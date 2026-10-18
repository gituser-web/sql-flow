package com.sqlflow.workflow.dto;

import lombok.Data;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 新建/更新 SQL 流的入参，也是 GET 详情的返回形状。见 DESIGN §6.2。
 * 字段名必须与前端 WorkflowDef JSON 完全一致。
 */
@Data
public class WorkflowDef {

    private Long id;
    private String code;
    private String name;
    private String description;
    /** 输入参数的 JSON 数组文本：[{"name","type","required","defaultValue"}] */
    private String inputs;
    /** 输出取哪个节点的结果（节点名）。空 = 最后一层的最后一个节点。 */
    private String outputNode;
    private Integer status;

    /** 列表视图用（详情也会带上） */
    private Integer stageCount;
    private Integer nodeCount;

    private List<StageDef> stages;

    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
