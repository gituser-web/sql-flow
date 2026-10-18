package com.sqlflow.workflow.engine;

import com.sqlflow.common.BadRequestException;
import org.apache.ibatis.builder.SqlSourceBuilder;
import org.apache.ibatis.mapping.BoundSql;
import org.apache.ibatis.mapping.ParameterMapping;
import org.apache.ibatis.mapping.SqlSource;
import org.apache.ibatis.session.Configuration;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 把 SQL 模板渲染成 {@code ?} + 绑定值。见 DESIGN §4.2。
 *
 * <p><b>两种占位符，语义完全不同：</b></p>
 * <ul>
 *   <li>{@code #{参数名}} —— <b>输入参数</b>（HTTP 入参 / SQL 流输入）。用的是 MyBatis 生态里
 *       "绑定参数"的标准写法，一眼就懂；反过来说 {@code $变量} 在 MyBatis 语境里恰恰容易让人
 *       联想到危险的 <code>${}</code>（字符串拼接）。</li>
 *   <li>{@code $节点名.rows[0].列} / {@code $节点名.rows[*].列} / {@code $节点名.rowCount} ——
 *       <b>前面节点的输出</b>。整列（{@code [*]}）会展开成 {@code ?, ?, ...}，空列表输出字面 {@code NULL}。</li>
 * </ul>
 *
 * <p><b>为什么用 MyBatis 的 {@link SqlSourceBuilder} 而不是自己写正则：</b>
 * {@code #{}} 的语义本来就有权威实现，自己写一份就多一份"可能和它对不上"的东西
 * （反斜杠转义怎么算、{@code #{a,jdbcType=BIGINT}} 这种属性写法怎么算、将来它改行为怎么办）。
 * 用它，渲染出来的东西和 MyBatis 自己跑 SQL 时的理解必然一致 —— 这不是省事，是少一个能出错的地方。</p>
 *
 * <p><b>怎么让两种占位符一起过 MyBatis：</b>先把 {@code $节点.字段} 求值、换成
 * {@code #{__pN}}（整列换成 {@code #{__pN_0}, #{__pN_1}, ...}，空列换成字面 {@code NULL}），
 * 再整条交给 {@code SqlSourceBuilder}。这样绑定值**天然按 SQL 里出现的顺序**排好，不用自己对齐。</p>
 *
 * <p><b>{@code ${}} 一律拒。</b>那是字符串拼接，会把调用方给的值拼进 SQL 文本。</p>
 */
public final class ReferenceRenderer {

    /** 共享一个 Configuration：它在这里只被读（解析模板时查类型处理器），不写。 */
    private static final Configuration CONFIGURATION = new Configuration();

    private final VariableTable vars;

    public ReferenceRenderer(VariableTable vars) {
        this.vars = vars;
    }

    /** 渲染结果：渲染后的 SQL 与按出现顺序的绑定值（一律按字符串绑定）。 */
    public record Rendered(String sql, List<String> params) {}

    /** 解析出的引用。kind ∈ {rowCount, truncated, cell, list}。 */
    public record ParsedRef(String name, String kind, Integer rowIndex, String column, int end) {}

    public Rendered render(String template) {
        if (template == null) {
            return new Rendered("", List.of());
        }
        if (template.contains("${")) {
            throw new BadRequestException("SQL 里不能写 ${...}（那是字符串拼接，会把调用方给的值拼进 SQL 文本）。输入参数请写 #{参数名}");
        }

        // 1) 把 $节点.字段 求值、换成 #{__pN}（整列换成多个 #{__pN}）
        Map<String, Object> values = new LinkedHashMap<>(vars.scalars());
        StringBuilder t = new StringBuilder();
        int i = 0;
        int n = template.length();
        int k = 0;
        while (i < n) {
            char c = template.charAt(i);
            if (c == '#' && i + 1 < n && template.charAt(i + 1) == '{') {
                // #{参数名} —— MyBatis 风格。**数组型参数展开成 ?, ?, ...**（空数组 → NULL）；标量原样交给 MyBatis。
                int close = template.indexOf('}', i + 2);
                if (close < 0) {
                    throw new BadRequestException("SQL 里的 #{ 没闭合，应该是 #{参数名}");
                }
                String name = template.substring(i + 2, close).trim();
                if (!name.matches("[A-Za-z_][A-Za-z0-9_]*")) {
                    throw new BadRequestException("SQL 里的 #{...} 参数名不合法: " + name + "（只能是字母、数字、下划线）");
                }
                if (vars.hasList(name)) {
                    List<String> vs = vars.listOf(name);
                    if (vs.isEmpty()) {
                        t.append("NULL");
                    } else {
                        for (int j = 0; j < vs.size(); j++) {
                            String key = "__a" + (k++);
                            values.put(key, vs.get(j));
                            t.append(j == 0 ? "#{" : ", #{").append(key).append("}");
                        }
                    }
                } else {
                    t.append("#{").append(name).append("}");
                }
                i = close + 1;
                continue;
            }
            if (c == '$') {
                ParsedRef ref = parseRef(template, i);
                if (ref.kind().equals("list")) {
                    List<Object> vs = vars.columnList(ref.name(), ref.column());
                    if (vs.isEmpty()) {
                        t.append("NULL");   // IN (NULL) 对任何行都不成立：结果为空且语法合法
                    } else {
                        for (int j = 0; j < vs.size(); j++) {
                            String key = "__p" + (k++);
                            values.put(key, vs.get(j));
                            t.append(j == 0 ? "#{" : ", #{").append(key).append("}");
                        }
                    }
                } else {
                    String key = "__p" + (k++);
                    values.put(key, scalarOf(ref));
                    t.append("#{").append(key).append("}");
                }
                i = ref.end();
            } else {
                t.append(c);
                i++;
            }
        }

        // 2) 整条交给 MyBatis 渲染 #{}
        SqlSource source;
        try {
            source = new SqlSourceBuilder(CONFIGURATION).parse(t.toString(), Map.class, null);
        } catch (Exception e) {
            throw new BadRequestException("SQL 模板解析失败：" + rootMessage(e));
        }
        BoundSql bound;
        try {
            bound = source.getBoundSql(values);
        } catch (Exception e) {
            throw new BadRequestException("SQL 参数绑定失败：" + rootMessage(e));
        }

        List<String> params = new ArrayList<>();
        for (ParameterMapping pm : bound.getParameterMappings()) {
            String name = pm.getProperty();
            if (!values.containsKey(name)) {
                throw new BadRequestException("SQL 里用了 #{" + name + "}，但输入参数里没有声明它");
            }
            Object v = values.get(name);
            params.add(v == null ? null : String.valueOf(v));
        }
        return new Rendered(bound.getSql(), params);
    }

    /** 取一个引用的**标量值**（整列不走这里）。 */
    private Object scalarOf(ParsedRef ref) {
        return switch (ref.kind()) {
            case "rowCount" -> vars.rowCount(ref.name());
            case "truncated" -> vars.get(ref.name()).isTruncated();
            case "cell" -> vars.scalar(ref.name(), "rows[" + ref.rowIndex() + "]." + ref.column());
            default -> throw new BadRequestException("无法解析引用: $" + ref.name());
        };
    }

    /**
     * 从 {@code start}（指向 {@code $}）解析一个节点引用，返回引用与结束下标。
     * 解析不出直接抛 {@link BadRequestException}。
     */
    public static ParsedRef parseRef(String s, int start) {
        int n = s.length();
        int p = start;
        if (p >= n || s.charAt(p) != '$') {
            throw new BadRequestException("引用必须以 $ 开头");
        }
        p++;
        if (p < n && s.charAt(p) == '{') {
            throw new BadRequestException("SQL 里不能写 ${...}；输入参数请写 #{参数名}");
        }
        int nameStart = p;
        if (p >= n || !isIdentStart(s.charAt(p))) {
            throw new BadRequestException("无法解析引用: " + s.substring(start));
        }
        p++;
        while (p < n && isIdentPart(s.charAt(p))) {
            p++;
        }
        String name = s.substring(nameStart, p);

        if (p >= n || s.charAt(p) != '.') {
            // 裸的 $名字 = 想引用输入参数。输入参数有专门的写法。
            throw new BadRequestException("$" + name + " 这种写法不支持："
                    + "**输入参数**要写 #{" + name + "}；**节点输出**要写 $" + name + ".rows[0].列");
        }
        p++;
        int propStart = p;
        if (p >= n || !isIdentStart(s.charAt(p))) {
            throw new BadRequestException("无法解析引用 $" + name);
        }
        p++;
        while (p < n && isIdentPart(s.charAt(p))) {
            p++;
        }
        String prop = s.substring(propStart, p);

        if (prop.equals("rowCount")) {
            return new ParsedRef(name, "rowCount", null, null, p);
        }
        if (prop.equals("truncated")) {
            return new ParsedRef(name, "truncated", null, null, p);
        }
        if (prop.equals("rows")) {
            if (p >= n || s.charAt(p) != '[') {
                throw new BadRequestException("无法解析引用 $" + name + ".rows（缺少 [）");
            }
            p++;
            boolean star = false;
            Integer idx = null;
            if (p < n && s.charAt(p) == '*') {
                star = true;
                p++;
            } else {
                int numStart = p;
                while (p < n && Character.isDigit(s.charAt(p))) {
                    p++;
                }
                if (p == numStart) {
                    throw new BadRequestException("无法解析引用 $" + name + ".rows[（需要下标或 *）");
                }
                idx = Integer.parseInt(s.substring(numStart, p));
            }
            if (p >= n || s.charAt(p) != ']') {
                throw new BadRequestException("无法解析引用 $" + name + ".rows[..]（缺少 ]）");
            }
            p++;
            if (p >= n || s.charAt(p) != '.') {
                throw new BadRequestException("无法解析引用 $" + name + ".rows[..]（缺少 .列名）");
            }
            p++;
            int colStart = p;
            if (p >= n || !isIdentStart(s.charAt(p))) {
                throw new BadRequestException("无法解析引用 $" + name + ".rows[..]（缺少列名）");
            }
            p++;
            while (p < n && isIdentPart(s.charAt(p))) {
                p++;
            }
            String col = s.substring(colStart, p);
            return new ParsedRef(name, star ? "list" : "cell", idx, col, p);
        }
        throw new BadRequestException("无法解析引用 $" + name + "." + prop);
    }

    /** 扫描模板，返回引用到的所有名字（`#{参数名}` 和 `$名.字段` 都算；同时做语法校验）。 */
    public static List<String> referencedNames(String template) {
        List<String> names = new ArrayList<>();
        if (template == null) {
            return names;
        }
        if (template.contains("${")) {
            throw new BadRequestException("SQL 里不能写 ${...}；输入参数请写 #{参数名}");
        }
        // #{参数名} —— 输入参数
        java.util.regex.Matcher m = java.util.regex.Pattern
                .compile("#\\{\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*}").matcher(template);
        while (m.find()) {
            if (!names.contains(m.group(1))) names.add(m.group(1));
        }
        // $名.字段 —— 节点输出
        int i = 0;
        int n = template.length();
        while (i < n) {
            if (template.charAt(i) == '$') {
                ParsedRef ref = parseRef(template, i);
                if (!names.contains(ref.name())) names.add(ref.name());
                i = ref.end();
            } else {
                i++;
            }
        }
        return names;
    }

    private static String rootMessage(Throwable e) {
        Throwable t = e;
        while (t.getCause() != null && t.getCause() != t) {
            t = t.getCause();
        }
        String msg = t.getMessage() == null ? t.getClass().getSimpleName() : t.getMessage();
        int nl = msg.indexOf('\n');
        return nl > 0 ? msg.substring(0, nl) : msg;
    }

    private static boolean isIdentStart(char c) {
        return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c == '_';
    }

    private static boolean isIdentPart(char c) {
        return isIdentStart(c) || (c >= '0' && c <= '9');
    }
}
