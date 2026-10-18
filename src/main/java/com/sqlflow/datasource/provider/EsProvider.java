package com.sqlflow.datasource.provider;

import org.springframework.stereotype.Component;

import java.sql.Connection;

/**
 * Elasticsearch 占位 Provider（DESIGN §1：只留扩展点，本版未实现）。
 */
@Component
public class EsProvider implements DataSourceProvider {

    public static final String TYPE = "ELASTICSEARCH";

    private static final String NOT_IMPLEMENTED = "本版未实现该数据源类型";

    @Override
    public String type() {
        return TYPE;
    }

    @Override
    public void test(ConnectionParams params) {
        throw new UnsupportedOperationException(NOT_IMPLEMENTED);
    }

    @Override
    public Connection open(ConnectionParams params) {
        throw new UnsupportedOperationException(NOT_IMPLEMENTED);
    }
}
