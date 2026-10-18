package com.sqlflow.datasource.provider;

/**
 * Provider 打开 / 测试连接所需的参数（datasource 包内部使用）。
 */
public record ConnectionParams(
        String type,
        String host,
        Integer port,
        String databaseName,
        String username,
        String password,
        String jdbcParams
) {
}
