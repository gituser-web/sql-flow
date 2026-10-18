package com.sqlflow.datasource.provider;

import java.sql.Connection;

/**
 * 数据源 Provider 扩展点（DESIGN §1）。
 * 本版只实现 {@link MySqlProvider}；ES / ClickHouse 为占位实现。
 */
public interface DataSourceProvider {

    /** 数据源类型标识：MYSQL / ELASTICSEARCH / CLICKHOUSE。 */
    String type();

    /** 测试连通性；失败抛异常。 */
    void test(ConnectionParams params) throws Exception;

    /** 打开一个（只读）连接，调用方负责关闭。 */
    Connection open(ConnectionParams params);
}
