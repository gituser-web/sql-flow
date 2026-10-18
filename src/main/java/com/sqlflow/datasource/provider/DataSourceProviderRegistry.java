package com.sqlflow.datasource.provider;

import com.sqlflow.common.BadRequestException;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 按 {@code type} 选 Provider。
 * 校验"type 必须是 MYSQL / ELASTICSEARCH / CLICKHOUSE"时也走这里。
 */
@Component
public class DataSourceProviderRegistry {

    private final Map<String, DataSourceProvider> byType;

    public DataSourceProviderRegistry(List<DataSourceProvider> providers) {
        Map<String, DataSourceProvider> map = new LinkedHashMap<>();
        for (DataSourceProvider provider : providers) {
            map.put(provider.type(), provider);
        }
        this.byType = Map.copyOf(map);
    }

    /** 取 Provider；未知类型抛 {@link BadRequestException}（field = type）。 */
    public DataSourceProvider get(String type) {
        if (type == null || type.isBlank()) {
            throw new BadRequestException("type", "数据源类型不能为空");
        }
        DataSourceProvider provider = byType.get(type.trim());
        if (provider == null) {
            throw new BadRequestException("type", "不支持的数据源类型: " + type);
        }
        return provider;
    }
}
