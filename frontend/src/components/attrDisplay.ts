import type { ItemTypeAttribute } from '../api/types'

/** Human-readable value of an attribute, or null when it's empty (empty
 * fields are simply not shown in reading views). */
export function attrDisplay(attr: ItemTypeAttribute, value: unknown, yes = 'Yes'): string | null {
  if (value === null || value === undefined || value === '') return null
  switch (attr.data_type) {
    case 'enum':
      return attr.enum_options?.find((o) => o.value === value)?.label ?? String(value)
    case 'multi_enum': {
      const values = Array.isArray(value) ? (value as string[]) : []
      if (values.length === 0) return null
      return values.map((v) => attr.enum_options?.find((o) => o.value === v)?.label ?? v).join(', ')
    }
    case 'boolean':
      return value ? yes : null
    case 'number':
      return `${value}${attr.unit ? ` ${attr.unit}` : ''}`
    default:
      return String(value)
  }
}

export const isLongText = (attr: ItemTypeAttribute) => attr.data_type === 'text' || attr.data_type === 'rich_text'
