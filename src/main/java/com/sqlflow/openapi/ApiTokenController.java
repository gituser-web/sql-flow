package com.sqlflow.openapi;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/** API 凭证的管理接口（给界面用）。 */
@RestController
@RequestMapping("/api/api-tokens")
@RequiredArgsConstructor
public class ApiTokenController {

    private final ApiTokenService service;

    @GetMapping
    public Object list() { return service.list(); }

    @PostMapping
    public ResponseEntity<?> create(@RequestBody(required = false) Map<String, Object> body) {
        try {
            return ResponseEntity.ok(service.create(body));
        } catch (ApiTokenService.FieldError e) {
            return ResponseEntity.badRequest().body(e.body());
        }
    }

    @PutMapping("/{id}")
    public ResponseEntity<?> update(@PathVariable Long id, @RequestBody(required = false) Map<String, Object> body) {
        try {
            return service.update(id, body).<ResponseEntity<?>>map(ResponseEntity::ok).orElseGet(ApiTokenController::notFound);
        } catch (ApiTokenService.FieldError e) {
            return ResponseEntity.badRequest().body(e.body());
        }
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> delete(@PathVariable Long id) {
        return service.delete(id) ? ResponseEntity.ok(Map.of("deleted", true)) : notFound();
    }

    @PostMapping("/{id}/status")
    public ResponseEntity<?> status(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        boolean enabled = body != null && Boolean.TRUE.equals(body.get("enabled"));
        return service.setStatus(id, enabled).<ResponseEntity<?>>map(ResponseEntity::ok).orElseGet(ApiTokenController::notFound);
    }

    private static ResponseEntity<?> notFound() {
        return ResponseEntity.status(404).body(Map.of("error", "凭证不存在"));
    }
}
