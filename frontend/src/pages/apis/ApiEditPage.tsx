import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { createWorkflow, getApi, getDataSources, getWorkflows, updateApi } from '../../api/client'
import type { ApiError } from '../../api/client'
import type { ApiDef, DataSource, Stage, Workflow } from '../../api/types'
import InputsTable from '../workflows/InputsTable'
import VarInsertButton from '../workflows/VarInsertButton'
import VisualQueryDialog from '../workflows/VisualQueryDialog'
import SqlEditor from '../workflows/SqlEditor'
import { parseInputs } from '../workflows/inputsUtil'

/** 参数映射 JSON（API 参数名 → SQL 流参数名）→ 对象 */
function parseMap(json?: string): Record<string, string> {
  try {
    const o = JSON.parse(json || '{}')
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {}
  } catch { return {} }
}

/**
 * 每个 API 参数实际绑到哪个流参数 —— **照抄后端 ApiService.resolveBindings**，两边规则必须一致：
 * 显式值优先；空串 = 明确「不传」；没写才同名自动绑，且那个流参数没被别人显式占掉。
 */
function effectiveBindings(apiNames: string[], wfNames: string[], map: Record<string, string>) {
  const claimed = new Set(Object.values(map).filter(v => v))
  const out: Record<string, string> = {}
  for (const a of apiNames) {
    if (a in map) { if (map[a]) out[a] = map[a] }
    else if (wfNames.includes(a) && !claimed.has(a)) out[a] = a
  }
  return out
}

/**
 * API 编辑页。**两种模式**：
 *   SQL —— 选数据源 + 写 SQL（旁边就能「可视化」生成）+ 输入参数表格；
 *   SQL 流 —— 选一个已有的 SQL 流。
 * 输入参数**直接是张表格**（不藏弹窗里）；SQL 里用 #{参数名} 引用。
 */
export default function ApiEditPage() {
  const { id } = useParams<{ id: string }>()
  const nav = useNavigate()
  const aid = id ? Number(id) : NaN

  const [def, setDef] = useState<ApiDef | null>(null)
  const [sources, setSources] = useState<DataSource[]>([])
  const [flows, setFlows] = useState<Workflow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState('')
  const [saveField, setSaveField] = useState<string | null>(null)
  const [savedOk, setSavedOk] = useState(false)

  const [visualOpen, setVisualOpen] = useState(false)
  /** SQL 编辑框的 DOM 引用，供「插入变量」插到光标处 */
  const sqlRef = useRef<HTMLTextAreaElement>(null)

  /** 把文本插到 SQL 编辑框的光标处 */
  function insertSql(text: string) {
    const el = sqlRef.current
    const cur = def?.sqlTemplate ?? ''
    if (!el) { patch({ sqlTemplate: cur + text }); return }
    const s = el.selectionStart ?? cur.length
    const e = el.selectionEnd ?? s
    patch({ sqlTemplate: cur.slice(0, s) + text + cur.slice(e) })
    requestAnimationFrame(() => {
      el.focus()
      const p = s + text.length
      el.setSelectionRange(p, p)
    })
  }
  /** 「新建 SQL 流」防重复：busy 是 state，连点会在它更新前都通过检查 */
  const [creatingFlow, setCreatingFlow] = useState(false)
  const flowSubmitting = useRef(false)

  useEffect(() => {
    let alive = true
    if (!Number.isFinite(aid)) { setErr('无效的 id'); setLoading(false); return }
    Promise.all([getApi(aid), getDataSources(), getWorkflows()])
      .then(([a, ds, wf]) => { if (alive) { setDef(a); setSources(ds); setFlows(wf) } })
      .catch(e => { if (alive) setErr((e as Error).message || '加载失败') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [aid])

  async function save() {
    if (!def || def.id == null || saving) return
    setSaving(true); setSaveErr(''); setSaveField(null); setSavedOk(false)
    try {
      const saved = await updateApi(def.id, def)
      setDef(saved); setSavedOk(true)   // 留在编辑页（不退出）
    } catch (e) {
      const ae = e as ApiError
      setSaveErr(ae.message || '保存失败'); setSaveField(ae.field ?? null)
    } finally { setSaving(false) }
  }

  /** 跳去编辑选中的 SQL 流：**先存 API**（和「新建 SQL 流」一样），存不上就留在这儿把错显示出来，免得改动丢了 */
  async function editFlow() {
    if (!def || def.id == null || def.workflowId == null || saving) return
    setSaving(true); setSaveErr(''); setSaveField(null)
    try {
      setDef(await updateApi(def.id, def))
      nav('/workflows/' + def.workflowId + '/edit')
    } catch (e) {
      const ae = e as ApiError
      setSaveErr((ae.message || '保存失败') + '（没跳转，先把这里改好）'); setSaveField(ae.field ?? null)
    } finally { setSaving(false) }
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
  const patch = (p: Partial<ApiDef>) => { setDef(d => (d ? { ...d, ...p } : d)); setSavedOk(false); setSaveErr('') }
  const bad = (f: string) => saveField === f

  /** 直接建一个 SQL 流：**输入参数默认就是 API 的输入参数**，建完选中它 */
  async function createFlow() {
    if (!def || flowSubmitting.current) return
    flowSubmitting.current = true
    setCreatingFlow(true)
    try {
      const stages: Stage[] = [{
        orderIndex: 0, kind: 'LAYER', executionMode: 'PARALLEL',
        nodes: [{ orderIndex: 0, name: 'main', dataSourceId: null, sqlTemplate: '', maxRows: 10 }],
      }]
      const created = await createWorkflow({
        // 名字 = 「API 名字_SQL流」，一眼看出是从哪个 API 建的
        name: `${def.name || '未命名 API'}_SQL流`,
        description: def.description,
        inputs: def.params ?? '[]',
        stages,
      })
      if (created.id != null) {
        setFlows(f => [...f, created])
        // 先把「引用哪个 SQL 流」存进 API（否则跳走就丢了），再跳到这个 SQL 流的编辑页
        const next = { ...def, workflowId: created.id }
        try {
          const saved = await updateApi(def.id!, next)
          setDef(saved); setSavedOk(true)
        } catch {
          /* 存不上也让用户先去编 SQL 流 —— 回来再保存一次即可 */
        }
        nav('/workflows/' + created.id + '/edit')
      }
    } catch (e) {
      alert((e as ApiError).message || '创建 SQL 流失败')
      flowSubmitting.current = false   // 失败允许重试
    } finally { setCreatingFlow(false) }
  }

  return (
    <div className="page">
      <div className="page-head">
        <button className="btn btn--sm" onClick={() => nav('/apis')}>← 返回列表</button>
        <h1 className="page-title">{def.name || '未命名 API'}</h1>
      </div>

      {saveErr && <div className="notice notice--err" style={{ marginBottom: 12 }}>{saveErr}{saveField ? `（字段：${saveField}）` : ''}</div>}
      {savedOk && <div className="notice" style={{ marginBottom: 12, background: '#f0fdf4', borderColor: '#bbf7d0', color: '#166534' }}>已保存</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="field-row">
          <label className="field-label">名称</label>
          <input className={'input' + (bad('name') ? ' input--bad' : '')} value={def.name}
            onChange={e => patch({ name: e.target.value })} />
        </div>
        <div className="field-row">
          <label className="field-label">说明</label>
          <textarea className="input" rows={2} value={def.description ?? ''}
            onChange={e => patch({ description: e.target.value })} />
        </div>
        {/* 模式只在新建时选，建好就定死（后端也拒改） */}
        <div className="field-row" style={{ marginBottom: 0 }}>
          <label className="field-label">模式</label>
          <div>
            <span className="node-tag">{def.mode === 'WORKFLOW' ? '引用 SQL 流' : '直接写 SQL'}</span>
            <span className="field-hint" style={{ marginLeft: 8 }}>新建时定的，不能改；要换模式请新建一个 API。</span>
          </div>
        </div>
      </div>

      {def.mode === 'SQL' ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="field-row">
            <label className="field-label">数据源</label>
            <select className={'input' + (bad('dataSourceId') ? ' input--bad' : '')}
              value={def.dataSourceId ?? ''}
              onChange={e => patch({ dataSourceId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">— 选择数据源 —</option>
              {sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="field-row" style={{ marginBottom: 0 }}>
            <div className="sql-head">
              <label className="field-label" style={{ marginBottom: 0 }}>SQL</label>
              <div className="spacer" />
              <VarInsertButton
                vars={inputs.map(p => ({ name: p.name, layerNo: 0, dataSourceId: null, sqlTemplate: '', isInput: true }))}
                onInsert={t => insertSql(t)} />
              <button type="button" className="btn btn--sm" onClick={() => setVisualOpen(true)}>可视化（单表）</button>
            </div>
            <SqlEditor
              ref={sqlRef}
              className={'input mono' + (bad('sqlTemplate') ? ' input--bad' : '')} rows={6}
              dataSourceId={def.dataSourceId ?? null}
              vars={inputs.map(p => ({ name: p.name, layerNo: 0, dataSourceId: null, sqlTemplate: '', isInput: true }))}
              value={def.sqlTemplate ?? ''}
              placeholder="敲 / 提示表和字段，// 提示输入参数"
              onChange={v => patch({ sqlTemplate: v })} />
          </div>
        </div>
      ) : (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="field-row" style={{ marginBottom: 0 }}>
            <div className="sql-head">
              <label className="field-label" style={{ marginBottom: 0 }}>引用哪个 SQL 流</label>
              <div className="spacer" />
              <button type="button" className="btn btn--sm" disabled={creatingFlow}
                onClick={() => void createFlow()}>{creatingFlow ? '创建中…' : '新建 SQL 流'}</button>
            </div>
            <div className="bind-cell">
              <select className={'input' + (bad('workflowId') ? ' input--bad' : '')} style={{ flex: 1, width: 'auto' }}
                value={def.workflowId ?? ''}
                onChange={e => patch({ workflowId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">— 选择 SQL 流 —</option>
                {flows.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
              {def.workflowId != null && (
                <button type="button" className="btn btn--sm" disabled={saving} onClick={() => void editFlow()}
                  title="先保存这个 API，再去编辑选中的 SQL 流">编辑这个 SQL 流 →</button>
              )}
            </div>
          </div>
        </div>
      )}

      <h2 className="wf-h2">输入参数</h2>
      <div className="card" style={{ marginBottom: 16 }}>
        <InputsTable rows={inputs} onChange={rows => patch({ params: JSON.stringify(rows) })} />
      </div>

      {/* WORKFLOW 模式：**参数绑定表单** —— 每一行选「这个 API 参数绑到 SQL 流的哪个参数」。
          不选就按同名自动绑；选了的以这里为准。 */}
      {def.mode === 'WORKFLOW' && def.workflowId != null && (() => {
        const wf = flows.find(w => w.id === def.workflowId)
        const wfNames = parseInputs(wf?.inputs).map(p => p.name)
        const map = parseMap(def.paramMap)
        const eff = effectiveBindings(inputs.map(p => p.name), wfNames, map)
        // 选「不传」也要存下来（空串），否则同名参数会被自动绑回去
        const setMap = (from: string, to: string) => patch({ paramMap: JSON.stringify({ ...map, [from]: to }) })
        return (
          <>
            <h2 className="wf-h2">参数绑定</h2>
            <div className="card" style={{ marginBottom: 16 }}>
              {inputs.length === 0 ? (
                <div className="field-hint">这个 API 没有输入参数，没什么可绑的。</div>
              ) : (
                <table className="tbl">
                  <thead>
                    <tr><th>API 参数</th><th style={{ width: 40 }} /><th>绑到 SQL 流的参数</th></tr>
                  </thead>
                  <tbody>
                    {inputs.map(p => {
                      const raw = eff[p.name] ?? ''
                      // 指向的流参数已经不存在了（流改过）→ 当作没绑
                      const bound = wfNames.includes(raw) ? raw : ''
                      return (
                        <tr key={p.name}>
                          <td className="mono">${p.name}</td>
                          <td className="faint">→</td>
                          <td>
                            {/* 提示和下拉框同一行，选「不传」时框不会被挤动 */}
                            <div className="bind-cell">
                              <select className="input input--sm" value={bound} onChange={e => setMap(p.name, e.target.value)}>
                                <option value="">— 不传 —</option>
                                {wfNames.map(n => {
                                  const by = Object.keys(eff).find(a => a !== p.name && eff[a] === n)
                                  return (
                                    <option key={n} value={n} disabled={!!by}>
                                      ${n}{by ? `（已绑 $${by}）` : ''}
                                    </option>
                                  )
                                })}
                              </select>
                              {!bound && <span className="field-hint" style={{ margin: 0 }}>不传给 SQL 流</span>}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
              <div className="field-hint" style={{ marginTop: 8 }}>
                不选就按<b>同名</b>自动绑；选了以这里为准。一个 SQL 流参数只能绑一个 API 参数，被占了的灰掉。
                SQL 流里没被绑到的参数用它自己的默认值。
              </div>
            </div>
          </>
        )
      })()}

      <button className="btn btn--primary save-fab" onClick={() => void save()} disabled={saving}>
        {saving ? '保存中…' : savedOk ? '已保存 ✓' : '保存'}
      </button>

      {visualOpen && (
        <VisualQueryDialog
          dataSourceId={def.dataSourceId ?? null}
          vars={inputs.map(p => ({ name: p.name, layerNo: 0, dataSourceId: null, sqlTemplate: '', isInput: true }))}
          maxRows={def.maxRows ?? 10}
          onSave={sql => { patch({ sqlTemplate: sql }); setVisualOpen(false) }}
          onCancel={() => setVisualOpen(false)}
        />
      )}
    </div>
  )
}
