# sql-flow 设计契约（并行开发的唯一依据）

> 本文档是项目的设计契约：**类名、字段名、REST 路径、TS 类型一律以本文为准。**
> 有疑问先按本文，别自己加字段/加端点。

## 0. 一句话

把"一条只读 SQL"升级成"分层的 SQL 流"：新建一个 API = 新建一个 SQL 流；SQL 流由若干**层**纵向排列，每层放 1~N 个 SQL 节点，层间可插 **if** 节点；后层可引用前面**所有层**节点的输出；最后一层的输出就是整个 API 的输出。

## 1. 技术栈与约定（已定死）

- Java 21 + Spring Boot 3.3.x + Maven；包名 `com.sqlflow`。
- 端口 **7000**；**前后端不分离**：前端构建产物进 `src/main/resources/static`，由 Spring Boot 托管。
- 应用自身数据：**内嵌 H2 文件**，`jdbc:h2:file:./data/sqlflow;MODE=MySQL`；Hibernate `ddl-auto=update`。
- 被查询的数据源：**只实现 MySQL**；ES / ClickHouse 只留扩展点（枚举 + Provider 空实现）。
- SQL 节点**只读**：单条 `SELECT` / `WITH`。
- token 认证：本版**不做**。
- 编辑器形态：**分层纵向**。if 判定为假 → **结束整个 SQL 流**。
- 前端：Vite + React 18 + TypeScript + react-router-dom。样式手写 CSS（不引 UI 框架），Dify 风格的浅色、卡片、圆角。

## 2. 目录结构与归属（避免并行冲突）

```
sql-flow/
  pom.xml
  README.md                                 [整合]
  docs/DESIGN.md
  src/main/resources/application.yml
  src/main/resources/static/                (前端构建产物, 勿手改)
  src/main/java/com/sqlflow/
    SqlFlowApplication.java
    common/
      ApiException.java  NotFoundException.java  BadRequestException.java
      GlobalExceptionHandler.java  Jsons.java
    datasource/
      DataSourceEntity.java  DataSourceRepository.java
      DataSourceService.java  DataSourceController.java
      dto/DataSourceRequest.java  dto/ConnectionTestRequest.java
      provider/DataSourceProvider.java  provider/MySqlProvider.java
      provider/EsProvider.java  provider/ClickHouseProvider.java   (占位)
      SqlReadOnlyGuard.java   (只读闸门, JSqlParser)
    workflow/
      WorkflowEntity.java  StageEntity.java  SqlNodeEntity.java
      WorkflowRepository.java  StageRepository.java  SqlNodeRepository.java
      WorkflowService.java  WorkflowController.java  RunController.java
      dto/*.java
      engine/ExecutionEngine.java  engine/NodeOutput.java  engine/RunResult.java
      engine/ReferenceRenderer.java  engine/ConditionEvaluator.java
      engine/VariableTable.java
  frontend/
    package.json  vite.config.ts  tsconfig.json  tsconfig.node.json  index.html
    src/main.tsx  src/App.tsx  src/styles.css  src/api/types.ts  src/api/client.ts
    src/components/AppLayout.tsx
    src/pages/datasources/**
    src/pages/workflows/WorkflowListPage.tsx
    src/pages/workflows/WorkflowEditorPage.tsx
    src/pages/workflows/**
```


## 3. 数据模型（JPA / H2）

### 3.1 DataSourceEntity → 表 `data_source`
| 字段 | 类型 | 说明 |
|---|---|---|
| id | Long | 自增 |
| name | String(128) | 唯一 |
| type | String(16) | `MYSQL` / `ELASTICSEARCH` / `CLICKHOUSE`（本版只实现 MYSQL）|
| host | String(255) | |
| port | Integer | |
| databaseName | String(128) | |
| username | String(128) | |
| password | String(512) | 明文存（本版不做加密，README 里注明）|
| jdbcParams | String(512) | 可空，如 `useSSL=false` |
| status | Integer | 1 启用 / 0 停用 |
| createdAt / updatedAt | LocalDateTime | `@PrePersist`/`@PreUpdate` |

### 3.2 WorkflowEntity → 表 `workflow`
| 字段 | 类型 | 说明 |
|---|---|---|
| id | Long | |
| code | String(64) | 唯一，URL 段，`[a-z0-9][a-z0-9_-]*`。**界面不填，后端自动生成**（对外服务以后再设计）|
| name | String(128) | |
| description | String(500) | 可空 |
| inputs | TEXT | 输入参数的 JSON 数组文本（见 §4.4）|
| outputNode | String(64) | 输出取哪个节点；空 = 最后一层的最后一个节点（见 §4.5）|
| status | Integer | 1 启用 / 0 停用（**界面已去掉停用功能，此列保留**）|
| createdAt / updatedAt | | |

### 3.3 StageEntity → 表 `stage`（SQL 流的一"步"，纵向有序）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | Long | |
| workflowId | Long | |
| orderIndex | Integer | 从 0 递增，决定纵向顺序 |
| kind | String(8) | `LAYER` 或 `IF` |
| executionMode | String(8) | `PARALLEL` / `SERIAL`，**仅 LAYER** |
| expression | String(500) | **仅 IF**，条件表达式 |

### 3.4 SqlNodeEntity → 表 `sql_node`
| 字段 | 类型 | 说明 |
|---|---|---|
| id | Long | |
| stageId | Long | 所属 LAYER |
| name | String(64) | **变量名**，同一 SQL 流内唯一，`[A-Za-z_][A-Za-z0-9_]*` |
| orderIndex | Integer | 层内顺序（SERIAL 按此顺序）|
| dataSourceId | Long | |
| sqlTemplate | TEXT | 只读 SQL |
| maxRows | Integer | 默认 1000，上限 10000 |

**层级约束（保存时校验）**：一个 SQL 流至少 1 个 LAYER；IF 不能是第一个 stage（前面必须有 LAYER）；每层至少 1 个 SQL 节点；节点 name SQL 流内唯一。

## 4. 输出格式与引用

### 4.1 节点输出（每个 SQL 节点执行后产生的 JSON）
```json
{ "columns": ["id","status"], "rows": [{"id":1,"status":"paid"}], "rowCount": 1, "truncated": false, "costMs": 3 }
```
变量名 = 节点 `name`，存进 `VariableTable`。

### 4.2 引用语法（写在后层 SQL 模板里）
| 写法 | 含义 | 渲染 |
|---|---|---|
| `$name.rowCount` | 行数（标量）| `?`，绑一个值 |
| `$name.truncated` | 是否截断（标量）| `?` |
| `$name.rows[0].col` | 第 0 行某列（标量）| `?` |
| `$name.rows[*].col` | 该列**所有行**（列表）| `?, ?, ...`；空列表 → `NULL` |
| `$参数名` | **SQL 流输入参数**（裸引用，不带 `.`）| `?`，绑输入值 |

- 渲染成 `?` + 按出现顺序收集绑定值，**值永不进 SQL 文本**。
- `$name` 未定义（该节点被跳过 / 不存在 / 拼错）→ **硬报错**，不静默。
- 禁止 `${...}`（字符串拼接）→ 报错。
- **SQL 流输入参数**用裸的 `$参数名`（`inputs` 里声明的）；节点输出必须带 `.字段`。两者在 SQL 里都用 `$`，所以**参数名不能和节点重名**（校验会拒）。
- 同层节点**默认**不能互相引用（并行层同时跑，互相看不见）；
  **串行层例外**：排在后面的节点可以引用同层排在它前面的节点（它们是一前一后跑的）。
  校验时，某节点的可引用集合 = 输入参数 + 更早层的所有节点 + （串行层时）同层 orderIndex 更小的节点。

## 4.4 SQL 流输入参数（`inputs`）

声明"运行时调用方要填什么"。存 `inputs`（TEXT，JSON 数组）：`[{"name","type","required","defaultValue"}]`，
类型只认 `string / long / int / boolean`。请求里**未声明的参数一律拒**（拼错一个可选名会静默拿到没过滤的数据）。
编辑页有「输入参数」弹窗增删（仿 tianzhi 的 CanvasInputsDialog）。

## 4.5 SQL 流输出（`outputNode`）

**输出 = 指定的那个节点的查询结果**；没指定就取**最后一层的最后一个节点**。
`outputNode` 只能指向**最后一层**里的节点（校验会拒别的层）。指定的节点这次没执行到 → 明确报错，不静默换一个。

### 4.3 if 条件表达式（`ConditionEvaluator`）
支持（确定性求值，绝不回落模型）：
```
$name.rowCount > 0
$name.rows[0].status == 'paid'
$name.rowCount != 0
$name.rows[*].col contains 'x'      // 任一行包含 x
$name.rows[0].col not contains 'x'  // 第 0 行不包含 x
$name.rowCount >= 5   <=   <
$name is empty         $name is not empty
$name                              // 单引用：非空即真
($a.rowCount > 0 and $a.rows[0].amount >= 300) or $a.rows[*].order_no contains 'A100'   // 组合
```
- 上面每一行是一个**判断**；判断之间用 `and` / `or` / 括号组合，**and 优先**（和 SQL 一样），不分大小写。引号里的 and/or 是值，不是关键字；`''` 是转义的 `'`。
- 关键字**只认英文**（`contains` / `not contains` / `is empty` / `is not empty`，以及 `and` / `or`），不分大小写；中文写法（包含 / 不包含 / 为空 / 非空）不支持，会直接报 400。
- 左边必须是 `$引用`，右边是 `'字符串'` / 数字 / 裸词。
- 编辑器的「可视化」拼出来的就是这套（`ifCondition.ts`），也能读回去；读不回去的手写写法只能「直接写表达式」。
- **解析不出 → 直接报错**（400），不要当 false，也不要交给模型。

## 5. 执行语义（`ExecutionEngine`）

- 按 `orderIndex` 顺序遍历 stage，维护 `VariableTable`。
- **LAYER**
  - `PARALLEL`：层内所有节点并发执行（线程池，池大小 4），**全部跑完**再判断；任一失败 → 整个 SQL 流 `FAILED`。
  - `SERIAL`：按 `orderIndex` 顺序执行；**一个失败 → 后面不执行**，整个 SQL 流 `FAILED`。
  - 每个成功节点：`vars.put(name, output)`。
- **IF**：求值；为 `true` → 继续下一 stage；为 `false` → **立即结束整个 SQL 流**，状态 `STOPPED`，返回已产生的最后一层输出。
- **输出**：见 §4.5 —— **指定的那个节点**的结果（默认最后一层的最后一个节点）。

`RunResult`：
```json
{
  "ok": true,
  "status": "SUCCESS | STOPPED | FAILED",
  "output": { },                       // 见上
  "costMs": 12,
  "steps": [                            // 执行轨迹，供编辑器展示
    { "stageIndex":0, "kind":"LAYER", "executionMode":"PARALLEL",
      "nodes":[ {"name":"a","ok":true,"output":{...},"costMs":3,"error":null} ] },
    { "stageIndex":1, "kind":"IF", "expression":"$a.rowCount > 0", "verdict":true }
  ],
  "error": null,                        // FAILED 时给
  "failedNode": null                    // FAILED 时给节点名
}
```

## 6. REST API

### 6.1 数据源 `/api/datasources`
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/datasources` | 列表 |
| GET | `/api/datasources/{id}` | 详情 |
| POST | `/api/datasources` | 新建，body = DataSourceRequest |
| PUT | `/api/datasources/{id}` | 更新 |
| DELETE | `/api/datasources/{id}` | 删除 |
| POST | `/api/datasources/test` | 连接测试（body = ConnectionTestRequest，不落库），返回 `{ok, message}` |

`DataSourceRequest`：`{name, type, host, port, databaseName, username, password, jdbcParams, status}`
`ConnectionTestRequest`：`{type, host, port, databaseName, username, password, jdbcParams}`
校验错 400 → `{error, field}`（field 对应表单字段名，前端据此标红）。

### 6.2 SQL 流 `/api/workflows`
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/workflows` | 列表（含 stageCount / nodeCount）|
| GET | `/api/workflows/{id}` | 完整定义（stages + nodes 嵌套）|
| POST | `/api/workflows` | 新建（body = WorkflowDef）|
| PUT | `/api/workflows/{id}` | 覆盖更新（body = WorkflowDef）|
| DELETE | `/api/workflows/{id}` | 删除 |
| POST | `/api/workflows/{id}/status` | body `{enabled:bool}` |
| POST | `/api/workflows/{id}/run` | 试跑，返回 RunResult |

`WorkflowDef`（新建/更新的入参，也是 GET 详情的返回形状）：
```json
{
  "id": null, "code":"order-status", "name":"查订单状态", "description":"",
  "status":1,
  "stages":[
    { "orderIndex":0, "kind":"LAYER", "executionMode":"PARALLEL",
      "nodes":[ {"orderIndex":0,"name":"main","dataSourceId":1,"sqlTemplate":"select ...","maxRows":1000} ] },
    { "orderIndex":1, "kind":"IF", "expression":"$main.rowCount > 0" },
    { "orderIndex":2, "kind":"LAYER", "executionMode":"SERIAL",
      "nodes":[ {"orderIndex":0,"name":"detail","dataSourceId":1,"sqlTemplate":"select ... where id in ($main.rows[*].id)","maxRows":1000} ] }
  ]
}
```

### 6.3 对外调用 `/api/run/{code}`
- `POST /api/run/{code}`：按 code 执行启用中的 SQL 流，返回 RunResult。
- 不存在 / 已停用 → 404。无 token（本版）。

## 7. 只读闸门（`SqlReadOnlyGuard`）
- 用 JSqlParser：解析后必须**恰好一条** `Select`；含 `INTO` / `FOR UPDATE` / `LOCK IN SHARE MODE` → 拒。
- 公开静态方法：`static void check(String sql)`（抛 `BadRequestException`）。
- 供 SQL 流引擎在**渲染完**的语句上再校验一次（渲染后 `?` 已就位）。

## 8. 前端契约

`frontend/src/api/types.ts` 已定义：`DataSource`、`ConnectionTest`、`Workflow`、`WorkflowDef`、`Stage`、`SqlNode`、`RunResult`、`RunStep`、`NodeOutput`（与后端 JSON 一一对应）。
`frontend/src/api/client.ts` 已封装所有请求函数（见文件）。**页面只调 client，不自己 fetch。**

路由（`App.tsx` 已配好）：
- `/` → 重定向到 `/workflows`
- `/datasources`
- `/workflows`、`/workflows/:id`

## 9. 视觉（Dify 风格）
- 浅色背景（`#f7f8fa`），卡片白底 + `1px #e5e7eb` 边 + 圆角 10px + 极轻阴影。
- 主色 `#2563eb`；文字 `#111827` / 次要 `#6b7280`。
- 分层编辑器：每层是一张横向卡片，层标题带"层 N / 并行·串行切换 / + 加 SQL 节点"；层内节点横向排列的小卡片；层与层之间画一条竖线，线上挂 if 卡片。
- 复用 `styles.css` 里的基础类：`.btn .btn--primary .btn--danger .btn--sm`、`.input`、`.card`、`.pill`、`.notice`、`.empty-note`、`.field-row`、`.field-label`、`.modal`、`.modal-overlay`。

## 10. 构建（重要）
需要 JDK 21 + Maven + Node.js。构建步骤：
```
cd frontend && npm install && npm run build      # 产物进 ../src/main/resources/static
cd .. && mvn spring-boot:run                      # http://localhost:7000
```
`vite.config.ts` 的 `build.outDir` 已指向 `../src/main/resources/static`，`emptyOutDir: true`。

## 11. 跨模块接缝（`datasource` 提供，`workflow` 使用）

依赖方向**只有一条**：`workflow` → `datasource`。`datasource` 包**不许** import `workflow` 包。

`com.sqlflow.datasource` 对外提供：

```java
/** SQL 流引擎执行只读 SQL 的入口。实现类是 @Service。 */
public interface SqlRunner {
    boolean exists(Long dataSourceId);
    /** 取不到名字返回 "#" + id */
    String dataSourceName(Long dataSourceId);
    /**
     * 执行一条**已渲染好**的只读 SQL（? 已就位）。
     * @param params 按 ? 出现顺序，一律按字符串绑定（ps.setString）
     * @return JSON: {"columns":[...],"rows":[...],"rowCount":n,"truncated":bool,"costMs":n}
     */
    String runReadOnly(Long dataSourceId, String renderedSql, List<String> params, int maxRows)
            throws SqlRunException;
}

/** 上游（数据库）的错：连不上、查询失败。 */
public class SqlRunException extends RuntimeException { ... }

/** 只读闸门。 */
public final class SqlReadOnlyGuard {
    public static void check(String sql);   // 不是单条 SELECT → 抛 BadRequestException
}
```

`workflow` 包通过构造注入使用 `SqlRunner`。
