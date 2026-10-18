import { Fragment, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  getDataSources, getWorkflow, runWorkflow, setWorkflowStatus, updateWorkflow,
} from '../../api/client'
import type { ApiError } from '../../api/client'
import type {
  DataSource, ExecutionMode, NodeOutput, RunResult, RunStatus, RunStep, SqlNode, Stage, WorkflowDef,
} from '../../api/types'
import ConditionDialog from './ConditionDialog'
import type { CondVar } from './ConditionDialog'
import VarInsertButton from './VarInsertButton'
import NodeOutputColumns from './NodeOutputColumns'
import VisualQueryDialog from './VisualQueryDialog'
import SqlEditor from './SqlEditor'
import InputsTable from './InputsTable'
import { parseInputs } from './inputsUtil'

// ── 纯函数工具 ─────────────────────────────────────────────

function newNode(orderIndex: number, name: string, dataSourceId: number | null): SqlNode {
  return { orderIndex, name, dataSourceId, sqlTemplate: '', maxRows: 10 }
}

/**
 * 节点变量名 = `{SQL 流 code}_step_L_node_K`（code 里的 `-` 换成 `_`，数字开头补 `_`）。
 * **照抄后端 NodeNaming**（保存时后端以它为准再算一遍），改规则两边一起改。
 */
function nodeVarName(code: string | undefined, layerNo: number, nodeNo: number): string {
  let p = (code ?? '').trim().replace(/-/g, '_')
  if (/^\d/.test(p)) p = '_' + p
  return (p ? p + '_' : '') + `step_${layerNo}_node_${nodeNo}`
}

/** `$旧名` → `$新名`，一次扫描同时换（a→b、b→a 不会连锁）；`$ab` 不会被当成 `$a` */
function rewriteRefs(text: string | undefined, rename: Map<string, string>): string | undefined {
  if (!text || rename.size === 0) return text
  return text.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (m, name: string) => {
    const to = rename.get(name)
    return to ? '$' + to : m
  })
}

/**
 * 重排 orderIndex，并**按位置重算变量名**；名字变了（删节点 / 加节点 / 老命名），
 * SQL 和 IF 里引用它的地方**一起改**，不然引用就断了。变量名给 SQL 引用用，跟人起的「节点名」分开。
 */
function normalize(stages: Stage[], code: string | undefined): Stage[] {
  const rename = new Map<string, string>()
  let layerNo = 0
  const renamed = stages.map((s, i) => {
    if (s.kind !== 'LAYER') return { ...s, orderIndex: i, nodes: undefined }
    layerNo += 1
    const ln = layerNo
    return {
      ...s,
      orderIndex: i,
      nodes: (s.nodes ?? []).map((n, j) => {
        const name = nodeVarName(code, ln, j + 1)
        if (n.name && n.name !== name) rename.set(n.name, name)
        return { ...n, orderIndex: j, name }
      }),
    }
  })
  if (rename.size === 0) return renamed
  return renamed.map(s => ({
    ...s,
    expression: rewriteRefs(s.expression, rename),
    nodes: s.nodes?.map(n => ({ ...n, sqlTemplate: rewriteRefs(n.sqlTemplate, rename) ?? '' })),
  }))
}

/**
 * 谁还在引用这个节点（SQL 或 IF 里写了 `$它`）。删之前查，**被引用就不让删** ——
 * 不然删完一重排，引用会悄悄指到顶上来的另一个节点（`node_2` 变 `node_1`），结果错了还不报错。
 */
function referrersOf(stages: Stage[], name: string): string[] {
  const re = new RegExp('\\$' + name + '(?![A-Za-z0-9_])')
  const out: string[] = []
  let layerNo = 0
  for (const s of stages) {
    if (s.kind === 'IF') { if (s.expression && re.test(s.expression)) out.push(`第 ${layerNo} 层后面的条件`) }
    else {
      layerNo++
      for (const n of s.nodes ?? []) if (n.name !== name && re.test(n.sqlTemplate ?? '')) out.push('$' + n.name)
    }
  }
  return out
}

/** IF 必须前面有 LAYER：丢掉位于最前、或紧跟在另一个 IF 后面的 IF。 */
function sanitize(stages: Stage[]): Stage[] {
  const out: Stage[] = []
  for (const s of stages) {
    if (s.kind === 'IF') {
      const prev = out[out.length - 1]
      if (!prev || prev.kind !== 'LAYER') continue
    }
    out.push(s)
  }
  return out
}


function fmtCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function statusColor(s: RunStatus): string {
  if (s === 'SUCCESS') return 'var(--ok)'
  if (s === 'FAILED') return 'var(--danger)'
  return 'var(--warn)'
}

// ── 运行结果子组件 ─────────────────────────────────────────

function GridTable({ output }: { output: NodeOutput }) {
  const MAX = 50
  const rows = output.rows.slice(0, MAX)
  return (
    <>
      <table className="run-grid" style={{ marginTop: 6 }}>
        <thead>
          <tr>{output.columns.map(c => <th key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {output.columns.map(c => <td key={c}>{fmtCell(r[c])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {output.rows.length === 0 && <div className="field-hint">（无数据行）</div>}
      {output.rows.length > MAX && (
        <div className="field-hint">仅显示前 {MAX} 行，共 {output.rowCount} 行</div>
      )}
    </>
  )
}

function RunStepView({ step, layerNo }: { step: RunStep; layerNo: number }) {
  if (step.kind === 'IF') {
    return (
      <div className="run-step">
        <div className="node-head">
          <span className="node-tag">IF</span>
          <span className="mono">{step.expression || '（空表达式）'}</span>
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
      <div className="layer-title" style={{ margin: '6px 0' }}>
        第 {layerNo} 层 · {step.executionMode === 'SERIAL' ? '串行' : '并行'}
      </div>
      {(step.nodes ?? []).map(n => (
        <div key={n.name} className={'run-step' + (n.ok ? '' : ' run-step--bad')}>
          <div className="node-head">
            <span className="mono">{n.name}</span>
            <span className="pill" style={{ color: n.ok ? 'var(--ok)' : 'var(--danger)' }}>
              <i />{n.ok ? '成功' : '失败'}
            </span>
            <span className="faint">{n.costMs} ms</span>
            <div className="spacer" />
            {n.output && (
              <span className="faint">
                {n.output.rowCount} 行{n.output.truncated ? ' · 已截断' : ''}
              </span>
            )}
          </div>
          {n.error && <div className="notice notice--err" style={{ marginTop: 6 }}>{n.error}</div>}
          {n.ok && n.output && <GridTable output={n.output} />}
        </div>
      ))}
    </div>
  )
}

// ── 编辑器 ─────────────────────────────────────────────────

/** 分层纵向编辑器：层 → 节点横排；层与层之间可插 if。 */
export default function WorkflowEditorPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const wid = id ? Number(id) : NaN

  const [def, setDef] = useState<WorkflowDef | null>(null)
  const [sources, setSources] = useState<DataSource[]>([])
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState('')

  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState('')
  const [saveField, setSaveField] = useState<string | null>(null)
  const [savedOk, setSavedOk] = useState(false)

  const [running, setRunning] = useState(false)
  const [runResult, setRunResult] = useState<RunResult | null>(null)
  const [runErr, setRunErr] = useState('')

  /** 条件节点弹窗：si === null 表示"在某位置新增"，否则编辑第 si 个 stage。 */
  const [condOpen, setCondOpen] = useState<{ at: number; si: number | null; expr: string } | null>(null)

  /**
   * 每个 SQL 输入框的 DOM 引用，按 "si-ni" 存，供「插入变量」插到光标处。
   * **必须和其它 hook 放在一起（早返回之前）** —— 放到下面的早返回之后，两次渲染的 hook 数量会不一致，
   * React 直接抛 #310（白屏）。
   */
  const sqlRefs = useRef<Record<string, HTMLTextAreaElement | null>>({})

  /** 可视化单表查询弹窗：哪个节点开着（si/ni） */
  const [visualOpen, setVisualOpen] = useState<{ si: number; ni: number } | null>(null)

  useEffect(() => {
    let alive = true
    if (!Number.isFinite(wid)) {
      setLoadErr('无效的 SQL 流 id')
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadErr('')
    Promise.all([getWorkflow(wid), getDataSources()])
      .then(([wf, ds]) => {
        if (!alive) return
        setDef(wf)
        setSources(ds)
      })
      .catch(e => { if (alive) setLoadErr((e as Error).message || '加载失败') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [wid])

  /** 所有对 stages 的改动都走这里：先 sanitize 再 normalize。 */
  function mutate(fn: (stages: Stage[]) => Stage[]) {
    setDef(d => (d ? { ...d, stages: normalize(sanitize(fn(d.stages ?? [])), d.code) } : d))
    setSavedOk(false)
    setSaveErr('')
    setSaveField(null)
  }

  function patchDef(patch: Partial<WorkflowDef>) {
    setDef(d => (d ? { ...d, ...patch } : d))
    setSavedOk(false)
    setSaveErr('')
    setSaveField(null)
  }

  function setStageField(si: number, patch: Partial<Stage>) {
    mutate(stages => stages.map((s, i) => (i === si ? { ...s, ...patch } : s)))
  }

  function updateNode(si: number, ni: number, patch: Partial<SqlNode>) {
    mutate(stages => stages.map((s, i) => (i === si
      ? { ...s, nodes: (s.nodes ?? []).map((n, j) => (j === ni ? { ...n, ...patch } : n)) }
      : s)))
  }

  function addNode(si: number) {
    mutate(stages => stages.map((s, i) => (i === si
      ? { ...s, nodes: [...(s.nodes ?? []), newNode((s.nodes ?? []).length, '', sources[0]?.id ?? null)] }
      : s)))
  }

  function removeNode(si: number, ni: number) {
    const stages = def?.stages ?? []
    const name = stages[si]?.nodes?.[ni]?.name
    const refs = name ? referrersOf(stages, name) : []
    if (refs.length > 0) {
      alert(`$${name} 还被 ${refs.join('、')} 引用着，删了引用会断。先把这些地方对它的引用去掉再删。`)
      return
    }
    mutate(stages => stages.map((s, i) => (i === si
      ? { ...s, nodes: (s.nodes ?? []).filter((_, j) => j !== ni) }
      : s)))
  }

  function addLayer() {
    mutate(stages => [
      ...stages,
      {
        orderIndex: stages.length,
        kind: 'LAYER',
        executionMode: 'PARALLEL',
        nodes: [newNode(0, '', sources[0]?.id ?? null)],
      },
    ])
  }

  /** 在 stage 索引 si 之前插入一个条件节点。 */
  function addIfAt(si: number, expression: string) {
    mutate(stages => {
      const copy = stages.slice()
      copy.splice(si, 0, { orderIndex: 0, kind: 'IF', expression })
      return copy
    })
  }

  function removeStage(si: number) {
    mutate(stages => stages.filter((_, i) => i !== si))
  }

  async function save() {
    if (!def || def.id == null || saving) return
    setSaving(true)
    setSaveErr('')
    setSaveField(null)
    try {
      const payload: WorkflowDef = { ...def, stages: normalize(def.stages ?? [], def.code) }
      const saved = await updateWorkflow(def.id, payload)
      setDef({ ...saved, stages: saved.stages ?? payload.stages })
      setSavedOk(true)   // 留在编辑页（不退出）
    } catch (e) {
      const ae = e as ApiError
      setSaveErr(ae.message || '保存失败')
      setSaveField(ae.field ?? null)
    } finally {
      setSaving(false)
    }
  }

  async function run() {
    if (!def || def.id == null || running) return
    setRunning(true)
    setRunErr('')
    setRunResult(null)
    try {
      setRunResult(await runWorkflow(def.id))
    } catch (e) {
      setRunErr((e as Error).message || '运行失败')
    } finally {
      setRunning(false)
    }
  }

  if (loading) {
    return <div className="page"><div className="empty-note">加载中…</div></div>
  }
  if (loadErr || !def) {
    return (
      <div className="page">
        <div className="page-head">
          <button className="btn btn--sm" onClick={() => navigate('/workflows')}>← 返回列表</button>
        </div>
        <div className="notice notice--err">{loadErr || 'SQL 流不存在'}</div>
      </div>
    )
  }

  const stages = def.stages ?? []
  const layersTotal = stages.filter(s => s.kind === 'LAYER').length

  // 层序号（第 N 层），IF 处为 0
  let seen = 0
  const layerNoOf = stages.map(s => (s.kind === 'LAYER' ? ++seen : 0))

  // 保存错误的 field 尽量映射到具体输入框
  const nf = saveField ? saveField.match(/stages\[(\d+)\]\.nodes\[(\d+)\]\.(\w+)/) : null
  const nodeField = nf ? { si: Number(nf[1]), ni: Number(nf[2]), prop: nf[3] } : null
  const ifStageNum = saveField ? Number(saveField.match(/stages\[(\d+)\]\.expression/)?.[1]) : NaN

  /** 标记为输出（**最多一个**：勾上它就清掉别的） */
  function setOutputNode(si: number, ni: number, on: boolean) {
    mutate(stages => stages.map((s, i) => ({
      ...s,
      nodes: (s.nodes ?? []).map((n, j) => ({
        ...n,
        isOutput: i === si && j === ni ? on : (on ? false : n.isOutput),
      })),
    })))
  }

  function renderNode(n: SqlNode, si: number, ni: number, count: number) {
    const hit = (prop: string) => !!nodeField && nodeField.si === si && nodeField.ni === ni && nodeField.prop === prop
    const badName = hit('name')
    const badSql = hit('sqlTemplate') || hit('sql')
    const badDs = hit('dataSourceId')
    return (
      <div className="node" key={n.id ?? ni}>
        <div className="node-head">
          <span className="node-tag">SQL</span>
          <input
            className={'input input--sm node-label' + (badName ? ' input--bad' : '')}
            value={n.label ?? ''}
            placeholder="节点名"
            onChange={e => updateNode(si, ni, { label: e.target.value })}
          />
          <div className="spacer" />
          <label className={'cond-listmode' + (n.isOutput ? ' wf-isout-on' : '')}
            title="执行到它就停：后面的层不跑；同层后面的（串行）不跑、别的（并行）去掉。最多一个。">
            <input type="checkbox" checked={!!n.isOutput}
              onChange={e => setOutputNode(si, ni, e.target.checked)} />
            输出
          </label>
          <button
            className="btn btn--sm btn--ghost"
            disabled={count <= 1}
            title={count <= 1 ? '每层至少 1 个节点' : '删除节点'}
            onClick={() => removeNode(si, ni)}
          >删除</button>
        </div>

        <div className="field-row">
          <label className="field-label">数据源</label>
          <select
            className={'input input--sm' + (badDs ? ' input--bad' : '')}
            value={n.dataSourceId ?? ''}
            onChange={e => updateNode(si, ni, { dataSourceId: e.target.value === '' ? null : Number(e.target.value) })}
          >
            <option value="">— 选择数据源 —</option>
            {sources.filter(s => s.id != null).map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        <div className="field-row" style={{ marginBottom: 0 }}>
          <div className="sql-head">
            <label className="field-label" style={{ marginBottom: 0 }}>SQL</label>
            <span className="node-var mono" title="引用它用这个变量名（自动生成）">{n.name}</span>
            <div className="spacer" />
            <button type="button" className="btn btn--sm" onClick={() => setVisualOpen({ si, ni })}>可视化（单表）</button>
            <VarInsertButton vars={varsBefore(si, ni)} onInsert={t => insertIntoNodeSql(si, ni, t)} />
          </div>
          <SqlEditor
            ref={el => { sqlRefs.current[`${si}-${ni}`] = el }}
            className={'input mono' + (badSql ? ' input--bad' : '')}
            rows={5}
            dataSourceId={n.dataSourceId ?? null}
            vars={varsBefore(si, ni)}
            parallelSiblings={ni > 0 && (def?.stages?.[si]?.executionMode ?? 'PARALLEL') !== 'SERIAL'}
            value={n.sqlTemplate}
            placeholder="敲 / 提示表和字段，// 提示输入参数和前面节点的输出"
            onChange={v => updateNode(si, ni, { sqlTemplate: v })}
          />
          <NodeOutputColumns dataSourceId={n.dataSourceId ?? null} sqlTemplate={n.sqlTemplate} />

          <div className="node-foot">
            <span className="field-hint" style={{ margin: 0 }}>
              后层用 <span className="mono">${n.name || '变量名'}</span> 引用它
            </span>
            <div className="spacer" />
            <span className="field-hint" style={{ margin: 0 }}>最多行数</span>
            <input
              type="number"
              className="input input--sm mono"
              style={{ width: 88 }}
              min={1}
              max={1000}
              value={n.maxRows}
              onChange={e => {
                const raw = e.target.value
                const num = raw === '' ? 1 : Math.min(1000, Math.max(1, parseInt(raw, 10) || 1))
                updateNode(si, ni, { maxRows: num })
              }}
            />
          </div>
        </div>
      </div>
    )
  }

  /** 把引用文本插到某个 SQL 输入框的光标处。 */
  function insertIntoNodeSql(si: number, ni: number, text: string) {
    const cur = def?.stages?.[si]?.nodes?.[ni]?.sqlTemplate ?? ''
    const el = sqlRefs.current[`${si}-${ni}`]
    if (!el) {
      updateNode(si, ni, { sqlTemplate: cur + text })
      return
    }
    const s = el.selectionStart ?? cur.length
    const e = el.selectionEnd ?? s
    updateNode(si, ni, { sqlTemplate: cur.slice(0, s) + text + cur.slice(e) })
    requestAnimationFrame(() => {
      el.focus()
      const p = s + text.length
      el.setSelectionRange(p, p)
    })
  }

  /**
   * 某个节点位置之前、能引用到的所有节点。
   * 除了更早的层，**串行层里排在它前面的同层节点也能引用**（它们是一前一后跑的）；
   * 并行层不加（同时跑，互相看不见）。
   */
  function varsBefore(si: number, ni = 0) {
    const out: CondVar[] = []
    // 输入参数排最前（裸的 $名字）
    for (const p of parseInputs(def?.inputs)) {
      if (p.name) out.push({ name: p.name, layerNo: 0, dataSourceId: null, sqlTemplate: '', isInput: true })
    }
    const all = def?.stages ?? []
    const push = (n: SqlNode, ln: number) => {
      if (n?.name) out.push({
        name: n.name, label: n.label?.trim() || undefined, layerNo: ln,
        dataSourceId: n.dataSourceId ?? null, sqlTemplate: n.sqlTemplate ?? '',
      })
    }
    let ln = 0
    for (let i = 0; i < si && i < all.length; i++) {
      const st = all[i]
      if (st.kind !== 'LAYER') continue
      ln++
      for (const n of st.nodes ?? []) push(n, ln)
    }
    const cur = all[si]
    if (cur?.kind === 'LAYER') {
      ln++
      if (cur.executionMode === 'SERIAL') {
        for (let k = 0; k < ni; k++) push((cur.nodes ?? [])[k], ln)
      }
    }
    return out
  }

  function renderLayer(stage: Stage, si: number, layerNo: number) {
    const nodes = stage.nodes ?? []
    return (
      <div className="layer">
        <div className="layer-head">
          <span className="layer-title">第 {layerNo} 层</span>
          <select
            className="input input--sm"
            style={{ width: 92 }}
            value={stage.executionMode ?? 'PARALLEL'}
            onChange={e => setStageField(si, { executionMode: e.target.value as ExecutionMode })}
          >
            <option value="PARALLEL">并行</option>
            <option value="SERIAL">串行</option>
          </select>
          <div className="spacer" />
          <button className="btn btn--sm" onClick={() => addNode(si)}>+ 加 SQL 节点</button>
        </div>
        <div className="layer-nodes">
          {nodes.map((n, ni) => renderNode(n, si, ni, nodes.length))}
        </div>
      </div>
    )
  }

  function renderIf(stage: Stage, si: number) {
    const bad = ifStageNum === si
    const text = (stage.expression ?? '').trim()
    return (
      <div className={'if-card' + (bad ? ' if-card--bad' : '')}>
        <span className="node-tag">条件</span>
        <button
          type="button"
          className={'cond-expr' + (text ? ' mono' : ' cond-expr--empty')}
          title="点击编辑条件"
          onClick={() => setCondOpen({ at: si, si, expr: stage.expression ?? '' })}
        >
          {text || '（点击设置条件）'}
        </button>
        <button className="btn btn--sm btn--ghost" onClick={() => removeStage(si)}>删除</button>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-head">
        <button className="btn btn--sm" onClick={() => navigate('/workflows')}>← 返回列表</button>
        <h1 className="page-title">{def.name || '未命名 SQL 流'}</h1>
        <div className="spacer" />
        <button className="btn" onClick={run} disabled={running}>{running ? '运行中…' : '运行'}</button>
      </div>

      {saveErr && (
        <div className="notice notice--err" style={{ marginBottom: 12 }}>
          {saveErr}{saveField ? `（字段：${saveField}）` : ''}
        </div>
      )}
      {savedOk && (
        <div className="notice" style={{ marginBottom: 12, background: '#f0fdf4', borderColor: '#bbf7d0', color: '#166534' }}>
          已保存
        </div>
      )}

      <div className="field-hint" style={{ marginBottom: 12 }}>
        SQL 节点只读（单条 SELECT / WITH）。占位符 <span className="mono">$节点名.rows[0].列</span> 取单值、
        <span className="mono">$节点名.rows[*].列</span> 取整列（可放进 <span className="mono">IN</span>）；
        只能引用<b>前面层</b>的节点。
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="field-row">
          <label className="field-label">名称</label>
          <input
            className={'input' + (saveField === 'name' ? ' input--bad' : '')}
            value={def.name}
            onChange={e => patchDef({ name: e.target.value })}
          />
        </div>
        <div className="field-row" style={{ marginBottom: 0 }}>
          <label className="field-label">说明</label>
          <textarea
            className="input"
            rows={2}
            value={def.description ?? ''}
            onChange={e => patchDef({ description: e.target.value })}
          />
        </div>
      </div>

      <h2 className="wf-h2">输入参数</h2>
      <div className="card" style={{ marginBottom: 16 }}>
        <InputsTable
          rows={parseInputs(def.inputs)}
          nodeNames={stages.flatMap(s => (s.nodes ?? []).map(n => n.name)).filter(Boolean)}
          onChange={rows => patchDef({ inputs: JSON.stringify(rows) })}
        />
      </div>

      <div className="field-hint" style={{ marginBottom: 8 }}>
        共 {layersTotal} 层。运行的是最近一次保存的版本。
      </div>

      <div className="flow">
        {stages.map((stage, i) => {
          const prev = i > 0 ? stages[i - 1] : null
          const key = stage.id != null ? `${stage.kind}-${stage.id}` : `${stage.kind}-${i}`
          return (
            <Fragment key={key}>
              {i > 0 && (
                <div className="connector"><div className="connector-line" /></div>
              )}
              {i > 0 && stage.kind === 'LAYER' && prev && prev.kind === 'LAYER' && (
                <div className="add-row">
                  <button className="add-btn" onClick={() => setCondOpen({ at: i, si: null, expr: '' })}>+ 增加条件节点</button>
                </div>
              )}
              {stage.kind === 'IF'
                ? renderIf(stage, i)
                : renderLayer(stage, i, layerNoOf[i])}
            </Fragment>
          )
        })}
        <div className="add-row" style={{ marginTop: 14 }}>
          <button className="add-btn" onClick={addLayer}>+ 加一层</button>
        </div>
      </div>

      {(runResult || runErr) && (
        <div className="card run-panel">
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
          {runResult?.error && (
            <div className="notice notice--err" style={{ marginBottom: 10 }}>{runResult.error}</div>
          )}

          {runResult?.steps.map((s, i) => {
            const layerNo = s.kind === 'LAYER'
              ? stages.filter(x => x.kind === 'LAYER' && (x.orderIndex ?? 0) <= s.stageIndex).length
              : 0
            return <RunStepView key={i} step={s} layerNo={layerNo} />
          })}
        </div>
      )}

      {/* 保存固定在右下角、跟着屏幕走：滚到下面改 SQL 时也能保存。
          工具栏里**不再放第二个**保存，全页只有这一个。 */}
      <button className="btn btn--primary save-fab" onClick={save} disabled={saving}>
        {saving ? '保存中…' : savedOk ? '已保存 ✓' : '保存'}
      </button>

      {condOpen && (
        <ConditionDialog
          initial={condOpen.expr}
          vars={varsBefore(condOpen.si ?? condOpen.at)}
          onSave={expr => {
            if (condOpen.si === null) addIfAt(condOpen.at, expr)
            else setStageField(condOpen.si, { expression: expr })
            setCondOpen(null)
          }}
          onCancel={() => setCondOpen(null)}
        />
      )}

      {visualOpen && (
        <VisualQueryDialog
          dataSourceId={def?.stages?.[visualOpen.si]?.nodes?.[visualOpen.ni]?.dataSourceId ?? null}
          vars={varsBefore(visualOpen.si, visualOpen.ni)}
          maxRows={def?.stages?.[visualOpen.si]?.nodes?.[visualOpen.ni]?.maxRows ?? 10}
          onSave={sql => { updateNode(visualOpen.si, visualOpen.ni, { sqlTemplate: sql }); setVisualOpen(null) }}
          onCancel={() => setVisualOpen(null)}
        />
      )}
    </div>
  )
}
