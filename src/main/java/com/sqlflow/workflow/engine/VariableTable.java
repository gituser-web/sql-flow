package com.sqlflow.workflow.engine;

import com.sqlflow.common.BadRequestException;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 变量名 → 节点输出。见 DESIGN §4.1。
 * 取值失败（变量不存在 / 路径不存在 / 列不存在）一律抛 {@link BadRequestException}。
 */
public class VariableTable {

    private static final Pattern ROW_PATH = Pattern.compile("rows\\[(\\d+)]\\.([A-Za-z_][A-Za-z0-9_]*)");

    private final Map<String, NodeOutput> vars = new LinkedHashMap<>();

    /** SQL 流**输入参数**（名字 → 值）。SQL 里用 {@code #{名字}} 引用。 */
    private final Map<String, String> scalars = new LinkedHashMap<>();

    /** **数组型**输入参数（名字 → 值列表）。SQL 里 {@code #{名字}} 会展开成 {@code ?, ?, ...}。 */
    private final Map<String, List<String>> lists = new LinkedHashMap<>();

    public void putList(String name, List<String> values) {
        lists.put(name, values);
    }

    public boolean hasList(String name) {
        return lists.containsKey(name);
    }

    /** 取数组型输入参数；没有就抛错。 */
    public List<String> listOf(String name) {
        if (!lists.containsKey(name)) {
            throw new BadRequestException("#{" + name + "} 不是数组型输入参数");
        }
        return lists.get(name);
    }

    public void putScalar(String name, String value) {
        scalars.put(name, value);
    }

    public boolean hasScalar(String name) {
        return scalars.containsKey(name);
    }

    /** 输入参数的只读快照（渲染器要用它去 MyBatis 那边按名字取值）。 */
    public Map<String, String> scalars() {
        return scalars;
    }

    /** 取输入参数的值；没这个输入参数就抛错（不静默）。 */
    public String scalarOf(String name) {
        if (!scalars.containsKey(name)) {
            throw new BadRequestException("$" + name
                    + " 不是输入参数（节点输出要写成 $名.rows[0].列 / $名.rowCount 这种）");
        }
        return scalars.get(name);
    }

    public void put(String name, NodeOutput output) {
        vars.put(name, output);
    }

    public boolean has(String name) {
        return vars.containsKey(name);
    }

    /** 取变量，不存在则抛错（不静默）。 */
    public NodeOutput get(String name) {
        NodeOutput out = vars.get(name);
        if (out == null) {
            throw new BadRequestException("变量未定义: $" + name);
        }
        return out;
    }

    public int rowCount(String name) {
        return get(name).getRowCount();
    }

    /**
     * 取标量。path 形如 {@code rowCount} / {@code truncated} / {@code rows[0].col}。
     */
    public Object scalar(String name, String path) {
        NodeOutput out = get(name);
        if (path == null || path.isBlank()) {
            throw new BadRequestException("变量路径为空: $" + name);
        }
        String p = path.trim();
        if (p.equals("rowCount")) {
            return out.getRowCount();
        }
        if (p.equals("truncated")) {
            return out.isTruncated();
        }
        Matcher m = ROW_PATH.matcher(p);
        if (m.matches()) {
            int idx = Integer.parseInt(m.group(1));
            String col = m.group(2);
            List<Map<String, Object>> rows = out.getRows();
            if (idx < 0 || idx >= rows.size()) {
                throw new BadRequestException("行下标越界: $" + name + "." + p);
            }
            return cell(rows.get(idx), col, name);
        }
        throw new BadRequestException("无法解析变量路径: $" + name + "." + p);
    }

    /**
     * 取某列所有行的值（列表）。列不存在 → 抛错。
     */
    public List<Object> columnList(String name, String col) {
        NodeOutput out = get(name);
        if (out.getColumns() == null || !out.getColumns().contains(col)) {
            throw new BadRequestException("列不存在: $" + name + " 没有列 " + col);
        }
        List<Object> values = new ArrayList<>();
        for (Map<String, Object> row : out.getRows()) {
            values.add(row.get(col));
        }
        return values;
    }

    private Object cell(Map<String, Object> row, String col, String name) {
        if (row == null || !row.containsKey(col)) {
            throw new BadRequestException("列不存在: $" + name + " 没有列 " + col);
        }
        return row.get(col);
    }
}
