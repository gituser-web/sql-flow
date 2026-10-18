# sql-flow

把**只读 SQL** 编排成一个 **API**。新建一个 API = 新建一个 SQL 流；SQL 流由若干**层**纵向排列，每层放 1~N 个 SQL 节点，层间可插 **if** 节点；后层可引用前面**所有层**节点的输出；最后一层的输出就是整个 API 的输出。

**架构：前后端不分离**。前端构建产物打进 Spring Boot 的静态目录（`src/main/resources/static`），由后端在同一端口（**7000**）一起托管，部署只需要一个 jar。

### 技术栈与版本

| 部分 | 技术 | 版本 |
|---|---|---|
| 运行环境 | JDK | **21**（必须恰好 21；更高版本可能导致 Lombok 注解处理失效） |
| 构建 | Maven | 3.9+（`./mvnw` 会自动查找，找不到则下载 3.9.9） |
| 后端框架 | Spring Boot | 3.3.5（Spring Web + Spring Data JPA） |
| SQL 解析 | JSqlParser | 4.9 |
| 参数渲染 | MyBatis（仅用 SQL 渲染） | 3.5.16 |
| 应用元数据库 | H2（内嵌文件，`./data/sqlflow`） | 随 Spring Boot 管理 |
| 被查询数据源 | MySQL（mysql-connector-j）/ SQLite（sqlite-jdbc 3.46.1.3） | ES / ClickHouse 留了扩展点，未实现 |
| 前端运行时 | Node.js + npm | 建议 Node 18+ |
| 前端框架 | React / React DOM | 18.3 |
| 路由 | React Router | 6.26 |
| 语言 | TypeScript | 5.6 |
| 构建工具 | Vite（@vitejs/plugin-react 4.3） | 5.4 |

- 认证：本版**不做** token

### 环境变量（可选）

| 变量 | 作用 |
|---|---|
| `SQLFLOW_JDK_HOME` / `JAVA_HOME` | 指定 JDK 21 路径 |
| `SQLFLOW_MAVEN_HOME` | 指定本地 Maven 安装目录 |
| `SQLFLOW_MVN_CACHE` | 自动下载 Maven 的缓存目录（默认 `~/.sqlflow-maven`） |

## 构建与运行

一键构建 + 启动：

```bash
./run.sh          # 检查环境 → 构建前端 → 启动后端 http://localhost:7000
./dev.sh          # 开发模式：后端 7000 + 前端 5173（热更新）
```

手动步骤（等价）：

```bash
cd frontend
npm install
npm run build          # 产物写入 ../src/main/resources/static

cd ..
mvn spring-boot:run    # http://localhost:7000
```

开发模式（仅开发时前端单独起 Vite 热更新，打包发布仍是前后端一体）：`cd frontend && npm run dev`（5173，`/api` 已代理到 7000），另开一个终端 `mvn spring-boot:run`。

## 快速上手

1. **数据源**页 → 新建一个 MySQL 数据源 → 「测试连接」。
2. **SQL 流**页 → 「新建 SQL 流」（填名称 + code）。
3. 进编辑器：给节点选数据源、写 SQL；需要多层就「加一层」；层间需要判断就「加 if」。
4. 「保存」→「运行」，逐节点看结果。
5. 对外调用：`POST /api/run/{code}`。

### 想零安装试跑？用 SQLite

不用起任何数据库服务，macOS 自带 `sqlite3`：

```bash
# 在项目根目录执行
mkdir -p data
sqlite3 data/demo.db < demo-sqlite.sql
```

然后「数据源」页选 **SQLite**，「数据库文件路径」填 `data/demo.db` 的**绝对路径**（如 `/path/to/sql-flow/data/demo.db`）。
（SQLite 只读：连接后自动 `PRAGMA query_only = ON`。）

## 语法速查

**引用前面层的节点输出**（写在后层 SQL 里）：

| 写法 | 含义 |
|---|---|
| `$a.rowCount` | 行数 |
| `$a.rows[0].id` | 第 0 行的 id 列（单值）|
| `$a.rows[*].id` | id 列**所有行**（列表，展开成 `?, ?, ...`，可放进 `IN (...)`）|

值一律走**绑定参数**，永不拼进 SQL 文本。引用只能指向**更早层**的节点；同层、更后层、不存在 → 报错。

**if 条件表达式**（确定性求值，不经过模型）：

```
$a.rowCount > 0          $a.rowCount == 0        $a.rows[0].status != 'paid'
$a.rows[*].tag 包含 'vip'  $a 为空    $a 非空     $a          // 单引用：非空即真
```

if 判定为 **false → 整个 SQL 流立即结束**（返回已产生的最后一层输出）。

## 执行语义

- 每层可选 **并行**（层内节点同时跑，全部等完；任一失败 → 整个 SQL 流失败）或 **串行**（按顺序跑，**一个失败后面就不跑**）。
- 同一层内的节点**不能互相引用**；后层可以引用前面所有层的输出。
- 所有 SQL 都是**只读**：单条 `SELECT` / `WITH`；`INTO` / `FOR UPDATE` / 加锁一律拒绝。

## 目录

```
src/main/java/com/sqlflow/
  common/        异常与全局错误处理
  datasource/    数据源管理、连接测试、只读闸门、JDBC 执行器（SqlRunner）
  workflow/      SQL 流模型 + 分层执行引擎 + REST API
frontend/src/
  api/           types.ts / client.ts（前后端契约）
  pages/datasources/   数据源页
  pages/workflows/     SQL 流列表 + 分层编辑器
docs/DESIGN.md   完整设计契约（改代码前先看这个）
```

## 已知限制 / 注意

- **数据源密码明文存储**（本版不做加密）。别把 `data/sqlflow.mv.db` 提交到仓库或随便外发。
- **ES / ClickHouse 未实现**：类型能选，但连接/查询会报「本版未实现」。
- **草稿容忍**：允许保存「没选数据源 / 没写 SQL」的 SQL 流；到「运行」时才报错（会明确说是哪个节点）。
- **「运行」跑的是最近一次保存的版本**，不是编辑框里的未保存内容。
- H2 与 MySQL 对 `TEXT` / `json` 的行为不完全一致；本版结构化数据一律存 **TEXT**，避免"本地绿线上红"。
