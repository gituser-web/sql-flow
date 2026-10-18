package com.sqlflow.workflow;

import com.sqlflow.workflow.dto.WorkflowDef;
import com.sqlflow.workflow.engine.RunResult;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * SQL 流 REST。见 DESIGN §6.2。
 */
@RestController
@RequestMapping("/api/workflows")
public class WorkflowController {

    private final WorkflowService service;

    public WorkflowController(WorkflowService service) {
        this.service = service;
    }

    @GetMapping
    public List<WorkflowDef> list() {
        return service.list();
    }

    @GetMapping("/{id}")
    public WorkflowDef get(@PathVariable Long id) {
        return service.get(id);
    }

    @PostMapping
    public WorkflowDef create(@RequestBody WorkflowDef def) {
        return service.create(def);
    }

    @PutMapping("/{id}")
    public WorkflowDef update(@PathVariable Long id, @RequestBody WorkflowDef def) {
        return service.update(id, def);
    }

    @DeleteMapping("/{id}")
    public Map<String, Object> delete(@PathVariable Long id) {
        service.delete(id);
        return Map.of("deleted", true);
    }

    @PostMapping("/{id}/status")
    public WorkflowDef setStatus(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        boolean enabled = body != null && Boolean.TRUE.equals(body.get("enabled"));
        return service.setStatus(id, enabled);
    }

    /** 试跑。body 可选 = 输入参数值（{"city":"上海"}）；没输入参数就传空。 */
    @PostMapping("/{id}/run")
    public RunResult run(@PathVariable Long id,
                         @RequestBody(required = false) Map<String, Object> inputs) {
        return service.run(id, inputs == null ? Map.of() : inputs);
    }

    /**
     * 探列：给条件编辑器用 —— 返回某条 SQL 的真实列名。
     * body = {@code {"dataSourceId":1,"sqlTemplate":"select ..."}}；失败时返回 {@code {columns:[], error}}。
     */
    @PostMapping("/probe-columns")
    public Map<String, Object> probeColumns(@RequestBody Map<String, Object> body) {
        Object raw = body == null ? null : body.get("dataSourceId");
        Long dsId = null;
        if (raw != null && !String.valueOf(raw).isBlank()) {
            try {
                dsId = Long.valueOf(String.valueOf(raw).trim());
            } catch (NumberFormatException ignored) {
                // 传了非数字就当作没选，由 service 给出"没选数据源"
            }
        }
        String sql = body == null || body.get("sqlTemplate") == null
                ? null : String.valueOf(body.get("sqlTemplate"));
        return service.probeColumns(dsId, sql);
    }
}
