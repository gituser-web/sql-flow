import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  createWorkflow, deleteWorkflow, getWorkflows,
} from '../../api/client'
import type { ApiError } from '../../api/client'
import type { Stage, Workflow, WorkflowDef } from '../../api/types'

/** 新建时的默认定义：1 个 LAYER，内含 1 个 SQL 节点，执行方式并行。 */
function defaultStages(): Stage[] {
  return [
    {
      orderIndex: 0,
      kind: 'LAYER',
      executionMode: 'PARALLEL',
      nodes: [
        { orderIndex: 0, name: 'main', dataSourceId: null, sqlTemplate: '', maxRows: 10 },
      ],
    },
  ]
}

/** LocalDateTime 形如 2026-10-18T09:30:00 → 2026-10-18 09:30 */
function fmtTime(s?: string): string {
  if (!s) return '—'
  return s.replace('T', ' ').slice(0, 16)
}

/** SQL 流列表 = API 列表。新建一个 SQL 流 = 新建一个 API。 */
export default function WorkflowListPage() {
  const navigate = useNavigate()
  const [list, setList] = useState<Workflow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState('')
  const [rowErr, setRowErr] = useState('')

  // 新建弹窗
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', description: '' })
  const [formErr, setFormErr] = useState('')
  const [formField, setFormField] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** 防重复提交：busy 是 state，连点两下会在它更新前都通过 `if (busy)` —— 用 ref 兜住 */
  const submitting = useRef(false)

  async function load() {
    setLoading(true)
    setLoadErr('')
    try {
      setList(await getWorkflows())
    } catch (e) {
      setLoadErr((e as Error).message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  /** 详情也另开新窗口（列表留着不动，方便连着看几个） */
  function openDetail(w: Workflow) {
    if (w.id != null) window.open(`/workflows/${w.id}`, '_blank')
  }

  /** 编辑另开新窗口（和详情页的「编辑」一致） */
  function openEdit(w: Workflow) {
    if (w.id != null) window.open(`/workflows/${w.id}/edit`, '_blank')
  }

  function openCreate() {
    setForm({ name: '', description: '' })
    setFormErr('')
    setFormField(null)
    setOpen(true)
  }

  async function submitCreate() {
    if (submitting.current) return
    submitting.current = true
    setBusy(true)
    setFormErr('')
    setFormField(null)
    try {
      const def: WorkflowDef = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        status: 1,
        stages: defaultStages(),
      }
      const created = await createWorkflow(def)
      if (created && created.id != null) {
        setOpen(false)
        // 新建完直接进**编辑页**（详情页是看流程图的地方）
        navigate('/workflows/' + created.id + '/edit')
      } else {
        setOpen(false)
        await load()
      }
    } catch (e) {
      const ae = e as ApiError
      setFormErr(ae.message || '创建失败')
      setFormField(ae.field ?? null)
      submitting.current = false
    } finally {
      setBusy(false)
    }
  }

  async function remove(w: Workflow) {
    if (w.id == null) return
    if (!window.confirm(`删除 SQL 流「${w.name}」？此操作不可撤销。`)) return
    setRowErr('')
    try {
      await deleteWorkflow(w.id)
      setList(prev => prev.filter(x => x.id !== w.id))
    } catch (e) {
      setRowErr((e as Error).message || '删除失败')
    }
  }

  const badName = formField === 'name'

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">SQL 流</h1>
        <div className="spacer" />
        <button className="btn btn--primary" onClick={openCreate}>新建 SQL 流</button>
      </div>

      {(loadErr || rowErr) && (
        <div className="notice notice--err" style={{ marginBottom: 12 }}>{loadErr || rowErr}</div>
      )}

      <div className="list-bar">
        <span className="faint">{list.length} 条</span>
      </div>

      {loading ? (
        <div className="empty-note">加载中…</div>
      ) : list.length === 0 ? (
        <div className="empty-note">还没有 SQL 流。新建一个 SQL 流 = 新建一个 API。</div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>名称</th>
                <th>层数</th>
                <th>节点数</th>
                <th>最近修改</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map(w => (
                <tr key={w.id} className="row">
                  <td>{w.name}</td>
                  <td>{w.stageCount ?? '—'}</td>
                  <td>{w.nodeCount ?? '—'}</td>
                  <td className="faint">{fmtTime(w.updatedAt)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn--sm" onClick={() => openDetail(w)}>详情</button>{' '}
                    <button className="btn btn--sm" onClick={() => openEdit(w)}>编辑</button>{' '}
                    <button className="btn btn--sm btn--danger" onClick={() => remove(w)}>删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <div className="modal-overlay" onClick={() => { if (!busy) setOpen(false) }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <div className="modal-title">新建 SQL 流</div>
            </div>

            {formErr && (
              <div className="notice notice--err" style={{ marginBottom: 12 }}>
                {formErr}{formField ? `（字段：${formField}）` : ''}
              </div>
            )}

            <div className="field-row">
              <label className="field-label">名称</label>
              <input
                className={'input' + (badName ? ' input--bad' : '')}
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>

            <div className="field-row">
              <label className="field-label">说明</label>
              <textarea
                className="input"
                rows={3}
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              />
            </div>

            <div className="page-head" style={{ marginBottom: 0, marginTop: 6 }}>
              <div className="spacer" />
              <button className="btn" onClick={() => setOpen(false)} disabled={busy}>取消</button>
              <button className="btn btn--primary" onClick={submitCreate} disabled={busy}>
                {busy ? '创建中…' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
