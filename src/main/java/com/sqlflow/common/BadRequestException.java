package com.sqlflow.common;

/** 400：调用方/表单的错。 */
public class BadRequestException extends ApiException {
    public BadRequestException(String message) { super(message); }
    public BadRequestException(String field, String message) { super(field, message); }
}
