package com.sqlflow.datasource;

import com.sqlflow.common.BadRequestException;
import com.sqlflow.common.NotFoundException;
import com.sqlflow.datasource.dto.ConnectionTestRequest;
import com.sqlflow.datasource.dto.DataSourceRequest;
import com.sqlflow.datasource.provider.ConnectionParams;
import com.sqlflow.datasource.provider.DataSourceProvider;
import com.sqlflow.datasource.provider.DataSourceProviderRegistry;
import com.sqlflow.datasource.provider.SqliteProvider;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 数据源业务：CRUD + 连接测试。校验失败抛 {@code BadRequestException(field, msg)}。
 */
@Service
public class DataSourceService {

    private final DataSourceRepository repository;
    private final DataSourceProviderRegistry registry;

    public DataSourceService(DataSourceRepository repository, DataSourceProviderRegistry registry) {
        this.repository = repository;
        this.registry = registry;
    }

    @Transactional(readOnly = true)
    public List<DataSourceEntity> list() {
        return repository.findAllByOrderByIdDesc();
    }

    @Transactional(readOnly = true)
    public DataSourceEntity get(Long id) {
        return repository.findById(id)
                .orElseThrow(() -> new NotFoundException("数据源不存在: #" + id));
    }

    @Transactional
    public DataSourceEntity create(DataSourceRequest req) {
        validate(req, null);
        DataSourceEntity entity = new DataSourceEntity();
        apply(entity, req);
        return repository.save(entity);
    }

    @Transactional
    public DataSourceEntity update(Long id, DataSourceRequest req) {
        DataSourceEntity entity = get(id);
        validate(req, id);
        apply(entity, req);
        return repository.save(entity);
    }

    @Transactional
    public void delete(Long id) {
        DataSourceEntity entity = get(id);
        repository.delete(entity);
    }

    @Transactional
    public DataSourceEntity setStatus(Long id, boolean enabled) {
        DataSourceEntity entity = get(id);
        entity.setStatus(enabled ? 1 : 0);
        return repository.save(entity);
    }

    /**
     * 连接测试（不落库）。连不上不抛 500，返回 {@code {ok:false, message}}；
     * 结构性校验错仍抛 400。
     */
    public Map<String, Object> test(ConnectionTestRequest req) {
        if (req == null) {
            throw new BadRequestException("请求体不能为空");
        }
        DataSourceProvider provider = registry.get(req.getType());
        String host = trim(req.getHost());
        String database = trim(req.getDatabaseName());
        if (isSqlite(req.getType())) {
            // SQLite 只要文件路径，没有 host/port/账号
            if (database == null || database.isEmpty()) {
                throw new BadRequestException("databaseName", "SQLite 文件路径不能为空");
            }
        } else {
            if (host == null || host.isEmpty()) {
                throw new BadRequestException("host", "主机不能为空");
            }
            validatePort(req.getPort());
            if (database == null || database.isEmpty()) {
                throw new BadRequestException("databaseName", "数据库名不能为空");
            }
        }

        ConnectionParams params = new ConnectionParams(
                req.getType(), host, req.getPort(), database,
                trim(req.getUsername()), req.getPassword(), trimToNull(req.getJdbcParams()));

        try {
            provider.test(params);
            return result(true, "连接成功");
        } catch (UnsupportedOperationException e) {
            return result(false, messageOrDefault(e, "本版未实现该数据源类型"));
        } catch (Exception e) {
            return result(false, "连接失败: " + rootMessage(e));
        }
    }

    /**
     * 列出数据源里的表名（给"可视化单表查询"用）。MySQL 用 {@code show tables}，SQLite 查 sqlite_master。
     */
    @Transactional(readOnly = true)
    public List<String> listTables(Long id) {
        DataSourceEntity ds = get(id);
        DataSourceProvider provider = registry.get(ds.getType());
        String sql = SqliteProvider.TYPE.equalsIgnoreCase(ds.getType())
                ? "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name"
                : "show tables";
        List<String> out = new ArrayList<>();
        try (Connection c = provider.open(paramsOf(ds));
             Statement st = c.createStatement();
             ResultSet rs = st.executeQuery(sql)) {
            while (rs.next()) {
                String name = rs.getString(1);
                if (name != null && !name.isBlank()) out.add(name);
            }
            return out;
        } catch (UnsupportedOperationException e) {
            throw new BadRequestException("本版未实现该数据源类型");
        } catch (SQLException e) {
            throw new BadRequestException("读表列表失败: " + e.getMessage());
        }
    }

    private static ConnectionParams paramsOf(DataSourceEntity d) {
        return new ConnectionParams(d.getType(), d.getHost(), d.getPort(), d.getDatabaseName(),
                d.getUsername(), d.getPassword(), d.getJdbcParams());
    }

    // ------------------------------------------------------------------
    // 校验
    // ------------------------------------------------------------------

    private void validate(DataSourceRequest req, Long selfId) {
        if (req == null) {
            throw new BadRequestException("请求体不能为空");
        }
        String name = trim(req.getName());
        if (name == null || name.isEmpty()) {
            throw new BadRequestException("name", "名称不能为空");
        }
        if (name.length() > 128) {
            throw new BadRequestException("name", "名称最长 128 字符");
        }
        repository.findByName(name).ifPresent(existing -> {
            if (selfId == null || !existing.getId().equals(selfId)) {
                throw new BadRequestException("name", "名称已存在: " + name);
            }
        });

        registry.get(req.getType()); // 校验 type 是已注册的类型

        String host = trim(req.getHost());
        String database = trim(req.getDatabaseName());
        if (isSqlite(req.getType())) {
            // SQLite 只要文件路径
            if (database == null || database.isEmpty()) {
                throw new BadRequestException("databaseName", "SQLite 文件路径不能为空");
            }
        } else {
            if (host == null || host.isEmpty()) {
                throw new BadRequestException("host", "主机不能为空");
            }
            validatePort(req.getPort());
            if (database == null || database.isEmpty()) {
                throw new BadRequestException("databaseName", "数据库名不能为空");
            }
        }
    }

    /** SQLite 不需要 host / port / 账号，只要文件路径。 */
    private static boolean isSqlite(String type) {
        return SqliteProvider.TYPE.equalsIgnoreCase(type == null ? "" : type.trim());
    }

    private static void validatePort(Integer port) {
        if (port == null) {
            throw new BadRequestException("port", "端口不能为空");
        }
        if (port < 1 || port > 65535) {
            throw new BadRequestException("port", "端口需在 1-65535 之间");
        }
    }

    private static void apply(DataSourceEntity entity, DataSourceRequest req) {
        entity.setName(trim(req.getName()));
        entity.setType(trim(req.getType()));
        entity.setHost(trim(req.getHost()));
        entity.setPort(req.getPort());
        entity.setDatabaseName(trim(req.getDatabaseName()));
        entity.setUsername(trim(req.getUsername()));
        entity.setPassword(req.getPassword());
        entity.setJdbcParams(trimToNull(req.getJdbcParams()));
        if (req.getStatus() != null) {
            entity.setStatus(req.getStatus());
        } else if (entity.getStatus() == null) {
            entity.setStatus(1);
        }
    }

    // ------------------------------------------------------------------
    // 小工具
    // ------------------------------------------------------------------

    private static Map<String, Object> result(boolean ok, String message) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("ok", ok);
        m.put("message", message);
        return m;
    }

    private static String trim(String s) {
        return s == null ? null : s.trim();
    }

    private static String trimToNull(String s) {
        if (s == null) {
            return null;
        }
        String t = s.trim();
        return t.isEmpty() ? null : t;
    }

    private static String messageOrDefault(Throwable e, String fallback) {
        String m = e.getMessage();
        return (m == null || m.isBlank()) ? fallback : m;
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
