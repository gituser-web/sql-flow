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
 * SQL 流的一「步」，纵向有序。表 {@code stage}。见 DESIGN §3.3。
 */
@Data
@Entity
@Table(name = "stage")
public class StageEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "workflow_id", nullable = false)
    private Long workflowId;

    /** 从 0 递增，决定纵向顺序 */
    @Column(name = "order_index", nullable = false)
    private Integer orderIndex;

    /** LAYER 或 IF */
    @Column(name = "kind", length = 8, nullable = false)
    private String kind;

    /** PARALLEL / SERIAL，仅 LAYER */
    @Column(name = "execution_mode", length = 8)
    private String executionMode;

    /** 仅 IF，条件表达式 */
    @Column(name = "expression", length = 500)
    private String expression;

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
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = LocalDateTime.now();
    }
}
