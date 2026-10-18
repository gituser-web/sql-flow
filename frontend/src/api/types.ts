// 与后端 JSON 一一对应。改动必须同步后端。

export type DataSourceType = 'MYSQL' | 'SQLITE' | 'ELASTICSEARCH' | 'CLICKHOUSE'

export interface DataSource {
  id?: number
  name: string
  type: DataSourceType
  /** SQLite 没有 host */
  host: string | null
  /** SQLite 没有 port */
  port: number | null
  /** MySQL 是库名；SQLite 是**数据库文件路径** */
  databaseName: string
  username: string
  password: string
  jdbcParams?: string
  status: number
  createdAt?: string
  updatedAt?: string
}

export interface ConnectionTest {
  type: DataSourceType
  host: string
  port: number | null
  databaseName: string
  username: string
  password: string
  jdbcParams?: string
}

/** SQL 流的输入参数声明（仿 tianzhi 的 inputSchema）。`xxx[]` 是**数组**（SQL 里 #{} 展开成 ?,?,...） */
export interface InputParam {
  name: string
  type: 'string' | 'long' | 'int' | 'boolean' | 'string[]' | 'long[]'
  required: boolean
  defaultValue?: string
}

export interface SqlNode {
  id?: number
  orderIndex: number
  /** 变量名：**自动生成**（{SQL 流 code}_step_1_node_1，如 wf_17785d86_step_1_node_1），SQL 里用它引用 */
  name: string
  /** **给人看的名字**（人起的）；界面显示这个 */
  label?: string
  dataSourceId: number | null
  sqlTemplate: string
  maxRows: number
  /** 保存时探到的输出列名（JSON 数组文本）。只读。 */
  columns?: string
  /** 标记为输出：执行到它就停（最多一个） */
  isOutput?: boolean
}

export type StageKind = 'LAYER' | 'IF'
export type ExecutionMode = 'PARALLEL' | 'SERIAL'

export interface Stage {
  id?: number
  orderIndex: number
  kind: StageKind
  executionMode?: ExecutionMode
  expression?: string
  nodes?: SqlNode[]
}

export interface Workflow {
  id?: number
  /** 对外路径段；界面不填，后端自动生成（对外服务以后再设计） */
  code?: string
  name: string
  description?: string
  /** 输入参数的 JSON 数组文本：[{"name","type","required","defaultValue"}] */
  inputs?: string
  /** 输出取哪个节点的结果（节点名）。空 = 最后一层的最后一个节点。 */
  outputNode?: string
  status?: number
  stageCount?: number
  nodeCount?: number
  stages?: Stage[]
  createdAt?: string
  updatedAt?: string
}

/** 新建/更新 SQL 流的入参（GET 详情的返回也是这个形状） */
export type WorkflowDef = Workflow

export interface NodeOutput {
  columns: string[]
  rows: Record<string, unknown>[]
  rowCount: number
  truncated: boolean
  costMs: number
}

export interface RunNode {
  name: string
  ok: boolean
  output?: NodeOutput | null
  costMs: number
  error?: string | null
}

export interface RunStep {
  stageIndex: number
  kind: StageKind
  executionMode?: ExecutionMode
  expression?: string
  verdict?: boolean
  nodes?: RunNode[]
}

export type RunStatus = 'SUCCESS' | 'STOPPED' | 'FAILED'

export interface RunResult {
  ok: boolean
  status: RunStatus
  output?: unknown
  costMs: number
  steps: RunStep[]
  error?: string | null
  failedNode?: string | null
}

// ── 对外 API ──────────────────────────────────────────────

export type ApiMode = 'SQL' | 'WORKFLOW'

export interface ApiDef {
  id?: number
  /** 对外路径段：/openapi/{code}。界面不填，后端自动生成 */
  code?: string
  name: string
  description?: string
  mode: ApiMode
  /** SQL 模式：数据源 */
  dataSourceId?: number | null
  /** SQL 模式：只读 SQL，$参数名 是输入参数 */
  sqlTemplate?: string | null
  /** SQL 流模式：引用哪个 SQL 流 */
  workflowId?: number | null
  maxRows?: number
  /** 输入参数的 JSON 数组文本 */
  params?: string
  /** 参数映射（只 WORKFLOW 模式）：API 参数名 → SQL 流参数名，JSON 对象文本 */
  paramMap?: string
  status?: number
  createdAt?: string
  updatedAt?: string
}

export interface ApiToken {
  id?: number
  name: string
  /** 明文（要能点开看） */
  token?: string
  remark?: string
  status?: number
  createdAt?: string
  lastUsedAt?: string
}
