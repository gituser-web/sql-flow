import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { getTables, probeColumns } from '../../api/client'
import type { CondVar } from './ConditionDialog'

/*
 * SQL 输入框 + 提示。三种：
 * 一、SQL 关键字：不用 /，敲满 2 个字母按前缀提示（见 keywordToken）。
 * 二、「//」分两步：先列输入参数（选了插 `#{名字}`）和前面能引用的 SQL 节点；
 *    选了节点就插 `$节点.`，菜单接着换成**这个节点**的输出字段（见 fieldToken）
 *    → 插 `$节点.rows[0].列`；紧跟在 `in (` 后面插 `$节点.rows[*].列` 取整列。
 *    节点多、字段多也只探选中的那一个节点。
 * 三、「/」：/ 后面继续敲字就是搜索；提示什么看 / 在哪（见 contextAt）：
 *   空框敲 /        → 表；选了插 `select * from 表 where 1=1 limit 1`
 *   from / join 后  → 只有表；选了插表名
 *   其余位置        → 只有 SQL 里已引用的表（from/join）的字段；选了插字段名
 * 表多也不怕：表列表每个数据源只拉一次（show tables 很便宜）；字段**只探 SQL 里用到的表**，
 * 用 `where 1=0` 拿元数据，不扫数据。列表最多显示 50 条，其余靠搜索。
 */

const tablesCache = new Map<number, Promise<string[]>>()
const colsCache = new Map<string, Promise<string[]>>()

function loadTables(ds: number) {
  let p = tablesCache.get(ds)
  if (!p) {
    p = getTables(ds).then(r => r.tables)
    p.catch(() => tablesCache.delete(ds))   // 失败了下次再试
    tablesCache.set(ds, p)
  }
  return p
}

function loadCols(ds: number, table: string) {
  const key = `${ds}:${table}`
  let p = colsCache.get(key)
  if (!p) {
    p = probeColumns(ds, `select * from ${table}`).then(r => (r.error ? [] : r.columns))
    p.catch(() => colsCache.delete(key))
    colsCache.set(key, p)
  }
  return p
}

/**
 * SQL 里已经引用的表（只认数据源里真有的）：
 *   `from a`、`from a x, b y`（逗号连表）、`join c`、`db.a`、带反引号的都认
 */
function referencedTables(sql: string, tables: string[]) {
  const byLower = new Map(tables.map(t => [t.toLowerCase(), t]))
  const out: string[] = []
  const add = (raw: string) => {
    const name = raw.replace(/[`"]/g, '').split('.').pop()!.toLowerCase()
    const t = byLower.get(name)
    if (t && !out.includes(t)) out.push(t)
  }
  // from 后面到下一个子句关键字为止是表列表，按逗号拆，每段第一个词是表名
  for (const m of sql.matchAll(/\bfrom\s+([\s\S]*?)(?=\b(?:where|join|left|right|inner|outer|cross|on|group|order|having|limit|union)\b|\)|;|$)/gi)) {
    for (const part of m[1].split(',')) {
      const w = part.trim().match(/^[`"\w.]+/)
      if (w) add(w[0])
    }
  }
  for (const m of sql.matchAll(/\bjoin\s+([`"\w.]+)/gi)) add(m[1])
  return out
}

/** 节点 SQL → 输出列（同一段 SQL 只探一次） */
const outColsCache = new Map<string, Promise<string[]>>()
function loadOutCols(ds: number, sql: string) {
  const key = `${ds}:${sql}`
  let p = outColsCache.get(key)
  if (!p) {
    p = probeColumns(ds, sql).then(r => { if (r.error) throw new Error(r.error); return r.columns })
    p.catch(() => outColsCache.delete(key))
    outColsCache.set(key, p)
  }
  return p
}

/**
 * 光标前是不是一个「/搜索词」或「//搜索词」；是就返回起点和搜索词。
 * 中文输入法下 / 键打出来是「、」，**两个都认**（选中时整段换掉，「、」不会留在 SQL 里）。
 */
const SLASH = /[/、]/
function slashToken(text: string, caret: number) {
  const before = text.slice(0, caret)
  const at = Math.max(before.lastIndexOf('/'), before.lastIndexOf('、'))
  if (at < 0) return null
  const q = before.slice(at + 1)
  // 只认表名/字段名能有的字符：敲 `/*` 写注释时不弹
  if (!/^[\w.$]*$/.test(q)) return null
  const dbl = at > 0 && SLASH.test(before[at - 1])
  const start = dbl ? at - 1 : at
  // 前面得是开头或分隔符，`a/b` 这种除法不弹
  if (start > 0 && !/[\s(,=]/.test(before[start - 1])) return null
  return { kind: dbl ? 'var' as const : 'slash' as const, at: start, q }
}

/*
 * SQL 关键字提示：不用敲 /，连着敲满 2 个字母就按前缀提示，不分大小写。
 * 只放在 SQL 编辑框里 —— 以后别的数据源（ES 之类）不是 SQL，不能共用这份。
 */
const SQL_KEYWORDS = [
  'select', 'from', 'where', 'and', 'or', 'not', 'in', 'like', 'between', 'is null', 'is not null',
  'as', 'distinct', 'join', 'left join', 'right join', 'inner join', 'on',
  'group by', 'order by', 'having', 'limit', 'offset', 'asc', 'desc',
  'union', 'union all', 'case', 'when', 'then', 'else', 'end', 'exists', 'null', 'with',
]

/** 光标前是不是在敲一个关键字；是就返回词的起点和已敲的部分 */
function keywordToken(text: string, caret: number) {
  const before = text.slice(0, caret)
  const m = before.match(/[A-Za-z]{2,}$/)
  if (!m) return null
  const at = caret - m[0].length
  // 词得是独立的：`$prev.rows`、`#{id}`、`a_b`、`/xx` 里的不算
  if (at > 0 && /[\w$.#{`"'/]/.test(before[at - 1])) return null
  // 字符串和 -- 注释里不提示
  if ((before.match(/'/g)?.length ?? 0) % 2 === 1) return null
  if (before.slice(before.lastIndexOf('\n') + 1).includes('--')) return null
  const lq = m[0].toLowerCase()
  // 已经敲全了一个关键字（or / in / as…）就不弹，免得把回车吃掉
  if (SQL_KEYWORDS.includes(lq)) return null
  if (!SQL_KEYWORDS.some(k => k.startsWith(lq))) return null
  return { kind: 'kw' as const, at, q: m[0] }
}

/**
 * 「//」第二步：选了节点后框里是 `$节点.`，接着弹这个节点的输出字段。
 * node = 节点名；at = $ 的位置（选字段时把 `$节点.搜索词` 整段换掉）
 */
function fieldToken(text: string, caret: number, nodeNames: string[]) {
  const m = text.slice(0, caret).match(/\$(\w+)\.(\w*)$/)
  if (!m || !nodeNames.includes(m[1])) return null
  return { kind: 'field' as const, at: caret - m[0].length, q: m[2], node: m[1] }
}

type Token = { kind: 'slash' | 'var' | 'field' | 'kw'; at: number; q: string; node?: string }

/**
 * / 所在位置要的是什么：
 *   start = 框里前面什么都没有 → 提示表，选了插整句模板
 *   table = 前一个子句关键字是 from / join / update / into（`from a, /` 也算）→ 只提示表，插表名
 *   column = 其余（select 列表、where、on、order by…）→ 只给已引用表的字段
 */
type Ctx = 'start' | 'table' | 'column'
const CLAUSE_KW = /\b(select|from|join|where|on|and|or|by|having|set|into|update|limit|values|union)\b/gi
function contextAt(text: string, at: number): Ctx {
  const before = text.slice(0, at)
  if (!before.trim()) return 'start'
  let last = ''
  for (const m of before.matchAll(CLAUSE_KW)) last = m[1].toLowerCase()
  return ['from', 'join', 'update', 'into'].includes(last) ? 'table' : 'column'
}

/** text = 列表里显示的；insert = 真插进去的（不给就是 text）；table = 右边灰字（表名 / 节点名） */
type Item = { kind: 'col' | 'table' | 'kw' | 'input' | 'out'; text: string; insert?: string; table?: string }
const KIND_LABEL = { col: '字段', table: '表', kw: '关键字', input: '参数', out: '节点' }
const LIMIT = 50

function filterSort(list: string[], q: string) {
  const lq = q.toLowerCase()
  const hit = list.filter(s => s.toLowerCase().includes(lq))
  return hit.sort((a, b) => Number(!a.toLowerCase().startsWith(lq)) - Number(!b.toLowerCase().startsWith(lq)))
}

type Props = {
  value: string
  onChange: (v: string) => void
  dataSourceId: number | null
  /** 「//」提示用：输入参数 + 前面能引用的 SQL 节点 */
  vars?: CondVar[]
  /** 所在层是并行、且同层前面还有节点 —— 「//」里提示一句为什么同层的引用不到 */
  parallelSiblings?: boolean
  className?: string
  rows?: number
  placeholder?: string
}

const SqlEditor = forwardRef<HTMLTextAreaElement, Props>(function SqlEditor(
  { value, onChange, dataSourceId, vars = [], parallelSiblings = false, className, rows, placeholder }, ref,
) {
  const el = useRef<HTMLTextAreaElement>(null)
  useImperativeHandle(ref, () => el.current!, [])

  const [token, setToken] = useState<Token | null>(null)
  /** 按了 Esc 的那个词 / 那个 /（kind:at），别再弹 */
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [tables, setTables] = useState<string[] | null>(null)
  const [tablesErr, setTablesErr] = useState('')
  const [cols, setCols] = useState<{ table: string; cols: string[] }[]>([])
  const [active, setActive] = useState(0)

  const tokenKey = token ? `${token.kind}:${token.at}` : null
  const open = token != null && tokenKey !== dismissed
  const slashOpen = open && token.kind === 'slash'

  // 「//」第二步：选中节点的输出列
  const nodeVars = vars.filter(v => !v.isInput)
  const fieldVar = open && token.kind === 'field' ? nodeVars.find(v => v.name === token.node) ?? null : null
  const [outCols, setOutCols] = useState<{ key: string; cols: string[] | null; err: string }>({ key: '', cols: null, err: '' })
  const outKey = fieldVar ? `${fieldVar.dataSourceId}:${fieldVar.sqlTemplate}` : ''
  useEffect(() => {
    if (!fieldVar || fieldVar.dataSourceId == null || !fieldVar.sqlTemplate.trim()) return
    let alive = true
    const key = outKey
    setOutCols({ key, cols: null, err: '' })
    loadOutCols(fieldVar.dataSourceId, fieldVar.sqlTemplate)
      .then(c => { if (alive) setOutCols({ key, cols: c, err: '' }) })
      .catch(e => { if (alive) setOutCols({ key, cols: [], err: (e as Error).message || '探列失败' }) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outKey])

  // 「/」菜单打开时才拉表（敲关键字不用表）
  useEffect(() => {
    if (!slashOpen || dataSourceId == null) return
    let alive = true
    setTablesErr('')
    loadTables(dataSourceId)
      .then(t => { if (alive) setTables(t) })
      .catch(e => { if (alive) { setTables([]); setTablesErr((e as Error).message || '读表失败') } })
    return () => { alive = false }
  }, [slashOpen, dataSourceId])

  // 字段：只探 SQL 里引用到的表
  const refTables = slashOpen && tables ? referencedTables(value, tables) : []
  const refKey = refTables.join(',')
  useEffect(() => {
    if (!slashOpen || dataSourceId == null || !refKey) { setCols([]); return }
    let alive = true
    Promise.all(refKey.split(',').map(t => loadCols(dataSourceId, t).then(c => ({ table: t, cols: c })).catch(() => ({ table: t, cols: [] }))))
      .then(r => { if (alive) setCols(r) })
    return () => { alive = false }
  }, [slashOpen, dataSourceId, refKey])

  // 每次换数据源，丢掉本组件的旧表
  useEffect(() => { setTables(null); setCols([]) }, [dataSourceId])

  const q = token?.q ?? ''
  const ctx: Ctx = token ? contextAt(value, token.at) : 'start'
  let items: Item[] = []
  let more = 0
  if (token?.kind === 'kw') {
    // 只按前缀；敲的是大写就插大写
    const upper = q === q.toUpperCase()
    items = SQL_KEYWORDS.filter(k => k.startsWith(q.toLowerCase()))
      .map(k => ({ kind: 'kw' as const, text: upper ? k.toUpperCase() : k }))
  } else if (token?.kind === 'var') {
    // 第一步：输入参数（选了直接插）+ 节点（选了插 `$节点.`，接着弹字段）
    const lq = q.toLowerCase()
    const hit = (s: string) => s.toLowerCase().includes(lq)
    items = [
      ...vars.filter(v => v.isInput && hit(v.name)).map(v => ({ kind: 'input' as const, text: v.name, insert: `#{${v.name}}` })),
      // 节点显示人起的名字（没填才显示变量名）；搜索两个都认
      ...nodeVars.filter(v => hit(v.name) || (!!v.label && hit(v.label)))
        .map(v => ({ kind: 'out' as const, text: v.label || v.name, insert: `$${v.name}.`, table: `第 ${v.layerNo} 层` })),
    ]
  } else if (token?.kind === 'field' && fieldVar) {
    // 第二步：这个节点的输出列。紧跟在 `in (` 后面取整列，其余取第一行
    const all = /\bin\s*\(\s*$/i.test(value.slice(0, token.at))
    const ready = outCols.key === outKey ? outCols.cols ?? [] : []
    items = [
      ...filterSort(ready, q).map(c => ({
        kind: 'col' as const, text: c, insert: `$${fieldVar.name}.rows[${all ? '*' : 0}].${c}`, table: all ? '整列' : '第 1 行',
      })),
      ...('rowcount'.includes(q.toLowerCase()) ? [{ kind: 'out' as const, text: 'rowCount', insert: `$${fieldVar.name}.rowCount`, table: '行数' }] : []),
    ]
  } else if (token) {
    const colItems: Item[] = ctx !== 'column' ? [] : cols.flatMap(g => filterSort(g.cols, q).map(c => ({ kind: 'col' as const, text: c, table: g.table })))
    // 字段位置只给已引用表的字段，不列表
    const tableHits = ctx === 'column' ? [] : filterSort(tables ?? [], q)
    items = [...colItems, ...tableHits.map(t => ({ kind: 'table' as const, text: t }))].slice(0, LIMIT)
    more = colItems.length + tableHits.length - items.length
  }
  // 关键字没匹配就整个不显示；「/」「//」没匹配要显示原因
  const showMenu = open && (token.kind !== 'kw' || items.length > 0)

  useEffect(() => { setActive(0) }, [q, tokenKey])

  function detect(text: string, caret: number): Token | null {
    return fieldToken(text, caret, nodeVars.map(v => v.name)) ?? slashToken(text, caret) ?? keywordToken(text, caret)
  }

  function sync(target: HTMLTextAreaElement) {
    const t = detect(target.value, target.selectionStart ?? 0)
    setToken(t)
    if (!t || `${t.kind}:${t.at}` !== dismissed) setDismissed(null)
  }

  function pick(it: Item) {
    const node = el.current
    if (!node || !token) return
    let insert = it.insert ?? (it.kind === 'table' && ctx === 'start' ? `select * from ${it.text} where 1=1 limit 1` : it.text)
    const caret = node.selectionStart ?? value.length
    // 关键字后面带个空格，接着就能写
    if (it.kind === 'kw' && !/^\s/.test(value.slice(caret))) insert += ' '
    const next = value.slice(0, token.at) + insert + value.slice(caret)
    onChange(next)
    const p = token.at + insert.length
    // 选了节点（插的是 `$节点.`）→ 菜单不关，直接换成这个节点的字段
    setToken(insert.endsWith('.') ? detect(next, p) : null)
    requestAnimationFrame(() => { node.focus(); node.setSelectionRange(p, p) })
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // 输入法还在组字（候选框开着）时，回车/方向键是给输入法的
    if (!showMenu || e.nativeEvent.isComposing) return
    if (e.key === 'Escape') { e.preventDefault(); setDismissed(tokenKey); return }
    if (items.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => (a + 1) % items.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => (a - 1 + items.length) % items.length) }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(items[active]) }
  }

  return (
    <div className="sql-editor">
      <textarea
        ref={el}
        className={className}
        rows={rows}
        spellCheck={false}
        value={value}
        placeholder={placeholder}
        onChange={e => { onChange(e.target.value); sync(e.target) }}
        onKeyDown={onKeyDown}
        onKeyUp={e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) sync(e.currentTarget) }}
        onClick={e => sync(e.currentTarget)}
        onBlur={() => setToken(null)}
      />
      {showMenu && (
        <div className="slash-menu" role="listbox">
          {slashOpen && dataSourceId == null && <div className="slash-note">先选数据源，才能提示表和字段。</div>}
          {slashOpen && dataSourceId != null && tables == null && !tablesErr && <div className="slash-note">读表中…</div>}
          {slashOpen && tablesErr && <div className="slash-note slash-note--err">{tablesErr}</div>}
          {slashOpen && tables != null && !tablesErr && items.length === 0 && (
            <div className="slash-note">
              {ctx !== 'column' ? `没有匹配「${q}」的表`
                : refTables.length === 0 ? '先在 from 后面写上表名，这里才能提示它的字段'
                : cols.length === 0 ? '读字段中…'
                : `${refTables.join('、')} 里没有匹配「${q}」的字段`}
            </div>
          )}
          {token.kind === 'var' && items.length === 0 && (
            <div className="slash-note">{vars.length === 0 ? '没有输入参数，前面也没有能引用的 SQL 节点' : `没有匹配「${q}」的参数或节点`}</div>
          )}
          {token.kind === 'var' && items.length > 0 && <div className="slash-note slash-note--head">先选参数，或选节点再选它的输出字段</div>}
          {token.kind === 'var' && parallelSiblings && (
            <div className="slash-note slash-note--head">这一层是「并行」：同层节点同时跑，互相引用不到。要引用同层前面的节点，把这层改成「串行」。</div>
          )}
          {token.kind === 'field' && fieldVar && (
            fieldVar.dataSourceId == null || !fieldVar.sqlTemplate.trim()
              ? <div className="slash-note">{fieldVar.label || fieldVar.name} 还没选数据源或没写 SQL，读不出输出字段</div>
              : outCols.key !== outKey || outCols.cols == null
                ? <div className="slash-note">读 {fieldVar.label || fieldVar.name} 的输出字段…</div>
                : outCols.err
                  ? <div className="slash-note slash-note--err">{outCols.err}</div>
                  : <div className="slash-note slash-note--head">{fieldVar.label || fieldVar.name} 的输出字段</div>
          )}
          {items.map((it, i) => (
            <div
              key={it.kind + (it.table ?? '') + it.text}
              role="option"
              aria-selected={i === active}
              className={'slash-item' + (i === active ? ' slash-item--on' : '')}
              onMouseDown={e => { e.preventDefault(); pick(it) }}
              onMouseEnter={() => setActive(i)}
            >
              <span className={'slash-kind slash-kind--' + it.kind}>{KIND_LABEL[it.kind]}</span>
              <span className="mono slash-text">{it.text}</span>
              {it.table && <span className="slash-sub mono">{it.table}</span>}
            </div>
          ))}
          {more > 0 && <div className="slash-note">还有 {more} 个，继续输入过滤</div>}
          {(!slashOpen || dataSourceId != null) && <div className="slash-foot">↑↓ 选择 · Enter 插入 · Esc 关闭</div>}
        </div>
      )}
    </div>
  )
})

export default SqlEditor
