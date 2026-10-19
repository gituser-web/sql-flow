package com.sqlflow.workflow.engine;

import com.sqlflow.common.BadRequestException;

import java.util.ArrayList;
import java.util.List;

/**
 * if 条件求值。见 DESIGN §4.3。确定性求值，绝不返回 false、绝不回落模型：
 * 解析不出直接抛 {@link BadRequestException}（400）。
 * <p>原子判断支持 {@code == != > >= < <=}、{@code 包含}/{@code 不包含}、{@code 为空}/{@code 非空}、
 * 以及单个 {@code $引用} 非空即真；左边必须是 {@code $引用}。
 * 原子之间可用 {@code and} / {@code or} / 括号组合（and 优先，和 SQL 一样）。
 */
public final class ConditionEvaluator {

    private static final String[] COMPARISON_OPS = {"==", "!=", ">=", "<=", ">", "<"};

    private final VariableTable vars;

    public ConditionEvaluator(VariableTable vars) {
        this.vars = vars;
    }

    // ── 组合：and / or / 括号 ──────────────────────────────────
    // 语法（and 比 or 绑得紧，和 SQL 一样）：
    //   expr    := andExpr ( or andExpr )*
    //   andExpr := primary ( and primary )*
    //   primary := '(' expr ')' | 原子判断（下面 evalAtom 那套，一个字都没改）
    // and / or 不分大小写，前后必须是空白或括号；引号里的不算（`'a and b'` 是一个值）。

    /** 解析出来的条件树 */
    sealed interface Node permits Atom, AndNode, OrNode {}
    record Atom(String text) implements Node {}
    record AndNode(List<Node> parts) implements Node {}
    record OrNode(List<Node> parts) implements Node {}

    public boolean eval(String expression) {
        return evalNode(parse(expression));
    }

    /**
     * 只做结构校验（不需要变量表），返回**所有**原子判断左边的引用。供保存时校验使用。
     */
    public static List<ReferenceRenderer.ParsedRef> validate(String expression) {
        List<ReferenceRenderer.ParsedRef> refs = new ArrayList<>();
        collect(parse(expression), refs);
        return refs;
    }

    private boolean evalNode(Node n) {
        if (n instanceof Atom a) return evalAtom(a.text());
        if (n instanceof AndNode and) {
            for (Node p : and.parts()) if (!evalNode(p)) return false;
            return true;
        }
        for (Node p : ((OrNode) n).parts()) if (evalNode(p)) return true;
        return false;
    }

    /** 校验要走**每一个**原子（不能短路，否则 `a or 写错了` 会漏检） */
    private static void collect(Node n, List<ReferenceRenderer.ParsedRef> out) {
        if (n instanceof Atom a) { out.add(validateAtom(a.text())); return; }
        List<Node> parts = n instanceof AndNode and ? and.parts() : ((OrNode) n).parts();
        for (Node p : parts) collect(p, out);
    }

    static Node parse(String expression) {
        if (expression == null || expression.isBlank()) {
            throw new BadRequestException("条件表达式为空");
        }
        return parseOr(expression.trim(), expression.trim());
    }

    private static Node parseOr(String s, String whole) {
        List<String> parts = splitTop(s, "or", whole);
        if (parts.size() == 1) return parseAnd(parts.get(0), whole);
        List<Node> nodes = new ArrayList<>();
        for (String p : parts) nodes.add(parseAnd(p, whole));
        return new OrNode(nodes);
    }

    private static Node parseAnd(String s, String whole) {
        List<String> parts = splitTop(s, "and", whole);
        if (parts.size() == 1) return parsePrimary(parts.get(0), whole);
        List<Node> nodes = new ArrayList<>();
        for (String p : parts) nodes.add(parsePrimary(p, whole));
        return new AndNode(nodes);
    }

    private static Node parsePrimary(String s, String whole) {
        String t = s.trim();
        if (t.isEmpty()) {
            throw new BadRequestException("条件表达式里 and / or 两边要有判断: " + whole);
        }
        // 整段被一对括号包住 → 剥掉再解析
        if (t.charAt(0) == '(' && matchingParen(t, 0, whole) == t.length() - 1) {
            return parseOr(t.substring(1, t.length() - 1).trim(), whole);
        }
        if (t.charAt(0) == '(') {
            throw new BadRequestException("括号后面要接 and / or: " + whole);
        }
        return new Atom(t);
    }

    /** 在**顶层**（不在括号里、不在引号里）按关键字 kw 切开 */
    private static List<String> splitTop(String s, String kw, String whole) {
        List<String> out = new ArrayList<>();
        int depth = 0, start = 0, n = s.length(), k = kw.length();
        char quote = 0;
        for (int i = 0; i < n; i++) {
            char c = s.charAt(i);
            if (quote != 0) {
                if (c == quote) {
                    // SQL 风格转义：引号里连着两个 '' 是一个 '
                    if (i + 1 < n && s.charAt(i + 1) == quote) { i++; continue; }
                    quote = 0;
                }
                continue;
            }
            if (c == '\'' || c == '"') { quote = c; continue; }
            if (c == '(') { depth++; continue; }
            if (c == ')') {
                if (--depth < 0) throw new BadRequestException("括号不配对: " + whole);
                continue;
            }
            if (depth == 0 && i + k <= n && s.regionMatches(true, i, kw, 0, k)
                    && (i == 0 || isBoundary(s.charAt(i - 1)))
                    && (i + k == n || isBoundary(s.charAt(i + k)))) {
                out.add(s.substring(start, i));
                start = i + k;
                i += k - 1;
            }
        }
        if (quote != 0) throw new BadRequestException("引号没闭合: " + whole);
        if (depth != 0) throw new BadRequestException("括号不配对: " + whole);
        out.add(s.substring(start));
        return out;
    }

    private static boolean isBoundary(char c) {
        return Character.isWhitespace(c) || c == '(' || c == ')';
    }

    /** s[open] 是 '('，返回和它配对的 ')' 的位置 */
    private static int matchingParen(String s, int open, String whole) {
        int depth = 0;
        char quote = 0;
        for (int i = open; i < s.length(); i++) {
            char c = s.charAt(i);
            if (quote != 0) {
                if (c == quote) {
                    if (i + 1 < s.length() && s.charAt(i + 1) == quote) { i++; continue; }
                    quote = 0;
                }
                continue;
            }
            if (c == '\'' || c == '"') quote = c;
            else if (c == '(') depth++;
            else if (c == ')' && --depth == 0) return i;
        }
        throw new BadRequestException("括号不配对: " + whole);
    }

    // ── 原子判断：一个 $引用 + 一个比较 ───────────────────────

    private boolean evalAtom(String expression) {
        String s = normalize(expression);
        ReferenceRenderer.ParsedRef ref = parseLeft(s);
        String rest = s.substring(ref.end()).trim();

        if (rest.isEmpty()) {
            return isNonEmpty(ref);
        }
        if (rest.equals("为空")) {
            return !isNonEmpty(ref);
        }
        if (rest.equals("非空")) {
            return isNonEmpty(ref);
        }
        if (rest.startsWith("不包含")) {
            return !contains(ref, literalString(rest.substring("不包含".length()).trim(), s));
        }
        if (rest.startsWith("包含")) {
            return contains(ref, literalString(rest.substring("包含".length()).trim(), s));
        }
        for (String op : COMPARISON_OPS) {
            if (rest.startsWith(op)) {
                String rhs = rest.substring(op.length()).trim();
                if (rhs.isEmpty()) {
                    throw new BadRequestException("条件表达式缺少右值: " + s);
                }
                return compare(ref, op, rhs);
            }
        }
        throw new BadRequestException("无法解析条件表达式: " + s);
    }

    private static ReferenceRenderer.ParsedRef validateAtom(String expression) {
        String s = normalize(expression);
        ReferenceRenderer.ParsedRef ref = parseLeft(s);
        String rest = s.substring(ref.end()).trim();

        if (rest.isEmpty() || rest.equals("为空") || rest.equals("非空")) {
            return ref;
        }
        if (rest.startsWith("不包含") || rest.startsWith("包含")) {
            return ref;
        }
        for (String op : COMPARISON_OPS) {
            if (rest.startsWith(op)) {
                if (rest.substring(op.length()).trim().isEmpty()) {
                    throw new BadRequestException("条件表达式缺少右值: " + s);
                }
                return ref;
            }
        }
        throw new BadRequestException("无法解析条件表达式: " + s);
    }

    private static String normalize(String expression) {
        if (expression == null || expression.isBlank()) {
            throw new BadRequestException("条件表达式为空");
        }
        String s = expression.trim();
        if (s.contains("${")) {
            throw new BadRequestException("条件表达式不支持 ${...}");
        }
        if (!s.startsWith("$")) {
            throw new BadRequestException("条件表达式左边必须是 $引用: " + s);
        }
        return s;
    }

    /**
     * 解析左边的 {@code $引用}。带 {@code .字段} 的走 {@link ReferenceRenderer#parseRef}；
     * 只有 {@code $name}（无字段）时返回 kind="bare"（用于「非空即真 / 为空 / 非空」）。
     */
    private static ReferenceRenderer.ParsedRef parseLeft(String s) {
        int p = 1; // s[0] == '$'
        if (p < s.length() && s.charAt(p) == '{') {
            throw new BadRequestException("条件表达式不支持 ${...}");
        }
        int start = p;
        if (p >= s.length() || !isIdentStart(s.charAt(p))) {
            throw new BadRequestException("无法解析引用: " + s);
        }
        p++;
        while (p < s.length() && isIdentPart(s.charAt(p))) {
            p++;
        }
        if (p < s.length() && s.charAt(p) == '.') {
            return ReferenceRenderer.parseRef(s, 0);
        }
        return new ReferenceRenderer.ParsedRef(s.substring(start, p), "bare", null, null, p);
    }

    private static boolean isIdentStart(char c) {
        return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c == '_';
    }

    private static boolean isIdentPart(char c) {
        return isIdentStart(c) || (c >= '0' && c <= '9');
    }

    private Object scalarOf(ReferenceRenderer.ParsedRef ref) {
        return switch (ref.kind()) {
            case "rowCount" -> vars.rowCount(ref.name());
            case "truncated" -> vars.get(ref.name()).isTruncated();
            case "cell" -> vars.scalar(ref.name(), "rows[" + ref.rowIndex() + "]." + ref.column());
            default -> throw new BadRequestException("该引用不能用于标量比较: $" + ref.name());
        };
    }

    private boolean isNonEmpty(ReferenceRenderer.ParsedRef ref) {
        switch (ref.kind()) {
            case "bare":
            case "rowCount":
                return vars.rowCount(ref.name()) > 0;
            case "truncated":
                return vars.get(ref.name()).isTruncated();
            case "cell": {
                Object v = vars.scalar(ref.name(), "rows[" + ref.rowIndex() + "]." + ref.column());
                return v != null && !String.valueOf(v).isEmpty();
            }
            case "list":
                return !vars.columnList(ref.name(), ref.column()).isEmpty();
            default:
                throw new BadRequestException("无法求值: $" + ref.name());
        }
    }

    private boolean contains(ReferenceRenderer.ParsedRef ref, String needle) {
        if (ref.kind().equals("list")) {
            for (Object v : vars.columnList(ref.name(), ref.column())) {
                if (v != null && String.valueOf(v).contains(needle)) {
                    return true;
                }
            }
            return false;
        }
        Object v = scalarOf(ref);
        return v != null && String.valueOf(v).contains(needle);
    }

    private boolean compare(ReferenceRenderer.ParsedRef ref, String op, String rhsRaw) {
        Object left = scalarOf(ref);
        Object right = literalValue(rhsRaw);
        Double ln = asNumber(left);
        Double rn = asNumber(right);

        if (op.equals("==") || op.equals("!=")) {
            boolean eq = (ln != null && rn != null)
                    ? ln.doubleValue() == rn.doubleValue()
                    : str(left).equals(str(right));
            return op.equals("==") == eq;
        }

        int cmp = (ln != null && rn != null)
                ? Double.compare(ln, rn)
                : str(left).compareTo(str(right));
        return switch (op) {
            case ">" -> cmp > 0;
            case ">=" -> cmp >= 0;
            case "<" -> cmp < 0;
            case "<=" -> cmp <= 0;
            default -> throw new BadRequestException("不支持的操作符: " + op);
        };
    }

    private static String str(Object o) {
        return o == null ? "" : String.valueOf(o);
    }

    private static Double asNumber(Object o) {
        if (o instanceof Number n) {
            return n.doubleValue();
        }
        if (o instanceof String s) {
            try {
                return Double.parseDouble(s.trim());
            } catch (NumberFormatException e) {
                return null;
            }
        }
        return null;
    }

    private static String literalString(String rhsRaw, String whole) {
        if (rhsRaw.isEmpty()) {
            throw new BadRequestException("条件表达式缺少右值: " + whole);
        }
        return String.valueOf(literalValue(rhsRaw));
    }

    private static Object literalValue(String rhs) {
        if (rhs.length() >= 2
                && ((rhs.charAt(0) == '\'' && rhs.charAt(rhs.length() - 1) == '\'')
                || (rhs.charAt(0) == '"' && rhs.charAt(rhs.length() - 1) == '"'))) {
            char q = rhs.charAt(0);
            // 引号里 '' 是一个 '（前端可视化编辑器就是这么转义的）
            return rhs.substring(1, rhs.length() - 1).replace("" + q + q, "" + q);
        }
        if (rhs.matches("-?\\d+")) {
            try {
                return Long.parseLong(rhs);
            } catch (NumberFormatException e) {
                return rhs;
            }
        }
        if (rhs.matches("-?\\d+\\.\\d+")) {
            try {
                return Double.parseDouble(rhs);
            } catch (NumberFormatException e) {
                return rhs;
            }
        }
        // 裸词
        return rhs;
    }
}
