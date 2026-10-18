package com.sqlflow;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * sql-flow：分层 SQL 流。
 *
 * 新建一个 API = 新建一个 SQL 流。SQL 流由若干「层」纵向排列，每层放 1~N 个只读 SQL 节点，
 * 层间可插 if 节点；后层可引用前面所有层节点的输出；最后一层的输出就是整个 API 的输出。
 */
@SpringBootApplication
public class SqlFlowApplication {
    public static void main(String[] args) {
        SpringApplication.run(SqlFlowApplication.class, args);
    }
}
