import type { InputParam } from '../../api/types'
import { INPUT_TYPES, inputError } from './inputsUtil'

/**
 * 输入参数**内联表格**（照 tianzhi 的「运行设置」那段）：直接摆在编辑页上，
 * 一行一个参数，能加能删。不再藏进弹窗里。
 *
 * SQL 里用 {@code #{参数名}} 引用（MyBatis 风格的绑定参数，值走 `?` 绑定，不拼字符串）。
 */
export default function InputsTable({ rows, nodeNames = [], onChange }: {
  rows: InputParam[]
  /** 已有的节点名 —— 参数名不能和它们重名（两者在 SQL 里都用 $名字） */
  nodeNames?: string[]
  onChange: (rows: InputParam[]) => void
}) {
  const err = inputError(rows, nodeNames)
  const patch = (i: number, p: Partial<InputParam>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)))

  return (
    <div>
      {rows.length === 0 ? (
        <div className="field-hint" style={{ marginBottom: 8 }}>
          还没有输入参数。运行时调用方要填什么，就在这里声明；SQL 里用 <span className="mono">#&#123;参数名&#125;</span> 引用。
        </div>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>名字</th>
              <th style={{ width: 150 }}>类型</th>
              <th style={{ width: 70 }}>必填</th>
              <th style={{ width: 150 }}>默认值</th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>
                  <input className="input input--sm mono" style={{ width: '100%' }} value={r.name}
                    placeholder="如 city" onChange={e => patch(i, { name: e.target.value })} />
                </td>
                <td>
                  <select className="input input--sm" style={{ width: '100%' }} value={r.type}
                    onChange={e => patch(i, { type: e.target.value as InputParam['type'] })}>
                    {INPUT_TYPES.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}
                  </select>
                </td>
                <td style={{ textAlign: 'center' }}>
                  <input type="checkbox" checked={!!r.required}
                    onChange={e => patch(i, { required: e.target.checked, defaultValue: e.target.checked ? '' : r.defaultValue })} />
                </td>
                <td>
                  <input className="input input--sm" style={{ width: '100%' }} disabled={r.required}
                    placeholder={r.required ? '必填不用填' : '默认值'}
                    value={r.defaultValue ?? ''} onChange={e => patch(i, { defaultValue: e.target.value })} />
                </td>
                <td>
                  <button type="button" className="btn btn--sm btn--ghost"
                    title="删掉这个参数"
                    onClick={() => onChange(rows.filter((_, j) => j !== i))}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
        <button type="button" className="btn btn--sm"
          onClick={() => onChange([...rows, { name: '', type: 'string', required: true, defaultValue: '' }])}>
          + 加一个
        </button>
        {err && <span className="node-out-err">{err}</span>}
      </div>
    </div>
  )
}
