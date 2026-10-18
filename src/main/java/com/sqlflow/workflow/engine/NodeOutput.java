package com.sqlflow.workflow.engine;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.sqlflow.common.BadRequestException;
import com.sqlflow.common.Jsons;
import lombok.Data;

import java.util.List;
import java.util.Map;

/**
 * 单个 SQL 节点的输出。见 DESIGN §4.1。
 * 直接从 {@code SqlRunner.runReadOnly} 返回的 JSON 字符串反序列化。
 */
@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class NodeOutput {

    private List<String> columns;
    private List<Map<String, Object>> rows;
    private int rowCount;
    private boolean truncated;
    private long costMs;

    /** 把 runReadOnly 的 JSON 解析成 NodeOutput。 */
    public static NodeOutput fromJson(String json) {
        if (json == null || json.isBlank()) {
            NodeOutput empty = new NodeOutput();
            empty.setColumns(List.of());
            empty.setRows(List.of());
            return empty;
        }
        try {
            NodeOutput out = Jsons.MAPPER.readValue(json, NodeOutput.class);
            if (out.getColumns() == null) {
                out.setColumns(List.of());
            }
            if (out.getRows() == null) {
                out.setRows(List.of());
            }
            return out;
        } catch (Exception e) {
            throw new BadRequestException("无法解析 SQL 执行结果: " + e.getMessage());
        }
    }
}
