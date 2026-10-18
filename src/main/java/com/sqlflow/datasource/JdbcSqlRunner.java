package com.sqlflow.datasource;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.sqlflow.common.BadRequestException;
import com.sqlflow.common.Jsons;
import com.sqlflow.datasource.provider.ConnectionParams;
import com.sqlflow.datasource.provider.DataSourceProvider;
import com.sqlflow.datasource.provider.DataSourceProviderRegistry;
import org.springframework.stereotype.Service;

import java.sql.Clob;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.Types;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * {@link SqlRunner} 的 JDBC 实现（DESIGN §11）。执行前对 SQL 再走一遍只读闸门。
 */
@Service
public class JdbcSqlRunner implements SqlRunner {

    private static final int QUERY_TIMEOUT_SECONDS = 30;
    private static final int MAX_TEXT_LEN = 2000;
    private static final Pattern PASSWORD_PATTERN =
            Pattern.compile("(?i)password\\s*=\\s*\\S*");

    private final DataSourceRepository repository;
    private final DataSourceProviderRegistry registry;

    public JdbcSqlRunner(DataSourceRepository repository, DataSourceProviderRegistry registry) {
        this.repository = repository;
        this.registry = registry;
    }

    @Override
    public boolean exists(Long dataSourceId) {
        return dataSourceId != null && repository.existsById(dataSourceId);
    }

    @Override
    public String dataSourceName(Long dataSourceId) {
        if (dataSourceId == null) {
            return "#";
        }
        return repository.findById(dataSourceId)
                .map(DataSourceEntity::getName)
                .orElse("#" + dataSourceId);
    }

    @Override
    public String runReadOnly(Long dataSourceId, String renderedSql, List<String> params, int maxRows)
            throws SqlRunException {
        // 渲染后的语句再校验一次（? 已就位）
        SqlReadOnlyGuard.check(renderedSql);

        DataSourceEntity ds = repository.findById(dataSourceId)
                .orElseThrow(() -> new SqlRunException("数据源不存在: #" + dataSourceId));

        DataSourceProvider provider;
        try {
            provider = registry.get(ds.getType());
        } catch (BadRequestException e) {
            throw new SqlRunException(e.getMessage(), e);
        }

        ConnectionParams cp = new ConnectionParams(
                ds.getType(), ds.getHost(), ds.getPort(), ds.getDatabaseName(),
                ds.getUsername(), ds.getPassword(), ds.getJdbcParams());

        long start = System.currentTimeMillis();
        Connection conn = null;
        try {
            conn = provider.open(cp);

            try (PreparedStatement ps = conn.prepareStatement(renderedSql)) {
                ps.setQueryTimeout(QUERY_TIMEOUT_SECONDS);
                ps.setMaxRows(maxRows + 1);
                if (params != null) {
                    for (int i = 0; i < params.size(); i++) {
                        ps.setString(i + 1, params.get(i));
                    }
                }

                try (ResultSet rs = ps.executeQuery()) {
                    ResultSetMetaData md = rs.getMetaData();
                    int colCount = md.getColumnCount();
                    List<String> columns = buildColumns(md, colCount);

                    List<Map<String, Object>> rows = new ArrayList<>();
                    boolean truncated = false;
                    while (rs.next()) {
                        // setMaxRows(maxRows+1)：多取的一行只用来判断 truncated，不进 rows
                        if (rows.size() >= maxRows) {
                            truncated = true;
                            break;
                        }
                        Map<String, Object> row = new LinkedHashMap<>();
                        for (int c = 1; c <= colCount; c++) {
                            row.put(columns.get(c - 1), readCell(rs, md, c));
                        }
                        rows.add(row);
                    }

                    long costMs = System.currentTimeMillis() - start;
                    Map<String, Object> out = new LinkedHashMap<>();
                    out.put("columns", columns);
                    out.put("rows", rows);
                    out.put("rowCount", rows.size());
                    out.put("truncated", truncated);
                    out.put("costMs", costMs);
                    return toJson(out);
                }
            }
        } catch (SqlRunException e) {
            throw e;
        } catch (JsonProcessingException e) {
            throw new SqlRunException("查询结果序列化失败: " + e.getMessage(), e);
        } catch (Exception e) {
            throw new SqlRunException(failMessage(ds, e), e);
        } finally {
            if (conn != null) {
                try {
                    conn.close();
                } catch (SQLException ignored) {
                    // 关闭失败忽略
                }
            }
        }
    }

    // ------------------------------------------------------------------
    // 结果集读取
    // ------------------------------------------------------------------

    /** 列名重复时加 _2 / _3 后缀。 */
    private static List<String> buildColumns(ResultSetMetaData md, int colCount) throws SQLException {
        List<String> columns = new ArrayList<>(colCount);
        Map<String, Integer> seen = new HashMap<>();
        for (int c = 1; c <= colCount; c++) {
            String label = md.getColumnLabel(c);
            if (label == null || label.isEmpty()) {
                label = md.getColumnName(c);
            }
            if (label == null || label.isEmpty()) {
                label = "col" + c;
            }
            int n = seen.merge(label, 1, Integer::sum);
            columns.add(n == 1 ? label : label + "_" + n);
        }
        return columns;
    }

    private static Object readCell(ResultSet rs, ResultSetMetaData md, int index) throws SQLException {
        int sqlType = md.getColumnType(index);

        if (isBinary(sqlType)) {
            byte[] bytes = rs.getBytes(index);
            return bytes == null ? null : "<二进制 " + bytes.length + " 字节>";
        }

        Object value = rs.getObject(index);
        if (value == null) {
            return null;
        }
        if (value instanceof byte[] bytes) {
            return "<二进制 " + bytes.length + " 字节>";
        }
        if (value instanceof Clob clob) {
            long len = clob.length();
            int read = (int) Math.min(len, MAX_TEXT_LEN);
            return read <= 0 ? "" : clob.getSubString(1, read);
        }
        if (value instanceof String s) {
            return s.length() > MAX_TEXT_LEN ? s.substring(0, MAX_TEXT_LEN) : s;
        }
        if (value instanceof Number || value instanceof Boolean) {
            return value;
        }
        // 时间等其余类型统一转字符串，避免 Jackson 序列化失败
        return value.toString();
    }

    private static boolean isBinary(int sqlType) {
        return sqlType == Types.BINARY
                || sqlType == Types.VARBINARY
                || sqlType == Types.LONGVARBINARY
                || sqlType == Types.BLOB;
    }

    private static String toJson(Map<String, Object> out) throws JsonProcessingException {
        return Jsons.MAPPER.writeValueAsString(out);
    }

    // ------------------------------------------------------------------
    // 错误消息（抹掉密码）
    // ------------------------------------------------------------------

    private static String failMessage(DataSourceEntity ds, Throwable e) {
        return "执行只读 SQL 失败: " + scrub(rootMessage(e), ds.getPassword());
    }

    private static String scrub(String message, String password) {
        String msg = message == null ? "" : message;
        if (password != null && !password.isEmpty()) {
            msg = msg.replace(password, "******");
        }
        return PASSWORD_PATTERN.matcher(msg).replaceAll("password=******");
    }

    private static String rootMessage(Throwable e) {
        Throwable t = e;
        while (t.getCause() != null && t.getCause() != t) {
            t = t.getCause();
        }
        String m = t.getMessage();
        return (m == null || m.isBlank()) ? t.getClass().getSimpleName() : m;
    }
}
