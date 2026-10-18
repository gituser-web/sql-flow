package com.sqlflow.datasource.provider;

import org.springframework.stereotype.Component;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.Properties;

/**
 * MySQL Provider：本版唯一真正实现的数据源类型。
 *
 * <p>URL 形如 {@code jdbc:mysql://host:port/db?useSSL=false&serverTimezone=Asia/Shanghai}，
 * {@code jdbcParams} 追加在后。连上后置为只读；登录超时 10 秒。</p>
 */
@Component
public class MySqlProvider implements DataSourceProvider {

    public static final String TYPE = "MYSQL";

    private static final int LOGIN_TIMEOUT_SECONDS = 10;
    private static final int DEFAULT_PORT = 3306;

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
        // DriverManager.setLoginTimeout 不抛受检异常，直接调（不能套 catch SQLException，会编译不过）
        DriverManager.setLoginTimeout(LOGIN_TIMEOUT_SECONDS);

        Properties props = new Properties();
        if (params.username() != null) {
            props.setProperty("user", params.username());
        }
        if (params.password() != null) {
            props.setProperty("password", params.password());
        }

        Connection conn;
        try {
            conn = DriverManager.getConnection(buildUrl(params), props);
        } catch (SQLException e) {
            throw new RuntimeException("无法连接 MySQL: " + e.getMessage(), e);
        }
        try {
            conn.setReadOnly(true);
        } catch (SQLException ignored) {
            // 某些驱动 / 代理不支持只读标记，忽略
        }
        return conn;
    }

    static String buildUrl(ConnectionParams params) {
        int port = params.port() == null ? DEFAULT_PORT : params.port();
        StringBuilder sb = new StringBuilder("jdbc:mysql://");
        sb.append(params.host()).append(':').append(port);
        sb.append('/').append(params.databaseName());
        sb.append("?useSSL=false&serverTimezone=Asia/Shanghai");

        String extra = params.jdbcParams();
        if (extra != null && !extra.isBlank()) {
            String trimmed = extra.trim();
            while (trimmed.startsWith("?") || trimmed.startsWith("&")) {
                trimmed = trimmed.substring(1);
            }
            if (!trimmed.isEmpty()) {
                sb.append('&').append(trimmed);
            }
        }
        return sb.toString();
    }
}
