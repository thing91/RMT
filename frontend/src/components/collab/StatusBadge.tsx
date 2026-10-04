import type { ItemType } from '../../api/types'
import { useT } from '../../i18n'
import { useStatusPalette } from '../../status/palette'

/** Workflow state pill — label and color come from the item type's
 * workflow-managed `status` enum options, falling back to the
 * organization-wide palette so a status looks the same everywhere. */
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
  const t = useT()
  const palette = useStatusPalette()
  if (!value && !label) return null
  const option = itemType?.attributes.find((a) => a.key === 'status')?.enum_options?.find((o) => o.value === value)
  const shared = typeof value === 'string' ? palette.get(value) : undefined
  const text = label ?? option?.label ?? shared?.label ?? String(value)
  const c = color ?? option?.color ?? shared?.color ?? '#64748b'
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full font-medium ${small ? 'px-1.5 py-0 text-[10px]' : 'px-2 py-0.5 text-xs'}`}
      style={{ backgroundColor: `${c}1f`, color: c }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: c }} />
      {t(text)}
    </span>
  )
}
