package com.sqlflow.workflow;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sqlflow.common.BadRequestException;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * SQL 流**输入参数**的声明与校验（仿 tianzhi 的 inputSchema）。
 *
 * <p>存成 TEXT 里的 JSON 数组：{@code [{"name","type","required","defaultValue"}]}。
 * 存 text 不存 json 列 —— H2 和 MySQL 的 json 行为不一致，会破坏"本地绿=线上绿"。</p>
 *
 * <p>SQL 里用**裸的** {@code $参数名} 引用（和节点输出的 {@code $名.rows[0].列} 区分开）。</p>
 */
public final class InputParams {

    /** 支持的参数类型。`xxx[]` 是**数组**：SQL 里 `#{名字}` 会展开成 `?, ?, ...`（空数组 → NULL）。 */
    public static final List<String> TYPES = List.of("string", "long", "int", "boolean", "string[]", "long[]");

    /** 参数名：和节点名同一套字符集 */
    public static final String NAME_PATTERN = "[A-Za-z_][A-Za-z0-9_]*";

    private static final ObjectMapper JSON = new ObjectMapper();

    /** 一条输入参数声明 */
    public record Param(String name, String type, boolean required, String defaultValue) {}

    private InputParams() {}

    /** 解析输入参数清单 JSON。坏 JSON / 错形状 / 未知类型 / 非法名字都在这里拒。 */
    public static List<Param> parse(String json) {
        if (json == null || json.isBlank()) return List.of();
        JsonNode arr;
        try {
            arr = JSON.readTree(json);
        } catch (Exception e) {
            throw new BadRequestException("inputs", "输入参数不是合法 JSON");
        }
        if (arr == null || !arr.isArray()) {
            throw new BadRequestException("inputs", "输入参数要是 JSON 数组");
        }
        List<Param> out = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (JsonNode n : arr) {
            if (!n.isObject()) throw new BadRequestException("inputs", "每个输入参数要是对象");
            String name = n.path("name").asText("").trim();
            if (name.isEmpty()) throw new BadRequestException("inputs", "每个输入参数都要有名字");
            if (!name.matches(NAME_PATTERN)) {
                throw new BadRequestException("inputs", "参数名「" + name + "」只能用字母、数字、下划线，且不能以数字开头");
            }
            if (!seen.add(name)) throw new BadRequestException("inputs", "参数名「" + name + "」重复了");
            String type = n.path("type").asText("string").trim().toLowerCase(Locale.ROOT);
            if (!TYPES.contains(type)) {
                throw new BadRequestException("inputs", "参数「" + name + "」的类型只能是 " + String.join(" / ", TYPES));
            }
            String dv = n.hasNonNull("defaultValue") ? n.get("defaultValue").asText() : null;
            if (dv != null && dv.isEmpty()) dv = null;
            out.add(new Param(name, type, n.path("required").asBoolean(false), dv));
        }
        return out;
    }

    /** 是不是数组类型 */
    public static boolean isArray(String type) {
        return type != null && type.endsWith("[]");
    }

    /** 校验一个值是否符合声明的类型（数组逐个元素校验；入参是 List）。 */
    public static void checkType(String name, String type, Object v) {
        if (isArray(type)) {
            if (!(v instanceof List<?> list)) {
                throw new BadRequestException("输入参数「" + name + "」要是数组，收到的是：" + brief(String.valueOf(v)));
            }
            String elem = type.substring(0, type.length() - 2);
            for (Object o : list) checkScalar(name, elem, o == null ? null : String.valueOf(o));
            return;
        }
        checkScalar(name, type, v == null ? null : String.valueOf(v));
    }

    private static void checkScalar(String name, String type, String v) {
        switch (type) {
            case "long" -> {
                try { Long.parseLong(v.trim()); } catch (NumberFormatException e) {
                    throw new BadRequestException("输入参数「" + name + "」要是整数，收到的是：" + brief(v)); }
            }
            case "int" -> {
                try { Integer.parseInt(v.trim()); } catch (NumberFormatException e) {
                    throw new BadRequestException("输入参数「" + name + "」要是整数（32 位），收到的是：" + brief(v)); }
            }
            case "boolean" -> {
                String t = v.trim().toLowerCase(Locale.ROOT);
                if (!t.equals("true") && !t.equals("false") && !t.equals("1") && !t.equals("0")) {
                    throw new BadRequestException("输入参数「" + name + "」要是布尔值（true/false/1/0），收到的是：" + brief(v));
                }
            }
            default -> { /* string：不校验 */ }
        }
    }

    /**
     * 把请求带来的值按声明绑成「名字 → 值」。标量是 String，**数组是 List&lt;String&gt;**。
     * 未声明的名字一律拒（拼错一个可选参数名会静默拿到没过滤的数据）。
     */
    public static java.util.Map<String, Object> bind(List<Param> declared, java.util.Map<String, Object> given) {
        java.util.Map<String, Object> in = given == null ? java.util.Map.of() : given;
        List<String> names = declared.stream().map(Param::name).toList();
        for (String k : in.keySet()) {
            if (!names.contains(k)) {
                throw new BadRequestException("不认识输入参数「" + k + "」"
                        + (names.isEmpty() ? "（这个 SQL 流没有输入参数）" : "，已声明的：" + String.join("、", names)));
            }
        }
        java.util.Map<String, Object> out = new java.util.LinkedHashMap<>();
        for (Param p : declared) {
            Object raw = in.get(p.name());
            if (isArray(p.type())) {
                List<String> list = toList(raw);
                if (list.isEmpty() && p.defaultValue() != null && !p.defaultValue().isBlank()) {
                    list = toList(p.defaultValue());
                }
                if (list.isEmpty() && p.required()) {
                    throw new BadRequestException("缺少必填输入参数「" + p.name() + "」");
                }
                checkType(p.name(), p.type(), list);
                out.put(p.name(), list);
                continue;
            }
            String v = raw == null ? null : String.valueOf(raw);
            if (v != null && v.isEmpty()) v = null;
            if (v == null) {
                if (p.required()) throw new BadRequestException("缺少必填输入参数「" + p.name() + "」");
                v = p.defaultValue();
            }
            if (v != null) checkType(p.name(), p.type(), v);
            out.put(p.name(), v);
        }
        return out;
    }

    /** 值 → 数组：已经是 List 就用；字符串按逗号拆（也接受 JSON 数组文本）。 */
    private static List<String> toList(Object raw) {
        if (raw == null) return List.of();
        if (raw instanceof List<?> l) {
            List<String> out = new ArrayList<>();
            for (Object o : l) out.add(o == null ? null : String.valueOf(o));
            return out;
        }
        String s = String.valueOf(raw).trim();
        if (s.isEmpty()) return List.of();
        if (s.startsWith("[")) {
            try {
                JsonNode n = JSON.readTree(s);
                if (n.isArray()) {
                    List<String> out = new ArrayList<>();
                    for (JsonNode x : n) out.add(x.isNull() ? null : x.asText());
                    return out;
                }
            } catch (Exception ignored) { /* 落回按逗号拆 */ }
        }
        List<String> out = new ArrayList<>();
        for (String part : s.split(",")) {
            String t = part.trim();
            if (!t.isEmpty()) out.add(t);
        }
        return out;
    }

    private static String brief(String v) {
        if (v == null) return "(空)";
        String t = v.replaceAll("\\s+", " ").trim();
        return t.length() > 60 ? t.substring(0, 60) + "…" : t;
    }
}
