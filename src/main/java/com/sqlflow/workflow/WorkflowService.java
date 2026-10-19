package com.sqlflow.workflow;

import com.fasterxml.jackson.databind.JsonNode;
import com.sqlflow.common.BadRequestException;
import com.sqlflow.common.Jsons;
import com.sqlflow.common.NotFoundException;
import com.sqlflow.datasource.SqlRunner;
import com.sqlflow.workflow.dto.SqlNodeDef;
import com.sqlflow.workflow.dto.StageDef;
import com.sqlflow.workflow.dto.WorkflowDef;
import com.sqlflow.workflow.engine.ConditionEvaluator;
import com.sqlflow.workflow.engine.ExecutionEngine;
import com.sqlflow.workflow.engine.ReferenceRenderer;
import com.sqlflow.workflow.engine.RunResult;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * SQL 流 CRUD + 校验 + 执行。见 DESIGN §3.4 / §5 / §6.2。
 */
@Service
public class WorkflowService {

    private static final Pattern CODE_PATTERN = Pattern.compile("[a-z0-9][a-z0-9_-]*");
    private static final Pattern NAME_PATTERN = Pattern.compile("[A-Za-z_][A-Za-z0-9_]*");
    private static final int DEFAULT_MAX_ROWS = 10;
    private static final int HARD_MAX_ROWS = 1000;

    private final WorkflowRepository workflowRepository;
    private final StageRepository stageRepository;
    private final SqlNodeRepository sqlNodeRepository;
    private final SqlRunner sqlRunner;
    private final ExecutionEngine engine;

    public WorkflowService(WorkflowRepository workflowRepository,
                           StageRepository stageRepository,
                           SqlNodeRepository sqlNodeRepository,
                           SqlRunner sqlRunner,
                           ExecutionEngine engine) {
        this.workflowRepository = workflowRepository;
        this.stageRepository = stageRepository;
        this.sqlNodeRepository = sqlNodeRepository;
        this.sqlRunner = sqlRunner;
        this.engine = engine;
    }

    // ── 查询 ────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public List<WorkflowDef> list() {
        List<WorkflowDef> out = new ArrayList<>();
        for (WorkflowEntity w : workflowRepository.findAllByOrderByIdDesc()) {
            WorkflowDef def = baseDef(w);
            List<StageEntity> stages = stageRepository.findByWorkflowIdOrderByOrderIndexAsc(w.getId());
            def.setStageCount(stages.size());
            int nodeCount = 0;
            if (!stages.isEmpty()) {
                List<Long> stageIds = stages.stream().map(StageEntity::getId).toList();
                nodeCount = (int) sqlNodeRepository.countByStageIdIn(stageIds);
            }
            def.setNodeCount(nodeCount);
            out.add(def);
        }
        return out;
    }

    @Transactional(readOnly = true)
    public WorkflowDef get(Long id) {
        WorkflowEntity w = workflowRepository.findById(id)
                .orElseThrow(() -> new NotFoundException("SQL 流不存在: " + id));
        WorkflowDef def = baseDef(w);

        List<StageDef> stageDefs = new ArrayList<>();
        int nodeCount = 0;
        for (StageEntity st : stageRepository.findByWorkflowIdOrderByOrderIndexAsc(id)) {
            StageDef sd = new StageDef();
            sd.setId(st.getId());
            sd.setOrderIndex(st.getOrderIndex());
            sd.setKind(st.getKind());
            sd.setExecutionMode(st.getExecutionMode());
            sd.setExpression(st.getExpression());

            List<SqlNodeDef> nodeDefs = new ArrayList<>();
            for (SqlNodeEntity nd : sqlNodeRepository.findByStageIdOrderByOrderIndexAsc(st.getId())) {
                SqlNodeDef n = new SqlNodeDef();
                n.setId(nd.getId());
                n.setOrderIndex(nd.getOrderIndex());
                n.setName(nd.getName());
                n.setLabel(nd.getLabel());
                n.setDataSourceId(nd.getDataSourceId());
                n.setSqlTemplate(nd.getSqlTemplate());
                n.setMaxRows(nd.getMaxRows());
                n.setColumns(nd.getColumns());
                n.setIsOutput(nd.getIsOutput());
                nodeDefs.add(n);
            }
            sd.setNodes(nodeDefs);
            stageDefs.add(sd);
            nodeCount += nodeDefs.size();
        }
        def.setStages(stageDefs);
        def.setStageCount(stageDefs.size());
        def.setNodeCount(nodeCount);
        return def;
    }

    // ── 写 ──────────────────────────────────────────────────

    /** 自动生成一个没用过的 code（wf_ + 8 位十六进制）。界面不填了，先占位。 */
    /**
     * 节点变量名按位置重算成 {@code {code}_step_L_node_K}，SQL / IF 里的引用跟着改（见 NodeNaming）。
     * 调用前已用**旧名字**校验过（引用断了的在那一步就拒，不会被改名"救活"成指向别的节点）；
     * 改完再校验一遍 —— 新名字万一和输入参数撞了，要在这里拒。
     */
    private void canonicalizeNames(WorkflowDef def) {
        NodeNaming.canonicalize(def.getCode(), def.getStages());
        validate(def);
    }

    private String generateCode() {
        for (int i = 0; i < 20; i++) {
            String c = "wf_" + UUID.randomUUID().toString().replace("-", "").substring(0, 8);
            if (workflowRepository.findByCode(c).isEmpty()) return c;
        }
        throw new IllegalStateException("生成 code 失败");
    }

    @Transactional
    public WorkflowDef create(WorkflowDef def) {
        validate(def);
        // 界面上不再填 code：没给就自动生成一个（对外服务以后再设计，先占个位）
        String code = (def.getCode() == null || def.getCode().isBlank()) ? generateCode() : def.getCode().trim();
        def.setCode(code);
        workflowRepository.findByCode(code).ifPresent(existing -> {
            throw new BadRequestException("code", "该 code 已存在: " + code);
        });
        canonicalizeNames(def);

        WorkflowEntity w = new WorkflowEntity();
        w.setCode(code);
        w.setName(def.getName());
        w.setDescription(def.getDescription());
        w.setInputs(normalizeInputs(def.getInputs()));
        w.setOutputNode(blankToNull(def.getOutputNode()));
        w.setStatus(def.getStatus() == null ? 1 : def.getStatus());
        w = workflowRepository.save(w);

        // 输出节点由"节点上的标记"决定（见 persistStages）
        w.setOutputNode(persistStages(w.getId(), def.getStages()));
        workflowRepository.save(w);
        return get(w.getId());    }

    @Transactional
    public WorkflowDef update(Long id, WorkflowDef def) {
        WorkflowEntity w = workflowRepository.findById(id)
                .orElseThrow(() -> new NotFoundException("SQL 流不存在: " + id));
        validate(def);
        // 没给 code 就沿用原来的（界面不再暴露它）
        String code = (def.getCode() == null || def.getCode().isBlank()) ? w.getCode() : def.getCode().trim();
        def.setCode(code);
        workflowRepository.findByCode(code).ifPresent(other -> {
            if (!other.getId().equals(id)) {
                throw new BadRequestException("code", "该 code 已存在: " + code);
            }
        });
        canonicalizeNames(def);

        w.setCode(code);
        w.setName(def.getName());
        w.setDescription(def.getDescription());
        w.setInputs(normalizeInputs(def.getInputs()));
        w.setOutputNode(blankToNull(def.getOutputNode()));
        if (def.getStatus() != null) {
            w.setStatus(def.getStatus());
        }
        workflowRepository.save(w);

        clearStages(id);
        w.setOutputNode(persistStages(id, def.getStages()));
        workflowRepository.save(w);
        return get(id);
    }

    @Transactional
    public void delete(Long id) {
        WorkflowEntity w = workflowRepository.findById(id)
                .orElseThrow(() -> new NotFoundException("SQL 流不存在: " + id));
        clearStages(id);
        workflowRepository.delete(w);
    }

    @Transactional
    public WorkflowDef setStatus(Long id, boolean enabled) {
        WorkflowEntity w = workflowRepository.findById(id)
                .orElseThrow(() -> new NotFoundException("SQL 流不存在: " + id));
        w.setStatus(enabled ? 1 : 0);
        workflowRepository.save(w);
        return get(id);
    }

    // ── 执行 ────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public RunResult run(Long id) {
        return run(id, Map.of());
    }

    /** 带输入参数试跑 */
    @Transactional(readOnly = true)
    public RunResult run(Long id, Map<String, Object> given) {
        WorkflowDef def = get(id);
        List<InputParams.Param> declared = InputParams.parse(def.getInputs());
        return engine.run(def, InputParams.bind(declared, given));
    }

    @Transactional(readOnly = true)
    public RunResult runByCode(String code) {
        return runByCode(code, Map.of());
    }

    /** 按 code 调（对外）—— 带输入参数 */
    @Transactional(readOnly = true)
    public RunResult runByCode(String code, Map<String, Object> given) {
        WorkflowEntity w = workflowRepository.findByCode(code)
                .filter(e -> e.getStatus() != null && e.getStatus() == 1)
                .orElseThrow(() -> new NotFoundException("SQL 流不存在或未启用: " + code));
        WorkflowDef def = get(w.getId());
        List<InputParams.Param> declared = InputParams.parse(def.getInputs());
        return engine.run(def, InputParams.bind(declared, given));
    }

    /** 输入参数存成规整的 JSON 文本（顺带校验） */
    private static String normalizeInputs(String raw) {
        List<InputParams.Param> ps = InputParams.parse(raw);
        try {
            return Jsons.MAPPER.writeValueAsString(ps);
        } catch (Exception e) {
            throw new BadRequestException("inputs", "输入参数不是合法 JSON");
        }
    }

    /**
     * 保存时探一次列并存下来（JSON 数组文本）。探不到就存 {@code []}，**不阻断保存** ——
     * 数据源临时连不上不该让人存不了草稿。
     */
    private String probeColumnsJson(Long dataSourceId, String sqlTemplate) {
        try {
            Map<String, Object> r = probeColumns(dataSourceId, sqlTemplate);
            Object cols = r.get("columns");
            return Jsons.MAPPER.writeValueAsString(cols == null ? List.of() : cols);
        } catch (Exception e) {
            return "[]";
        }
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    // ── 持久化辅助 ──────────────────────────────────────────

    private WorkflowDef baseDef(WorkflowEntity w) {
        WorkflowDef def = new WorkflowDef();
        def.setId(w.getId());
        def.setCode(w.getCode());
        def.setName(w.getName());
        def.setDescription(w.getDescription());
        def.setInputs(w.getInputs() == null ? "[]" : w.getInputs());
        def.setOutputNode(w.getOutputNode());
        def.setStatus(w.getStatus());
        def.setCreatedAt(w.getCreatedAt());
        def.setUpdatedAt(w.getUpdatedAt());
        return def;
    }

    private void clearStages(Long workflowId) {
        for (StageEntity st : stageRepository.findByWorkflowIdOrderByOrderIndexAsc(workflowId)) {
            sqlNodeRepository.deleteByStageId(st.getId());
        }
        stageRepository.deleteByWorkflowId(workflowId);
    }

    private String persistStages(Long workflowId, List<StageDef> stageDefs) {
        List<StageDef> stages = new ArrayList<>(stageDefs);
        stages.sort(Comparator.comparingInt(s -> s.getOrderIndex() == null ? Integer.MAX_VALUE : s.getOrderIndex()));

        String outputNodeName = null;
        int stageIndex = 0;
        for (StageDef sd : stages) {
            String kind = sd.getKind().toUpperCase();

            StageEntity se = new StageEntity();
            se.setWorkflowId(workflowId);
            se.setOrderIndex(stageIndex++);
            se.setKind(kind);
            if (kind.equals("LAYER")) {
                se.setExecutionMode(sd.getExecutionMode() == null ? "PARALLEL" : sd.getExecutionMode().toUpperCase());
                se.setExpression(null);
            } else {
                se.setExecutionMode(null);
                se.setExpression(sd.getExpression());
            }
            se = stageRepository.save(se);

            if (!kind.equals("LAYER")) {
                continue;
            }

            List<SqlNodeDef> nodes = new ArrayList<>(sd.getNodes());
            nodes.sort(Comparator.comparingInt(n -> n.getOrderIndex() == null ? Integer.MAX_VALUE : n.getOrderIndex()));
            int nodeIndex = 0;
            for (SqlNodeDef nd : nodes) {
                SqlNodeEntity ne = new SqlNodeEntity();
                ne.setStageId(se.getId());
                ne.setOrderIndex(nodeIndex++);
                ne.setName(nd.getName());
                ne.setLabel(nd.getLabel());
                ne.setDataSourceId(nd.getDataSourceId());
                ne.setSqlTemplate(nd.getSqlTemplate());
                ne.setMaxRows(nd.getMaxRows() == null ? DEFAULT_MAX_ROWS : nd.getMaxRows());
                ne.setIsOutput(Boolean.TRUE.equals(nd.getIsOutput()));
                // 保存时探一次输出列并存下来 —— 详情页直接读，不用每次重算
                ne.setColumns(probeColumnsJson(nd.getDataSourceId(), nd.getSqlTemplate()));
                sqlNodeRepository.save(ne);
                if (Boolean.TRUE.equals(nd.getIsOutput())) outputNodeName = nd.getName();
            }
        }
        return outputNodeName;
    }

    // ── 校验 ────────────────────────────────────────────────

    // ── 探列：拿一条 SQL 的真实列名（给条件编辑器用）────────────────────

    /**
     * 把节点的 SQL 用 {@code WHERE 1=0} 套一层跑一次，只读元数据拿列名（不取数据）。
     * {@code $引用} 一律换成 {@code NULL} —— 这里只求"能编译出结果列"，不求解出值。
     */
    public Map<String, Object> probeColumns(Long dataSourceId, String sqlTemplate) {
        Map<String, Object> out = new LinkedHashMap<>();
        if (dataSourceId == null) return probeFail(out, "没选数据源");
        if (sqlTemplate == null || sqlTemplate.isBlank()) return probeFail(out, "还没写 SQL");
        if (!sqlRunner.exists(dataSourceId)) return probeFail(out, "数据源不存在");

        String sql = sqlTemplate.trim();
        while (sql.endsWith(";")) sql = sql.substring(0, sql.length() - 1).trim();
        if (sql.isEmpty()) return probeFail(out, "还没写 SQL");
        // $引用 → NULL。**要吃掉整条引用链**，包括结尾可能多出来的点
        // （`$main.rows[0].` 这种半截引用，少吃一个字符就会留下孤立的 `.`，SQL 直接语法错）。
        // 字符集覆盖：字段名 / `.` / `[0]` / `[*]`，遇到空格、逗号、括号就停。
        sql = sql.replaceAll("\\$[A-Za-z_][A-Za-z0-9_]*[A-Za-z0-9_.\\[\\]*]*", "NULL");
        // #{输入参数} 同理 → NULL（`in (#{ids})` 变 `in (NULL)` 也合法）。不换的话解析器不认 `{`
        sql = sql.replaceAll("#\\{[^}]*}", "NULL");
        String wrapped = "select * from (" + sql + ") __probe where 1 = 0";

        try {
            String json = sqlRunner.runReadOnly(dataSourceId, wrapped, List.of(), 1);
            JsonNode n = Jsons.MAPPER.readTree(json);
            List<String> cols = new ArrayList<>();
            for (JsonNode c : n.path("columns")) cols.add(c.asText());
            out.put("columns", cols);
            return out;
        } catch (Exception e) {
            // 把实际发出去的 SQL 也带上 —— 否则用户只看到"拿不到列"，无从下手
            String shown = wrapped.length() > 300 ? wrapped.substring(0, 300) + "…" : wrapped;
            return probeFail(out, probeError(e) + " ｜ 探测用的 SQL：" + shown);
        }
    }

    private static Map<String, Object> probeFail(Map<String, Object> out, String msg) {
        out.put("columns", List.of());
        out.put("error", msg);
        return out;
    }

    private static String probeError(Throwable e) {
        Throwable t = e;
        while (t.getCause() != null && t.getCause() != t) t = t.getCause();
        String m = t.getMessage();
        return (m == null || m.isBlank()) ? t.getClass().getSimpleName() : m;
    }

    private void validate(WorkflowDef def) {
        if (def == null) {
            throw new BadRequestException("SQL 流定义不能为空");
        }
        String code = def.getCode();
        // 界面上不再填 code（对外服务以后再设计）：填了才校验格式，没填由 create 自动生成
        if (code != null && !code.isBlank() && !CODE_PATTERN.matcher(code).matches()) {
            throw new BadRequestException("code", "code 需以小写字母或数字开头，只能含小写字母、数字、_、-");
        }

        // 输入参数：解析即校验（名字/类型/重复）
        List<InputParams.Param> inputs = InputParams.parse(def.getInputs());
        Set<String> inputNames = new HashSet<>();
        for (InputParams.Param p : inputs) inputNames.add(p.name());
        if (def.getName() == null || def.getName().isBlank()) {
            throw new BadRequestException("name", "名称不能为空");
        }

        List<StageDef> stages = def.getStages();
        if (stages == null || stages.isEmpty()) {
            throw new BadRequestException("stages", "至少需要 1 个层");
        }
        List<StageDef> sorted = new ArrayList<>(stages);
        sorted.sort(Comparator.comparingInt(s -> s.getOrderIndex() == null ? Integer.MAX_VALUE : s.getOrderIndex()));

        if (!"LAYER".equalsIgnoreCase(trim(sorted.get(0).getKind()))) {
            throw new BadRequestException("stages", "第一个 stage 必须是 LAYER（IF 不能作为第一层）");
        }

        boolean hasLayer = false;
        Set<String> nodeNames = new HashSet<>();
        Set<String> availableNames = new HashSet<>();
        /** 最后一个 LAYER 里的节点名 —— 输出只能从这里选 */
        Set<String> lastLayerNodeNames = new HashSet<>();

        for (StageDef sd : sorted) {
            String kind = trim(sd.getKind()).toUpperCase();

            if (kind.equals("LAYER")) {
                hasLayer = true;

                String mode = trim(sd.getExecutionMode()).toUpperCase();
                if (!mode.equals("PARALLEL") && !mode.equals("SERIAL")) {
                    throw new BadRequestException("stages", "LAYER 的 executionMode 必须是 PARALLEL 或 SERIAL");
                }

                List<SqlNodeDef> nodes = sd.getNodes();
                if (nodes == null || nodes.isEmpty()) {
                    throw new BadRequestException("stages", "每个 LAYER 至少需要 1 个 SQL 节点");
                }

                for (SqlNodeDef nd : nodes) {
                    String name = nd.getName();
                    if (name == null || !NAME_PATTERN.matcher(name).matches()) {
                        throw new BadRequestException("stages", "节点名不合法（需 [A-Za-z_][A-Za-z0-9_]*）: " + name);
                    }
                    if (!nodeNames.add(name)) {
                        throw new BadRequestException("stages", "节点名重复: " + name);
                    }
                    // 草稿容忍：新建 SQL 流时节点还没选数据源、还没写 SQL 是正常的，
                    // 允许存下来，到「运行」时才卡（见 ExecutionEngine）。但一旦设了值就必须合法。
                    if (nd.getDataSourceId() != null && !sqlRunner.exists(nd.getDataSourceId())) {
                        throw new BadRequestException("stages", "节点 " + name + " 的数据源不存在: " + nd.getDataSourceId());
                    }
                    int maxRows = nd.getMaxRows() == null ? DEFAULT_MAX_ROWS : nd.getMaxRows();
                    if (maxRows < 1 || maxRows > HARD_MAX_ROWS) {
                        throw new BadRequestException("stages", "节点 " + name + " 的 maxRows 必须在 1.." + HARD_MAX_ROWS);
                    }
                    String sql = nd.getSqlTemplate();
                    if (sql != null && !sql.isBlank()) {
                        for (String ref : ReferenceRenderer.referencedNames(sql)) {
                            if (!availableNames.contains(ref) && !inputNames.contains(ref)) {
                                throw new BadRequestException("stages",
                                        "节点 " + name + " 引用了不可用的变量: $" + ref
                                        + "（只能是输入参数、更早的层、或串行层里在它前面的节点）");
                            }
                        }
                    }
                    // 串行层是**先后**跑的：本节点跑完后，同层排在它后面的节点就能引用它。
                    // 并行层不加（同时跑，互相看不见）。
                    if (mode.equals("SERIAL")) {
                        availableNames.add(name);
                    }
                }

                // 本层节点名对后续层可见
                for (SqlNodeDef nd : nodes) {
                    availableNames.add(nd.getName());
                }
                // 记下"最后一层"的节点名（输出只能是这里面的）
                lastLayerNodeNames = new HashSet<>();
                for (SqlNodeDef nd : nodes) lastLayerNodeNames.add(nd.getName());
            } else if (kind.equals("IF")) {
                if (!hasLayer) {
                    throw new BadRequestException("stages", "IF 之前必须至少有一个 LAYER");
                }
                String expr = sd.getExpression();
                if (expr == null || expr.isBlank()) {
                    throw new BadRequestException("stages", "IF 条件不能为空");
                }
                // 组合条件里每个判断的引用都要可用
                for (ReferenceRenderer.ParsedRef ref : ConditionEvaluator.validate(expr)) {
                    if (!availableNames.contains(ref.name())) {
                        throw new BadRequestException("stages",
                                "IF 引用了不可用的变量: $" + ref.name() + "（只能引用更早层的节点）");
                    }
                }
            } else {
                throw new BadRequestException("stages", "未知的 stage 类型: " + sd.getKind());
            }
        }

        if (!hasLayer) {
            throw new BadRequestException("stages", "至少需要 1 个 LAYER");
        }

        // 输入参数名不能和节点重名（两者在 SQL 里都用 $名字，重了就分不清）
        for (String in : inputNames) {
            if (nodeNames.contains(in)) {
                throw new BadRequestException("inputs", "输入参数名「" + in + "」和某个节点重名了");
            }
        }

        // 输出：最多一个节点标记为输出（执行到它就停）
        int outCount = 0;
        for (StageDef st : sorted) {
            if (!"LAYER".equalsIgnoreCase(trim(st.getKind()))) continue;
            if (st.getNodes() == null) continue;
            for (SqlNodeDef nd : st.getNodes()) {
                if (Boolean.TRUE.equals(nd.getIsOutput())) outCount++;
            }
        }
        if (outCount > 1) {
            throw new BadRequestException("stages", "最多只能有一个节点标记为输出");
        }
    }

    private static String trim(String s) {
        return s == null ? "" : s.trim();
    }
}
