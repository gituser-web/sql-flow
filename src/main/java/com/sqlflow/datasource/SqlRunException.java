package com.sqlflow.datasource;

/**
 * 上游（数据库）的错：连不上、查询失败。DESIGN §11。
 */
public class SqlRunException extends RuntimeException {

    public SqlRunException(String message) {
        super(message);
    }

    public SqlRunException(String message, Throwable cause) {
        super(message, cause);
    }
}
