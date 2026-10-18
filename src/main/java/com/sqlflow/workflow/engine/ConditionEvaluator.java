package com.sqlflow.workflow.engine;

import com.sqlflow.common.BadRequestException;

/**
 * if 条件求值。见 DESIGN §4.3。确定性求值，绝不返回 false、绝不回落模型：
 * 解析不出直接抛 {@link BadRequestException}（400）。
 * <p>支持 {@code == != > >= < <=}、{@code 包含}/{@code 不包含}、{@code 为空}/{@code 非空}、
 * 以及单个 {@code $引用} 非空即真。左边必须是 {@code $引用}。
 */
public final class ConditionEvaluator {

    private static final String[] COMPARISON_OPS = {"==", "!=", ">=", "<=", ">", "<"};

    private final VariableTable vars;

    public ConditionEvaluator(VariableTable vars) {
        this.vars = vars;
    }

    public boolean eval(String expression) {
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

    /**
     * 只做结构校验（不需要变量表），返回左侧引用。供保存时校验使用。
     */
    public static ReferenceRenderer.ParsedRef validate(String expression) {
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
            return rhs.substring(1, rhs.length() - 1);
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
