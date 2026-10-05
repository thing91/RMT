import { describe, expect, it } from 'vitest'
import type { ItemType, ItemTypeAttribute } from '../api/types'
import { attrDisplay } from '../components/attrDisplay'
import { buildPalette } from './palette'

function statusType(id: string, options: [string, string, string | null][]): ItemType {
  return {
    id,
    attributes: [
      {
        key: 'status',
        enum_options: options.map(([value, label, color]) => ({ value, label, color, deprecated: false })),
      },
    ],
  } as unknown as ItemType
}

describe('status palette', () => {
  it('collects every workflow status once, in workflow order, first definition wins', () => {
    const palette = buildPalette([
      statusType('req', [
        ['draft', 'Draft', '#64748b'],
        ['review', 'In Review', '#d97706'],
        ['approved', 'Approved', '#16a34a'],
      ]),
      statusType('va', [
        ['draft', 'Draft (VA)', '#000000'],
        ['passed', 'Passed', null],
      ]),
    ])
    expect([...palette.keys()]).toEqual(['draft', 'review', 'approved', 'passed'])
    expect(palette.get('draft')).toMatchObject({ label: 'Draft', color: '#64748b', order: 0 })
    // A status without a color gets the neutral one.
    expect(palette.get('passed')?.color).toBe('#64748b')
  })

  it('handles item types without a status attribute', () => {
    expect(buildPalette([{ id: 's', attributes: [] } as unknown as ItemType]).size).toBe(0)
    expect(buildPalette(undefined).size).toBe(0)
  })
})

describe('attribute display', () => {
  const attr = (partial: Partial<ItemTypeAttribute>) => ({ label: 'x', key: 'x', ...partial }) as ItemTypeAttribute

  it('shows enum labels, units and yes/no, hides empty values', () => {
    const level = attr({ data_type: 'enum', enum_options: [{ value: 'hi', label: 'High', deprecated: false }] })
    expect(attrDisplay(level, 'hi')).toBe('High')
    expect(attrDisplay(level, 'gone')).toBe('gone')
    expect(attrDisplay(attr({ data_type: 'number', unit: 'kg' }), 85)).toBe('85 kg')
    expect(attrDisplay(attr({ data_type: 'boolean' }), true, 'Tak')).toBe('Tak')
    expect(attrDisplay(attr({ data_type: 'boolean' }), false)).toBeNull()
    expect(attrDisplay(attr({ data_type: 'text' }), '')).toBeNull()
    expect(attrDisplay(attr({ data_type: 'text' }), null)).toBeNull()
    const multi = attr({
      data_type: 'multi_enum',
      enum_options: [
        { value: 'a', label: 'EPS', deprecated: false },
        { value: 'b', label: 'AOCS', deprecated: false },
      ],
    })
    expect(attrDisplay(multi, ['a', 'b'])).toBe('EPS, AOCS')
    expect(attrDisplay(multi, [])).toBeNull()
  })
})
