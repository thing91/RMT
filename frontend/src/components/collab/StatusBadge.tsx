import type { ItemType } from '../../api/types'

/** Workflow state pill — label and color come from the item type's
 * workflow-managed `status` enum options. */
export default function StatusBadge({
  itemType,
  value,
  label,
  color,
  small,
}: {
  itemType?: ItemType
  value?: unknown
  label?: string
  color?: string | null
  small?: boolean
}) {
  if (!value && !label) return null
  const option = itemType?.attributes.find((a) => a.key === 'status')?.enum_options?.find((o) => o.value === value)
  const text = label ?? option?.label ?? String(value)
  const c = color ?? option?.color ?? '#64748b'
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${small ? 'px-1.5 py-0 text-[10px]' : 'px-2 py-0.5 text-xs'}`}
      style={{ backgroundColor: `${c}1f`, color: c }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: c }} />
      {text}
    </span>
  )
}
