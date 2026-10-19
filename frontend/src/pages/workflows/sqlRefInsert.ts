/*
 * 「//」选「整列」时插什么：`$节点.rows[*].列` 只会展开成 `?, ?, ...`（没数据时是 `NULL`），
 * 不会自己带括号，所以这里只按光标前后补齐 `( … )`；`in` / `not in` 由用户自己写。
 *   光标前是 `(`（可带空格） → 只插引用；光标后不是 `)` 就补一个 `)`
 *   其余                     → 插 `(引用)`（前一个字符不是空白就先补个空格）
 */

/** 光标前是不是紧跟着 `in (`（含 `not in (`）：是就该默认取整列 */
export function afterInParen(before: string) {
  return /\bin\s*\(\s*$/i.test(before)
}

/** before = 光标前（不含 `//搜索词` 那段），after = 光标后，ref = `$节点.rows[*].列` */
export function wholeColumnInsert(before: string, after: string, ref: string) {
  if (/\(\s*$/.test(before)) return /^\s*\)/.test(after) ? ref : `${ref})`
  return `${before === '' || /\s$/.test(before) ? '' : ' '}(${ref})`
}
