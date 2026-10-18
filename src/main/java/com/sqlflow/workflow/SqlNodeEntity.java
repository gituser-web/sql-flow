package com.sqlflow.workflow;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * LAYER 层内的一个只读 SQL 节点。表 {@code sql_node}。见 DESIGN §3.4。
 */
@Data
@Entity
@Table(name = "sql_node")
public class SqlNodeEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "stage_id", nullable = false)
    private Long stageId;

    /** **变量名**：自动生成（`{SQL 流 code}_step_1_node_1`，见 NodeNaming），SQL 里用它引用 */
    @Column(name = "name", length = 64, nullable = false)
    private String name;

    /** **给人看的名字**（人起的）。界面显示这个，SQL 里不用它 */
    @Column(name = "label", length = 128)
    private String label;

    /** 层内顺序（SERIAL 按此顺序） */
    @Column(name = "order_index", nullable = false)
    private Integer orderIndex;

    /** 草稿可为空：新建 SQL 流时节点还没选数据源是允许的，运行时才卡。 */
    @Column(name = "data_source_id")
    private Long dataSourceId;

    /** 只读 SQL 模板 */
    @Column(name = "sql_template", columnDefinition = "TEXT")
    private String sqlTemplate;

    /**
     * **保存时探到的输出列名**（JSON 数组文本）。
     * 存下来是为了详情页直接读 —— 不用每次打开都重新连库算一遍。
     * 列名不叫 columns：COLUMNS 在 MySQL 里是关键字。
     */
    @Column(name = "output_columns", columnDefinition = "TEXT")
    private String columns;

    /**
     * 标记为**输出**：执行到它就停 —— 同层后面的（串行）不跑、同层别的（并行）去掉、后面的层都不跑。
     * 一个 SQL 流最多一个节点标记为输出。
     */
    @Column(name = "is_output")
    private Boolean isOutput;

    /** 默认 1000，上限 10000 */
    @Column(name = "max_rows")
    private Integer maxRows;

    @Column(name = "created_at")
    private LocalDateTime createdAt;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    @PrePersist
    void onCreate() {
        LocalDateTime now = LocalDateTime.now();
        if (createdAt == null) {
            createdAt = now;
        }
        updatedAt = now;
        if (maxRows == null) {
            maxRows = 10;
        }
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = LocalDateTime.now();
    }
}
