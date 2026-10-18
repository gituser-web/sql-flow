package com.sqlflow.common;

import com.fasterxml.jackson.databind.ObjectMapper;

/** 共享一个 ObjectMapper（线程安全，配置一致）。 */
public final class Jsons {

    public static final ObjectMapper MAPPER = new ObjectMapper();

    private Jsons() {}
}
