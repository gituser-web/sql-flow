package com.sqlflow.datasource.dto;

import lombok.Data;

/**
 * 连接测试入参（DESIGN §6.1）：与 {@link DataSourceRequest} 相同，去掉 name / status。
 * 不落库。
 */
@Data
public class ConnectionTestRequest {
    private String type;
    private String host;
    private Integer port;
    private String databaseName;
    private String username;
    private String password;
    private String jdbcParams;
}
