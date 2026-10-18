package com.sqlflow.datasource;

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
 * 数据源（表 {@code data_source}）。字段严格对应 DESIGN §3.1。
 *
 * <p>{@code password} 本版明文存储（不做加密，README 里注明）。</p>
 */
@Data
@Entity
@Table(name = "data_source")
public class DataSourceEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 唯一 */
    @Column(name = "name", length = 128, nullable = false, unique = true)
    private String name;

    /** MYSQL / ELASTICSEARCH / CLICKHOUSE（本版只实现 MYSQL） */
    @Column(name = "type", length = 16, nullable = false)
    private String type;

    /** MySQL 等需要；SQLite 没有 host，可为空 */
    @Column(name = "host", length = 255)
    private String host;

    @Column(name = "port")
    private Integer port;

    @Column(name = "database_name", length = 128)
    private String databaseName;

    @Column(name = "username", length = 128)
    private String username;

    /** 明文存储（本版不做加密） */
    @Column(name = "password", length = 512)
    private String password;

    /** 可空，如 {@code useSSL=false} */
    @Column(name = "jdbc_params", length = 512)
    private String jdbcParams;

    /** 1 启用 / 0 停用 */
    @Column(name = "status")
    private Integer status;

    @Column(name = "created_at")
    private LocalDateTime createdAt;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    @PrePersist
    void onCreate() {
        LocalDateTime now = LocalDateTime.now();
        this.createdAt = now;
        this.updatedAt = now;
        if (this.status == null) {
            this.status = 1;
        }
    }

    @PreUpdate
    void onUpdate() {
        this.updatedAt = LocalDateTime.now();
    }
}
