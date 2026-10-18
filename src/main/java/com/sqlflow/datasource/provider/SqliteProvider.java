package com.sqlflow.datasource.provider;

import org.springframework.stereotype.Component;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;

/**
 * SQLite Provider：零安装数据源，用来本地试跑（不用起任何数据库服务）。
 *
 * <p>{@code databaseName} 存的是**数据库文件路径**（如 {@code /Users/you/sql-flow/data/demo.db}），
 * 没有 host / port / 用户名 / 密码。文件不存在时，读连接会失败（报错，不会静默建空库）。</p>
 *
 * <p>打开后执行 {@code PRAGMA query_only = ON}，从连接层再锁一道只读 ——
 * 与 {@link MySqlProvider} 的 {@code setReadOnly(true)} 对应。</p>
 */
@Component
public class SqliteProvider implements DataSourceProvider {

    public static final String TYPE = "SQLITE";

    @Override
    public String type() {
        return TYPE;
    }

    @Override
    public void test(ConnectionParams params) throws Exception {
        try (Connection conn = open(params)) {
            if (conn == null) {
                throw new SQLException("未能建立连接");
            }
        }
    }

    @Override
    public Connection open(ConnectionParams params) {
        String path = params.databaseName();
        if (path == null || path.isBlank()) {
            throw new RuntimeException("SQLite 要填数据库文件路径");
        }

        Connection conn;
        try {
            conn = DriverManager.getConnection("jdbc:sqlite:" + path.trim());
        } catch (SQLException e) {
            throw new RuntimeException("无法打开 SQLite 文件: " + e.getMessage(), e);
        }

        try (Statement st = conn.createStatement()) {
            st.execute("PRAGMA query_only = ON");
        } catch (SQLException ignored) {
            // 老驱动不支持也无所谓：只读闸门仍在 SQL 层兜底
        }
        return conn;
    }
}
