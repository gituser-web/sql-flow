package com.sqlflow.openapi;

import com.fasterxml.jackson.databind.JsonNode;
import com.sqlflow.common.BadRequestException;
import com.sqlflow.common.NotFoundException;
import com.sqlflow.datasource.SqlReadOnlyGuard;
import com.sqlflow.datasource.SqlRunException;
import com.sqlflow.datasource.SqlRunner;
import com.sqlflow.workflow.InputParams;
import com.sqlflow.workflow.WorkflowService;
import com.sqlflow.workflow.engine.ReferenceRenderer;
import com.sqlflow.workflow.engine.RunResult;
import com.sqlflow.workflow.engine.VariableTable;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;

/**
 * API 的管理与执行。**两种模式**（见 {@link ApiDef}）：
 * <ul>
 *   <li>SQL：{@code $参数名} 渲染成 {@code ?} → 过只读闸门 → 跑一次；</li>
 *   <li>WORKFLOW：把引用的 SQL 流整个跑一遍（输入参数用它自己声明的）。</li>
 * </ul>
 * 两种模式都：**未声明的参数一律拒**；结果统一信封 {@code {ok, data, costMs}}。
 */
@Service
@RequiredArgsConstructor
public class ApiService {

    private final ApiDefRepository repo;
    private final SqlRunner sqlRunner;
    private final WorkflowService workflowService;

    private static final int DEFAULT_MAX_ROWS = 10;
    private static final int HARD_MAX_ROWS = 1000;
    private static final int NAME_MAX = 128;
    private static final int DESC_MAX = 500;
    private static final java.util.regex.Pattern CODE = java.util.regex.Pattern.compile("[a-z0-9][a-z0-9_.-]{0,63}");

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

    /** 上游（库 / SQL 流）的错 —— 对外 503 */
    public static class UpstreamError extends RuntimeException {
        public UpstreamError(String msg) { super(msg); }
    }

    // ── 管理侧 ───────────────────────────────────────────────

    @Transactional(readOnly = true)
    public List<Map<String, Object>> list() {
        return repo.findAllByOrderByIdDesc().stream().map(ApiService::view).toList();
    }

    @Transactional(readOnly = true)
    public Optional<Map<String, Object>> get(Long id) {
        return repo.findById(id).map(ApiService::view);
    }

    @Transactional
    public Map<String, Object> create(Map<String, Object> body) {
        ApiDef api = new ApiDef();
        apply(api, body, true);
        if (api.getCode() == null || api.getCode().isBlank()) api.setCode(generateCode());
        repo.findByCode(api.getCode()).ifPresent(o -> {
            throw new FieldError("code", "已经有路径叫「" + api.getCode() + "」的了");
        });
        return view(repo.save(api));
    }

    @Transactional
    public Optional<Map<String, Object>> update(Long id, Map<String, Object> body) {
        Optional<ApiDef> found = repo.findById(id);
        if (found.isEmpty()) return Optional.empty();
        ApiDef api = found.get();
        apply(api, body, false);
        return Optional.of(view(repo.save(api)));
    }

    @Transactional
    public boolean delete(Long id) {
        if (!repo.existsById(id)) return false;
        repo.deleteById(id);
        return true;
    }

    @Transactional
    public Optional<Map<String, Object>> setStatus(Long id, boolean enabled) {
        return repo.findById(id).map(a -> {
            a.setStatus(enabled ? ApiDef.ENABLED : ApiDef.DISABLED);
            return view(repo.save(a));
        });
    }

    /** 试跑：拿当前定义（可以是停用的）跑一次，不落库 */
    @Transactional(readOnly = true)
    public Map<String, Object> test(Long id, Map<String, Object> given) {
        ApiDef api = repo.findById(id).orElseThrow(() -> new FieldError(null, "接口不存在"));
        return execute(api, given);
    }

    /** 按 code 取一条**启用中**的定义；停用与不存在都回 empty（对外一律 404） */
    @Transactional(readOnly = true)
    public Optional<ApiDef> enabledByCode(String code) {
        return repo.findByCode(code).filter(a -> a.getStatus() != null && a.getStatus() == ApiDef.ENABLED);
    }

    // ── 执行 ─────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public Map<String, Object> execute(ApiDef api, Map<String, Object> given) {
        List<InputParams.Param> declared = InputParams.parse(api.getParams());
        Map<String, Object> bound = InputParams.bind(declared, given);
        long t0 = System.currentTimeMillis();

        if (ApiDef.MODE_WORKFLOW.equals(api.getMode())) {
            if (api.getWorkflowId() == null) throw new FieldError("workflowId", "没选 SQL 流");
            RunResult r;
            try {
                // 参数绑定：**显式映射优先**（paramMap: API名 → 流名），没配的按**同名**自动绑。
                com.sqlflow.workflow.dto.WorkflowDef wf = workflowService.get(api.getWorkflowId());
                Set<String> wfNames = new HashSet<>();
                for (InputParams.Param p : InputParams.parse(wf.getInputs())) wfNames.add(p.name());
                Map<String, String> targets = resolveBindings(bound.keySet(), wfNames, parseParamMap(api.getParamMap()));
                Map<String, Object> forFlow = new LinkedHashMap<>();
                for (Map.Entry<String, Object> e : bound.entrySet()) {
                    String target = targets.get(e.getKey());
                    if (target != null && e.getValue() != null) forFlow.put(target, e.getValue());
                }
                r = workflowService.run(api.getWorkflowId(), forFlow);
            } catch (NotFoundException e) {
                throw new FieldError("workflowId", "引用的 SQL 流不存在了");
            } catch (BadRequestException e) {
                throw new FieldError(null, e.getMessage());
            }
            if (!r.isOk()) throw new UpstreamError(r.getError() == null ? "SQL 流执行失败" : r.getError());
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("workflowStatus", r.getStatus());
            out.put("data", r.getOutput());
            out.put("costMs", System.currentTimeMillis() - t0);
            return out;
        }

        // SQL 模式
        if (api.getDataSourceId() == null) throw new FieldError("dataSourceId", "没选数据源");
        if (api.getSqlTemplate() == null || api.getSqlTemplate().isBlank()) throw new FieldError("sqlTemplate", "还没写 SQL");
        if (!sqlRunner.exists(api.getDataSourceId())) throw new FieldError("dataSourceId", "这个数据源已经被删了");

        VariableTable vars = new VariableTable();
        bound.forEach((k, v) -> {
            if (v instanceof List<?> l) {
                vars.putList(k, l.stream().map(x -> x == null ? null : String.valueOf(x)).toList());
            } else if (v != null) {
                vars.putScalar(k, String.valueOf(v));
            }
        });
        ReferenceRenderer.Rendered rendered;
        try {
            rendered = new ReferenceRenderer(vars).render(api.getSqlTemplate());
            SqlReadOnlyGuard.check(rendered.sql());
        } catch (IllegalArgumentException | BadRequestException e) {
            throw new FieldError("sqlTemplate", e.getMessage());
        }
        int maxRows = api.getMaxRows() == null || api.getMaxRows() <= 0
                ? DEFAULT_MAX_ROWS : Math.min(api.getMaxRows(), HARD_MAX_ROWS);
        try {
            String json = sqlRunner.runReadOnly(api.getDataSourceId(), rendered.sql(), rendered.params(), maxRows);
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("data", com.sqlflow.common.Jsons.MAPPER.readValue(json, Map.class));
            out.put("costMs", System.currentTimeMillis() - t0);
            return out;
        } catch (SqlRunException e) {
            throw new UpstreamError("查询失败：" + e.getMessage());
        } catch (Exception e) {
            throw new UpstreamError("查询失败：" + (e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage()));
        }
    }

    // ── 内部 ─────────────────────────────────────────────────

    private void apply(ApiDef api, Map<String, Object> body, boolean creating) {
        String name = str(body.get("name"));
        if (name != null || creating) {
            if (name == null || name.isBlank()) throw new FieldError("name", "要填接口名称");
            if (name.trim().length() > NAME_MAX) throw new FieldError("name", "名称最多 " + NAME_MAX + " 个字");
            api.setName(name.trim());
        }
        if (body.containsKey("description") || creating) {
            String d = str(body.get("description"));
            if (d != null && d.length() > DESC_MAX) throw new FieldError("description", "说明最多 " + DESC_MAX + " 字");
            api.setDescription(d == null || d.isBlank() ? null : d);
        }
        String mode = str(body.get("mode"));
        if (mode != null || creating) {
            String m = (mode == null ? ApiDef.MODE_SQL : mode.trim().toUpperCase(Locale.ROOT));
            if (!m.equals(ApiDef.MODE_SQL) && !m.equals(ApiDef.MODE_WORKFLOW)) {
                throw new FieldError("mode", "模式只能是 SQL 或 WORKFLOW");
            }
            // 一个 API 只能是一种模式：新建时定，之后不许改（编辑页带上原值是允许的）
            if (!creating && api.getMode() != null && !api.getMode().equals(m)) {
                throw new FieldError("mode", "API 的模式建好就不能改；要换模式请新建一个 API");
            }
            api.setMode(m);
        }
        if (body.containsKey("dataSourceId") || creating) {
            api.setDataSourceId(longOrNull(body.get("dataSourceId")));
        }
        if (body.containsKey("sqlTemplate") || creating) {
            String sql = str(body.get("sqlTemplate"));
            api.setSqlTemplate(sql == null || sql.isBlank() ? null : sql.trim());
        }
        if (body.containsKey("workflowId") || creating) {
            api.setWorkflowId(longOrNull(body.get("workflowId")));
        }
        if (body.containsKey("maxRows") || creating) {
            Object raw = body.get("maxRows");
            int mr = DEFAULT_MAX_ROWS;
            if (raw != null && !String.valueOf(raw).isBlank()) {
                try { mr = Integer.parseInt(String.valueOf(raw).trim().replaceAll("\\.0$", "")); }
                catch (NumberFormatException e) { throw new FieldError("maxRows", "最多返回行数要是整数"); }
            }
            if (mr < 1 || mr > HARD_MAX_ROWS) throw new FieldError("maxRows", "最多返回行数要在 1–" + HARD_MAX_ROWS + " 之间");
            api.setMaxRows(mr);
        }
        if (body.containsKey("params") || creating) {
            Object raw = body.get("params");
            String json = raw == null ? "[]" : (raw instanceof String s ? s : toJson(raw));
            List<InputParams.Param> ps = InputParams.parse(json);   // 顺带校验
            api.setParams(toJson(ps));
        }
        if (body.containsKey("paramMap") || creating) {
            Object raw = body.get("paramMap");
            String json = raw == null ? "{}" : (raw instanceof String s ? s : toJson(raw));
            Map<String, String> map = parseParamMap(json);   // 顺带校验（必须是 string→string 的对象）
            checkNoDuplicateTargets(map);
            api.setParamMap(toJson(map));
        }
        if (body.containsKey("status") || creating) {
            api.setStatus(intOr(body.get("status"), ApiDef.ENABLED));
        }
        // 草稿容忍：新建时只填了名字和模式，数据源 / SQL / SQL 流都还没配是正常的
        // —— 允许存下来，到「试跑」或对外调用时才卡（见 execute）。
        // 但一旦设了值，就得是合法的。
        if (api.getDataSourceId() != null && !sqlRunner.exists(api.getDataSourceId())) {
            throw new FieldError("dataSourceId", "这个数据源已经被删了");
        }
    }

    /**
     * 每个 API 参数实际绑到 SQL 流的哪个参数（没绑的不在结果里）。**前端 ApiEditPage 的 effectiveBindings 照抄这份**。
     * <ul>
     *   <li>paramMap 里写了非空值 → 绑到它（显式优先）</li>
     *   <li>paramMap 里写了空串 → 用户明确选了「不传」</li>
     *   <li>没写 → 同名自动绑；但这个流参数已经被别的 API 参数**显式**占了就不自动绑（保证一对一）</li>
     * </ul>
     */
    static Map<String, String> resolveBindings(Collection<String> apiNames, Set<String> wfNames, Map<String, String> map) {
        Set<String> claimed = new HashSet<>();
        for (String v : map.values()) if (!v.isEmpty()) claimed.add(v);
        Map<String, String> out = new LinkedHashMap<>();
        for (String a : apiNames) {
            if (map.containsKey(a)) {
                if (!map.get(a).isEmpty()) out.put(a, map.get(a));
            } else if (wfNames.contains(a) && !claimed.contains(a)) {
                out.put(a, a);
            }
        }
        return out;
    }

    /** 两个 API 参数显式绑到同一个流参数 → 一个值会静默盖掉另一个，直接拒 */
    static void checkNoDuplicateTargets(Map<String, String> map) {
        Map<String, String> firstFrom = new HashMap<>();
        for (Map.Entry<String, String> e : map.entrySet()) {
            if (e.getValue().isEmpty()) continue;
            String prev = firstFrom.putIfAbsent(e.getValue(), e.getKey());
            if (prev != null) {
                throw new FieldError("paramMap", "API 参数 $" + prev + " 和 $" + e.getKey()
                        + " 都绑到了 SQL 流的 $" + e.getValue() + "；一个 SQL 流参数只能绑一个 API 参数");
            }
        }
    }

    /** 解析参数映射（API 参数名 → SQL 流参数名；空串 = 明确「不传」）。坏形状直接拒。 */
    static Map<String, String> parseParamMap(String json) {
        if (json == null || json.isBlank()) return Map.of();
        try {
            JsonNode n = com.sqlflow.common.Jsons.MAPPER.readTree(json);
            if (n == null || n.isNull()) return Map.of();
            if (!n.isObject()) throw new FieldError("paramMap", "参数映射要是 JSON 对象");
            Map<String, String> out = new LinkedHashMap<>();
            n.fields().forEachRemaining(e -> {
                String v = e.getValue() == null || e.getValue().isNull() ? "" : e.getValue().asText();
                out.put(e.getKey(), v.trim());
            });
            return out;
        } catch (FieldError e) {
            throw e;
        } catch (Exception e) {
            throw new FieldError("paramMap", "参数映射不是合法 JSON");
        }
    }

    private static String generateCode() {
        for (int i = 0; i < 20; i++) {
            String c = "api_" + UUID.randomUUID().toString().replace("-", "").substring(0, 8);
            if (c.matches("[a-z0-9][a-z0-9_.-]*")) return c;
        }
        throw new IllegalStateException("生成 code 失败");
    }

    private static String toJson(Object o) {
        try { return com.sqlflow.common.Jsons.MAPPER.writeValueAsString(o); }
        catch (Exception e) { throw new FieldError("params", "参数清单不是合法 JSON"); }
    }

    private static Long longOrNull(Object raw) {
        if (raw == null || String.valueOf(raw).isBlank()) return null;
        try { return Long.parseLong(String.valueOf(raw).trim().replaceAll("\\.0$", "")); }
        catch (NumberFormatException e) { throw new FieldError(null, "id 不是数字: " + raw); }
    }

    private static int intOr(Object raw, int dft) {
        if (raw == null || String.valueOf(raw).isBlank()) return dft;
        try { return Integer.parseInt(String.valueOf(raw).trim()); }
        catch (NumberFormatException e) { return dft; }
    }

    static Map<String, Object> view(ApiDef a) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", a.getId());
        m.put("code", a.getCode());
        m.put("name", a.getName());
        m.put("description", a.getDescription());
        m.put("mode", a.getMode());
        m.put("dataSourceId", a.getDataSourceId());
        m.put("sqlTemplate", a.getSqlTemplate());
        m.put("workflowId", a.getWorkflowId());
        m.put("maxRows", a.getMaxRows());
        m.put("params", a.getParams() == null ? "[]" : a.getParams());
        m.put("paramMap", a.getParamMap() == null ? "{}" : a.getParamMap());
        m.put("status", a.getStatus());
        m.put("createdAt", a.getCreatedAt() == null ? null : a.getCreatedAt().toString());
        m.put("updatedAt", a.getUpdatedAt() == null ? null : a.getUpdatedAt().toString());
        return m;
    }

    private static String str(Object o) { return o == null ? null : String.valueOf(o); }
}
