package com.sqlflow.workflow;

import com.sqlflow.common.BadRequestException;
import com.sqlflow.workflow.dto.SqlNodeDef;
import com.sqlflow.workflow.dto.StageDef;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/** 节点变量名 = {code}_step_L_node_K；改名时 SQL / IF 里的引用一起改（前端 normalize 照抄这份规则）。 */
class NodeNamingTest {

    private static SqlNodeDef node(int idx, String name, String sql) {
        SqlNodeDef n = new SqlNodeDef();
        n.setOrderIndex(idx); n.setName(name); n.setSqlTemplate(sql);
        return n;
    }

    private static StageDef layer(int idx, SqlNodeDef... nodes) {
        StageDef s = new StageDef();
        s.setOrderIndex(idx); s.setKind("LAYER"); s.setExecutionMode("PARALLEL");
        s.setNodes(new ArrayList<>(List.of(nodes)));
        return s;
    }

    private static StageDef iff(int idx, String expr) {
        StageDef s = new StageDef();
        s.setOrderIndex(idx); s.setKind("IF"); s.setExpression(expr);
        return s;
    }

    @Test
    void prefixIsSqlFlowCode() {
        assertEquals("wf_17785d86_step_1_node_1", NodeNaming.nameFor("wf_17785d86", 1, 1));
        assertEquals("wf_17785d86_step_2_node_3", NodeNaming.nameFor("wf_17785d86", 2, 3));
    }

    @Test
    void codeMadeIntoValidIdentifier() {
        // code 允许 `-`、数字开头；变量名不行
        assertEquals("my_flow_step_1_node_1", NodeNaming.nameFor("my-flow", 1, 1));
        assertEquals("_9od_step_1_node_1", NodeNaming.nameFor("9od", 1, 1));
        assertTrue(NodeNaming.nameFor("9-a", 1, 1).matches("[A-Za-z_][A-Za-z0-9_]*"));
    }

    @Test
    void oldNamesAndReferencesMigrated() {
        // 老数据：step_1_node_1 / step_2_node_1，SQL 和 IF 里都引用了
        List<StageDef> stages = new ArrayList<>(List.of(
                layer(0, node(0, "step_1_node_1", "select id from orders where status = #{status}")),
                iff(1, "$step_1_node_1.rowCount > 0"),
                layer(2, node(0, "step_2_node_1",
                        "select * from users where id in ($step_1_node_1.rows[*].user_id) and x = $step_1_node_1.rows[0].id"))));
        NodeNaming.canonicalize("wf_abc", stages);
        assertEquals("wf_abc_step_1_node_1", stages.get(0).getNodes().get(0).getName());
        assertEquals("$wf_abc_step_1_node_1.rowCount > 0", stages.get(1).getExpression());
        assertEquals("wf_abc_step_2_node_1", stages.get(2).getNodes().get(0).getName());
        assertEquals("select * from users where id in ($wf_abc_step_1_node_1.rows[*].user_id) and x = $wf_abc_step_1_node_1.rows[0].id",
                stages.get(2).getNodes().get(0).getSqlTemplate());
        // #{输入参数} 不动
        assertEquals("select id from orders where status = #{status}", stages.get(0).getNodes().get(0).getSqlTemplate());
    }

    @Test
    void renumberAfterDeleteFollowsTheNode() {
        // 第 1 层原来有 node_1、node_2，删了 node_1：node_2 变成 node_1，后层对它的引用要跟过去
        List<StageDef> stages = new ArrayList<>(List.of(
                layer(0, node(1, "f_step_1_node_2", "select 1 as a")),
                layer(1, node(0, "f_step_2_node_1", "select $f_step_1_node_2.rows[0].a"))));
        NodeNaming.canonicalize("f", stages);
        assertEquals("f_step_1_node_1", stages.get(0).getNodes().get(0).getName());
        assertEquals("select $f_step_1_node_1.rows[0].a", stages.get(1).getNodes().get(0).getSqlTemplate());
    }

    @Test
    void renameIsSimultaneousNotChained() {
        // 两个名字互换位置：a→b 和 b→a 同时发生，不能连锁成 a→a
        assertEquals("$b $a", NodeNaming.rewrite("$a $b", Map.of("a", "b", "b", "a")));
        // `$ab` 不是 `$a` 后面接个 b
        assertEquals("$ab", NodeNaming.rewrite("$ab", Map.of("a", "z")));
    }

    @Test
    void tooLongCodeRejected() {
        String code = "c".repeat(60);
        List<StageDef> stages = new ArrayList<>(List.of(layer(0, node(0, "x", ""))));
        assertThrows(BadRequestException.class, () -> NodeNaming.canonicalize(code, stages));
    }
}
