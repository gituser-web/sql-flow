import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { deleteApi, getApi, getWorkflows, setApiStatus, testApi } from '../../api/client'
import type { ApiError } from '../../api/client'
import type { ApiDef, Workflow } from '../../api/types'
import { parseInputs } from '../workflows/inputsUtil'

/** API 详情：看定义 + 试跑 + 怎么调（curl 示例，不放真 token）。 */
export default function ApiDetailPage() {
  const { id } = useParams<{ id: string }>()
  const nav = useNavigate()
  const aid = id ? Number(id) : NaN

  const [def, setDef] = useState<ApiDef | null>(null)
  const [flows, setFlows] = useState<Workflow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const [vals, setVals] = useState<Record<string, string>>({})
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<unknown>(null)
  const [runErr, setRunErr] = useState('')

  useEffect(() => {
    let alive = true
    if (!Number.isFinite(aid)) { setErr('无效的 id'); setLoading(false); return }
    Promise.all([getApi(aid), getWorkflows()])
      .then(([a, wf]) => { if (alive) { setDef(a); setFlows(wf) } })
      .catch(e => { if (alive) setErr((e as Error).message || '加载失败') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [aid])

  async function run() {
    if (!def || def.id == null || running) return
    setRunning(true); setRunErr(''); setResult(null)
    try { setResult(await testApi(def.id, vals)) }
    catch (e) { setRunErr((e as ApiError).message || '运行失败') }
    finally { setRunning(false) }
  }

  async function toggle() {
    if (!def || def.id == null) return
    try { const u = await setApiStatus(def.id, def.status !== 1); setDef({ ...def, status: u.status }) }
    catch (e) { alert((e as ApiError).message || '操作失败') }
  }

  async function remove() {
    if (!def || def.id == null) return
    if (!window.confirm(`删除接口「${def.name}」？已经调它的系统会立刻 404。`)) return
    try { await deleteApi(def.id); nav('/apis') } catch (e) { alert((e as ApiError).message || '删除失败') }
  }

  if (loading) return <div className="page"><div className="empty-note">加载中…</div></div>
  if (err || !def) {
    return (
      <div className="page">
        <div className="page-head"><button className="btn btn--sm" onClick={() => nav('/apis')}>← 返回列表</button></div>
        <div className="notice notice--err">{err || '接口不存在'}</div>
      </div>
    )
  }

  const inputs = parseInputs(def.params)
  const flowName = def.workflowId == null ? '—' : (flows.find(w => w.id === def.workflowId)?.name ?? `#${def.workflowId}`)
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:7000'
  const body = inputs.filter(p => p.required).map(p => `"${p.name}": "<值>"`).join(', ')
  const curl = `curl -X POST '${origin}/openapi/${def.code}' \\\n  -H "X-API-Token: $TZ_TOKEN" \\\n  -H 'Content-Type: application/json' \\\n  -d '{${body}}'`

  return (
    <div className="page">
      <div className="page-head">
        <button className="btn btn--sm" onClick={() => nav('/apis')}>← 返回列表</button>
        <h1 className="page-title">{def.name}</h1>
        <span className="pill" style={{ color: def.status === 1 ? 'var(--ok)' : 'var(--fg-faint)' }}>
          <i />{def.status === 1 ? '启用' : '停用'}
        </span>
        <div className="spacer" />
        <button className="btn" onClick={() => void toggle()}>{def.status === 1 ? '停用' : '启用'}</button>
        <button className="btn btn--danger" onClick={() => void remove()}>删除</button>
        <button className="btn btn--primary" onClick={() => window.open(`/apis/${def.id}/edit`, '_blank')}>编辑</button>
      </div>

      {def.description && <p className="wf-desc">{def.description}</p>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="field-row">
          <label className="field-label">模式</label>
          <div>{def.mode === 'SQL' ? '直接写 SQL' : `引用 SQL 流：${flowName}`}</div>
        </div>
        {def.mode === 'SQL' ? (
          <>
            <div className="field-row">
              <label className="field-label">SQL</label>
              <pre className="code">{def.sqlTemplate || '（还没写）'}</pre>
            </div>
          </>
        ) : null}
        <div className="field-row" style={{ marginBottom: 0 }}>
          <label className="field-label">怎么调</label>
          <pre className="code">{curl}</pre>
          <div className="field-hint">
            token 去「API 凭证」页拿。返回统一信封：<span className="mono">&#123;"ok":true,"data":…,"costMs":…&#125;</span>
          </div>
        </div>
      </div>

      <h2 className="wf-h2">试跑</h2>
      <div className="card" style={{ marginBottom: 16 }}>
        {inputs.length === 0 && <div className="field-hint">这个接口没有输入参数，直接跑。</div>}
        {inputs.map(p => (
          <div className="field-row" key={p.name}>
            <label className="field-label">
              {p.name}<span className="faint"> {p.type}{p.required ? ' · 必填' : ` · 默认 ${p.defaultValue ?? '(空)'}`}</span>
            </label>
            <input className="input" value={vals[p.name] ?? p.defaultValue ?? ''}
              onChange={e => setVals(v => ({ ...v, [p.name]: e.target.value }))} />
          </div>
        ))}
        <button className="btn btn--primary" onClick={() => void run()} disabled={running}>
          {running ? '运行中…' : '跑一次'}
        </button>
        {runErr && <div className="notice notice--err" style={{ marginTop: 10 }}>{runErr}</div>}
        {result != null && (
          <pre className="code" style={{ marginTop: 10 }}>{JSON.stringify(result, null, 2)}</pre>
        )}
      </div>
    </div>
  )
}
