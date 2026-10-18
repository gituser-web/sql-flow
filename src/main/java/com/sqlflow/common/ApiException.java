package com.sqlflow.common;

/**
 * 业务异常基类。带上 field 时，前端把对应表单字段标红（与数据源页同一套约定）。
 */
public class ApiException extends RuntimeException {

    /** 对应前端表单字段名；为 null 表示不是某一格的问题 */
    public final String field;

    public ApiException(String message) {
        this(null, message);
    }

    public ApiException(String field, String message) {
        super(message);
        this.field = field;
    }
}
