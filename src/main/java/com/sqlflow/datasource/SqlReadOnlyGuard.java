package com.sqlflow.datasource;

import com.sqlflow.common.BadRequestException;
import net.sf.jsqlparser.parser.CCJSqlParserUtil;
import net.sf.jsqlparser.statement.Statement;
import net.sf.jsqlparser.statement.Statements;
import net.sf.jsqlparser.statement.select.Select;

import java.util.List;
import java.util.regex.Pattern;

/**
 * 只读闸门（DESIGN §7）：解析后必须**恰好一条** SELECT；含 INTO / FOR UPDATE /
 * LOCK IN SHARE MODE 一律拒绝。
 *
 * <p>供 SQL 流引擎在**渲染完**的语句上再校验一次（渲染后 {@code ?} 已就位）。</p>
 */
public final class SqlReadOnlyGuard {

    private static final Pattern INTO = Pattern.compile("\\bINTO\\b", Pattern.CASE_INSENSITIVE);
    private static final Pattern FOR_UPDATE =
            Pattern.compile("\\bFOR\\s+UPDATE\\b", Pattern.CASE_INSENSITIVE);
    private static final Pattern LOCK_IN_SHARE_MODE =
            Pattern.compile("\\bLOCK\\s+IN\\s+SHARE\\s+MODE\\b", Pattern.CASE_INSENSITIVE);

    private SqlReadOnlyGuard() {
    }

    /**
     * 校验一条只读 SQL；不是"恰好一条 SELECT"则抛 {@link BadRequestException}。
     */
    public static void check(String sql) {
        if (sql == null || sql.isBlank()) {
            throw new BadRequestException("SQL 不能为空");
        }

        Statements statements;
        try {
            statements = CCJSqlParserUtil.parseStatements(sql);
        } catch (Exception e) {
            throw new BadRequestException("SQL 解析失败: " + e.getMessage());
        }

        List<Statement> list = statements.getStatements();
        if (list == null || list.size() != 1) {
            throw new BadRequestException("只允许一条只读 SQL");
        }
        if (!(list.get(0) instanceof Select)) {
            throw new BadRequestException("只允许 SELECT / WITH 只读查询");
        }

        // 去掉字符串字面量后再做关键字匹配（避免字面量里的 INTO 等误伤）
        String stripped = stripLiterals(sql);
        if (INTO.matcher(stripped).find()) {
            throw new BadRequestException("只读 SQL 不允许使用 INTO");
        }
        if (FOR_UPDATE.matcher(stripped).find()) {
            throw new BadRequestException("只读 SQL 不允许使用 FOR UPDATE");
        }
        if (LOCK_IN_SHARE_MODE.matcher(stripped).find()) {
            throw new BadRequestException("只读 SQL 不允许使用 LOCK IN SHARE MODE");
        }
    }

    /**
     * 把单引号 / 双引号字符串字面量的内容替换为空格（保留 token 边界）。
     */
    private static String stripLiterals(String sql) {
        StringBuilder sb = new StringBuilder(sql.length());
        boolean inSingle = false;
        boolean inDouble = false;
        for (int i = 0; i < sql.length(); i++) {
            char c = sql.charAt(i);
            if (inSingle) {
                if (c == '\'') {
                    if (i + 1 < sql.length() && sql.charAt(i + 1) == '\'') {
                        i++; // 转义的 '' 仍在字面量内
                    } else {
                        inSingle = false;
                    }
                }
                sb.append(' ');
            } else if (inDouble) {
                if (c == '"') {
                    inDouble = false;
                }
                sb.append(' ');
            } else if (c == '\'') {
                inSingle = true;
                sb.append(' ');
            } else if (c == '"') {
                inDouble = true;
                sb.append(' ');
            } else {
                sb.append(c);
            }
        }
        return sb.toString();
    }
}
