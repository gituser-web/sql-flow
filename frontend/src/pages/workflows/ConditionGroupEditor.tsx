import { useState } from 'react'
import VarPickerDialog from './VarPickerDialog'
import type { CondVar } from './ConditionDialog'
import { OPS, condSql, groupSql, newCond, newGroup, noValue, type Cond, type Group } from './queryTypes'

interface EditGroup extends Group { collapsed: boolean }

/**
 * 条件编辑页 —— 独立弹窗（查看页点「编辑条件」进来）。
 * 一个「条件」= 一组判断；里面可以多条（选 AND/OR），条件之间也可以选 AND/OR。
 * 每个条件有**稳定 id**（c1 / c2…），日志里就靠它对应。
 * 每个条件可**折叠**，免得条件一多占满屏。
 *
 * 值可以是字面量，也可以是**前面层节点的输出**（点「选引用」，或直接在值里打 `$`）。
 */
export default function ConditionGroupEditor({ groups, cols, vars, onSave, onCancel }: {
  groups: Group[]
  cols: string[]
  vars: CondVar[]
  onSave: (groups: Group[]) => void
  onCancel: () => void
}) {
  const [gs, setGs] = useState<EditGroup[]>(() =>
    (groups.length ? groups : [newGroup([])]).map((g, i) => ({
      ...g,
      conds: g.conds.length ? g.conds : [newCond()],
      collapsed: i > 0,   // 第一个条件展开，其余默认收起
    })))
  /** 哪个值输入框正在「选引用」 */
  const [pickFor, setPickFor] = useState<{ gi: number; ci: number } | null>(null)

  const patch = (gi: number, p: Partial<EditGroup>) =>
    setGs(x => x.map((g, i) => (i === gi ? { ...g, ...p } : g)))
  const setCond = (gi: number, ci: number, p: Partial<Cond>) =>
    setGs(x => x.map((g, i) => i === gi
      ? { ...g, conds: g.conds.map((c, k) => (k === ci ? { ...c, ...p } : c)) } : g))
  const addCond = (gi: number) =>
    setGs(x => x.map((g, i) => (i === gi ? { ...g, conds: [...g.conds, newCond()] } : g)))
  const delCond = (gi: number, ci: number) =>
    setGs(x => x.map((g, i) => (i === gi ? { ...g, conds: g.conds.filter((_, k) => k !== ci) } : g)))
  const addGroup = () => setGs(x => [...x, { ...newGroup(x), collapsed: false }])
  const delGroup = (gi: number) => setGs(x => x.filter((_, i) => i !== gi))

  return (
    <div className="modal-overlay" style={{ zIndex: 800 }} onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="modal cge" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">编辑条件</span>
          <span className="faint" style={{ marginLeft: 8 }}>条件内选 AND/OR，条件之间也选 AND/OR</span>
          <div className="spacer" />
          <button className="btn btn--sm btn--ghost" onClick={onCancel}>关闭</button>
        </div>

        <div className="cge-body-scroll">
          {gs.map((g, gi) => (
            <div className="cge-wrap" key={g.id}>
              {gi > 0 && (
                <div className="cge-join">
                  <select className="input input--sm" style={{ width: 76 }} value={g.join}
                    onChange={e => patch(gi, { join: e.target.value as 'and' | 'or' })}>
                    <option value="and">AND</option>
                    <option value="or">OR</option>
                  </select>
                  <span className="faint">与上一个条件的关系</span>
                </div>
              )}

              <div className="cge-group">
                <div className="cge-head" onClick={() => patch(gi, { collapsed: !g.collapsed })}>
                  <span className="cge-caret">{g.collapsed ? '▸' : '▾'}</span>
                  <span className="cge-title">条件 {gi + 1}</span>
                  <span className="cge-id mono" title="稳定标识：增删条件也不会变，日志里用它对应">{g.id}</span>
                  <select className="input input--sm" value={g.mode}
                    onClick={e => e.stopPropagation()}
                    onChange={e => patch(gi, { mode: e.target.value as 'and' | 'or' })}>
                    <option value="and">里面全部满足 AND</option>
                    <option value="or">里面满足任一 OR</option>
                  </select>
                  {g.collapsed && (
                    <span className="cge-summary mono">{groupSql(g) || '（还没填）'}</span>
                  )}
                  <div className="spacer" />
                  {gs.length > 1 && (
                    <button type="button" className="btn btn--sm btn--ghost"
                      onClick={e => { e.stopPropagation(); delGroup(gi) }}>删掉这个条件</button>
                  )}
                </div>

                {!g.collapsed && (
                  <div className="cge-group-body">
                    {g.conds.map((c, ci) => (
                      <div className="vq-cond" key={ci}>
                        {ci > 0
                          ? <span className="vq-inline-join">{g.mode === 'and' ? 'AND' : 'OR'}</span>
                          : <span className="vq-inline-join vq-inline-join--first" />}
                        <select className="input input--sm" value={c.field}
                          onChange={e => setCond(gi, ci, { field: e.target.value })}>
                          <option value="">— 字段 —</option>
                          {cols.map(x => <option key={x} value={x}>{x}</option>)}
                        </select>
                        <select className="input input--sm" value={c.op}
                          onChange={e => setCond(gi, ci, { op: e.target.value })}>
                          {OPS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
                        </select>
                        {!noValue(c.op) && (
                          <>
                            <input className="input input--sm" style={{ width: 150 }} value={c.value}
                              placeholder={(c.op === 'in' || c.op === 'not in') ? '$main.rows[*].id' : '值'}
                              onChange={e => setCond(gi, ci, { value: e.target.value })} />
                            <button type="button" className="btn btn--sm btn--ghost"
                              title="选一个前面层节点的输出当值"
                              onClick={() => setPickFor({ gi, ci })}>选引用</button>
                          </>
                        )}
                        <button type="button" className="btn btn--sm btn--ghost"
                          disabled={g.conds.length <= 1}
                          onClick={() => delCond(gi, ci)}>×</button>
                      </div>
                    ))}
                    <button type="button" className="btn btn--sm" onClick={() => addCond(gi)}>+ 条件内加一条判断</button>
                  </div>
                )}
              </div>
            </div>
          ))}

          <button type="button" className="btn btn--sm" style={{ marginTop: 8 }} onClick={addGroup}>
            + 加一个条件
          </button>

          <div className="field-hint" style={{ marginTop: 10 }}>
            值可以直接填字面量，也可以引用前面层节点的输出：点「选引用」，或直接在值里打 <span className="mono">$</span>。
            引用列表要用 <span className="mono">在…里（IN）</span> 或 <span className="mono">不在…里（NOT IN）</span>，例如 <span className="mono">order_id in ($main.rows[*].id)</span>。
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button className="btn" onClick={onCancel}>取消</button>
          <button className="btn btn--primary"
            onClick={() => onSave(gs.map(({ collapsed: _c, ...g }) => g))}>保存条件</button>
        </div>

        {pickFor && (
          <VarPickerDialog
            vars={vars}
            bare
            onPick={t => { setCond(pickFor.gi, pickFor.ci, { value: t }); setPickFor(null) }}
            onClose={() => setPickFor(null)}
          />
        )}
      </div>
    </div>
  )
}
