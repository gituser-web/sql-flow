import { useEffect, useState } from 'react'
import { probeColumns } from '../../api/client'

/**
 * 节点卡上的「输出列」：这个 SQL 跑出来有哪些列（后端探列，`WHERE 1=0` 拿元数据）。
 * 它就是**这个节点对外的接口** —— 写后层时抬头一看就知道能引用什么。
 * SQL 每敲一下不探，停 600ms 才探一次。探不到就把**原因显示出来**（别藏在 tooltip 里）。
 */
export default function NodeOutputColumns({ dataSourceId, sqlTemplate, compact = false }: {
  dataSourceId: number | null
  sqlTemplate: string
  /** compact = 详情页用：一行「返回 a、b、c」，不带大标签和 chip */
  compact?: boolean
}) {
  const [cols, setCols] = useState<string[] | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    setCols(null)
    setErr('')
    if (dataSourceId == null || !sqlTemplate.trim()) return
    let alive = true
    const timer = setTimeout(() => {
      probeColumns(dataSourceId, sqlTemplate)
        .then(r => {
          if (!alive) return
          if (r.error) setErr(r.error)
          else setCols(r.columns)
        })
        .catch(e => { if (alive) setErr((e as Error).message || '探列失败') })
    }, 600)
    return () => { alive = false; clearTimeout(timer) }
  }, [dataSourceId, sqlTemplate])

  if (compact) {
    return (
      <div className="wf-node-meta">
        <span className="wf-node-k">返回</span>
        {cols && cols.length > 0 && <span className="mono wf-node-cols">{cols.join('、')}</span>}
        {cols && cols.length === 0 && <span className="faint">（无）</span>}
        {!cols && !err && <span className="faint">…</span>}
        {err && <span className="faint" title={err}>拿不到</span>}
      </div>
    )
  }

  if (dataSourceId == null) {
    return <div className="node-out"><span className="faint">先选数据源，才能读出它的输出列。</span></div>
  }
  if (!sqlTemplate.trim()) return null

  return (
    <div className="node-out">
      <span className="node-out-label">输出列</span>
      {cols && cols.length > 0 && (
        <div className="cond-chips">
          {cols.map((c, i) => <span key={i} className="out-chip mono">{c}</span>)}
        </div>
      )}
      {cols && cols.length === 0 && <span className="faint">这条 SQL 没有输出列。</span>}
      {!cols && !err && <span className="faint">读取中…</span>}
      {err && <span className="node-out-err" title={err}>拿不到列：{err}</span>}
    </div>
  )
}
