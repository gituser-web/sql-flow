import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createApi, deleteApi, getApis, setApiStatus } from '../../api/client'
import type { ApiError } from '../../api/client'
import type { ApiDef, ApiMode } from '../../api/types'

const MODE_LABEL: Record<ApiMode, string> = { SQL: 'SQL', WORKFLOW: 'SQL 流' }

function fmt(s?: string): string {
  if (!s) return '—'
  return s.replace('T', ' ').slice(0, 16)
}

/** API 列表。新建时选模式（SQL / SQL 流），建完进编辑页。 */
export default function ApiListPage() {
  const nav = useNavigate()
  const [list, setList] = useState<ApiDef[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<{ name: string; description: string; mode: ApiMode }>(
    { name: '', description: '', mode: 'SQL' })
  const [formErr, setFormErr] = useState('')
  const [busy, setBusy] = useState(false)
  /** 防重复提交（busy 是 state，连点会重复建） */
  const submitting = useRef(false)

  const load = () => {
    setLoading(true); setErr('')
    getApis().then(setList).catch(e => setErr((e as Error).message || '加载失败')).finally(() => setLoading(false))
  }
  useEffect(load, [])

  async function submit() {
    if (submitting.current) return
    submitting.current = true
    setBusy(true); setFormErr('')
    try {
      const created = await createApi({
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        mode: form.mode,
        maxRows: 10,
        params: '[]',
      })
      if (created.id != null) { setOpen(false); nav('/apis/' + created.id + '/edit') }
      else { setOpen(false); load() }
    } catch (e) {
      setFormErr((e as ApiError).message || '创建失败')
      submitting.current = false
    }
    finally { setBusy(false) }
  }

  async function toggle(a: ApiDef) {
    if (a.id == null) return
    try {
      const u = await setApiStatus(a.id, a.status !== 1)
      setList(prev => prev.map(x => (x.id === a.id ? { ...x, status: u.status } : x)))
    } catch (e) { alert((e as ApiError).message || '操作失败') }
  }

  async function remove(a: ApiDef) {
    if (a.id == null) return
    if (!window.confirm(`删除接口「${a.name}」？已经调它的系统会立刻 404。`)) return
    try { await deleteApi(a.id); setList(prev => prev.filter(x => x.id !== a.id)) }
    catch (e) { alert((e as ApiError).message || '删除失败') }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">API</h1>
        <div className="spacer" />
        <button className="btn btn--primary" onClick={() => { setForm({ name: '', description: '', mode: 'SQL' }); setFormErr(''); setOpen(true) }}>新建 API</button>
      </div>

      {err && <div className="notice notice--err" style={{ marginBottom: 12 }}>{err}</div>}

      {loading ? <div className="empty-note">加载中…</div> : list.length === 0 ? (
        <div className="empty-note">还没有 API。新建一个 = 对外暴露一个接口。</div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="tbl">
            <thead>
              <tr><th>名称</th><th style={{ width: 90 }}>模式</th><th style={{ width: 90 }}>状态</th><th style={{ width: 150 }}>最近修改</th><th /></tr>
            </thead>
            <tbody>
              {list.map(a => (
                <tr key={a.id} className="row">
                  <td>{a.name}{a.description && <div className="faint">{a.description}</div>}</td>
                  <td><span className="node-tag">{MODE_LABEL[a.mode as ApiMode] ?? a.mode}</span></td>
                  <td>
                    <span className="pill" style={{ color: a.status === 1 ? 'var(--ok)' : 'var(--fg-faint)' }}>
                      <i />{a.status === 1 ? '启用' : '停用'}
                    </span>
                  </td>
                  <td className="faint">{fmt(a.updatedAt)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn--sm" onClick={() => a.id != null && window.open(`/apis/${a.id}`, '_blank')}>详情</button>{' '}
                    <button className="btn btn--sm" onClick={() => a.id != null && window.open(`/apis/${a.id}/edit`, '_blank')}>编辑</button>{' '}
                    <button className="btn btn--sm" onClick={() => void toggle(a)}>{a.status === 1 ? '停用' : '启用'}</button>{' '}
                    <button className="btn btn--sm btn--danger" onClick={() => void remove(a)}>删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <div className="modal-overlay" onClick={() => { if (!busy) setOpen(false) }}>
          <div className="modal" style={{ width: 480 }} onClick={e => e.stopPropagation()}>
            <div className="modal-head"><span className="modal-title">新建 API</span></div>
            {formErr && <div className="notice notice--err" style={{ marginBottom: 10 }}>{formErr}</div>}
            <div className="field-row">
              <label className="field-label">名称</label>
              <input className="input" value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="field-row">
              <label className="field-label">模式 <span className="faint" style={{ fontWeight: 400 }}>（建好后不能改）</span></label>
              <div className="cond-chips">
                <button type="button" className={'cond-chip' + (form.mode === 'SQL' ? ' cond-chip--on' : '')}
                  onClick={() => setForm(f => ({ ...f, mode: 'SQL' }))}>直接写 SQL</button>
                <button type="button" className={'cond-chip' + (form.mode === 'WORKFLOW' ? ' cond-chip--on' : '')}
                  onClick={() => setForm(f => ({ ...f, mode: 'WORKFLOW' }))}>引用 SQL 流</button>
              </div>
            </div>
            <div className="field-row">
              <label className="field-label">说明</label>
              <textarea className="input" rows={2} value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button className="btn" onClick={() => setOpen(false)} disabled={busy}>取消</button>
              <button className="btn btn--primary" onClick={() => void submit()} disabled={busy}>创建并编辑</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
