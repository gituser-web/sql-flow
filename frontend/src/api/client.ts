import type {
  ApiDef, ApiToken, ConnectionTest, DataSource, RunResult, Workflow, WorkflowDef,
} from './types'

/** 后端错误形状：{error, field?}。field 用于把表单某一格标红。 */
export interface ApiError extends Error {
  field?: string
}

async function req<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  })
  const text = await res.text()
  let data: any = null
  if (text) {
    try { data = JSON.parse(text) } catch { data = text }
  }
  if (!res.ok) {
    const err: ApiError = new Error((data && data.error) || res.statusText || '请求失败')
    if (data && data.field) err.field = data.field
    throw err
  }
  return data as T
}

const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) })

// ── 数据源 ────────────────────────────────────────────────
export const getDataSources = () => req<DataSource[]>('/api/datasources')
export const getDataSource = (id: number) => req<DataSource>(`/api/datasources/${id}`)
export const createDataSource = (b: DataSource) => req<DataSource>('/api/datasources', json(b))
export const updateDataSource = (id: number, b: DataSource) =>
  req<DataSource>(`/api/datasources/${id}`, { ...json(b), method: 'PUT' })
export const deleteDataSource = (id: number) =>
  req<{ deleted: boolean }>(`/api/datasources/${id}`, { method: 'DELETE' })
export const testDataSource = (b: ConnectionTest) =>
  req<{ ok: boolean; message: string }>('/api/datasources/test', json(b))
/** 列出数据源里的表（给可视化单表查询用） */
export const getTables = (id: number) =>
  req<{ tables: string[] }>(`/api/datasources/${id}/tables`)

// ── SQL 流 ────────────────────────────────────────────────
export const getWorkflows = () => req<Workflow[]>('/api/workflows')
export const getWorkflow = (id: number) => req<WorkflowDef>(`/api/workflows/${id}`)
export const createWorkflow = (b: WorkflowDef) => req<WorkflowDef>('/api/workflows', json(b))
export const updateWorkflow = (id: number, b: WorkflowDef) =>
  req<WorkflowDef>(`/api/workflows/${id}`, { ...json(b), method: 'PUT' })
export const deleteWorkflow = (id: number) =>
  req<{ deleted: boolean }>(`/api/workflows/${id}`, { method: 'DELETE' })
export const setWorkflowStatus = (id: number, enabled: boolean) =>
  req<WorkflowDef>(`/api/workflows/${id}/status`, json({ enabled }))
/** 试跑；inputs 是输入参数值（数组型传真数组） */
export const runWorkflow = (id: number, inputs: Record<string, unknown> = {}) =>
  req<RunResult>(`/api/workflows/${id}/run`, json(inputs))
/** 按 code 调这个 API */
export const runByCode = (code: string) =>
  req<RunResult>(`/api/run/${code}`, { method: 'POST' })

/** 探列：拿一条 SQL 的真实列名（给条件编辑器用）。失败时返回 {columns:[], error}。 */
export const probeColumns = (dataSourceId: number, sqlTemplate: string) =>
  req<{ columns: string[]; error?: string }>(
    '/api/workflows/probe-columns', json({ dataSourceId, sqlTemplate }))

// ── 对外 API ──────────────────────────────────────────────
export const getApis = () => req<ApiDef[]>('/api/apis')
export const getApi = (id: number) => req<ApiDef>(`/api/apis/${id}`)
export const createApi = (b: ApiDef) => req<ApiDef>('/api/apis', json(b))
export const updateApi = (id: number, b: ApiDef) =>
  req<ApiDef>(`/api/apis/${id}`, { ...json(b), method: 'PUT' })
export const deleteApi = (id: number) =>
  req<{ deleted: boolean }>(`/api/apis/${id}`, { method: 'DELETE' })
export const setApiStatus = (id: number, enabled: boolean) =>
  req<ApiDef>(`/api/apis/${id}/status`, json({ enabled }))
/** 试跑：body 直接就是参数值（数组型传真数组） */
export const testApi = (id: number, params: Record<string, unknown>) =>
  req<{ data: unknown; costMs: number; workflowStatus?: string }>(`/api/apis/${id}/test`, json(params))

// ── API 凭证 ──────────────────────────────────────────────
export const getApiTokens = () => req<ApiToken[]>('/api/api-tokens')
export const createApiToken = (b: { name: string; remark?: string }) =>
  req<ApiToken>('/api/api-tokens', json(b))
export const updateApiToken = (id: number, b: { name?: string; remark?: string }) =>
  req<ApiToken>(`/api/api-tokens/${id}`, { ...json(b), method: 'PUT' })
export const deleteApiToken = (id: number) =>
  req<{ deleted: boolean }>(`/api/api-tokens/${id}`, { method: 'DELETE' })
export const setApiTokenStatus = (id: number, enabled: boolean) =>
  req<ApiToken>(`/api/api-tokens/${id}/status`, json({ enabled }))
