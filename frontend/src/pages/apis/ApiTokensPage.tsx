import { useEffect, useRef, useState } from 'react'
import {
  createApiToken, deleteApiToken, getApiTokens, setApiTokenStatus, updateApiToken,
} from '../../api/client'
import type { ApiError } from '../../api/client'
import type { ApiToken } from '../../api/types'

function fmt(s?: string): string {
  if (!s) return '—'
  return s.replace('T', ' ').slice(0, 16)
}

/**
 * API 凭证（仿 tianzhi）。**明文存、点「查看」才在屏幕上显示**；
 * 「复制」直接拿真值（不用先显示）。停用立刻生效。
 */
export default function ApiTokensPage() {
  const [list, setList] = useState<ApiToken[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  /** 哪些行显示了明文 token */
  const [shown, setShown] = useState<Record<number, boolean>>({})

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', remark: '' })
  const [formErr, setFormErr] = useState('')
  const [busy, setBusy] = useState(false)
  /** 防重复提交（busy 是 state，连点会重复建） */
  const submitting = useRef(false)

  const load = () => {
    setLoading(true); setErr('')
    getApiTokens().then(setList).catch(e => setErr((e as Error).message || '加载失败')).finally(() => setLoading(false))
  }
  useEffect(load, [])

  async function submit() {
    if (submitting.current) return
    submitting.current = true
    setBusy(true); setFormErr('')
    try {
      await createApiToken({ name: form.name.trim(), remark: form.remark.trim() || undefined })
      setOpen(false); load()
    } catch (e) {
      setFormErr((e as ApiError).message || '创建失败')
      submitting.current = false
    }
    finally { setBusy(false) }
  }

  async function copy(t: ApiToken) {
    try { await navigator.clipboard.writeText(t.token ?? '') } catch { /* 剪贴板不给用就算了 */ }
  }

  async function toggle(t: ApiToken) {
    if (t.id == null) return
    try {
      const u = await setApiTokenStatus(t.id, t.status !== 1)
      setList(prev => prev.map(x => (x.id === t.id ? { ...x, status: u.status } : x)))
    } catch (e) { alert((e as ApiError).message || '操作失败') }
  }

  async function rename(t: ApiToken) {
    if (t.id == null) return
    const name = window.prompt('改名', t.name)
    if (name == null) return
    try { const u = await updateApiToken(t.id, { name: name.trim() }); setList(prev => prev.map(x => (x.id === t.id ? u : x))) }
    catch (e) { alert((e as ApiError).message || '改名失败') }
  }

  async function remove(t: ApiToken) {
    if (t.id == null) return
    if (!window.confirm(`删除凭证「${t.name}」？用它调接口的系统会立刻 401。`)) return
    try { await deleteApiToken(t.id); setList(prev => prev.filter(x => x.id !== t.id)) }
    catch (e) { alert((e as ApiError).message || '删除失败') }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">API 凭证</h1>
        <div className="spacer" />
        <button className="btn btn--primary" onClick={() => { setForm({ name: '', remark: '' }); setFormErr(''); setOpen(true) }}>新建凭证</button>
      </div>

      <div className="field-hint" style={{ marginBottom: 12 }}>
        调 <span className="mono">/openapi/&#123;code&#125;</span> 时带上：<span className="mono">X-API-Token</span> 头，
        或 <span className="mono">Authorization: Bearer &lt;token&gt;</span>。停用立刻生效。
      </div>

      {err && <div className="notice notice--err" style={{ marginBottom: 12 }}>{err}</div>}

      {loading ? <div className="empty-note">加载中…</div> : list.length === 0 ? (
        <div className="empty-note">还没有凭证。新建一个，给要调接口的系统用。</div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="tbl">
            <thead>
              <tr><th>名字</th><th>token</th><th style={{ width: 90 }}>状态</th><th style={{ width: 150 }}>最近使用</th><th /></tr>
            </thead>
            <tbody>
              {list.map(t => (
                <tr key={t.id} className="row">
                  <td>{t.name}{t.remark && <div className="faint">{t.remark}</div>}</td>
                  <td className="mono">
                    {t.id != null && shown[t.id] ? t.token : '••••••••••••'}
                    <button className="btn btn--sm btn--ghost" style={{ marginLeft: 6 }}
                      onClick={() => t.id != null && setShown(s => ({ ...s, [t.id!]: !s[t.id!] }))}>
                      {t.id != null && shown[t.id] ? '隐藏' : '查看'}
                    </button>
                    <button className="btn btn--sm btn--ghost" onClick={() => void copy(t)}>复制</button>
                  </td>
                  <td>
                    <span className="pill" style={{ color: t.status === 1 ? 'var(--ok)' : 'var(--fg-faint)' }}>
                      <i />{t.status === 1 ? '启用' : '停用'}
                    </span>
                  </td>
                  <td className="faint">{fmt(t.lastUsedAt)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn--sm" onClick={() => void rename(t)}>改名</button>{' '}
                    <button className="btn btn--sm" onClick={() => void toggle(t)}>{t.status === 1 ? '停用' : '启用'}</button>{' '}
                    <button className="btn btn--sm btn--danger" onClick={() => void remove(t)}>删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <div className="modal-overlay" onClick={() => { if (!busy) setOpen(false) }}>
          <div className="modal" style={{ width: 460 }} onClick={e => e.stopPropagation()}>
            <div className="modal-head"><span className="modal-title">新建凭证</span></div>
            {formErr && <div className="notice notice--err" style={{ marginBottom: 10 }}>{formErr}</div>}
            <div className="field-row">
              <label className="field-label">名字</label>
              <input className="input" value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="field-row">
              <label className="field-label">备注</label>
              <input className="input" value={form.remark}
                onChange={e => setForm(f => ({ ...f, remark: e.target.value }))} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button className="btn" onClick={() => setOpen(false)} disabled={busy}>取消</button>
              <button className="btn btn--primary" onClick={() => void submit()} disabled={busy}>创建</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
