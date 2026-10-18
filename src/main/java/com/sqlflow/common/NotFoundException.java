package com.sqlflow.common;

/** 404：不存在。 */
public class NotFoundException extends ApiException {
    public NotFoundException(String message) { super(message); }
}
