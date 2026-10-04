import { useEffect, useState } from 'react'
import { apiErrorDetail, apiErrorMessage } from '../../api/client'
import { useWorkflowCatalog, useWorkflowTemplates, type WorkflowSpecInput } from '../../api/collabHooks'
import type { WorkflowDefinition, WorkflowState, WorkflowTransition } from '../../api/types'
import { btn } from './Modal'
import StatusBadge from './StatusBadge'

/** Shows one workflow (states + transitions) and lets an admin switch to a
 * template or edit the definition as JSON. Server-side validation (unknown
 * states/condition types, states still in use) is shown inline. */
export default function WorkflowEditor({
  definition,
  canEdit,
  onSave,
  extraActions,
}: {
  definition: WorkflowDefinition | undefined
  canEdit: boolean
  onSave: (spec: WorkflowSpecInput) => Promise<unknown>
  extraActions?: React.ReactNode
}) {
  const { data: templates } = useWorkflowTemplates()
  const { data: catalog } = useWorkflowCatalog()
  const [mode, setMode] = useState<'view' | 'json'>('view')
  const [json, setJson] = useState('')
  const [template, setTemplate] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (definition)
      setJson(
        JSON.stringify(
          {
            name: definition.name,
            states: definition.states,
            transitions: definition.transitions,
            settings: definition.settings,
          },
          null,
          2,
        ),
      )
  }, [definition])

  async function save(spec: WorkflowSpecInput) {
    setErrors([])
    setSaved(false)
    try {
      await onSave(spec)
      setSaved(true)
      setMode('view')
    } catch (err) {
      const d = apiErrorDetail(err)
      setErrors([d?.message ?? apiErrorMessage(err, 'Could not save.'), ...(d?.reasons ?? [])])
    }
  }

  function saveJson() {
    try {
      save(JSON.parse(json) as WorkflowSpecInput)
    } catch {
      setErrors(['That is not valid JSON.'])
    }
  }

  return (
    <div className="space-y-3">
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            className="rounded-md border border-slate-300 px-2 py-1"
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
          >
            <option value="">Apply a template…</option>
            {(templates ?? []).map((t) => (
              <option key={t.key} value={t.key}>
                {t.name}
              </option>
            ))}
          </select>
          <button className={btn.secondary} disabled={!template} onClick={() => save({ template })}>
            Apply
          </button>
          <span className="text-slate-300">|</span>
          <button className={btn.ghost} onClick={() => setMode(mode === 'json' ? 'view' : 'json')}>
            {mode === 'json' ? 'Back to overview' : 'Edit as JSON…'}
          </button>
          {extraActions}
          {saved && <span className="text-green-700">Saved.</span>}
        </div>
      )}
      {errors.length > 0 && (
        <ul className="list-disc rounded-md bg-red-50 py-2 pl-6 pr-3 text-xs text-red-700">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {mode === 'json' ? (
        <div className="space-y-2">
          <textarea
            className="h-96 w-full rounded-md border border-slate-300 p-2 font-mono text-xs"
            value={json}
            onChange={(e) => setJson(e.target.value)}
            spellCheck={false}
          />
          {catalog && (
            <p className="text-[11px] text-slate-500">
              Conditions: {catalog.conditions.join(', ')} · Actions: {catalog.actions.join(', ')} · Roles:{' '}
              {catalog.role_tokens.join(', ')}, perm:&lt;permission&gt; · Notify targets:{' '}
              {catalog.notify_targets.join(', ')}
            </p>
          )}
          <button className={btn.primary} onClick={saveJson}>
            Save workflow
          </button>
        </div>
      ) : (
        definition && <WorkflowOverview states={definition.states} transitions={definition.transitions} />
      )}
    </div>
  )
}

function ruleText(r: { type: string; [k: string]: unknown }): string {
  const params = Object.entries(r)
    .filter(([k]) => k !== 'type')
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join('/') : String(v)}`)
  return params.length ? `${r.type} (${params.join(', ')})` : r.type
}

export function WorkflowOverview({ states, transitions }: { states: WorkflowState[]; transitions: WorkflowTransition[] }) {
  const label = (k: string) => states.find((s) => s.key === k)?.label ?? k
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {states.map((s) => (
          <span key={s.key} className="flex items-center gap-1">
            <StatusBadge label={s.label} color={s.color} />
            <span className="text-[10px] text-slate-400">
              {[s.initial && 'initial', s.read_only && 'read-only', s.is_obsolete && 'obsolete', s.category]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </span>
        ))}
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-400">
            <th className="py-1 font-medium">Transition</th>
            <th className="font-medium">From → To</th>
            <th className="font-medium">Who</th>
            <th className="font-medium">Conditions</th>
            <th className="font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {transitions.map((t) => (
            <tr key={t.key} className="border-b border-slate-100 align-top">
              <td className="py-1 font-medium text-slate-700">
                {t.label}
                {t.requires_comment && <span className="ml-1 text-slate-400" title="Comment required">💬</span>}
              </td>
              <td className="text-slate-600">
                {t.from.map(label).join(', ')} → <b>{label(t.to)}</b>
              </td>
              <td className="text-slate-500">{t.roles.length ? t.roles.join(', ') : 'workflow.transition'}</td>
              <td className="text-slate-500">{t.conditions.map(ruleText).join('; ') || '—'}</td>
              <td className="text-slate-500">{t.actions.map(ruleText).join('; ') || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
