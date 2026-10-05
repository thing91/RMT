import { useState } from 'react'
import { useWorkflowCatalog } from '../../api/collabHooks'
import type { WorkflowRule, WorkflowState, WorkflowTransition } from '../../api/types'
import { btn } from './Modal'
import StatusBadge from './StatusBadge'
import { useT } from '../../i18n'

export interface WorkflowDraft {
  name: string
  states: WorkflowState[]
  transitions: WorkflowTransition[]
  settings: Record<string, unknown>
}

const CATEGORIES: WorkflowState['category'][] = ['draft', 'active', 'done', 'side']
const cell = 'rounded border border-slate-300 px-1.5 py-0.5 text-xs'
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

/** Form-based workflow editor: states as a table, transitions as cards
 * with from/to, who, conditions and actions. Produces the same JSON the
 * server validates, so anything the form can't express can still be done
 * in the JSON view. */
export default function WorkflowVisualEditor({
  initial,
  onSave,
  saving,
}: {
  initial: WorkflowDraft
  onSave: (draft: WorkflowDraft) => void
  saving?: boolean
}) {
  const t = useT()
  const { data: catalog } = useWorkflowCatalog()
  const [wf, setWf] = useState<WorkflowDraft>(initial)
  const [open, setOpen] = useState<string | null>(null)

  const setState = (i: number, patch: Partial<WorkflowState>) =>
    setWf((w) => ({
      ...w,
      states: w.states.map((s, j) =>
        j === i ? { ...s, ...patch } : patch.initial ? { ...s, initial: false } : s,
      ),
    }))
  const setTransition = (i: number, patch: Partial<WorkflowTransition>) =>
    setWf((w) => ({ ...w, transitions: w.transitions.map((t, j) => (j === i ? { ...t, ...patch } : t)) }))

  function removeState(i: number) {
    const key = wf.states[i].key
    setWf((w) => ({
      ...w,
      states: w.states.filter((_, j) => j !== i),
      transitions: w.transitions
        .map((t) => ({ ...t, from: t.from.filter((f) => f !== key) }))
        .filter((t) => t.to !== key && t.from.length > 0),
    }))
  }

  return (
    <div className="space-y-4 text-xs">
      <label className="flex items-center gap-2">
        <span className="font-medium text-slate-500">{t('Name')}</span>
        <input className={`${cell} w-64`} value={wf.name} onChange={(e) => setWf({ ...wf, name: e.target.value })} />
      </label>

      <section>
        <h3 className="mb-1 font-semibold uppercase tracking-wide text-slate-500">{t('States')}</h3>
        <table className="w-full">
          <thead className="text-left text-slate-400">
            <tr>
              <th className="font-medium">{t('Label')}</th>
              <th className="font-medium">{t('Key')}</th>
              <th className="font-medium">{t('Category')}</th>
              <th className="font-medium" title={t('Content can\'t be edited in this state')}>{t('Read-only')}</th>
              <th className="font-medium" title={t('Entering this state retires the item')}>{t('Obsolete')}</th>
              <th className="font-medium">{t('Initial')}</th>
              <th className="font-medium">{t('Color')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {wf.states.map((s, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="py-1 pr-1">
                  <input
                    className={`${cell} w-36`}
                    value={s.label}
                    onChange={(e) =>
                      setState(i, { label: e.target.value, ...(s.key === '' || s.key.startsWith('new_') ? { key: slug(e.target.value) } : {}) })
                    }
                  />
                </td>
                <td className="pr-1">
                  <input className={`${cell} w-28 font-mono`} value={s.key} onChange={(e) => setState(i, { key: slug(e.target.value) })} />
                </td>
                <td className="pr-1">
                  <select className={cell} value={s.category} onChange={(e) => setState(i, { category: e.target.value as WorkflowState['category'] })}>
                    {CATEGORIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </td>
                <td className="text-center">
                  <input type="checkbox" checked={s.read_only} onChange={(e) => setState(i, { read_only: e.target.checked })} />
                </td>
                <td className="text-center">
                  <input type="checkbox" checked={s.is_obsolete} onChange={(e) => setState(i, { is_obsolete: e.target.checked })} />
                </td>
                <td className="text-center">
                  <input type="radio" name="initial" checked={s.initial} onChange={() => setState(i, { initial: true })} />
                </td>
                <td>
                  <input type="color" className="h-5 w-8" value={s.color ?? '#64748b'} onChange={(e) => setState(i, { color: e.target.value })} />
                </td>
                <td>
                  <button className="text-slate-400 hover:text-red-600" onClick={() => removeState(i)} title={t('Remove state')}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          className={`${btn.ghost} mt-1`}
          onClick={() =>
            setWf((w) => ({
              ...w,
              states: [
                ...w.states,
                { key: `new_${w.states.length + 1}`, label: t('New state'), category: 'active', read_only: false, is_obsolete: false, initial: false, color: '#64748b' },
              ],
            }))
          }
        >
          + {t('State')}
        </button>
      </section>

      <section>
        <h3 className="mb-1 font-semibold uppercase tracking-wide text-slate-500">{t('Transitions')}</h3>
        <div className="space-y-1.5">
          {wf.transitions.map((t, i) => (
            <div key={i} className="rounded-md border border-slate-200">
              <button className="flex w-full items-center gap-2 px-2 py-1.5 text-left" onClick={() => setOpen(open === t.key ? null : t.key)}>
                <span className="font-medium text-slate-700">{t.label}</span>
                <span className="text-slate-400">
                  {t.from.map((f) => wf.states.find((s) => s.key === f)?.label ?? f).join(', ')} →
                </span>
                <StatusBadge label={wf.states.find((s) => s.key === t.to)?.label ?? t.to} color={wf.states.find((s) => s.key === t.to)?.color} small />
                <span className="ml-auto text-slate-400">{t.roles.join(', ') || 'workflow.transition'}</span>
              </button>
              {open === t.key && (
                <TransitionForm
                  t={t}
                  states={wf.states}
                  catalog={catalog}
                  onChange={(patch) => {
                    setTransition(i, patch)
                    if (patch.key) setOpen(patch.key)
                  }}
                  onRemove={() => setWf((w) => ({ ...w, transitions: w.transitions.filter((_, j) => j !== i) }))}
                />
              )}
            </div>
          ))}
        </div>
        <button
          className={`${btn.ghost} mt-1`}
          onClick={() => {
            const key = `transition_${wf.transitions.length + 1}`
            setWf((w) => ({
              ...w,
              transitions: [
                ...w.transitions,
                { key, label: t('New transition'), from: [w.states[0]?.key], to: w.states[0]?.key, roles: [], conditions: [], actions: [], requires_comment: false },
              ],
            }))
            setOpen(key)
          }}
        >
          + {t('Transition')}
        </button>
      </section>

      <button className={btn.primary} disabled={saving} onClick={() => onSave(wf)}>
        {t('Save workflow')}
      </button>
    </div>
  )
}

function TransitionForm({
  t,
  states,
  catalog,
  onChange,
  onRemove,
}: {
  t: WorkflowTransition
  states: WorkflowState[]
  catalog: ReturnType<typeof useWorkflowCatalog>['data']
  onChange: (patch: Partial<WorkflowTransition>) => void
  onRemove: () => void
}) {
  const tx = useT()
  const [customRole, setCustomRole] = useState('')
  const tokens = [...new Set([...(catalog?.role_tokens ?? []), ...t.roles])]
  return (
    <div className="space-y-2 border-t border-slate-100 bg-slate-50 px-2 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <input className={`${cell} w-40`} value={t.label} onChange={(e) => onChange({ label: e.target.value })} />
        <input className={`${cell} w-32 font-mono`} value={t.key} onChange={(e) => onChange({ key: slug(e.target.value) })} />
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={t.requires_comment} onChange={(e) => onChange({ requires_comment: e.target.checked })} />
          {tx('comment required')}
        </label>
        <button className="ml-auto text-slate-400 hover:text-red-600" onClick={onRemove}>
          {tx('Remove transition')}
        </button>
      </div>
      <div className="flex flex-wrap items-start gap-4">
        <fieldset>
          <legend className="mb-0.5 font-medium text-slate-500">{tx('From')}</legend>
          {states.map((s) => (
            <label key={s.key} className="mr-2 inline-flex items-center gap-1">
              <input
                type="checkbox"
                checked={t.from.includes(s.key)}
                onChange={(e) => onChange({ from: e.target.checked ? [...t.from, s.key] : t.from.filter((f) => f !== s.key) })}
              />
              {s.label}
            </label>
          ))}
        </fieldset>
        <label>
          <span className="mb-0.5 block font-medium text-slate-500">{tx('To')}</span>
          <select className={cell} value={t.to} onChange={(e) => onChange({ to: e.target.value })}>
            {states.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset>
        <legend className="mb-0.5 font-medium text-slate-500">
          Who may run it <span className="font-normal text-slate-400">(any one; none ticked = anyone with workflow.transition)</span>
        </legend>
        {tokens.map((tok) => (
          <label key={tok} className="mr-2 inline-flex items-center gap-1">
            <input
              type="checkbox"
              checked={t.roles.includes(tok)}
              onChange={(e) => onChange({ roles: e.target.checked ? [...t.roles, tok] : t.roles.filter((r) => r !== tok) })}
            />
            <span className="font-mono">{tok}</span>
          </label>
        ))}
        <span className="inline-flex items-center gap-1">
          <input className={`${cell} w-40 font-mono`} placeholder={tx('perm:suggestion.resolve')} value={customRole} onChange={(e) => setCustomRole(e.target.value)} />
          <button
            className={btn.ghost}
            disabled={!customRole.trim()}
            onClick={() => {
              onChange({ roles: [...t.roles, customRole.trim()] })
              setCustomRole('')
            }}
          >
            {tx('add')}
          </button>
        </span>
      </fieldset>
      <RuleList title={tx('Conditions (all must hold)')} rules={t.conditions} types={catalog?.conditions ?? []} onChange={(conditions) => onChange({ conditions })} />
      <RuleList title={tx('Actions (run after the change)')} rules={t.actions} types={catalog?.actions ?? []} onChange={(actions) => onChange({ actions })} />
    </div>
  )
}

function RuleList({
  title,
  rules,
  types,
  onChange,
}: {
  title: string
  rules: WorkflowRule[]
  types: string[]
  onChange: (rules: WorkflowRule[]) => void
}) {
  const t = useT()
  return (
    <div>
      <div className="mb-0.5 font-medium text-slate-500">{title}</div>
      {rules.map((r, i) => {
        const { type, ...params } = r
        return (
          <div key={i} className="mb-1 flex items-center gap-1">
            <select className={cell} value={type} onChange={(e) => onChange(rules.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))}>
              {[...new Set([...types, type])].map((ty) => (
                <option key={ty}>{ty}</option>
              ))}
            </select>
            <ParamsInput
              value={params}
              onChange={(p) => onChange(rules.map((x, j) => (j === i ? { type: x.type, ...p } : x)))}
            />
            <button className="text-slate-400 hover:text-red-600" onClick={() => onChange(rules.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        )
      })}
      <button className={btn.ghost} onClick={() => onChange([...rules, { type: types[0] ?? 'notify' }])}>
        + {t('add')}
      </button>
    </div>
  )
}

/** Parameters as compact JSON, e.g. {"targets": ["watchers"]}. */
function ParamsInput({ value, onChange }: { value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void }) {
  const [text, setText] = useState(Object.keys(value).length ? JSON.stringify(value) : '')
  const [bad, setBad] = useState(false)
  return (
    <input
      className={`${cell} flex-1 font-mono ${bad ? 'border-red-400 bg-red-50' : ''}`}
      placeholder='parameters, e.g. {"targets": ["watchers"]}'
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (!text.trim()) {
          setBad(false)
          onChange({})
          return
        }
        try {
          const parsed = JSON.parse(text)
          setBad(false)
          onChange(parsed)
        } catch {
          setBad(true)
        }
      }}
    />
  )
}
