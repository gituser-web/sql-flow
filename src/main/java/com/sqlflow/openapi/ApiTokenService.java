package com.sqlflow.openapi;

import com.sqlflow.common.BadRequestException;
import com.sqlflow.common.NotFoundException;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * API 凭证（仿 tianzhi 的 ApiTokenService）。
 *
 * <p>明文存、界面能点开看：作用是"知道是哪个系统在调 + 出事了能一键停掉"，不是身份认证。
 * **停用立刻生效**——鉴权按值查库、不缓存。</p>
 */
@Service
@RequiredArgsConstructor
public class ApiTokenService {

    private final ApiTokenRepository repo;
    private static final SecureRandom RND = new SecureRandom();
    private static final int NAME_MAX = 128;
    private static final int REMARK_MAX = 500;
    /** 最近使用时间的写入节流：高频调用下不值得每次请求都写库 */
    private static final Duration TOUCH_INTERVAL = Duration.ofSeconds(60);

    public static class FieldError extends RuntimeException {
        public final String field;
        public FieldError(String field, String msg) { super(msg); this.field = field; }
        public Map<String, Object> body() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("error", getMessage());
            if (field != null) m.put("field", field);
            return m;
        }
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> list() {
        return repo.findAllByOrderByIdDesc().stream().map(ApiTokenService::view).toList();
    }

    @Transactional
    public Map<String, Object> create(Map<String, Object> body) {
        ApiTokenEntity t = new ApiTokenEntity();
        String name = body == null ? null : str(body.get("name"));
        if (name == null || name.isBlank()) throw new FieldError("name", "要填个名字（方便以后认出是谁在用）");
        if (name.trim().length() > NAME_MAX) throw new FieldError("name", "名字最多 " + NAME_MAX + " 个字");
        t.setName(name.trim());
        String remark = body == null ? null : str(body.get("remark"));
        if (remark != null && remark.length() > REMARK_MAX) throw new FieldError("remark", "备注最多 " + REMARK_MAX + " 字");
        t.setRemark(remark == null || remark.isBlank() ? null : remark);
        t.setToken(newToken());
        t.setStatus(ApiTokenEntity.ENABLED);
        return view(repo.save(t));
    }

    @Transactional
    public Optional<Map<String, Object>> update(Long id, Map<String, Object> body) {
        return repo.findById(id).map(t -> {
            String name = body == null ? null : str(body.get("name"));
            if (name != null) {
                if (name.isBlank()) throw new FieldError("name", "名字不能为空");
                t.setName(name.trim());
            }
            if (body != null && body.containsKey("remark")) {
                String remark = str(body.get("remark"));
                if (remark != null && remark.length() > REMARK_MAX) throw new FieldError("remark", "备注最多 " + REMARK_MAX + " 字");
                t.setRemark(remark == null || remark.isBlank() ? null : remark);
            }
            return view(repo.save(t));
        });
    }

    @Transactional
    public boolean delete(Long id) {
        if (!repo.existsById(id)) return false;
        repo.deleteById(id);
        return true;
    }

    @Transactional
    public Optional<Map<String, Object>> setStatus(Long id, boolean enabled) {
        return repo.findById(id).map(t -> {
            t.setStatus(enabled ? ApiTokenEntity.ENABLED : ApiTokenEntity.DISABLED);
            return view(repo.save(t));
        });
    }

    /**
     * 校验一个 token 是否可用。**按值查库**（不缓存）：停用后下一次请求就失效 ——
     * 这个页面存在的意义就是"出事了能立刻掐掉"。
     */
    @Transactional
    public boolean isValid(String token) {
        if (token == null || token.isBlank()) return false;
        Optional<ApiTokenEntity> found = repo.findByToken(token.trim());
        if (found.isEmpty()) return false;
        ApiTokenEntity t = found.get();
        if (t.getStatus() == null || t.getStatus() != ApiTokenEntity.ENABLED) return false;
        touch(t);
        return true;
    }

    private void touch(ApiTokenEntity t) {
        LocalDateTime now = LocalDateTime.now();
        if (t.getLastUsedAt() != null && Duration.between(t.getLastUsedAt(), now).compareTo(TOUCH_INTERVAL) < 0) return;
        t.setLastUsedAt(now);
        try { repo.save(t); } catch (Exception ignored) { /* 记不上不影响这次调用 */ }
    }

    private static String newToken() {
        byte[] b = new byte[16];
        RND.nextBytes(b);
        StringBuilder sb = new StringBuilder("tk_");
        for (byte x : b) sb.append(String.format("%02x", x));
        return sb.toString();
    }

    /** 明文返回（qi 定的：要能点开看） */
    static Map<String, Object> view(ApiTokenEntity t) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", t.getId());
        m.put("name", t.getName());
        m.put("token", t.getToken());
        m.put("status", t.getStatus());
        m.put("remark", t.getRemark());
        m.put("createdAt", t.getCreatedAt() == null ? null : t.getCreatedAt().toString());
        m.put("lastUsedAt", t.getLastUsedAt() == null ? null : t.getLastUsedAt().toString());
        return m;
    }

    private static String str(Object o) { return o == null ? null : String.valueOf(o); }
}
