package com.sqlflow.workflow;

import com.sqlflow.workflow.engine.RunResult;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 对外调用：按 code 执行启用中的 SQL 流。见 DESIGN §6.3。
 */
@RestController
@RequestMapping("/api/run")
public class RunController {

    private final WorkflowService service;

    public RunController(WorkflowService service) {
        this.service = service;
    }

    /** body 可选 = 输入参数值（{"city":"上海"}） */
    @PostMapping("/{code}")
    public RunResult run(@PathVariable String code,
                         @RequestBody(required = false) Map<String, Object> inputs) {
        return service.runByCode(code, inputs == null ? Map.of() : inputs);
    }
}
