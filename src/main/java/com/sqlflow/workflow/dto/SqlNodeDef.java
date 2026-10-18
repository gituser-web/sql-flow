package com.sqlflow.workflow.dto;

import lombok.Data;

/**
 * LAYER 层内的一个只读 SQL 节点。字段名与前端 SqlNode JSON 一致。
 */
@Data
public class SqlNodeDef {

    private Long id;
    private Integer orderIndex;

    /** 变量名：自动生成（{SQL 流 code}_step_1_node_1，见 NodeNaming），SQL 里用它引用 */
    private String name;
    /** 给人看的名字（人起的）；界面显示这个 */
    private String label;
    private Long dataSourceId;
    private String sqlTemplate;
    private Integer maxRows;

    /** 保存时探到的输出列名（JSON 数组文本）。只读，前端不改。 */
    private String columns;

    /** 标记为输出：执行到它就停（同层后面的不跑、别的并行分支去掉、后面的层都不跑）。最多一个。 */
    private Boolean isOutput;
}
