import type { InputParam } from '../../api/types'

export const INPUT_TYPES: { v: InputParam['type']; label: string }[] = [
  { v: 'string', label: '字符串' },
  { v: 'long', label: '整数' },
  { v: 'int', label: '整数（32 位）' },
  { v: 'boolean', label: '布尔' },
  { v: 'string[]', label: '字符串数组' },
  { v: 'long[]', label: '数字数组' },
]

export const INPUT_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

/** 是不是数组类型 */
export const isArrayType = (t: string) => t.endsWith('[]')

/** 表单里的文本 → 发给后端的值：数组型按逗号拆成真数组，其他原样 */
export function toParamValue(type: string, text: string): unknown {
  if (!isArrayType(type)) return text
  const t = text.trim()
  if (!t) return []
  if (t.startsWith('[')) {
    try { const a = JSON.parse(t); return Array.isArray(a) ? a : [] } catch { /* 落回逗号拆 */ }
  }
  return t.split(',').map(s => s.trim()).filter(Boolean)
}

/** 解析输入参数 JSON（坏 JSON 当空） */
export function parseInputs(json?: string): InputParam[] {
  try {
    const a = JSON.parse(json || '[]')
    return Array.isArray(a) ? a : []
  } catch { return [] }
}

/** 校验：名字合法且不重复、不和节点重名。返回错误文案（空串 = 没问题）。 */export function inputError(rows: InputParam[], nodeNames: string[] = []): string {
  const seen = new Set<string>()
  for (let i = 0; i < rows.length; i++) {
    const n = (rows[i].name || '').trim()
    if (!n) return `第 ${i + 1} 个参数还没填名字`
    if (!INPUT_NAME_RE.test(n)) return `参数名「${n}」只能用字母、数字、下划线，且不能以数字开头`
    if (seen.has(n)) return `参数名「${n}」重复了`
    if (nodeNames.includes(n)) return `参数名「${n}」和某个节点重名了`
    seen.add(n)
  }
  return ''
}
