import { useEffect, useRef, useState } from 'react'
import { probeColumns } from '../../api/client'
import type { CondVar } from './ConditionDialog'

/**
 * 「插入变量」选择器 —— 照 tianzhi 的 VarPickerPanel：**居中的固定窗**。
 *
 * 交互：**点开节点 → 点一个字段（只是选中，看右边）→ 在右边选「取哪一行」→ 点「插入」**。
 * 单击只选中；双击 / Enter / 点「插入」才真的插进去。
 *
 * bare = true 时只插裸引用（`$a.rows[*].列`，当"值"用）；
 * bare = false 时插整段片段（全部行 → `in ($a.rows[*].列)`，某一行 → `$a.rows[n].列`）。
 */
type Scope = 'first' | 'index' | 'all'
interface Item { kind: 'scalar' | 'count' | 'col'; node: string; col?: string; label: string }
type Row =
  | { kind: 'group'; label: string }
  | { kind: 'node'; name: string; count: number }
  | { kind: 'item'; item: Item }

export default function VarPickerDialog({ vars, bare = false, onPick, onClose }: {
  vars: CondVar[]
  /** true = 只插裸引用；false = 插整段片段 */
  bare?: boolean
  onPick: (text: string) => void
  onClose: () => void
}) {
  const [cols, setCols] = useState<Record<string, string[]>>({})
  const [err, setErr] = useState<Record<string, string>>({})
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [scope, setScope] = useState<Scope>('first')
  /** 第几行，人看的从 1 开始 */
  const [rowNo, setRowNo] = useState('1')
  const [sel, setSel] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    for (const v of vars) {
      if (v.dataSourceId == null || !v.sqlTemplate.trim()) continue
      probeColumns(v.dataSourceId, v.sqlTemplate)
        .then(r => {
          if (!alive) return
          if (r.error) setErr(p => ({ ...p, [v.name]: r.error as string }))
          else setCols(p => ({ ...p, [v.name]: r.columns }))
        })
        .catch(e => { if (alive) setErr(p => ({ ...p, [v.name]: (e as Error).message || '探列失败' })) })
    }
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { requestAnimationFrame(() => searchRef.current?.focus()) }, [])

  const q = search.trim().toLowerCase()
  const searching = q !== ''
  const rowIdx = Math.max(0, (parseInt(rowNo, 10) || 1) - 1)   // 后端从 0 开始

  function itemsOf(v: CondVar): Item[] {
    // 输入参数：裸的 $名字，没有行数/列
    if (v.isInput) return [{ kind: 'scalar', node: v.name, label: v.name }]
    const out: Item[] = [{ kind: 'count', node: v.name, label: '行数' }]
    for (const c of cols[v.name] ?? []) out.push({ kind: 'col', node: v.name, col: c, label: c })
    return out
  }

  function refFor(node: string, col: string): string {
    if (scope === 'all') return `$${node}.rows[*].${col}`
    const n = scope === 'first' ? 0 : rowIdx
    return `$${node}.rows[${n}].${col}`
  }
  function textFor(it: Item): string {
    if (it.kind === 'scalar') return `#{${it.node}}`   // 输入参数用 #{}（MyBatis 风格）
    if (it.kind === 'count') return `$${it.node}.rowCount`
    const ref = refFor(it.node, it.col!)
    return bare || scope !== 'all' ? ref : `in (${ref})`
  }

  const rows: Row[] = []
  let inputHeader = false
  for (const v of vars) {
    // 输入参数：**本身就是可插入项，不用展开**（展开出来还是它自己）
    if (v.isInput) {
      if (searching && !v.name.toLowerCase().includes(q)) continue
      if (!inputHeader) { rows.push({ kind: 'group', label: '输入参数' }); inputHeader = true }
      rows.push({ kind: 'item', item: { kind: 'scalar', node: v.name, label: v.name } })
      continue
    }
    const all = itemsOf(v)
    const hit = searching ? all.filter(i => (i.label + ' ' + v.name).toLowerCase().includes(q)) : []
    if (searching && hit.length === 0) continue
    rows.push({ kind: 'node', name: v.name, count: all.length })
    if (searching || open[v.name]) {
      for (const it of (searching ? hit : all)) rows.push({ kind: 'item', item: it })
    }
  }

  const cur = rows[Math.min(sel, Math.max(rows.length - 1, 0))] ?? null
  const curItem = cur?.kind === 'item' ? cur.item : null
  const preview = curItem ? textFor(curItem) : ''

  function toggle(name: string) { setOpen(o => ({ ...o, [name]: !o[name] })) }
  function insert() { if (curItem) onPick(textFor(curItem)) }
  function activate() {
    if (!cur) return
    if (cur.kind === 'node') toggle(cur.name)
    else if (cur.kind === 'item') insert()
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, rows.length - 1)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); return }
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); activate() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  return (
    <div className="modal-overlay" style={{ zIndex: 700 }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal vp" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">插入变量</span>
          <span className="faint" style={{ marginLeft: 8 }}>点开节点 → 点字段 → 右边选取哪一行 → 插入</span>
          <div className="spacer" />
          <button className="btn btn--sm btn--ghost" onClick={onClose}>关闭</button>
        </div>

        <input
          ref={searchRef}
          className="input"
          style={{ marginBottom: 10 }}
          value={search}
          placeholder="搜索：字段名 / 节点名"
          spellCheck={false}
          onChange={e => { setSearch(e.target.value); setSel(0) }}
        />

        <div className="vp-body">
          <div className="vp-list">
            {vars.length === 0 && <div className="vf-empty">这一步前面还没有 SQL 节点，没什么可引用的。</div>}
            {vars.length > 0 && rows.length === 0 && <div className="vf-empty">没有匹配「{search}」的字段。</div>}
            {rows.map((r, i) => {
              const on = i === sel
              if (r.kind === 'group') {
                return <div key={'g-' + r.label} className="vp-group">{r.label}</div>
              }
              if (r.kind === 'node') {
                const expanded = searching || !!open[r.name]
                const e = err[r.name]
                return (
                  <div key={'n-' + r.name}
                    className={'vp-row vp-node' + (on ? ' vp-row--on' : '')}
                    onClick={() => { setSel(i); toggle(r.name) }}>
                    <span className="vp-caret">{expanded ? '▾' : '▸'}</span>
                    <span className="vp-name mono">${r.name}</span>
                    {!e && <span className="vp-count">{r.count}</span>}
                    {e && <span className="vp-warn-inline">拿不到列</span>}
                  </div>
                )
              }
              return (
                <div key={r.item.node + '.' + r.item.label}
                  className={'vp-row vp-child' + (on ? ' vp-row--on' : '')}
                  onClick={() => setSel(i)}
                  onDoubleClick={() => onPick(textFor(r.item))}>
                  <span className="vp-name">{r.item.label}</span>
                </div>
              )
            })}
          </div>

          <div className="vp-detail">
            {curItem ? (
              <>
                <div className="vp-d-kicker">${curItem.node}</div>
                <div className="vp-d-title mono">{preview}</div>

                {curItem.kind === 'col' && (
                  <div className="vp-scope">
                    <div className="vp-d-label">取哪一行</div>
                    <label className="cond-listmode">
                      <input type="radio" checked={scope === 'first'} onChange={() => setScope('first')} />
                      第一行
                    </label>
                    <label className="cond-listmode">
                      <input type="radio" checked={scope === 'index'} onChange={() => setScope('index')} />
                      第
                      <input className="input input--sm" style={{ width: 56, margin: '0 4px' }}
                        value={rowNo} inputMode="numeric"
                        onFocus={() => setScope('index')}
                        onChange={e => { setRowNo(e.target.value.replace(/\D/g, '') || '1'); setScope('index') }} />
                      行
                    </label>
                    <label className="cond-listmode">
                      <input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} />
                      全部行（整列）
                    </label>
                  </div>
                )}

                <div className="vp-d-help">
                  {curItem.kind === 'scalar'
                    ? '输入参数，用 #{名字} 引用（运行时调用方要填的值）。'
                    : curItem.kind === 'count'
                      ? '这个节点查出来的行数（数字）。'
                      : scope === 'all'
                        ? bare
                          ? `「${curItem.col}」这一列的所有值（列表），配合「在…里（IN）」用。`
                          : `「${curItem.col}」这一列的所有值，插成 \`in (?, ?, …)\` —— 直接接在 \`where 某列 \` 后面就能用。`
                        : `第 ${scope === 'first' ? 1 : rowIdx + 1} 行的「${curItem.col}」，单个值。`}
                </div>
              </>
            ) : cur?.kind === 'node' ? (
              <>
                <div className="vp-d-kicker">${cur.name}</div>
                {err[cur.name]
                  ? <div className="vp-d-help">拿不到列：{err[cur.name]}</div>
                  : <div className="vp-d-help">点开它，选一个字段；右边能选取哪一行。</div>}
              </>
            ) : (
              <div className="vp-d-empty">左边选一个，这里会说明它会插进什么。</div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn btn--primary" disabled={!curItem} onClick={insert}>插入</button>
        </div>
      </div>
    </div>
  )
}
