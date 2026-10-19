/**
 * 条件节点（IF）的可视化模型 ↔ 表达式。
 *
 * 表达式语法以后端 ConditionEvaluator 为准（原子判断 + and / or / 括号，and 优先）。
 * 这里只负责：① 把可视化编辑的结果**拼成**表达式；② 把**这里拼出来的那种**表达式读回来。
 * 读不回来的（手写的、旧写法）不硬猜 —— 交给「直接写表达式」，保证不悄悄改掉别人的条件。
 */

export type IfTarget = 'rowCount' | 'truncated' | 'col'
export type IfScope = 'first' | 'any'

/** 一条判断：某个节点的 行数 / 是否截断 / 某个字段 */
export interface IfCond {
  node: string
  target: IfTarget
  col: string
  scope: IfScope
  op: string
  value: string
}

/** 一个「条件」= 一组判断。join = 和**上一个条件**的关系；mode = 组内多条之间的关系 */
export interface IfGroup { mode: 'and' | 'or'; join: 'and' | 'or'; conds: IfCond[] }

export const OPS_COMPARE = [
  { v: '==', label: '等于' },
  { v: '!=', label: '不等于' },
  { v: '>', label: '大于' },
  { v: '>=', label: '大于等于' },
  { v: '<', label: '小于' },
  { v: '<=', label: '小于等于' },
]
/** v 是写进表达式的关键字（规则只认英文），label 只是界面上给人看的 */
const OPS_TEXT = [
  { v: 'contains', label: '包含' },
  { v: 'not contains', label: '不包含' },
  { v: 'is not empty', label: '非空' },
  { v: 'is empty', label: '为空' },
]

/** 每种判断对象能用哪些算子 —— 和后端能求值的一一对应（整列只能 contains / is not empty 这类） */
export function opsFor(c: Pick<IfCond, 'target' | 'scope'>) {
  if (c.target === 'rowCount') return OPS_COMPARE
  if (c.target === 'truncated') return OPS_COMPARE.slice(0, 2)
  return c.scope === 'any' ? OPS_TEXT : [...OPS_COMPARE, ...OPS_TEXT]
}

export const noValue = (op: string) => op === 'is not empty' || op === 'is empty'

export const newIfCond = (node: string): IfCond =>
  ({ node, target: 'rowCount', col: '', scope: 'first', op: '>', value: '0' })

export const newIfGroup = (node: string): IfGroup => ({ mode: 'and', join: 'and', conds: [newIfCond(node)] })

/** 数字原样，其他加单引号（里面的 ' 写成 ''，后端按 SQL 习惯认） */
function lit(v: string): string {
  const t = v.trim()
  if (/^-?\d+(\.\d+)?$/.test(t)) return t
  return "'" + t.replace(/'/g, "''") + "'"
}

/** 这条还没填完 → 返回原因（保存时拦，不悄悄丢掉） */
export function condProblem(c: IfCond): string {
  if (!c.node) return '没选节点'
  if (c.target === 'col' && !c.col) return '没选字段'
  if (!opsFor(c).some(o => o.v === c.op)) return '这个判断对象不能用这个条件'
  if (noValue(c.op)) return ''
  if (!c.value.trim()) return '没填值'
  if (c.target === 'rowCount' && !/^\d+$/.test(c.value.trim())) return '行数要填整数'
  return ''
}

export function condExpr(c: IfCond): string {
  const left = c.target === 'rowCount' ? `$${c.node}.rowCount`
    : c.target === 'truncated' ? `$${c.node}.truncated`
    : `$${c.node}.rows[${c.scope === 'any' ? '*' : 0}].${c.col}`
  if (noValue(c.op)) return `${left} ${c.op}`
  const right = c.target === 'truncated' ? (c.value === 'true' ? 'true' : 'false')
    : c.target === 'rowCount' ? c.value.trim()
    : lit(c.value)
  return `${left} ${c.op} ${right}`
}

function groupExpr(g: IfGroup): string {
  const cs = g.conds.map(condExpr)
  return cs.length === 1 ? cs[0] : `(${cs.join(` ${g.mode} `)})`
}

export function buildIfExpr(groups: IfGroup[]): string {
  return groups.map((g, i) => (i === 0 ? groupExpr(g) : `${g.join} ${groupExpr(g)}`)).join(' ')
}

// ── 读回来 ────────────────────────────────────────────────

/** 顶层（不在括号/引号里）按 and / or 切；返回片段和片段之间的连接词 */
function splitTop(s: string): { parts: string[]; joins: ('and' | 'or')[] } | null {
  const parts: string[] = []
  const joins: ('and' | 'or')[] = []
  let depth = 0, start = 0, quote = ''
  const boundary = (ch: string | undefined) => ch === undefined || /[\s()]/.test(ch)
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quote) {
      if (ch === quote) { if (s[i + 1] === quote) { i++; continue } quote = '' }
      continue
    }
    if (ch === "'" || ch === '"') { quote = ch; continue }
    if (ch === '(') { depth++; continue }
    if (ch === ')') { if (--depth < 0) return null; continue }
    if (depth !== 0) continue
    for (const kw of ['and', 'or'] as const) {
      if (s.slice(i, i + kw.length).toLowerCase() === kw && boundary(s[i - 1]) && boundary(s[i + kw.length])) {
        parts.push(s.slice(start, i).trim()); joins.push(kw)
        start = i + kw.length; i += kw.length - 1
        break
      }
    }
  }
  if (quote || depth !== 0) return null
  parts.push(s.slice(start).trim())
  return parts.every(p => p) ? { parts, joins } : null
}

/** 关键字不分大小写（和后端一致），但字段名 / rowCount 这些要区分大小写，所以只给关键字做大小写无关 */
const ci = (w: string) => w.replace(/[a-z]/g, ch => `[${ch}${ch.toUpperCase()}]`)
const KW_OPS = [`${ci('not')}\\s+${ci('contains')}`, ci('contains'), `${ci('is')}\\s+${ci('not')}\\s+${ci('empty')}`, `${ci('is')}\\s+${ci('empty')}`]
const ATOM = new RegExp(
  String.raw`^\$([A-Za-z_][A-Za-z0-9_]*)\.(rowCount|truncated|rows\[(0|\*)\]\.([A-Za-z_][A-Za-z0-9_]*))\s*` +
  `(==|!=|>=|<=|>|<|(?:${KW_OPS.join('|')})(?![A-Za-z0-9_]))\\s*(.*)$`)

function parseAtom(s: string, nodes: string[]): IfCond | null {
  const m = ATOM.exec(s.trim())
  if (!m || !nodes.includes(m[1])) return null
  const [, node, what, idx, col, rawOp, rest] = m
  const op = rawOp.toLowerCase().replace(/\s+/g, ' ')   // 关键字不分大小写，统一成编辑器用的写法
  const target: IfTarget = what === 'rowCount' ? 'rowCount' : what === 'truncated' ? 'truncated' : 'col'
  const c: IfCond = { node, target, col: col ?? '', scope: idx === '*' ? 'any' : 'first', op, value: '' }
  if (!opsFor(c).some(o => o.v === op)) return null
  const r = rest.trim()
  if (noValue(op)) return r ? null : c
  if (/^-?\d+(\.\d+)?$/.test(r)) c.value = r
  else if (/^'(?:[^']|'')*'$/.test(r)) c.value = r.slice(1, -1).replace(/''/g, "'")
  else if (target === 'truncated' && (r === 'true' || r === 'false')) c.value = r
  else return null   // 裸词等手写形式：不猜
  if (target === 'rowCount' && !/^\d+$/.test(c.value)) return null
  return c
}

/**
 * 表达式 → 可视化分组；读不了返回 null（交给「直接写表达式」）。
 * 只认 buildIfExpr 拼得出的形状：顶层若干组、组是单条或一层括号、组内连接词一致。
 */
export function parseIfExpr(expr: string, nodes: string[]): IfGroup[] | null {
  const top = splitTop(expr.trim())
  if (!top) return null
  const groups: IfGroup[] = []
  for (let gi = 0; gi < top.parts.length; gi++) {
    const p = top.parts[gi]
    const join = gi === 0 ? 'and' : top.joins[gi - 1]
    if (p.startsWith('(') && p.endsWith(')')) {
      const inner = splitTop(p.slice(1, -1).trim())
      if (!inner || inner.parts.length < 2 || new Set(inner.joins).size !== 1) return null
      const conds = inner.parts.map(x => parseAtom(x, nodes))
      if (conds.some(c => !c)) return null
      groups.push({ mode: inner.joins[0], join, conds: conds as IfCond[] })
    } else {
      const c = parseAtom(p, nodes)
      if (!c) return null
      groups.push({ mode: 'and', join, conds: [c] })
    }
  }
  return groups
}
