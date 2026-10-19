package com.sqlflow.workflow.engine;

import com.sqlflow.common.BadRequestException;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * IF 条件：原子判断 + and / or / 括号。
 * 用到的表达式都是**前端可视化编辑器会生成的那种写法**（ifCondition.ts 的 buildIfExpr），两边对得上。
 */
class ConditionEvaluatorTest {

    /** $o：两行订单；$e：空结果 */
    private static ConditionEvaluator ev() {
        VariableTable vars = new VariableTable();
        NodeOutput o = new NodeOutput();
        o.setColumns(List.of("id", "status", "note"));
        o.setRows(List.of(
                Map.of("id", 1, "status", "paid", "note", "it's a and b"),
                Map.of("id", 2, "status", "unpaid", "note", "x")));
        o.setRowCount(2);
        vars.put("o", o);
        NodeOutput e = new NodeOutput();
        e.setColumns(List.of("id"));
        e.setRows(List.of());
        e.setRowCount(0);
        vars.put("e", e);
        return new ConditionEvaluator(vars);
    }

    @Test
    void singleAtomStillWorks() {
        assertTrue(ev().eval("$o.rowCount > 0"));
        assertFalse(ev().eval("$e.rowCount > 0"));
        assertTrue(ev().eval("$o.rows[0].status == 'paid'"));
        assertTrue(ev().eval("$o.rows[*].status 包含 'unpaid'"));
        assertTrue(ev().eval("$e 为空"));
    }

    @Test
    void andOr() {
        assertTrue(ev().eval("$o.rowCount > 0 and $o.rows[0].status == 'paid'"));
        assertFalse(ev().eval("$o.rowCount > 0 and $e.rowCount > 0"));
        assertTrue(ev().eval("$e.rowCount > 0 or $o.rowCount == 2"));
        assertTrue(ev().eval("$o.rowCount > 0 AND $o.rowCount < 5"));   // 不分大小写
    }

    @Test
    void andBindsTighterThanOr() {
        // true or (false and false) = true；若从左到右算 (true or false) and false = false
        assertTrue(ev().eval("$o.rowCount > 0 or $e.rowCount > 0 and $e.rowCount > 1"));
        // 括号改优先级：(true or false) and false = false
        assertFalse(ev().eval("($o.rowCount > 0 or $e.rowCount > 0) and $e.rowCount > 1"));
    }

    @Test
    void groupsLikeVisualEditor() {
        // 前端「条件 1 AND 条件 2」，每组里多条就加括号
        String expr = "($o.rowCount > 0 and $o.rows[0].status == 'paid') and ($e.rowCount == 0 or $e.rowCount > 5)";
        assertTrue(ev().eval(expr));
    }

    @Test
    void keywordsInsideQuotesAreValues() {
        // 引号里的 and 不是关键字；'' 是转义的 '
        assertTrue(ev().eval("$o.rows[0].note == 'it''s a and b'"));
        assertTrue(ev().eval("$o.rows[*].note 包含 ' and '"));
    }

    @Test
    void validateCollectsEveryRefWithoutShortCircuit() {
        List<ReferenceRenderer.ParsedRef> refs = ConditionEvaluator.validate("$o.rowCount > 0 or ($e.rowCount == 0 and $x.rows[0].id == 1)");
        assertEquals(List.of("o", "e", "x"), refs.stream().map(ReferenceRenderer.ParsedRef::name).toList());
    }

    @Test
    void badShapesRejected() {
        assertThrows(BadRequestException.class, () -> ConditionEvaluator.validate("$o.rowCount > 0 and"));
        assertThrows(BadRequestException.class, () -> ConditionEvaluator.validate("($o.rowCount > 0"));
        assertThrows(BadRequestException.class, () -> ConditionEvaluator.validate("$o.rowCount > 0) or $e 为空"));
        assertThrows(BadRequestException.class, () -> ConditionEvaluator.validate("$o.rows[0].status == 'paid"));
        assertThrows(BadRequestException.class, () -> ConditionEvaluator.validate("$o.rowCount > 0 and 1 == 1"));
    }

    @Test
    void identifierContainingOrIsNotSplit() {
        // 节点名里带 or / and（wf_..._order、band）不能被当成关键字
        VariableTable vars = new VariableTable();
        NodeOutput o = new NodeOutput();
        o.setColumns(List.of("vendor")); o.setRows(List.of(Map.of("vendor", "a"))); o.setRowCount(1);
        vars.put("wf_order_band", o);
        assertTrue(new ConditionEvaluator(vars).eval("$wf_order_band.rows[0].vendor == 'a'"));
    }
}
