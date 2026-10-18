import { useEffect, useState } from 'react'
import { probeColumns } from '../../api/client'

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

/** 单值引用能配的算子 */
const OPS_FIRST = [
  { v: '==', label: '等于' },
  { v: '!=', label: '不等于' },
  { v: '>', label: '大于' },
  { v: '>=', label: '大于等于' },
  { v: '<', label: '小于' },
  { v: '<=', label: '小于等于' },
  { v: '包含', label: '包含' },
  { v: '不包含', label: '不包含' },
  { v: '非空', label: '非空' },
  { v: '为空', label: '为空' },
]
/** 整列（rows[*]）只能配这几个 —— 后端对 list 只支持非空/包含，标量比较会直接报错 */
const OPS_ANY = [
  { v: '包含', label: '包含' },
  { v: '不包含', label: '不包含' },
  { v: '非空', label: '非空' },
  { v: '为空', label: '为空' },
]

function quote(v: string): string {
  const t = v.trim()
  if (/^-?\d+(\.\d+)?$/.test(t)) return t
  return "'" + t.replace(/'/g, "''") + "'"
}

interface Builder { nodeName: string; field: string; scope: 'first' | 'any'; op: string; val: string }

/**
 * 条件节点弹窗。**按"你想问什么"组织**：
 *   ① 结果       有数据 / 没有数据 / 被截断 —— 一键填
 *   ② 按字段     字段 + 条件 + 值 + 范围（第一行 / 任意一行）—— **改哪个都即时填进表达式**
 *   ③ 表达式     上面自动填，也可以直接改
 * 没有"确定"按钮：选完即生效。
 */
export default function ConditionDialog({ initial, vars, onSave, onCancel }: {
  initial: string
  vars: CondVar[]
  onSave: (expr: string) => void
  onCancel: () => void
}) {
  const [expr, setExpr] = useState(initial)
  const [cols, setCols] = useState<Record<string, string[]>>({})
  const [b, setB] = useState<Builder>({
    nodeName: vars[0]?.name ?? '', field: '', scope: 'first', op: '==', val: '',
  })

  useEffect(() => {
    let alive = true
    for (const v of vars) {
      if (v.dataSourceId == null || !v.sqlTemplate.trim()) continue
      probeColumns(v.dataSourceId, v.sqlTemplate)
        .then(r => { if (alive && !r.error) setCols(p => ({ ...p, [v.name]: r.columns })) })
        .catch(() => { /* 探不到就不给字段下拉，仍可手写表达式 */ })
    }
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fieldList = cols[b.nodeName] ?? []
  const effField = fieldList.includes(b.field) ? b.field : (fieldList[0] ?? '')
  const ops = b.scope === 'first' ? OPS_FIRST : OPS_ANY
  const effOp = ops.some(o => o.v === b.op) ? b.op : ops[0].v
  const needsValue = effOp !== '非空' && effOp !== '为空'

  /** 改一项 → 立刻把表达式算出来填进去（值还没填就先不动，等填了再填） */
  function change(patch: Partial<Builder>) {
    const nb = { ...b, ...patch }
    setB(nb)
    const list = cols[nb.nodeName] ?? []
    const f = list.includes(nb.field) ? nb.field : (list[0] ?? '')
    if (!nb.nodeName || !f) return
    const o = (nb.scope === 'first' ? OPS_FIRST : OPS_ANY).some(x => x.v === nb.op) ? nb.op
      : (nb.scope === 'first' ? OPS_FIRST : OPS_ANY)[0].v
    if (o !== '非空' && o !== '为空' && !nb.val.trim()) return   // 等值填了再写
    const ref = nb.scope === 'first' ? `$${nb.nodeName}.rows[0].${f}` : `$${nb.nodeName}.rows[*].${f}`
    setExpr(o === '非空' || o === '为空' ? `${ref} ${o}` : `${ref} ${o} ${quote(nb.val)}`)
  }

  return (
    <div className="modal-overlay" style={{ zIndex: 600 }} onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="modal cond-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">条件节点</span>
          <div className="spacer" />
          <button className="btn btn--sm btn--ghost" onClick={onCancel}>关闭</button>
        </div>

        {vars.length === 0 ? (
          <div className="field-hint">这个条件前面还没有 SQL 节点，没什么可判断的。</div>
        ) : (
          <>
            <div className="cond-sec">
              <div className="cond-sec-head"><span className="cond-sec-no">1</span>结果</div>
              {vars.map(v => (
                <div className="cond-quick" key={v.name}>
                  <span className="mono faint">${v.name}</span>
                  <button type="button" className="cond-chip"
                    onClick={() => setExpr(`$${v.name}.rowCount > 0`)}>有数据</button>
                  <button type="button" className="cond-chip"
                    onClick={() => setExpr(`$${v.name}.rowCount == 0`)}>没有数据</button>
                  <button type="button" className="cond-chip"
                    onClick={() => setExpr(`$${v.name}.truncated == true`)}>被截断</button>
                </div>
              ))}
            </div>

            <div className="cond-sec">
              <div className="cond-sec-head"><span className="cond-sec-no">2</span>按某个字段判断</div>
              <div className="cond-builder">
                <select className="input input--sm" value={b.nodeName}
                  onChange={e => change({ nodeName: e.target.value, field: '' })}>
                  {vars.map(v => <option key={v.name} value={v.name}>${v.name}</option>)}
                </select>
                {fieldList.length > 0 ? (
                  <select className="input input--sm" value={effField}
                    onChange={e => change({ field: e.target.value })}>
                    {fieldList.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                ) : (
                  <span className="faint">（读不到列，可在下面直接写表达式）</span>
                )}
                <select className="input input--sm" value={effOp}
                  onChange={e => change({ op: e.target.value })}>
                  {ops.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
                </select>
                {needsValue && (
                  <input className="input input--sm" style={{ width: 120 }} value={b.val}
                    placeholder="值" onChange={e => change({ val: e.target.value })} />
                )}
              </div>
              <div className="cond-scope">
                范围：
                <label className="cond-listmode">
                  <input type="radio" checked={b.scope === 'first'}
                    onChange={() => change({ scope: 'first' })} /> 第一行
                </label>
                <label className="cond-listmode">
                  <input type="radio" checked={b.scope === 'any'}
                    onChange={() => change({ scope: 'any' })} /> 任意一行（整列）
                </label>
                {b.scope === 'any' && <span className="faint">整列只能判断 非空 / 包含 这类</span>}
              </div>
            </div>

            <div className="cond-sec" style={{ marginBottom: 0 }}>
              <div className="cond-sec-head"><span className="cond-sec-no">3</span>表达式</div>
              <textarea
                className="input mono"
                rows={3}
                spellCheck={false}
                value={expr}
                placeholder="上面选完自动填；也可以直接写，如 $main.rowCount > 0"
                onChange={e => setExpr(e.target.value)}
              />
              <div className="field-hint">
                判定为<b>真</b> → 继续往下走；为<b>假</b> → 结束整个 SQL 流。
              </div>
            </div>
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="btn" onClick={onCancel}>取消</button>
          <button className="btn btn--primary" onClick={() => onSave(expr.trim())}>保存</button>
        </div>
      </div>
    </div>
  )
}
