package com.sqlflow.openapi;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * API 的**管理**接口（给界面用；对外调用在 {@link ApiOpenController}）。
 * 校验错 400 {@code {error, field}}，前端据此把哪一格标红。
 */
@RestController
@RequestMapping("/api/apis")
@RequiredArgsConstructor
public class ApiController {

    private final ApiService service;

    @GetMapping
    public Object list() { return service.list(); }

    @GetMapping("/{id}")
    public ResponseEntity<?> get(@PathVariable Long id) {
        return service.get(id).<ResponseEntity<?>>map(ResponseEntity::ok).orElseGet(ApiController::notFound);
    }

    @PostMapping
    public ResponseEntity<?> create(@RequestBody Map<String, Object> body) {
        try {
            return ResponseEntity.ok(service.create(body));
        } catch (ApiService.FieldError e) {
            return ResponseEntity.badRequest().body(e.body());
        }
    }

    @PutMapping("/{id}")
    public ResponseEntity<?> update(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        try {
            return service.update(id, body).<ResponseEntity<?>>map(ResponseEntity::ok).orElseGet(ApiController::notFound);
        } catch (ApiService.FieldError e) {
            return ResponseEntity.badRequest().body(e.body());
        }
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> delete(@PathVariable Long id) {
        return service.delete(id) ? ResponseEntity.ok(Map.of("deleted", true)) : notFound();
    }

    /** 启停。停用的对外 404，但管理页仍可见、可试跑 */
    @PostMapping("/{id}/status")
    public ResponseEntity<?> status(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        boolean enabled = body != null && Boolean.TRUE.equals(body.get("enabled"));
        return service.setStatus(id, enabled).<ResponseEntity<?>>map(ResponseEntity::ok).orElseGet(ApiController::notFound);
    }

    /** 试跑：body 直接就是参数值（{"city":"上海"}） */
    @PostMapping("/{id}/test")
    public ResponseEntity<?> test(@PathVariable Long id, @RequestBody(required = false) Map<String, Object> body) {
        try {
            return ResponseEntity.ok(service.test(id, body));
        } catch (com.sqlflow.common.BadRequestException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage(), "type", "BAD_REQUEST"));
        } catch (ApiService.FieldError e) {
            return ResponseEntity.badRequest().body(e.body());
        } catch (ApiService.UpstreamError e) {
            return ResponseEntity.status(503).body(Map.of("error", e.getMessage(), "type", "UPSTREAM_UNAVAILABLE"));
        }
    }

    private static ResponseEntity<?> notFound() {
        return ResponseEntity.status(404).body(Map.of("error", "接口不存在"));
    }
}
