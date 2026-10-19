import { useEffect, useState } from 'react'
import { probeColumns } from '../../api/client'
import {
  buildIfExpr, condProblem, newIfCond, newIfGroup, noValue, opsFor, parseIfExpr,
  type IfCond, type IfGroup, type IfTarget,
} from './ifCondition'

/** 条件里可引用的变量（前面层的 SQL 节点）。带上 SQL 是为了探出真实列名。 */
export interface CondVar {
  name: string
  /** 人起的节点名（没填就是 undefined，显示时退回 name） */
  label?: string
  layerNo: number
  dataSourceId: number | null
  sqlTemplate: string
  /** true = SQL 流输入参数（裸的 $名字，没有 rows/列） */
  isInput?: boolean
}

/**
 * 条件节点弹窗。和「可视化查询 → 编辑条件」一个样子：
 *   一个**条件** = 一组判断，组内选 AND / OR；条件之间也选 AND / OR（AND 优先，和 SQL 一样）。
 *   每条判断 = 节点 + 看什么（行数 / 是否截断 / 某个字段）+ 条件 + 值。
 * 也可以切到「直接写表达式」。手写的、可视化读不回来的表达式就停在那儿，不悄悄改写。
 * 判定为真 → 继续往下；为假 → 结束整个 SQL 流。
 */
export default function ConditionDialog({ initial, vars, onSave, onCancel }: {
  initial: string
  vars: CondVar[]
  onSave: (expr: string) => void
  onCancel: () => void
}) {
  // 条件只能判断 SQL 节点的结果（输入参数不是查询结果，没有行数/字段）
  const nodes = vars.filter(v => !v.isInput)
  const nodeNames = nodes.map(v => v.name)
  const first = nodeNames[0] ?? ''

  const parsed = initial.trim() ? parseIfExpr(initial, nodeNames) : [newIfGroup(first)]
  const [mode, setMode] = useState<'visual' | 'text'>(parsed ? 'visual' : 'text')
  const [groups, setGroups] = useState<IfGroup[]>(parsed ?? [newIfGroup(first)])
  const [text, setText] = useState(initial)
  /** 从「直接写」切回可视化失败时的提示 */
  const [parseNote, setParseNote] = useState(parsed ? '' : '这个表达式是手写的，可视化读不了，先在下面直接改；清空后就能用可视化重新配。')
  const [showErr, setShowErr] = useState(false)
  const [cols, setCols] = useState<Record<string, string[]>>({})

  useEffect(() => {
    let alive = true
    for (const v of nodes) {
      if (v.dataSourceId == null || !v.sqlTemplate.trim()) continue
      probeColumns(v.dataSourceId, v.sqlTemplate)
        .then(r => { if (alive && !r.error) setCols(p => ({ ...p, [v.name]: r.columns })) })
        .catch(() => { /* 探不到就只给「行数 / 是否截断」，或直接写表达式 */ })
    }
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const labelOf = (n: string) => nodes.find(v => v.name === n)?.label || n
  const expr = mode === 'visual' ? buildIfExpr(groups) : text.trim()
  const problems = groups.map(g => g.conds.map(condProblem))
  const hasProblem = mode === 'visual' && problems.some(ps => ps.some(Boolean))

  const setGroup = (gi: number, p: Partial<IfGroup>) => setGroups(gs => gs.map((g, i) => (i === gi ? { ...g, ...p } : g)))
  const setCond = (gi: number, ci: number, p: Partial<IfCond>) =>
    setGroups(gs => gs.map((g, i) => (i === gi ? { ...g, conds: g.conds.map((c, k) => (k === ci ? { ...c, ...p } : c)) } : g)))
  const addCond = (gi: number) => setGroups(gs => gs.map((g, i) => (i === gi ? { ...g, conds: [...g.conds, newIfCond(first)] } : g)))
  const delCond = (gi: number, ci: number) => setGroups(gs => gs.map((g, i) => (i === gi ? { ...g, conds: g.conds.filter((_, k) => k !== ci) } : g)))

  /** 换「看什么」时把条件和值改成说得通的默认值，免得留一个不能用的组合 */
  function setTarget(gi: number, ci: number, target: IfTarget) {
    const c = groups[gi].conds[ci]
    const next: IfCond = { ...c, target }
    if (target === 'rowCount') Object.assign(next, { op: '>', value: '0' })
    else if (target === 'truncated') Object.assign(next, { op: '==', value: 'true' })
    else Object.assign(next, { col: c.col || cols[c.node]?.[0] || '', scope: 'first', op: '==', value: '' })
    setCond(gi, ci, next)
  }

  function switchTo(m: 'visual' | 'text') {
    if (m === mode) return
    if (m === 'text') { setText(buildIfExpr(groups)); setMode('text'); setParseNote(''); return }
    if (!text.trim()) { setGroups([newIfGroup(first)]); setMode('visual'); setParseNote(''); return }
    const g = parseIfExpr(text, nodeNames)
    if (!g) { setParseNote('这个表达式可视化读不了（手写的写法），继续在这里改；清空后就能用可视化重新配。'); return }
    setGroups(g); setMode('visual'); setParseNote('')
  }

  function save() {
    if (mode === 'visual' && hasProblem) { setShowErr(true); return }
    if (!expr) { setShowErr(true); return }
    onSave(expr)
  }

  return (
    <div className="modal-overlay" style={{ zIndex: 600 }} onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="modal cond-modal cge" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">条件节点</span>
          <div className="cond-chips" style={{ marginLeft: 12 }}>
            <button type="button" className={'cond-chip' + (mode === 'visual' ? ' cond-chip--on' : '')} onClick={() => switchTo('visual')}>可视化</button>
            <button type="button" className={'cond-chip' + (mode === 'text' ? ' cond-chip--on' : '')} onClick={() => switchTo('text')}>直接写表达式</button>
          </div>
          <div className="spacer" />
          <button className="btn btn--sm btn--ghost" onClick={onCancel}>关闭</button>
        </div>

        {nodes.length === 0 ? (
          <div className="field-hint">这个条件前面还没有 SQL 节点，没什么可判断的。</div>
        ) : mode === 'visual' ? (
          <div className="cge-body-scroll">
            {groups.map((g, gi) => (
              <div className="cge-wrap" key={gi}>
                {gi > 0 && (
                  <div className="cge-join">
                    <select className="input input--sm" style={{ width: 76 }} value={g.join}
                      onChange={e => setGroup(gi, { join: e.target.value as 'and' | 'or' })}>
                      <option value="and">AND</option>
                      <option value="or">OR</option>
                    </select>
                    <span className="faint">与上一个条件的关系</span>
                  </div>
                )}
                <div className="cge-group">
                  <div className="cge-head" style={{ cursor: 'default' }}>
                    <span className="cge-title">条件 {gi + 1}</span>
                    {g.conds.length > 1 && (
                      <select className="input input--sm" value={g.mode}
                        onChange={e => setGroup(gi, { mode: e.target.value as 'and' | 'or' })}>
                        <option value="and">里面全部满足 AND</option>
                        <option value="or">里面满足任一 OR</option>
                      </select>
                    )}
                    <div className="spacer" />
                    {groups.length > 1 && (
                      <button type="button" className="btn btn--sm btn--ghost"
                        onClick={() => setGroups(gs => gs.filter((_, i) => i !== gi))}>删掉这个条件</button>
                    )}
                  </div>
                  <div className="cge-group-body">
                    {g.conds.map((c, ci) => {
                      const ops = opsFor(c)
                      const colList = cols[c.node] ?? []
                      // 读回来的字段这次没探到（SQL 改过 / 数据源连不上）也留着，不悄悄换掉
                      const colOpts = c.col && !colList.includes(c.col) ? [c.col, ...colList] : colList
                      const prob = problems[gi][ci]
                      return (
                        <div key={ci}>
                          <div className="vq-cond">
                            {ci > 0
                              ? <span className="vq-inline-join">{g.mode === 'and' ? 'AND' : 'OR'}</span>
                              : <span className="vq-inline-join vq-inline-join--first" />}
                            <select className="input input--sm" style={{ maxWidth: 150 }} value={c.node} title={c.node}
                              onChange={e => setCond(gi, ci, { node: e.target.value, ...(c.target === 'col' ? { col: '' } : {}) })}>
                              {nodes.map(v => <option key={v.name} value={v.name}>{v.label || v.name}（第 {v.layerNo} 层）</option>)}
                            </select>
                            <select className="input input--sm" value={c.target}
                              onChange={e => setTarget(gi, ci, e.target.value as IfTarget)}>
                              <option value="rowCount">行数</option>
                              <option value="truncated">是否被截断</option>
                              <option value="col" disabled={colOpts.length === 0 && c.target !== 'col'}>某个字段</option>
                            </select>
                            {c.target === 'col' && (
                              <>
                                <select className={'input input--sm' + (showErr && !c.col ? ' input--bad' : '')} value={c.col}
                                  onChange={e => setCond(gi, ci, { col: e.target.value })}>
                                  <option value="">— 字段 —</option>
                                  {colOpts.map(x => <option key={x} value={x}>{x}</option>)}
                                </select>
                                <select className="input input--sm" value={c.scope}
                                  onChange={e => {
                                    const scope = e.target.value as 'first' | 'any'
                                    const okOps = opsFor({ target: 'col', scope })
                                    setCond(gi, ci, { scope, op: okOps.some(o => o.v === c.op) ? c.op : okOps[0].v })
                                  }}>
                                  <option value="first">第一行</option>
                                  <option value="any">任意一行</option>
                                </select>
                              </>
                            )}
                            <select className="input input--sm" value={c.op} onChange={e => setCond(gi, ci, { op: e.target.value })}>
                              {ops.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
                            </select>
                            {!noValue(c.op) && (c.target === 'truncated' ? (
                              <select className="input input--sm" value={c.value} onChange={e => setCond(gi, ci, { value: e.target.value })}>
                                <option value="true">是</option>
                                <option value="false">否</option>
                              </select>
                            ) : (
                              <input className={'input input--sm' + (showErr && prob ? ' input--bad' : '')} style={{ width: 96 }}
                                value={c.value} placeholder={c.target === 'rowCount' ? '整数' : '值'}
                                onChange={e => setCond(gi, ci, { value: e.target.value })} />
                            ))}
                            <button type="button" className="btn btn--sm btn--ghost" disabled={g.conds.length <= 1}
                              onClick={() => delCond(gi, ci)}>×</button>
                          </div>
                          {showErr && prob && <div className="field-hint" style={{ color: 'var(--danger)', margin: '-2px 0 6px 52px' }}>{prob}</div>}
                          {!prob && c.target === 'col' && c.scope === 'any' && (
                            <div className="field-hint" style={{ margin: '-2px 0 6px 52px' }}>任意一行：有一行满足就算</div>
                          )}
                        </div>
                      )
                    })}
                    <button type="button" className="btn btn--sm" onClick={() => addCond(gi)}>+ 条件内加一条判断</button>
                  </div>
                </div>
              </div>
            ))}
            <button type="button" className="btn btn--sm" style={{ marginTop: 8 }}
              onClick={() => setGroups(gs => [...gs, newIfGroup(first)])}>+ 加一个条件</button>
            {groups.length > 2 && new Set(groups.slice(1).map(g => g.join)).size > 1 && (
              <div className="field-hint" style={{ marginTop: 8 }}>
                条件之间 AND 和 OR 混用时，<b>AND 先算</b>（和 SQL 一样）：A OR B AND C = A OR (B AND C)。
              </div>
            )}
          </div>
        ) : (
          <textarea className="input mono" rows={4} spellCheck={false} value={text}
            placeholder="如 $节点.rowCount > 0 and $节点.rows[0].status == 'paid'"
            onChange={e => { setText(e.target.value); setParseNote('') }} />
        )}

        {parseNote && <div className="notice" style={{ marginTop: 10 }}>{parseNote}</div>}

        {nodes.length > 0 && (
          <div className="field-row" style={{ marginTop: 12, marginBottom: 0 }}>
            <label className="field-label">
              {mode === 'visual' ? '生成的表达式' : '写法'}
              {mode === 'visual' && <span className="faint" style={{ fontWeight: 400 }}>（{groups.flatMap(g => g.conds).map(c => labelOf(c.node)).filter((x, i, a) => a.indexOf(x) === i).join('、')}）</span>}
            </label>
            {mode === 'visual'
              ? <pre className="code" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{expr}</pre>
              : <div className="field-hint">判断写成 <span className="mono">$节点.rowCount &gt; 0</span>、<span className="mono">$节点.rows[0].字段 == '值'</span>、<span className="mono">$节点.rows[*].字段 包含 '值'</span>，之间用 and / or / 括号连。</div>}
            <div className="field-hint">判定为<b>真</b> → 继续往下走；为<b>假</b> → 结束整个 SQL 流。</div>
          </div>
        )}

        {showErr && (hasProblem || !expr) && (
          <div className="notice notice--err" style={{ marginTop: 10 }}>{hasProblem ? '有判断没填完（标红的），填好或删掉再保存。' : '条件不能为空。'}</div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="btn" onClick={onCancel}>取消</button>
          <button className="btn btn--primary" disabled={nodes.length === 0} onClick={save}>保存</button>
        </div>
      </div>
    </div>
  )
}
