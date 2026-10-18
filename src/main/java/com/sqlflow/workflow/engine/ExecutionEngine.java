package com.sqlflow.workflow.engine;

import com.sqlflow.common.BadRequestException;
import com.sqlflow.datasource.SqlReadOnlyGuard;
import com.sqlflow.datasource.SqlRunException;
import com.sqlflow.datasource.SqlRunner;
import com.sqlflow.workflow.dto.SqlNodeDef;
import com.sqlflow.workflow.dto.StageDef;
import com.sqlflow.workflow.dto.WorkflowDef;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/**
 * SQL 流执行引擎。见 DESIGN §5。
 */
@Service
public class ExecutionEngine {

    private final SqlRunner sqlRunner;
    private final int parallelPoolSize;

    public ExecutionEngine(SqlRunner sqlRunner,
                           @Value("${sqlflow.parallel-pool-size:4}") int parallelPoolSize) {
        this.sqlRunner = sqlRunner;
        this.parallelPoolSize = parallelPoolSize;
    }

    public RunResult run(WorkflowDef def) {
        return run(def, java.util.Map.of());
    }

    /**
     * @param inputs SQL 流输入参数（名字 → 值）。标量是 String，**数组是 List**；SQL 里都用 {@code #{名字}} 引用。
     */
    public RunResult run(WorkflowDef def, java.util.Map<String, Object> inputs) {
        long started = System.currentTimeMillis();

        List<StageDef> stages = new ArrayList<>(def.getStages() == null ? List.of() : def.getStages());
        stages.sort(Comparator.comparingInt(s -> s.getOrderIndex() == null ? Integer.MAX_VALUE : s.getOrderIndex()));

        VariableTable vars = new VariableTable();
        if (inputs != null) {
            inputs.forEach((k, v) -> {
                if (v instanceof java.util.List<?> l) {
                    vars.putList(k, l.stream().map(x -> x == null ? null : String.valueOf(x)).toList());
                } else if (v != null) {
                    vars.putScalar(k, String.valueOf(v));
                }
            });
        }
        List<RunResult.RunStep> steps = new ArrayList<>();
        /** 最后一个执行到的 LAYER 里的节点名（按 orderIndex 排好）—— 输出没指定时取最后一个 */
        List<String> lastLayerNodes = null;
        // 输出**只在收工时取一次**：指定的输出节点在后面的层时，前面每层跑完它当然还没执行到，
        // 每层都去取就会在第 1 层报「没执行到它」。

        for (int si = 0; si < stages.size(); si++) {
            StageDef stage = stages.get(si);
            String kind = stage.getKind() == null ? "" : stage.getKind().toUpperCase();

            if (kind.equals("LAYER")) {
                LayerOutcome outcome = runLayer(stage, vars, si, def.getOutputNode());
                steps.add(outcome.step);
                if (!outcome.ok) {
                    return failed(outcome, bestEffortOutput(def, lastLayerNodes, vars), steps, started);
                }
                lastLayerNodes = nodeNamesOf(stage);
                // 标记为输出的节点跑到了 → 立刻收工：后面的层都不跑
                if (outcome.stoppedAtOutput) {
                    return finish(true, "SUCCESS", resolveOutput(def, lastLayerNodes, vars), steps, started, null, null);
                }
            } else if (kind.equals("IF")) {
                boolean verdict = new ConditionEvaluator(vars).eval(stage.getExpression());
                RunResult.RunStep step = new RunResult.RunStep();
                step.setStageIndex(si);
                step.setKind("IF");
                step.setExpression(stage.getExpression());
                step.setVerdict(verdict);
                steps.add(step);
                if (!verdict) {
                    // 条件不满足提前停：指定的输出节点可能还没跑到 → 没有输出（null），不算错
                    return finish(true, "STOPPED", bestEffortOutput(def, lastLayerNodes, vars), steps, started, null, null);
                }
            } else {
                throw new BadRequestException("未知的 stage 类型: " + stage.getKind());
            }
        }

        return finish(true, "SUCCESS", resolveOutput(def, lastLayerNodes, vars), steps, started, null, null);
    }

    /** 一层的节点名，按 orderIndex 排好 */
    private static List<String> nodeNamesOf(StageDef stage) {
        List<SqlNodeDef> nodes = new ArrayList<>(stage.getNodes() == null ? List.of() : stage.getNodes());
        nodes.sort(Comparator.comparingInt(n -> n.getOrderIndex() == null ? Integer.MAX_VALUE : n.getOrderIndex()));
        List<String> out = new ArrayList<>();
        for (SqlNodeDef n : nodes) out.add(n.getName());
        return out;
    }

    /**
     * SQL 流的输出 = **指定的那个节点**（{@code def.outputNode}）；没指定就取**最后一层的最后一个节点**。
     * 指定的节点必须真的执行到了，否则明确报错（不静默给别的）。
     */
    private static Object resolveOutput(WorkflowDef def, List<String> lastLayerNodes, VariableTable vars) {
        String want = def.getOutputNode();
        String name = (want == null || want.isBlank())
                ? (lastLayerNodes == null || lastLayerNodes.isEmpty() ? null : lastLayerNodes.get(lastLayerNodes.size() - 1))
                : want.trim();
        if (name == null) return null;
        if (!vars.has(name)) {
            throw new BadRequestException("输出节点 $" + name + " 不存在、或这次没执行到它");
        }
        return vars.get(name);
    }

    /** 失败时尽力给一个输出（拿不到就算了，别让报错被另一个错盖住） */
    private static Object bestEffortOutput(WorkflowDef def, List<String> lastLayerNodes, VariableTable vars) {
        try {
            return resolveOutput(def, lastLayerNodes, vars);
        } catch (Exception e) {
            return null;
        }
    }

    // ── 内部 ────────────────────────────────────────────────

    private RunResult failed(LayerOutcome outcome, Object output,
                             List<RunResult.RunStep> steps, long started) {
        return finish(false, "FAILED", output, steps, started, outcome.error, outcome.failedNode);
    }

    private RunResult finish(boolean ok, String status, Object output,
                             List<RunResult.RunStep> steps, long started,
                             String error, String failedNode) {
        RunResult result = new RunResult();
        result.setOk(ok);
        result.setStatus(status);
        result.setOutput(output);
        result.setCostMs(System.currentTimeMillis() - started);
        result.setSteps(steps);
        result.setError(error);
        result.setFailedNode(failedNode);
        return result;
    }

    private LayerOutcome runLayer(StageDef stage, VariableTable vars, int stageIndex, String outputNode) {
        List<SqlNodeDef> nodes = new ArrayList<>(stage.getNodes() == null ? List.of() : stage.getNodes());
        nodes.sort(Comparator.comparingInt(n -> n.getOrderIndex() == null ? Integer.MAX_VALUE : n.getOrderIndex()));

        String mode = stage.getExecutionMode() == null ? "PARALLEL" : stage.getExecutionMode().toUpperCase();

        // 本层里有没有"标记为输出"的节点？有的话：**串行跑到它为止、并行只跑它**（别的分支去掉）
        SqlNodeDef outNode = null;
        if (outputNode != null && !outputNode.isBlank()) {
            for (SqlNodeDef n : nodes) {
                if (outputNode.equals(n.getName())) { outNode = n; break; }
            }
        }
        List<SqlNodeDef> toRun = nodes;
        if (outNode != null) {
            toRun = mode.equals("SERIAL")
                    ? new ArrayList<>(nodes.subList(0, nodes.indexOf(outNode) + 1))
                    : List.of(outNode);
        }

        List<RunResult.RunNode> runNodes = new ArrayList<>();
        boolean ok = true;
        String failedNode = null;
        String error = null;

        if (mode.equals("SERIAL")) {
            for (SqlNodeDef node : toRun) {
                RunResult.RunNode rn = executeNode(node, vars);
                runNodes.add(rn);
                if (rn.isOk()) {
                    vars.put(node.getName(), rn.getOutput());
                } else {
                    ok = false;
                    failedNode = node.getName();
                    error = rn.getError();
                    break; // 一个失败，后面不再执行
                }
            }
        } else {
            int poolSize = Math.max(1, Math.min(parallelPoolSize, Math.max(1, toRun.size())));
            ExecutorService pool = Executors.newFixedThreadPool(poolSize);
            try {
                List<Future<RunResult.RunNode>> futures = new ArrayList<>();
                for (SqlNodeDef node : toRun) {
                    futures.add(pool.submit(() -> executeNode(node, vars)));
                }
                for (int i = 0; i < futures.size(); i++) {
                    SqlNodeDef node = toRun.get(i);
                    RunResult.RunNode rn;
                    try {
                        rn = futures.get(i).get();
                    } catch (Exception e) {
                        rn = new RunResult.RunNode();
                        rn.setName(node.getName());
                        rn.setOk(false);
                        rn.setError(message(e));
                    }
                    runNodes.add(rn);
                    if (rn.isOk()) {
                        vars.put(node.getName(), rn.getOutput());
                    } else if (ok) {
                        ok = false;
                        failedNode = node.getName();
                        error = rn.getError();
                    }
                }
            } finally {
                pool.shutdown();
            }
        }

        RunResult.RunStep step = new RunResult.RunStep();
        step.setStageIndex(stageIndex);
        step.setKind("LAYER");
        step.setExecutionMode(mode);
        step.setNodes(runNodes);

        LayerOutcome outcome = new LayerOutcome();
        outcome.step = step;
        outcome.ok = ok;
        outcome.failedNode = failedNode;
        outcome.error = error;
        outcome.merged = ok ? mergeLayer(runNodes) : null;
        // 输出节点跑到了 → 让上层收工（后面的层都不跑）
        outcome.stoppedAtOutput = outNode != null && ok;
        return outcome;
    }

    /** 该层 1 个节点 → 该节点输出；多个 → { 节点名: 输出, ... }。 */
    private Object mergeLayer(List<RunResult.RunNode> runNodes) {
        if (runNodes.size() == 1) {
            return runNodes.get(0).getOutput();
        }
        Map<String, NodeOutput> merged = new LinkedHashMap<>();
        for (RunResult.RunNode rn : runNodes) {
            merged.put(rn.getName(), rn.getOutput());
        }
        return merged;
    }

    private RunResult.RunNode executeNode(SqlNodeDef node, VariableTable vars) {
        long t0 = System.currentTimeMillis();
        RunResult.RunNode rn = new RunResult.RunNode();
        rn.setName(node.getName());
        try {
            // 草稿容忍的代价：运行时要卡在这里，且要给人看得懂的话（保存时允许留空）
            if (node.getDataSourceId() == null) {
                throw new BadRequestException("节点 " + node.getName() + " 还没选数据源");
            }
            if (node.getSqlTemplate() == null || node.getSqlTemplate().isBlank()) {
                throw new BadRequestException("节点 " + node.getName() + " 还没写 SQL");
            }
            ReferenceRenderer.Rendered rendered = new ReferenceRenderer(vars).render(node.getSqlTemplate());
            SqlReadOnlyGuard.check(rendered.sql());
            int maxRows = node.getMaxRows() == null ? 1000 : node.getMaxRows();
            String json = sqlRunner.runReadOnly(node.getDataSourceId(), rendered.sql(), rendered.params(), maxRows);
            rn.setOutput(NodeOutput.fromJson(json));
            rn.setOk(true);
        } catch (SqlRunException e) {
            rn.setOk(false);
            rn.setError("数据源执行失败: " + message(e));
        } catch (Exception e) {
            rn.setOk(false);
            rn.setError(message(e));
        }
        rn.setCostMs(System.currentTimeMillis() - t0);
        return rn;
    }

    private static String message(Throwable e) {
        String m = e.getMessage();
        return (m == null || m.isBlank()) ? e.getClass().getSimpleName() : m;
    }

    private static final class LayerOutcome {
        RunResult.RunStep step;
        boolean ok;
        String failedNode;
        String error;
        Object merged;
        /** 本层里"标记为输出"的节点跑到了 → 上层该收工了 */
        boolean stoppedAtOutput;
    }
}
