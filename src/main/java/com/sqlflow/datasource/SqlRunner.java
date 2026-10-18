package com.sqlflow.datasource;

import java.util.List;

/**
 * SQL 流引擎执行只读 SQL 的入口（DESIGN §11）。实现类是 {@code @Service}。
 */
public interface SqlRunner {

    boolean exists(Long dataSourceId);

    /** 取不到名字返回 "#" + id */
    String dataSourceName(Long dataSourceId);

    /**
     * 执行一条**已渲染好**的只读 SQL（{@code ?} 已就位）。
     *
     * @param params 按 {@code ?} 出现顺序，一律按字符串绑定（ps.setString）
     * @return JSON: {"columns":[...],"rows":[...],"rowCount":n,"truncated":bool,"costMs":n}
     */
    String runReadOnly(Long dataSourceId, String renderedSql, List<String> params, int maxRows)
            throws SqlRunException;
}
