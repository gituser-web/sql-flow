package com.sqlflow.openapi;

import com.sqlflow.common.BadRequestException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

/**
 * API 的**对外**入口：{@code POST /openapi/{code}}。
 *
 * <p>几个刻意的选择：</p>
 * <ul>
 *   <li><b>不存在与已停用合并成同一个 404</b>：不告诉调用方"这个 code 曾经存在过"。</li>
 *   <li><b>定义坏了的细节不进响应</b>：只回"接口配置有问题，请联系提供方"，细节进日志。</li>
 *   <li>token 放 {@code X-API-Token} 头，或 {@code Authorization: Bearer <token>}。</li>
 * </ul>
 */
@RestController
@RequestMapping("/openapi")
@RequiredArgsConstructor
@Slf4j
public class ApiOpenController {

    private final ApiService apiService;
    private final ApiTokenService tokenService;

    @PostMapping("/{code:[a-z0-9_.-]+}")
    public ResponseEntity<?> call(@PathVariable String code,
                                  @RequestBody(required = false) Map<String, Object> body,
                                  @RequestHeader(value = "X-API-Token", required = false) String tokenHeader,
                                  @RequestHeader(value = "Authorization", required = false) String authHeader) {
        ResponseEntity<?> denied = checkToken(tokenHeader, authHeader);
        if (denied != null) return denied;

        Optional<ApiDef> found = apiService.enabledByCode(code);
        if (found.isEmpty()) return fail(404, "NOT_FOUND", "没有这个接口（或已停用）");

        ApiDef api = found.get();
        long t0 = System.currentTimeMillis();
        try {
            Map<String, Object> data = apiService.execute(api, body == null ? Map.of() : body);
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true);
            out.put("data", data.get("data"));
            if (data.get("workflowStatus") != null) out.put("workflowStatus", data.get("workflowStatus"));
            out.put("costMs", System.currentTimeMillis() - t0);
            return ResponseEntity.ok(out);
        } catch (BadRequestException e) {
            return fail(400, "BAD_REQUEST", e.getMessage());
        } catch (ApiService.FieldError e) {
            log.error("API [{}] 配置有问题：{}", api.getCode(), e.getMessage());
            return fail(500, "API_MISCONFIGURED", "接口配置有问题，请联系提供方");
        } catch (ApiService.UpstreamError e) {
            return fail(503, "UPSTREAM_UNAVAILABLE", e.getMessage());
        } catch (Exception e) {
            log.error("API [{}] 执行失败", api.getCode(), e);
            return fail(500, "INTERNAL", "服务内部错误");
        }
    }

    private ResponseEntity<?> checkToken(String tokenHeader, String authHeader) {
        String t = tokenHeader;
        if ((t == null || t.isBlank()) && authHeader != null && authHeader.regionMatches(true, 0, "Bearer ", 0, 7)) {
            t = authHeader.substring(7).trim();
        }
        if (!tokenService.isValid(t)) {
            return fail(401, "UNAUTHORIZED", "缺少或无效的 token（放在 X-API-Token 头，或 Authorization: Bearer <token>）");
        }
        return null;
    }

    private static ResponseEntity<?> fail(int status, String type, String error) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("ok", false);
        m.put("error", error);
        m.put("type", type);
        return ResponseEntity.status(status).body(m);
    }
}
