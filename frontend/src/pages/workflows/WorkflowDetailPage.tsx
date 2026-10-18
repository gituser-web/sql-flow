import { Fragment, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  deleteWorkflow, getDataSources, getWorkflow, runWorkflow,
} from '../../api/client'
import type { ApiError } from '../../api/client'
import type {
  DataSource, NodeOutput, RunResult, RunStatus, RunStep, SqlNode, Stage, WorkflowDef,
} from '../../api/types'
import { parseInputs } from './inputsUtil'

/**
 * SQL 流**详情页**（只读）—— 列表点进来看到的就是它。
 *
 * 上面是**流程图**：一层一层往下，层与层之间用线连起来，中间的条件也画在线上。
 * 每个节点显示：变量名、数据源、SQL、输出列。
 * 改定义要点「编辑」进**独立编辑页**（另开一个窗口），免得边看边改把原样弄丢。
 */
export default function WorkflowDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const wid = id ? Number(id) : NaN

  const [def, setDef] = useState<WorkflowDef | null>(null)
  const [sources, setSources] = useState<DataSource[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const [running, setRunning] = useState(false)
  const [runResult, setRunResult] = useState<RunResult | null>(null)
  const [runErr, setRunErr] = useState('')
  /** 有输入参数时，先弹个表单填值再跑 */
  const [runOpen, setRunOpen] = useState(false)
  const [vals, setVals] = useState<Record<string, string>>({})

  useEffect(() => {
    let alive = true
    if (!Number.isFinite(wid)) {
      setErr('无效的 SQL 流 id'); setLoading(false); return
    }
    setLoading(true); setErr('')
    Promise.all([getWorkflow(wid), getDataSources()])
      .then(([wf, ds]) => { if (alive) { setDef(wf); setSources(ds) } })
      .catch(e => { if (alive) setErr((e as Error).message || '加载失败') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [wid])

  async function remove() {
    if (!def || def.id == null) return
    if (!window.confirm(`删除 SQL 流「${def.name}」？此操作不可撤销。`)) return
    try { await deleteWorkflow(def.id); navigate('/workflows') }
    catch (e) { alert((e as ApiError).message || '删除失败') }
  }

  async function run(values: Record<string, string>) {
    if (!def || def.id == null || running) return
    setRunning(true); setRunErr(''); setRunResult(null)
    try { setRunResult(await runWorkflow(def.id, values)) }
    catch (e) { setRunErr((e as ApiError).message || '运行失败') }
    finally { setRunning(false); setRunOpen(false) }
  }

  /** 编辑在**新窗口**打开：详情页留着不动，方便对照 */
  function openEditor() {
    if (!def?.id) return
    window.open(`/workflows/${def.id}/edit`, '_blank')
  }

  if (loading) return <div className="page"><div className="empty-note">加载中…</div></div>
  if (err || !def) {
    return (
      <div className="page">
        <div className="page-head">
          <button className="btn btn--sm" onClick={() => navigate('/workflows')}>← 返回列表</button>
        </div>
        <div className="notice notice--err">{err || 'SQL 流不存在'}</div>
      </div>
    )
  }

  const stages = def.stages ?? []
  const inputs = parseInputs(def.inputs)
  const startRun = () => {
    if (inputs.length === 0) { void run({}); return }
    setVals(Object.fromEntries(inputs.map(p => [p.name, p.defaultValue ?? ''])))
    setRunOpen(true)
  }
  const dsName = (sid: number | null | undefined) =>
    sid == null ? '未选数据源' : (sources.find(s => s.id === sid)?.name ?? `#${sid}`)

  // 层号（条件不占层号）
  let layerNo = 0
  const layerNoOf = stages.map(s => (s.kind === 'LAYER' ? ++layerNo : 0))

  return (
    <div className="page">
      <div className="page-head">
        <button className="btn btn--sm" onClick={() => navigate('/workflows')}>← 返回列表</button>
        <h1 className="page-title">{def.name || '未命名 SQL 流'}</h1>
        <div className="spacer" />
        <button className="btn" onClick={startRun} disabled={running}>{running ? '运行中…' : '运行'}</button>
        <button className="btn btn--danger" onClick={remove}>删除</button>
        <button className="btn btn--primary" onClick={openEditor}>编辑</button>
      </div>

      {def.description && <p className="wf-desc">{def.description}</p>}

      {inputs.length > 0 && (
        <>
          <h2 className="wf-h2">输入参数</h2>
          <div className="card" style={{ marginBottom: 20, padding: 0, overflow: 'hidden' }}>
            <table className="tbl">
              <thead>
                <tr><th>名字</th><th style={{ width: 120 }}>类型</th><th style={{ width: 80 }}>必填</th><th style={{ width: 140 }}>默认值</th></tr>
              </thead>
              <tbody>
                {inputs.map(p => (
                  <tr key={p.name} className="row">
                    <td className="mono">${p.name}</td>
                    <td className="faint">{p.type}</td>
                    <td className="faint">{p.required ? '是' : '否'}</td>
                    <td className="mono faint">{p.defaultValue || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2 className="wf-h2">流程</h2>
      <div className="field-hint" style={{ marginBottom: 12 }}>
        节点上标的 <span className="mono">$变量名</span> 是<b>这个节点的名字</b> —— 后面的层用
        <span className="mono"> $变量名.rows[0].列</span> 引用它查出来的结果（整列用 <span className="mono">rows[*]</span>）。
      </div>
      <div className="wf-flow">
        {stages.length === 0 && <div className="empty-note">这个 SQL 流还没有任何层。</div>}
        {stages.map((stage: Stage, i: number) => (
          <Fragment key={stage.id ?? i}>
            {i > 0 && (
              <div className="wf-link" aria-hidden>
                <div className="wf-link-line" />
                <span className="wf-link-arrow">↓</span>
              </div>
            )}
            {stage.kind === 'IF'
              ? <ConditionCard stage={stage} />
              : (
                <div className="wf-layer">
                  <div className="wf-layer-head">
                    <span className="wf-layer-no">第 {layerNoOf[i]} 层</span>
                    <span className="wf-layer-mode">
                      {stage.executionMode === 'SERIAL' ? '串行执行' : '并行执行'}
                    </span>
                    <div className="spacer" />
                    <span className="faint">{(stage.nodes ?? []).length} 个节点</span>
                  </div>
                  {/* 节点是**盒子**，层与层用 ↓ 连；整个流程居中、按内容收缩，不铺满整行 */}
                  <div className="wf-nodes">
                    {(stage.nodes ?? []).map((n, ni) => (
                      <Fragment key={n.id ?? ni}>
                        {ni > 0 && stage.executionMode === 'SERIAL' && (
                          <span className="wf-arrow" aria-hidden>→</span>
                        )}
                        <NodeBox
                          n={n}
                          ds={dsName(n.dataSourceId)}
                          order={stage.executionMode === 'SERIAL' ? ni + 1 : undefined}
                        />
                      </Fragment>
                    ))}
                  </div>
                </div>
              )}
          </Fragment>
        ))}
      </div>

      {runOpen && (
        <div className="modal-overlay" style={{ zIndex: 700 }} onClick={e => { if (e.target === e.currentTarget) setRunOpen(false) }}>
          <div className="modal" style={{ width: 460 }} onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <span className="modal-title">运行：{def.name}</span>
              <div className="spacer" />
              <button className="btn btn--sm btn--ghost" onClick={() => setRunOpen(false)}>关闭</button>
            </div>
            {inputs.map(p => {
              const missing = p.required && !(vals[p.name] ?? '').trim()
              return (
                <div className="field-row" key={p.name}>
                  <label className="field-label">
                    {p.name}
                    <span className="faint"> {p.type}{p.required ? ' · 必填' : ` · 默认 ${p.defaultValue ?? '(空)'}`}</span>
                  </label>
                  <input className={'input' + (missing ? ' input--bad' : '')}
                    value={vals[p.name] ?? ''}
                    onChange={e => setVals(v => ({ ...v, [p.name]: e.target.value }))} />
                </div>
              )
            })}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button className="btn" onClick={() => setRunOpen(false)}>取消</button>
              <button className="btn btn--primary" disabled={running}
                onClick={() => void run(vals)}>{running ? '运行中…' : '运行'}</button>
            </div>
          </div>
        </div>
      )}

      {(runResult || runErr) && (
        <div className="card run-panel" style={{ marginTop: 20 }}>
          <div className="page-head" style={{ marginBottom: 12 }}>
            <div className="modal-title">运行结果</div>
            {runResult && (
              <span className="pill" style={{ color: statusColor(runResult.status) }}>
                <i />{runResult.status}
              </span>
            )}
            {runResult && <span className="faint">总耗时 {runResult.costMs} ms</span>}
            {runResult?.failedNode && <span className="faint">失败节点：{runResult.failedNode}</span>}
          </div>
          {runErr && <div className="notice notice--err">{runErr}</div>}
          {runResult?.error && <div className="notice notice--err" style={{ marginBottom: 10 }}>{runResult.error}</div>}
          {runResult?.steps.map((s, i) => (
            <RunStepView key={i} step={s} />
          ))}
        </div>
      )}
    </div>
  )
}

/** 节点上存下来的输出列（JSON 数组文本）→ 数组 */
function parseCols(json?: string): string[] {
  try {
    const a = JSON.parse(json || '[]')
    return Array.isArray(a) ? a.map(String) : []
  } catch { return [] }
}

function ConditionCard({ stage }: { stage: Stage }) {
  const expr = (stage.expression ?? '').trim()
  return (
    <div className="wf-cond">
      <span className="wf-cond-tag">条件</span>
      <span className="wf-cond-expr mono">{expr || '（还没设条件）'}</span>
    </div>
  )
}

function statusColor(s: RunStatus): string {
  if (s === 'SUCCESS') return 'var(--ok)'
  if (s === 'FAILED') return 'var(--danger)'
  return 'var(--warn)'
}

/** 详情页里的一个节点**盒子**：变量名、数据源、输出列（存下来的）、看 SQL。 */
function NodeBox({ n, ds, order }: { n: SqlNode; ds: string; order?: number }) {
  const [showSql, setShowSql] = useState(false)
  const cols = parseCols(n.columns)
  return (
    <div className="wf-node">
      <div className="wf-node-top">
        {order != null && <span className="wf-order">{order}</span>}
        <span className="wf-node-var mono"
          title="这个节点的变量名；后面的层用 $变量名.rows[0].列 引用它的结果">
          ${n.name || '（未命名）'}
        </span>
        {n.isOutput && <span className="wf-out-tag">输出</span>}
      </div>
      <div className="wf-node-meta">
        <span className="wf-node-k">数据源</span>
        <span>{ds}</span>
      </div>
      {/* 输出列是**保存时存下来的**，不在这里重新探 */}
      {cols.length > 0 && <div className="wf-node-cols mono">{cols.join('、')}</div>}
      <button type="button" className="wf-sql-toggle" onClick={() => setShowSql(s => !s)}>
        {showSql ? '收起 ▴' : '看 SQL ▾'}
      </button>
      {/* SQL 用**浮层**显示，不占布局 —— 展开时下面的内容不动、页面不跳 */}
      {showSql && (
        <div className="wf-sql-pop">
          <pre className="wf-node-sql mono">{n.sqlTemplate?.trim() || '（还没写 SQL）'}</pre>
        </div>
      )}
    </div>
  )
}

function GridTable({ output }: { output: NodeOutput }) {
  const MAX = 50
  const rows = output.rows.slice(0, MAX)
  return (
    <>
      <table className="run-grid" style={{ marginTop: 6 }}>
        <thead><tr>{output.columns.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{output.columns.map((c, k) => <td key={k}>{fmtCell(r[c])}</td>)}</tr>
          ))}
        </tbody>
      </table>
      {output.rows.length === 0 && <div className="field-hint">（无数据行）</div>}
      {output.rows.length > MAX && <div className="field-hint">仅显示前 {MAX} 行，共 {output.rowCount} 行</div>}
    </>
  )
}

function fmtCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function RunStepView({ step }: { step: RunStep }) {
  if (step.kind === 'IF') {
    return (
      <div className="run-step">
        <div className="node-head">
          <span className="node-tag">条件</span>
          <span className="mono">{step.expression || '（空）'}</span>
          <div className="spacer" />
          <span className="pill" style={{ color: step.verdict ? 'var(--ok)' : 'var(--warn)' }}>
            <i />{step.verdict ? 'true · 继续' : 'false · 结束'}
          </span>
        </div>
      </div>
    )
  }
  return (
    <div>
      {(step.nodes ?? []).map(n => (
        <div key={n.name} className={'run-step' + (n.ok ? '' : ' run-step--bad')}>
          <div className="node-head">
            <span className="mono">${n.name}</span>
            <span className="pill" style={{ color: n.ok ? 'var(--ok)' : 'var(--danger)' }}>
              <i />{n.ok ? '成功' : '失败'}
            </span>
            <span className="faint">{n.costMs} ms</span>
            <div className="spacer" />
            {n.output && <span className="faint">{n.output.rowCount} 行{n.output.truncated ? ' · 已截断' : ''}</span>}
          </div>
          {n.error && <div className="notice notice--err" style={{ marginTop: 6 }}>{n.error}</div>}
          {n.ok && n.output && <GridTable output={n.output} />}
        </div>
      ))}
    </div>
  )
}
