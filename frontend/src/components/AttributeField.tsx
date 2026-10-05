import type { ItemTypeAttribute } from '../api/types'
import { useT } from '../i18n'

interface Props {
  attribute: ItemTypeAttribute
  value: unknown
  onChange: (value: unknown) => void
}

export default function AttributeField({ attribute, value, onChange }: Props) {
  const t = useT()
  const inputClass =
    'w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none'

  switch (attribute.data_type) {
    case 'text':
    case 'user_ref':
    case 'item_ref':
      return (
        <input
          className={inputClass}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )

    case 'rich_text':
      return (
        <textarea
          className={inputClass}
          rows={4}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )

    case 'enum': {
      const options = attribute.enum_options ?? []
      const currentIsDeprecated = options.find((o) => o.value === value)?.deprecated
      return (
        <div>
          <select
            className={inputClass}
            value={(value as string) ?? ''}
            onChange={(e) => onChange(e.target.value || null)}
          >
            <option value="">—</option>
            {options
              .filter((o) => !o.deprecated || o.value === value)
              .map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                  {o.deprecated ? ' (deprecated)' : ''}
                </option>
              ))}
          </select>
          {currentIsDeprecated && (
            <p className="mt-1 text-xs text-amber-600">
              {t('This value is deprecated. Consider migrating it to a current option.')}
            </p>
          )}
        </div>
      )
    }

    case 'multi_enum': {
      const options = attribute.enum_options ?? []
      const selected = new Set((value as string[]) ?? [])
      return (
        <div className="flex flex-wrap gap-2">
          {options.map((o) => (
            <label
              key={o.value}
              className="flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs"
            >
              <input
                type="checkbox"
                checked={selected.has(o.value)}
                onChange={(e) => {
                  const next = new Set(selected)
                  if (e.target.checked) next.add(o.value)
                  else next.delete(o.value)
                  onChange(Array.from(next))
                }}
              />
              {o.label}
            </label>
          ))}
        </div>
      )
    }

    case 'number':
      return (
        <input
          type="number"
          className={inputClass}
          min={attribute.min ?? undefined}
          max={attribute.max ?? undefined}
          value={value === null || value === undefined ? '' : (value as number)}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
      )

    case 'date':
      return (
        <input
          type="date"
          className={inputClass}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
        />
      )

    case 'boolean':
      return (
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
      )

    default:
      return null
  }
}
