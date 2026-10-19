/** 可视化查询的条件模型 + SQL 生成（查看页和编辑页共用）。 */

export interface Cond { field: string; op: string; value: string }
/**
 * 一个「条件」（一组判断）。
 * - `id`：**稳定标识**，建的时候生成一次，之后不随增删/换位置变化 —— 日志里就靠它对应。
 * - `join` = 与**上一个条件**的关系（第一个忽略）；`mode` = 组内多条之间的关系。
 */
export interface Group { id: string; mode: 'and' | 'or'; join: 'and' | 'or'; conds: Cond[] }

export const OPS = [
  { v: '=', label: '等于' },
  { v: '!=', label: '不等于' },
  { v: '>', label: '大于' },
  { v: '>=', label: '大于等于' },
  { v: '<', label: '小于' },
  { v: '<=', label: '小于等于' },
  { v: 'like', label: 'LIKE' },
  { v: 'not like', label: 'NOT LIKE' },
  { v: 'in', label: '在…里（IN）' },
  { v: 'not in', label: '不在…里（NOT IN）' },
  { v: 'is not empty', label: '非空' },
  { v: 'is empty', label: '为空' },
]

export const noValue = (op: string) => op === 'is not empty' || op === 'is empty'

/** 数字不加引号，其他加单引号 */
export function quote(v: string): string {
  const t = v.trim()
  if (/^-?\d+(\.\d+)?$/.test(t)) return t
  return "'" + t.replace(/'/g, "''") + "'"
}

/** 值里以 $ 开头 = 引用前面层的输出（不加引号，直接拼进去） */
const isRef = (v: string) => v.trim().startsWith('$')

/** 右边的值：引用原样，字面量加引号 */
function rhsOf(c: Cond): string {
  return isRef(c.value) ? c.value.trim() : quote(c.value)
}

/**
 * 拼成**合法的 SQL**。算子的 v 只是内部标识（和条件节点的英文关键字同名，便于统一），
 * 中文 label 只给人看；落到 SQL 要翻译：
 *   is not empty → is not null，is empty → is null，like → like，not like → not like
 *   （值里自己写了 % 就原样用，比如 '%abc' / 'abc%'；完全不含 % 才在两侧补 %…%），in → in (…)，not in → not in (…)。
 * （这些不是 SQL 关键字，不能原样拼进 SQL。）
 */
export function condSql(c: Cond): string {
  const lit = c.value.trim()
  const likeArg = isRef(c.value) ? c.value.trim() : quote(lit.includes('%') ? lit : `%${lit}%`)
  switch (c.op) {
    case 'is not empty': return `${c.field} is not null`
    case 'is empty': return `${c.field} is null`
    case 'in': return `${c.field} in (${rhsOf(c)})`
    case 'not in': return `${c.field} not in (${rhsOf(c)})`
    case 'like': return `${c.field} like ${likeArg}`
    case 'not like': return `${c.field} not like ${likeArg}`
    default: return `${c.field} ${c.op} ${rhsOf(c)}`
  }
}

/** 一组拼成一段（多条件加括号）；没填的组返回空串 */
export function groupSql(g: Group): string {
  const cs = g.conds.filter(c => c.field).map(condSql)
  if (!cs.length) return ''
  return cs.length === 1 ? cs[0] : `(${cs.join(` ${g.mode} `)})`
}

/** 所有组拼成 where 后面的部分（不含 where 关键字） */
export function buildWhere(groups: Group[]): string {
  const parts: { sql: string; join: 'and' | 'or' }[] = []
  for (const g of groups) {
    const s = groupSql(g)
    if (s) parts.push({ sql: s, join: g.join })
  }
  return parts.map((p, i) => (i === 0 ? p.sql : `${p.join} ${p.sql}`)).join(' ')
}

export const newCond = (): Cond => ({ field: '', op: '=', value: '' })

/** 生成一个还没被用过的条件 id（c1 / c2 / …）。取现有最大编号 +1，不复用，保证稳定。 */
export function newGroupId(existing: Group[]): string {
  let max = 0
  for (const g of existing) {
    const m = /^c(\d+)$/.exec(g.id ?? '')
    if (m) max = Math.max(max, Number(m[1]))
  }
  return 'c' + (max + 1)
}

export const newGroup = (existing: Group[], join: 'and' | 'or' = 'and'): Group =>
  ({ id: newGroupId(existing), mode: 'and', join, conds: [newCond()] })
