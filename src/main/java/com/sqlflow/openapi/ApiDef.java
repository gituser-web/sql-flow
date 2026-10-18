package com.sqlflow.openapi;

import jakarta.persistence.*;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 对外暴露的一个 API。**两种模式**（qi 定的）：
 *
 * <ul>
 *   <li>{@link #MODE_SQL}：直接写一条只读 SQL（也可以用可视化编辑器生成）+ 声明输入参数。
 *       执行走和数据节点同一条只读闸门；{@code $参数名} 是输入参数。</li>
 *   <li>{@link #MODE_WORKFLOW}：引用一个 SQL 流，把它整个跑一遍；输入参数用 SQL 流自己声明的。</li>
 * </ul>
 *
 * 对外地址一律 {@code /openapi/{code}}，靠 {@link ApiTokenEntity} 里的凭证鉴权。
 */
@Data
@Entity
@Table(name = "api_def")
public class ApiDef {

    public static final String MODE_SQL = "SQL";
    public static final String MODE_WORKFLOW = "WORKFLOW";

    public static final int ENABLED = 1;
    public static final int DISABLED = 0;

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 对外路径段：/openapi/{code}。界面不填，后端自动生成。 */
    @Column(name = "code", length = 64, nullable = false, unique = true)
    private String code;

    @Column(name = "name", length = 128, nullable = false)
    private String name;

    @Column(name = "description", length = 500)
    private String description;

    /** SQL / WORKFLOW */
    @Column(name = "mode", length = 16, nullable = false)
    private String mode;

    // ── SQL 模式用 ────────────────────────────────────────────
    /** 连哪个数据源（data_source.id） */
    @Column(name = "data_source_id")
    private Long dataSourceId;

    /** 只读 SQL 模板；{@code $参数名} 是输入参数 */
    @Column(name = "sql_template", columnDefinition = "TEXT")
    private String sqlTemplate;

    /** 最多返回行数 */
    @Column(name = "max_rows")
    private Integer maxRows;

    // ── SQL 流模式用 ──────────────────────────────────────────
    /** 引用哪个 SQL 流（workflow.id） */
    @Column(name = "workflow_id")
    private Long workflowId;

    /** 输入参数的 JSON 数组文本：[{"name","type","required","defaultValue"}] */
    @Column(name = "params", columnDefinition = "TEXT")
    private String params;

    /**
     * **参数映射**（只 WORKFLOW 模式用）：API 参数名 → SQL 流参数名，JSON 对象文本 `{"nnn":"orderId"}`。
     * 没配的按**同名**自动绑；这里配了的以这里为准。
     */
    @Column(name = "param_map", columnDefinition = "TEXT")
    private String paramMap;

    /** 1 启用 / 0 停用。停用的对外 404（管理页仍可见、可试跑） */
    @Column(name = "status", nullable = false)
    private Integer status;

    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;

    @PrePersist
    void onCreate() {
        if (createdAt == null) createdAt = LocalDateTime.now();
        updatedAt = createdAt;
        if (status == null) status = ENABLED;
    }

    @PreUpdate
    void onUpdate() { updatedAt = LocalDateTime.now(); }
}
