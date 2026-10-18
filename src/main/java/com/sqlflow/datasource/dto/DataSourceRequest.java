package com.sqlflow.datasource.dto;

import lombok.Data;

/**
 * 新建 / 更新数据源的入参（DESIGN §6.1）。
 * 形状与前端 {@code DataSource} 一致。
 */
@Data
public class DataSourceRequest {
    private String name;
    private String type;
    private String host;
    private Integer port;
    private String databaseName;
    private String username;
    private String password;
    private String jdbcParams;
    private Integer status;
}
