package com.sqlflow.workflow.dto;

import lombok.Data;

import java.util.List;

/**
 * SQL 流里的一「步」。kind=LAYER 时用 executionMode + nodes；kind=IF 时用 expression。
 */
@Data
public class StageDef {

    private Long id;
    private Integer orderIndex;

    /** LAYER 或 IF */
    private String kind;

    /** PARALLEL / SERIAL，仅 LAYER */
    private String executionMode;

    /** 仅 IF */
    private String expression;

    /** 仅 LAYER */
    private List<SqlNodeDef> nodes;
}
