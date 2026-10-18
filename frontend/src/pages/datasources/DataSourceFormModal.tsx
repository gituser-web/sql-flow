import { useState } from 'react'
import type { FormEvent } from 'react'
import {
  createDataSource, testDataSource, updateDataSource,
} from '../../api/client'
import type { ApiError } from '../../api/client'
import type { ConnectionTest, DataSource, DataSourceType } from '../../api/types'

/** 新建/编辑数据源弹窗。传 initial（含 id）即编辑，否则新建。 */
export interface DataSourceFormModalProps {
  initial?: DataSource
  onClose: () => void
  /** 保存成功后回调（父组件据此刷新列表并关闭弹窗） */
  onSaved: () => void
}

interface FormState {
  name: string
  type: DataSourceType
  host: string
  port: string
  databaseName: string
  username: string
  password: string
  jdbcParams: string
  status: number
}

/** 可用的类型：MySQL / SQLite 已实现；ES / CK 显示但禁用。 */
const TYPE_OPTIONS: { value: DataSourceType; label: string }[] = [
  { value: 'MYSQL', label: 'MySQL' },
  { value: 'SQLITE', label: 'SQLite（零安装，填文件路径）' },
  { value: 'ELASTICSEARCH', label: 'Elasticsearch（本版未实现）' },
  { value: 'CLICKHOUSE', label: 'ClickHouse（本版未实现）' },
]
const UNSUPPORTED: DataSourceType[] = ['ELASTICSEARCH', 'CLICKHOUSE']

const emptyForm: FormState = {
  name: '',
  type: 'MYSQL',
  host: 'localhost',
  port: '3306',
  databaseName: '',
  username: 'root',
  password: '',
  jdbcParams: '',
  status: 1,
}

function toForm(ds: DataSource): FormState {
  return {
    name: ds.name ?? '',
    type: ds.type ?? 'MYSQL',
    host: ds.host ?? '',
    port: ds.port != null ? String(ds.port) : '',
    databaseName: ds.databaseName ?? '',
    username: ds.username ?? '',
    password: ds.password ?? '',
    jdbcParams: ds.jdbcParams ?? '',
    status: ds.status ?? 1,
  }
}

export default function DataSourceFormModal({ initial, onClose, onSaved }: DataSourceFormModalProps) {
  const editing = initial?.id != null
  const [form, setForm] = useState<FormState>(initial ? toForm(initial) : emptyForm)
  /** 后端 400 带 field → 标红对应输入框；键 = 字段名。 */
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)

  const busy = testing || saving

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }))
    setFieldErrors((prev) => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  const isSqlite = form.type === 'SQLITE'
  const needsPort = !isSqlite

  const parsePort = (): number | null => {
    const raw = form.port.trim()
    if (raw === '') return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  }

  const buildConnectionTest = (port: number | null): ConnectionTest => ({
    type: form.type,
    host: form.host.trim(),
    port,
    databaseName: form.databaseName.trim(),
    username: form.username.trim(),
    password: form.password,
    jdbcParams: form.jdbcParams.trim() || undefined,
  })

  const runTest = async () => {
    setTest(null)
    const port = parsePort()
    if (needsPort && port == null) {
      setTest({ ok: false, message: '端口必须是数字' })
      return
    }
    setTesting(true)
    try {
      const res = await testDataSource(buildConnectionTest(port))
      setTest(res)
    } catch (err) {
      const e = err as ApiError
      setTest({ ok: false, message: e.message || '测试失败' })
    } finally {
      setTesting(false)
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setFormError('')
    const port = parsePort()
    if (needsPort && port == null) {
      setFieldErrors({ port: '端口必须是数字' })
      return
    }
    setFieldErrors({})
    setSaving(true)
    try {
      const payload: DataSource = {
        name: form.name.trim(),
        type: form.type,
        host: isSqlite ? '' : form.host.trim(),
        port: isSqlite ? null : port,
        databaseName: form.databaseName.trim(),
        username: isSqlite ? '' : form.username.trim(),
        password: isSqlite ? '' : form.password,
        jdbcParams: form.jdbcParams.trim() || undefined,
        status: form.status,
      }
      if (editing && initial?.id != null) {
        await updateDataSource(initial.id, payload)
      } else {
        await createDataSource(payload)
      }
      onSaved()
    } catch (err) {
      const e2 = err as ApiError
      const msg = e2.message || '保存失败'
      if (e2.field) setFieldErrors({ [e2.field]: msg })
      else setFormError(msg)
    } finally {
      setSaving(false)
    }
  }

  const cls = (name: string) => 'input' + (fieldErrors[name] ? ' input--bad' : '')
  const err = (name: string) =>
    fieldErrors[name] ? (
      <div className="field-hint" style={{ color: 'var(--danger)' }}>{fieldErrors[name]}</div>
    ) : null

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <form
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <div className="modal-head">
          <span className="modal-title">{editing ? '编辑数据源' : '新建数据源'}</span>
          <button type="button" className="btn btn--sm btn--ghost spacer" onClick={onClose} disabled={busy}>
            关闭
          </button>
        </div>

        <div className="field-row">
          <label className="field-label">名称</label>
          <input
            className={cls('name')}
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="例如：订单库"
            autoFocus
          />
          {err('name')}
        </div>

        <div className="field-row">
          <label className="field-label">类型</label>
          <select
            className={cls('type')}
            value={form.type}
            onChange={(e) => set('type', e.target.value as DataSourceType)}
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value} disabled={UNSUPPORTED.includes(o.value)}>
                {o.label}
              </option>
            ))}
          </select>
          {err('type')}
          {UNSUPPORTED.includes(form.type) && (
            <div className="notice" style={{ marginTop: 8 }}>
              本版未实现，只有 MySQL / SQLite 数据源可以保存并执行。
            </div>
          )}
        </div>

        {!isSqlite && (
          <div style={{ display: 'flex', gap: 12 }}>
            <div className="field-row" style={{ flex: 3 }}>
              <label className="field-label">主机</label>
              <input
                className={cls('host')}
                value={form.host}
                onChange={(e) => set('host', e.target.value)}
                placeholder="localhost"
              />
              {err('host')}
            </div>
            <div className="field-row" style={{ flex: 1 }}>
              <label className="field-label">端口</label>
              <input
                className={cls('port')}
                value={form.port}
                onChange={(e) => set('port', e.target.value)}
                inputMode="numeric"
                placeholder="3306"
              />
              {err('port')}
            </div>
          </div>
        )}

        <div className="field-row">
          <label className="field-label">{isSqlite ? '数据库文件路径' : '数据库'}</label>
          <input
            className={cls('databaseName')}
            value={form.databaseName}
            onChange={(e) => set('databaseName', e.target.value)}
            placeholder={isSqlite ? '/Users/you/sql-flow/data/demo.db' : 'database name'}
          />
          {err('databaseName')}
          {isSqlite && (
            <div className="field-hint">
              SQLite 直接读这个文件；文件不存在会报错。可以用项目里的 demo.sql 建一个。
            </div>
          )}
        </div>

        {!isSqlite && (
          <>
            <div className="field-row">
              <label className="field-label">用户名</label>
              <input
                className={cls('username')}
                value={form.username}
                onChange={(e) => set('username', e.target.value)}
              />
              {err('username')}
            </div>

            <div className="field-row">
              <label className="field-label">密码</label>
              <input
                className={cls('password')}
                type="password"
                value={form.password}
                onChange={(e) => set('password', e.target.value)}
                autoComplete="new-password"
              />
              {err('password')}
            </div>

            <div className="field-row">
              <label className="field-label">JDBC 参数</label>
              <input
                className={cls('jdbcParams')}
                value={form.jdbcParams}
                onChange={(e) => set('jdbcParams', e.target.value)}
                placeholder="例如：useSSL=false"
              />
              {err('jdbcParams')}
            </div>
          </>
        )}

        <div className="field-row">
          <label className="field-label">状态</label>
          <select
            className={cls('status')}
            value={form.status}
            onChange={(e) => set('status', Number(e.target.value))}
          >
            <option value={1}>启用</option>
            <option value={0}>停用</option>
          </select>
          {err('status')}
        </div>

        {formError && <div className="notice notice--err" style={{ marginBottom: 12 }}>{formError}</div>}
        {test && (
          <div className={'notice' + (test.ok ? '' : ' notice--err')} style={{ marginBottom: 12 }}>
            {test.message}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>取消</button>
          <button type="button" className="btn" onClick={runTest} disabled={busy}>
            {testing ? '测试中…' : '测试连接'}
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </form>
    </div>
  )
}
