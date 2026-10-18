import { useEffect, useState } from 'react'
import { getTables, probeColumns } from '../../api/client'
import ConditionGroupEditor from './ConditionGroupEditor'
import type { CondVar } from './ConditionDialog'
import { buildWhere, newGroup, type Group } from './queryTypes'

/**
 * 可视化单表查询 —— 给"就是想查一张表"的人用，不用写 SQL。
 *
 * 条件是**只读查看**：这里只显示当前条件，点「编辑条件」进独立编辑页（那里每组可折叠、
 * 值还能引用前面层节点的输出）。
 * 选表 → 选返回字段 → 编条件 → 下面实时生成 SQL，确认就填回节点。
 * 只做单表：join / 子查询这类还是手写。
 */
export default function VisualQueryDialog({ dataSourceId, vars, maxRows = 10, onSave, onCancel }: {
  dataSourceId: number | null
  /** 前面层可引用的节点（条件里当"值"用） */
  vars: CondVar[]
  /** 生成的 SQL 末尾会带上 limit（和节点上的「最多行数」一致） */
  maxRows?: number
  onSave: (sql: string) => void
  onCancel: () => void
}) {
  const [limit, setLimit] = useState(maxRows)
  const [tables, setTables] = useState<string[]>([])
  const [table, setTable] = useState('')
  const [cols, setCols] = useState<string[]>([])
  const [allFields, setAllFields] = useState(true)
  const [picked, setPicked] = useState<string[]>([])
  const [groups, setGroups] = useState<Group[]>(() => [newGroup([])])
  const [editConds, setEditConds] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (dataSourceId == null) return
    getTables(dataSourceId)
      .then(r => setTables(r.tables))
      .catch(e => setErr((e as Error).message || '读表列表失败'))
  }, [dataSourceId])

  useEffect(() => {
    if (dataSourceId == null || !table) return
    setCols([])
    probeColumns(dataSourceId, `select * from ${table}`)
      .then(r => { if (r.error) setErr(r.error); else { setCols(r.columns); setErr('') } })
      .catch(e => setErr((e as Error).message || '读字段失败'))
  }, [dataSourceId, table])

  const chosen = !allFields && picked.length > 0 ? picked : null
  const fields = chosen ? chosen.join(', ') : '*'
  const where = buildWhere(groups)
  const sql = table ? `select ${fields} from ${table}${where ? ' where ' + where : ''} limit ${limit}` : ''

  const toggleField = (c: string) => {
    setAllFields(false)
    setPicked(p => (p.includes(c) ? p.filter(x => x !== c) : [...p, c]))
  }

  return (
    <div className="modal-overlay" style={{ zIndex: 700 }} onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="modal vq" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">可视化查询（单表）</span>
          <div className="spacer" />
          <button className="btn btn--sm btn--ghost" onClick={onCancel}>关闭</button>
        </div>

        {dataSourceId == null ? (
          <div className="notice notice--err">这个节点还没选数据源，先选了再用可视化。</div>
        ) : (
          <>
            <div className="field-row">
              <label className="field-label">表</label>
              <select className="input" value={table}
                onChange={e => { setTable(e.target.value); setGroups([newGroup([])]); setPicked([]); setAllFields(true) }}>
                <option value="">— 选一张表 —</option>
                {tables.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              {tables.length === 0 && !err && <div className="field-hint">这个数据源里没读到表。</div>}
            </div>

            {table && (
              <>
                <div className="field-row">
                  <label className="field-label">返回字段</label>
                  <div className="cond-chips">
                    <button type="button" className={'cond-chip' + (allFields ? ' cond-chip--on' : '')}
                      onClick={() => { setAllFields(true); setPicked([]) }}>
                      全部（<span className="mono">*</span>）
                    </button>
                    {cols.map(c => {
                      const on = !allFields && picked.includes(c)
                      return (
                        <button key={c} type="button" className={'cond-chip' + (on ? ' cond-chip--on' : '')}
                          onClick={() => toggleField(c)}>{c}</button>
                      )
                    })}
                  </div>
                  <div className="field-hint">
                    {allFields
                      ? '返回所有列。想只要几列，直接点上面的字段名。'
                      : picked.length > 0
                        ? `只返回：${picked.join('、')}`
                        : '一列都没选 —— 点上面的字段名，或点「全部（*）」。'}
                  </div>
                </div>

                <div className="field-row">
                  <div className="sql-head">
                    <label className="field-label" style={{ marginBottom: 0 }}>条件</label>
                    <div className="spacer" />
                    <button type="button" className="btn btn--sm" onClick={() => setEditConds(true)}>编辑条件</button>
                  </div>
                  {where
                    ? <div className="vq-cond-view mono">{where}</div>
                    : <div className="field-hint">还没加条件 —— 不加就是查全表。</div>}
                </div>
              </>
            )}

            {err && <div className="notice notice--err" style={{ marginBottom: 10 }}>{err}</div>}
          </>
        )}

        <div className="field-row" style={{ marginBottom: 0 }}>
          <div className="sql-head">
            <label className="field-label" style={{ marginBottom: 0 }}>生成的 SQL（可以直接拿去改）</label>
            <div className="spacer" />
            <span className="field-hint" style={{ margin: 0 }}>最多行数</span>
            <input type="number" className="input input--sm mono" style={{ width: 88 }} min={1} max={1000}
              value={limit}
              onChange={e => setLimit(Math.min(1000, Math.max(1, parseInt(e.target.value, 10) || 1)))} />
          </div>
          <pre className="code">{sql || '（还没选表）'}</pre>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button className="btn" onClick={onCancel}>取消</button>
          <button className="btn btn--primary" disabled={!sql} onClick={() => onSave(sql)}>用这个 SQL</button>
        </div>

        {editConds && (
          <ConditionGroupEditor
            groups={groups}
            cols={cols}
            vars={vars}
            onSave={g => { setGroups(g); setEditConds(false) }}
            onCancel={() => setEditConds(false)}
          />
        )}
      </div>
    </div>
  )
}
