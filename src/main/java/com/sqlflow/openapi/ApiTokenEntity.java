package com.sqlflow.openapi;

import jakarta.persistence.*;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 调 API 用的**凭证**（仿 tianzhi 的 api_token）。
 *
 * <p>明文存、界面能点开看（qi 定的）：它的作用是"知道是哪个系统在调 + 出事了能一键停掉"，
 * 不是身份认证。**停用立刻生效**——鉴权按值查库、不缓存。</p>
 */
@Data
@Entity
@Table(name = "api_token")
public class ApiTokenEntity {

    public static final int ENABLED = 1;
    public static final int DISABLED = 0;

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 谁在用，如"订单系统" */
    @Column(name = "name", length = 128, nullable = false)
    private String name;

    @Column(name = "remark", length = 500)
    private String remark;

    /** tk_ + 32 位十六进制。唯一，鉴权按它查库 */
    @Column(name = "token", length = 64, nullable = false, unique = true)
    private String token;

    @Column(name = "status", nullable = false)
    private Integer status;

    /** 最近使用时间（节流写，见 ApiTokenService） */
    @Column(name = "last_used_at")
    private LocalDateTime lastUsedAt;

    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @PrePersist
    void onCreate() {
        if (createdAt == null) createdAt = LocalDateTime.now();
        if (status == null) status = ENABLED;
    }
}
