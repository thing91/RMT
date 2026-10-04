import { useState } from 'react'
import { apiErrorMessage } from '../../api/client'
import { useLibraryRules, useSetLibraryRules } from '../../api/libraryHooks'
import type { LibraryRuleSpec, MissionAttributeDef } from '../../api/types'
import { btn } from './Modal'

const OPS: { value: LibraryRuleSpec['op']; label: string; needsValue: boolean }[] = [
  { value: 'falsy', label: 'is No / empty', needsValue: false },
  { value: 'truthy', label: 'is Yes / set', needsValue: false },
  { value: 'eq', label: 'equals', needsValue: true },
  { value: 'ne', label: 'is not', needsValue: true },
  { value: 'in', label: 'is one of', needsValue: true },
  { value: 'gt', label: 'greater than', needsValue: true },
  { value: 'lt', label: 'less than', needsValue: true },
]

function parseValue(raw: string, def?: MissionAttributeDef, op?: string): unknown {
  if (op === 'in' || op === 'not_in') return raw.split(',').map((s) => s.trim()).filter(Boolean)
  if (def?.type === 'number') return Number(raw)
  if (def?.type === 'boolean') return raw === 'true'
  return raw
}

/** Conditional applicability for one library requirement: "if the mission
 * has no propulsion, suggest Not applicable". Projects only ever get a
 * suggestion; a person confirms it. */
export default function LibraryRulesPanel({ itemId, defs, canEdit }: { itemId: string; defs: MissionAttributeDef[]; canEdit: boolean }) {
  const { data: rules } = useLibraryRules(itemId)
  const save = useSetLibraryRules(itemId)
  const [draft, setDraft] = useState<LibraryRuleSpec[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const current = draft ?? rules ?? []
  const update = (i: number, patch: Partial<LibraryRuleSpec>) => setDraft(current.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  if (defs.length === 0)
    return <p className="text-xs text-slate-400">Define mission attributes on the library's Releases page to add rules.</p>

  return (
    <div className="space-y-2 text-xs">
      <p className="text-slate-500">Rules are checked in order; the first match becomes the project's suggestion.</p>
      {current.map((r, i) => {
        const def = defs.find((d) => d.key === r.attribute)
        const op = OPS.find((o) => o.value === r.op)
        return (
          <div key={i} className="space-y-1 rounded-md border border-slate-200 p-2">
            <div className="flex flex-wrap items-center gap-1">
              If
              <select disabled={!canEdit} className="rounded border border-slate-300 px-1" value={r.attribute} onChange={(e) => update(i, { attribute: e.target.value })}>
                {defs.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.label ?? d.key}
                  </option>
                ))}
              </select>
              <select disabled={!canEdit} className="rounded border border-slate-300 px-1" value={r.op} onChange={(e) => update(i, { op: e.target.value as LibraryRuleSpec['op'] })}>
                {OPS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {op?.needsValue && (
                <input
                  disabled={!canEdit}
                  className="w-28 rounded border border-slate-300 px-1"
                  defaultValue={Array.isArray(r.value) ? r.value.join(', ') : r.value === undefined ? '' : String(r.value)}
                  onBlur={(e) => update(i, { value: parseValue(e.target.value, def, r.op) })}
                />
              )}
              → suggest
              <select disabled={!canEdit} className="rounded border border-slate-300 px-1" value={r.suggest} onChange={(e) => update(i, { suggest: e.target.value as LibraryRuleSpec['suggest'] })}>
                <option value="not_applicable">Not applicable</option>
                <option value="applicable">Applicable</option>
              </select>
              {canEdit && (
                <button className="ml-auto text-slate-400 hover:text-red-600" onClick={() => setDraft(current.filter((_, j) => j !== i))}>
                  ✕
                </button>
              )}
            </div>
            <input
              disabled={!canEdit}
              className="w-full rounded border border-slate-300 px-1 py-0.5"
              placeholder="Reason shown to the project"
              value={r.reason ?? ''}
              onChange={(e) => update(i, { reason: e.target.value })}
            />
          </div>
        )
      })}
      {current.length === 0 && <p className="text-slate-400">No rules — always assessed manually.</p>}
      {canEdit && (
        <div className="flex gap-2">
          <button className={btn.secondary} onClick={() => setDraft([...current, { attribute: defs[0].key, op: 'falsy', suggest: 'not_applicable' }])}>
            + Rule
          </button>
          {draft && (
            <button
              className={btn.primary}
              onClick={() =>
                save.mutate(draft, {
                  onSuccess: () => {
                    setDraft(null)
                    setError(null)
                  },
                  onError: (e) => setError(apiErrorMessage(e, 'Could not save rules.')),
                })
              }
            >
              Save rules
            </button>
          )}
        </div>
      )}
      {error && <p className="text-red-600">⚠ {error}</p>}
    </div>
  )
}
