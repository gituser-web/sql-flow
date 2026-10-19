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
        assertTrue(ev().eval("$o.rows[*].status contains 'unpaid'"));
        assertTrue(ev().eval("$e is empty"));
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
        assertTrue(ev().eval("$o.rows[*].note contains ' and '"));
        assertFalse(ev().eval("$o.rows[0].note == 'is not empty or not contains'"));   // 引号里的关键字是值
        assertTrue(ev().eval("$o.rows[*].note contains 'a and b' or $e is not empty"));
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
        assertThrows(BadRequestException.class, () -> ConditionEvaluator.validate("$o.rowCount > 0) or $e is empty"));
        assertThrows(BadRequestException.class, () -> ConditionEvaluator.validate("$o.rows[0].status == 'paid"));
        assertThrows(BadRequestException.class, () -> ConditionEvaluator.validate("$o.rowCount > 0 and 1 == 1"));
    }

    @Test
    void englishKeywords() {
        assertTrue(ev().eval("$o is not empty"));
        assertFalse(ev().eval("$e is not empty"));
        assertFalse(ev().eval("$o is empty"));
        assertTrue(ev().eval("$o.rows[0].status contains 'pa'"));
        assertFalse(ev().eval("$o.rows[0].status contains 'un'"));
        assertTrue(ev().eval("$o.rows[0].status not contains 'un'"));      // not contains 先于 contains 匹配
        assertFalse(ev().eval("$o.rows[*].status not contains 'unpaid'"));
        assertTrue(ev().eval("$o.rows[*].status not contains 'refund'"));
        assertTrue(ev().eval("$o.rows[0].id contains 1"));                 // 数字 / 裸词右值
        assertTrue(ev().eval("$o.rows[0].status contains'pa'"));           // 关键字后直接跟引号
    }

    @Test
    void englishKeywordsAreCaseInsensitive() {
        assertTrue(ev().eval("$e IS EMPTY"));
        assertTrue(ev().eval("$o Is Not  Empty"));
        assertTrue(ev().eval("$o.rows[*].status CONTAINS 'unpaid'"));
        assertTrue(ev().eval("$o.rows[0].status NOT Contains 'un'"));
        assertTrue(ev().eval("($e IS EMPTY OR $e.rowCount > 0) AND $o.rows[0].status Not Contains 'x'"));
    }

    @Test
    void keywordOpsWithAndOrSplitCorrectly() {
        // is not empty / not contains 里没有 and / or，不能被切坏；和 and / or 组合也要对
        assertTrue(ev().eval("$o is not empty and $o.rows[0].status not contains 'un'"));
        assertTrue(ev().eval("$e is not empty or $o.rows[*].note contains 'and'"));
        List<ReferenceRenderer.ParsedRef> refs = ConditionEvaluator.validate("$o is not empty and ($e is empty or $o.rows[0].status not contains 'x')");
        assertEquals(List.of("o", "e", "o"), refs.stream().map(ReferenceRenderer.ParsedRef::name).toList());
    }

    @Test
    void chineseKeywordsRejected() {
        for (String expr : List.of("$o.rows[*].status 包含 'unpaid'", "$o.rows[*].status 不包含 'x'", "$e 为空", "$o 非空")) {
            BadRequestException ex = assertThrows(BadRequestException.class, () -> ev().eval(expr));
            assertTrue(ex.getMessage().contains("英文"), ex.getMessage());
            assertThrows(BadRequestException.class, () -> ConditionEvaluator.validate(expr));
        }
        BadRequestException ex = assertThrows(BadRequestException.class, () -> ConditionEvaluator.validate("$e 为空"));
        assertTrue(ex.getMessage().contains("is empty"), ex.getMessage());
        ex = assertThrows(BadRequestException.class, () -> ConditionEvaluator.validate("$o.rows[0].status 不包含 'x'"));
        assertTrue(ex.getMessage().contains("not contains"), ex.getMessage());
    }

    @Test
    void keywordMisuseRejected() {
        assertThrows(BadRequestException.class, () -> ConditionEvaluator.validate("$o.rows[0].status contains"));
        assertThrows(BadRequestException.class, () -> ConditionEvaluator.validate("$o.rows[0].status not contains"));
        assertThrows(BadRequestException.class, () -> ConditionEvaluator.validate("$o is empty 1"));
        assertThrows(BadRequestException.class, () -> ConditionEvaluator.validate("$o.rows[0].status containsx 'a'"));
        assertThrows(BadRequestException.class, () -> ConditionEvaluator.validate("$o.rows[0].status like 'a'"));
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
