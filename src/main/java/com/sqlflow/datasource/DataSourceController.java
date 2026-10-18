package com.sqlflow.datasource;

import com.sqlflow.datasource.dto.ConnectionTestRequest;
import com.sqlflow.datasource.dto.DataSourceRequest;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 数据源 REST API（DESIGN §6.1），路径 {@code /api/datasources}，共 6 个端点。
 */
@RestController
@RequestMapping("/api/datasources")
public class DataSourceController {

    private final DataSourceService service;

    public DataSourceController(DataSourceService service) {
        this.service = service;
    }

    @GetMapping
    public List<DataSourceEntity> list() {
        return service.list();
    }

    @GetMapping("/{id}")
    public DataSourceEntity get(@PathVariable Long id) {
        return service.get(id);
    }

    @PostMapping
    public DataSourceEntity create(@RequestBody DataSourceRequest request) {
        return service.create(request);
    }

    @PutMapping("/{id}")
    public DataSourceEntity update(@PathVariable Long id, @RequestBody DataSourceRequest request) {
        return service.update(id, request);
    }

    @DeleteMapping("/{id}")
    public Map<String, Object> delete(@PathVariable Long id) {
        service.delete(id);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("deleted", true);
        return body;
    }

    /** 连接测试：返回 {@code {ok, message}}，连不上不抛 500。 */
    /** 列出这个数据源里的表（给"可视化单表查询"用） */
    @GetMapping("/{id}/tables")
    public Object tables(@PathVariable Long id) {
        return java.util.Map.of("tables", service.listTables(id));
    }

    @PostMapping("/test")
    public Map<String, Object> test(@RequestBody ConnectionTestRequest request) {
        return service.test(request);
    }
}
