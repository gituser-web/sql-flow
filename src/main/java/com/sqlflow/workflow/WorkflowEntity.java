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
 * SQL 流。表 {@code workflow}。见 DESIGN §3.2。
 */
@Data
@Entity
@Table(name = "workflow")
public class WorkflowEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** URL 段，唯一，[a-z0-9][a-z0-9_-]* */
    @Column(name = "code", length = 64, nullable = false, unique = true)
    private String code;

    @Column(name = "name", length = 128, nullable = false)
    private String name;

    @Column(name = "description", length = 500)
    private String description;

    /**
     * 输入参数的 JSON 数组：{@code [{"name","type","required","defaultValue"}]}。
     * 存 text 不存 json 列（H2 / MySQL 的 json 行为不一致）。
     */
    @Column(name = "inputs", columnDefinition = "TEXT")
    private String inputs;

    /** 输出取哪个节点的结果（节点名）。**空 = 最后一层的最后一个节点**。 */
    @Column(name = "output_node", length = 64)
    private String outputNode;

    /** 1 启用 / 0 停用 */
    @Column(name = "status", nullable = false)
    private Integer status;

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
        if (status == null) {
            status = 1;
        }
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = LocalDateTime.now();
    }
}
