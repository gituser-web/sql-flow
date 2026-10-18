import { useState } from 'react'
import VarPickerDialog from './VarPickerDialog'
import type { CondVar } from './ConditionDialog'

/** 「插入变量」按钮：点开居中的选择窗（先点节点，再选字段）。 */
export default function VarInsertButton({ vars, onInsert }: {
  vars: CondVar[]
  onInsert: (text: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="btn btn--sm" onClick={() => setOpen(true)}>插入变量</button>
      {open && (
        <VarPickerDialog
          vars={vars}
          onPick={t => { onInsert(t); setOpen(false) }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
