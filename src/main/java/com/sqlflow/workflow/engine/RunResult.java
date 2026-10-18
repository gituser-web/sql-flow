package com.sqlflow.workflow.engine;

import lombok.Data;

import java.util.List;

/**
 * 一次 SQL 流执行的结果。字段与 DESIGN §5 的 RunResult JSON 一致。
 */
@Data
public class RunResult {

    private boolean ok;

    /** SUCCESS / STOPPED / FAILED */
    private String status;

    /** 最后一个成功执行到的 LAYER 的合并结果 */
    private Object output;

    private long costMs;

    private List<RunStep> steps;

    /** FAILED 时给 */
    private String error;

    /** FAILED 时给节点名 */
    private String failedNode;

    /** 一个 stage 的执行轨迹。 */
    @Data
    public static class RunStep {
        private int stageIndex;
        private String kind;
        private String executionMode;
        private String expression;
        private Boolean verdict;
        private List<RunNode> nodes;
    }

    /** 一个 SQL 节点的执行轨迹。 */
    @Data
    public static class RunNode {
        private String name;
        private boolean ok;
        private NodeOutput output;
        private long costMs;
        private String error;
    }
}
