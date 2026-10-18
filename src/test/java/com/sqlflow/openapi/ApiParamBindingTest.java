package com.sqlflow.openapi;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/** API 参数 → SQL 流参数的绑定规则（前端 ApiEditPage.effectiveBindings 照抄这份，改了两边一起改）。 */
class ApiParamBindingTest {

    private static Map<String, String> resolve(List<String> api, Set<String> wf, String mapJson) {
        return ApiService.resolveBindings(api, wf, ApiService.parseParamMap(mapJson));
    }

    @Test
    void sameNameAutoBinds() {
        assertEquals(Map.of("ccc", "ccc"), resolve(List.of("ccc", "nnn"), Set.of("ccc"), "{}"));
    }

    @Test
    void explicitClaimStopsSameNameAutoBind() {
        // 用户截图的场景：$nnn 显式绑 $ccc，$ccc 不能再被同名自动绑到 $ccc
        assertEquals(Map.of("nnn", "ccc"), resolve(List.of("nnn", "ccc"), Set.of("ccc"), "{\"nnn\":\"ccc\"}"));
    }

    @Test
    void explicitNotPassIsKept() {
        // 空串 = 明确选了「不传」，不能被同名自动绑回去
        assertEquals(Map.of(), resolve(List.of("ccc"), Set.of("ccc"), "{\"ccc\":\"\"}"));
        assertEquals(Map.of("ccc", ""), ApiService.parseParamMap("{\"ccc\":\"\"}"));
    }

    @Test
    void duplicateExplicitTargetsRejected() {
        ApiService.FieldError e = assertThrows(ApiService.FieldError.class,
                () -> ApiService.checkNoDuplicateTargets(ApiService.parseParamMap("{\"nnn\":\"ccc\",\"ccc\":\"ccc\"}")));
        assertTrue(e.getMessage().contains("$ccc"), e.getMessage());
    }

    @Test
    void notPassEntriesAreNotDuplicates() {
        assertDoesNotThrow(() -> ApiService.checkNoDuplicateTargets(ApiService.parseParamMap("{\"a\":\"\",\"b\":\"\"}")));
    }
}
