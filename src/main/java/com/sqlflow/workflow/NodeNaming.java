package com.sqlflow.workflow;

import com.sqlflow.common.BadRequestException;
import com.sqlflow.workflow.dto.SqlNodeDef;
import com.sqlflow.workflow.dto.StageDef;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 节点变量名（SQL 里引用它用的名字）= **{@code {SQL 流 code}_step_{第几层}_node_{层内第几个}}**，
 * 例如 {@code wf_17785d86_step_1_node_1}。按位置自动生成，人起的「节点名」是另一个字段（label）。
 *
 * <p><b>以后端为准</b>：保存时按位置重算一遍，名字变了就把所有 SQL / IF 里的旧引用一起改掉
 * （删了节点、挪了层、老数据用的是旧命名，都靠这一步对齐）。
 * 前端 WorkflowEditorPage 的 {@code normalize} 照同一规则实时预览 —— 改规则两边一起改。</p>
 */
public final class NodeNaming {

    /** 和 SqlNodeEntity.name 的列长一致 */
    static final int MAX_LEN = 64;

    /** {@code $名字} —— 后面跟的不是标识符字符才算一个完整的名字（`$ab` 不会被当成 `$a`） */
    private static final Pattern REF = Pattern.compile("\\$([A-Za-z_][A-Za-z0-9_]*)");

    private NodeNaming() {}

    /**
     * code 可能含 `-`、可能数字开头（code 规则比变量名宽），变量名不行：`-` → `_`，数字开头前面补 `_`。
     */
    public static String prefixOf(String code) {
        String p = code == null ? "" : code.trim().replace('-', '_');
        if (p.isEmpty()) return "";
        return Character.isDigit(p.charAt(0)) ? "_" + p : p;
    }

    public static String nameFor(String code, int layerNo, int nodeNo) {
        String p = prefixOf(code);
        return (p.isEmpty() ? "" : p + "_") + "step_" + layerNo + "_node_" + nodeNo;
    }

    /**
     * 按位置给所有节点重新起名，并把 SQL 模板和 IF 表达式里的旧引用换成新名字（就地改 stages）。
     * 调用前 stages 必须已经过校验（名字唯一、引用都可用）—— 重命名是一一映射，校验结论不变。
     */
    public static void canonicalize(String code, List<StageDef> stages) {
        if (stages == null) return;
        List<StageDef> sorted = new ArrayList<>(stages);
        sorted.sort(Comparator.comparingInt(s -> s.getOrderIndex() == null ? Integer.MAX_VALUE : s.getOrderIndex()));

        Map<String, String> rename = new HashMap<>();
        int layerNo = 0;
        for (StageDef s : sorted) {
            if (!"LAYER".equalsIgnoreCase(s.getKind() == null ? "" : s.getKind().trim()) || s.getNodes() == null) continue;
            layerNo++;
            List<SqlNodeDef> nodes = new ArrayList<>(s.getNodes());
            nodes.sort(Comparator.comparingInt(n -> n.getOrderIndex() == null ? Integer.MAX_VALUE : n.getOrderIndex()));
            for (int k = 0; k < nodes.size(); k++) {
                String next = nameFor(code, layerNo, k + 1);
                if (next.length() > MAX_LEN) {
                    throw new BadRequestException("code", "SQL 流 code 太长，节点变量名 " + next + " 超过 " + MAX_LEN + " 个字符");
                }
                SqlNodeDef n = nodes.get(k);
                if (n.getName() != null) rename.put(n.getName(), next);
                n.setName(next);
            }
        }

        for (StageDef s : sorted) {
            if (s.getExpression() != null) s.setExpression(rewrite(s.getExpression(), rename));
            if (s.getNodes() == null) continue;
            for (SqlNodeDef n : s.getNodes()) {
                if (n.getSqlTemplate() != null) n.setSqlTemplate(rewrite(n.getSqlTemplate(), rename));
            }
        }
    }

    /** 一次扫描同时换（不是逐个 replace —— 否则 a→b、b→c 会连锁成 a→c） */
    static String rewrite(String text, Map<String, String> rename) {
        if (rename.isEmpty() || text.indexOf('$') < 0) return text;
        Matcher m = REF.matcher(text);
        StringBuilder sb = new StringBuilder();
        while (m.find()) {
            String to = rename.get(m.group(1));
            m.appendReplacement(sb, Matcher.quoteReplacement(to == null ? m.group() : "$" + to));
        }
        m.appendTail(sb);
        return sb.toString();
    }
}
