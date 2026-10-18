import { useCallback, useEffect, useState } from 'react'
import { deleteDataSource, getDataSources } from '../../api/client'
import type { ApiError } from '../../api/client'
import type { DataSource, DataSourceType } from '../../api/types'
import DataSourceFormModal from './DataSourceFormModal'

const TYPE_LABEL: Record<DataSourceType, string> = {
  MYSQL: 'MySQL',
  SQLITE: 'SQLite',
  ELASTICSEARCH: 'Elasticsearch',
  CLICKHOUSE: 'ClickHouse',
}

/** host:port/databaseName；SQLite 直接显示文件路径 */
function address(ds: DataSource): string {
  if (ds.type === 'SQLITE') return ds.databaseName || '—'
  const host = ds.host || '—'
  const port = ds.port != null && String(ds.port) !== '' ? `:${ds.port}` : ''
  const db = ds.databaseName ? `/${ds.databaseName}` : ''
  return `${host}${port}${db}`
}

function formatTime(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function DataSourcesPage() {
  const [items, setItems] = useState<DataSource[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  // modal: open + 正在编辑的项（undefined = 新建）
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<DataSource | undefined>(undefined)

  const [pendingDelete, setPendingDelete] = useState<DataSource | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      setItems(await getDataSources())
    } catch (err) {
      setLoadError((err as ApiError).message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  const openCreate = () => { setEditing(undefined); setModalOpen(true) }
  const openEdit = (ds: DataSource) => { setEditing(ds); setModalOpen(true) }

  const confirmDelete = async () => {
    if (pendingDelete?.id == null) return
    setDeleting(true)
    setDeleteError('')
    try {
      await deleteDataSource(pendingDelete.id)
      setPendingDelete(null)
      await reload()
    } catch (err) {
      setDeleteError((err as ApiError).message || '删除失败')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">数据源</h1>
        <span className="faint">SQL 流里的只读 SQL 都跑在这些库上</span>
        <button className="btn btn--primary spacer" onClick={openCreate}>+ 新建数据源</button>
      </div>

      {loadError && <div className="notice notice--err" style={{ marginBottom: 14 }}>{loadError}</div>}

      <div className="card">
        {loading ? (
          <div className="empty-note">加载中…</div>
        ) : items.length === 0 ? (
          <div className="empty-note">还没有数据源，先新建一个 MySQL 数据源</div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>名称</th>
                <th>类型</th>
                <th>地址</th>
                <th>状态</th>
                <th>最近修改</th>
                <th style={{ width: 140 }}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((ds) => (
                <tr className="row" key={ds.id ?? ds.name}>
                  <td>
                    <div className="row-click" onClick={() => openEdit(ds)}>{ds.name}</div>
                    {ds.jdbcParams ? <div className="field-hint mono">{ds.jdbcParams}</div> : null}
                  </td>
                  <td>{TYPE_LABEL[ds.type] ?? ds.type}</td>
                  <td className="mono">{address(ds)}</td>
                  <td>
                    <span className="pill" style={{ color: ds.status === 1 ? 'var(--ok)' : 'var(--fg-faint)' }}>
                      <i />{ds.status === 1 ? '启用' : '停用'}
                    </span>
                  </td>
                  <td className="faint">{formatTime(ds.updatedAt)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button className="btn btn--sm" onClick={() => openEdit(ds)}>编辑</button>
                      <button
                        className="btn btn--sm btn--danger"
                        onClick={() => { setDeleteError(''); setPendingDelete(ds) }}
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modalOpen && (
        <DataSourceFormModal
          key={editing?.id ?? 'new'}
          initial={editing}
          onClose={() => setModalOpen(false)}
          onSaved={() => { setModalOpen(false); void reload() }}
        />
      )}

      {pendingDelete && (
        <div className="modal-overlay" onClick={deleting ? undefined : () => setPendingDelete(null)}>
          <div className="modal" style={{ width: 400 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <span className="modal-title">删除数据源</span>
            </div>
            <p style={{ marginTop: 0 }}>
              确定要删除「{pendingDelete.name}」吗？引用它的 SQL 流节点将无法执行。
            </p>
            {deleteError && <div className="notice notice--err" style={{ marginBottom: 12 }}>{deleteError}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={() => setPendingDelete(null)} disabled={deleting}>取消</button>
              <button className="btn btn--danger" onClick={confirmDelete} disabled={deleting}>
                {deleting ? '删除中…' : '删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
