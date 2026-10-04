import { useMemo } from 'react'
import { useItemTypes, useOrg } from '../api/hooks'
import type { ItemType } from '../api/types'

export interface StatusInfo {
  value: string
  label: string
  color: string
  order: number
}

const NEUTRAL = '#64748b'

/** One status palette for the whole app: every workflow-managed `status`
 * option across the organization's item types, in workflow order (first
 * seen wins). Labels are the workflow's English labels — pass them through
 * `t()` when displaying. */
export function buildPalette(itemTypes: ItemType[] | undefined): Map<string, StatusInfo> {
  const map = new Map<string, StatusInfo>()
  for (const type of itemTypes ?? []) {
    const options = type.attributes.find((a) => a.key === 'status')?.enum_options ?? []
    for (const o of options) {
      if (map.has(o.value)) continue
      map.set(o.value, { value: o.value, label: o.label, color: o.color ?? NEUTRAL, order: map.size })
    }
  }
  return map
}

export function useStatusPalette() {
  const { org } = useOrg()
  const { data: itemTypes } = useItemTypes(org?.id)
  return useMemo(() => {
    const map = buildPalette(itemTypes)
    const get = (value: string): StatusInfo =>
      map.get(value) ?? { value, label: value === 'none' ? 'Other' : value, color: NEUTRAL, order: 999 }
    const sort = (values: string[]) => [...values].sort((a, b) => get(a).order - get(b).order)
    const all = () => [...map.values()]
    return { get, sort, all }
  }, [itemTypes])
}
