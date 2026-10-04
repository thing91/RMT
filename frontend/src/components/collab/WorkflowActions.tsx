import { useState } from 'react'
import type { TransitionInput } from '../../api/collabHooks'
import type { SubjectWorkflow, TransitionOption } from '../../api/types'
import { useT } from '../../i18n'
import StatusBadge from './StatusBadge'
import { TransitionDialog } from './TransitionPanel'

/** Current status plus the one next step you can take as a button; every
 * other transition (including ones you can't run yet, with the reason) sits
 * under "More ▾". */
export default function WorkflowActions({
  workflow,
  run,
  disabled,
}: {
  workflow: SubjectWorkflow | undefined
  run: (key: string, input: TransitionInput) => Promise<unknown>
  disabled?: boolean
}) {
  const t = useT()
  const [active, setActive] = useState<TransitionOption | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  if (!workflow) return null
  const current = workflow.states.find((s) => s.key === workflow.state)
  const primary = workflow.transitions.find((x) => x.allowed)
  const rest = workflow.transitions.filter((x) => x !== primary)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusBadge label={workflow.state_label} color={current?.color} />
      {primary && (
        <button
          disabled={disabled}
          onClick={() => setActive(primary)}
          title={`${t(primary.label)} → ${t(primary.to_label)}`}
          className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
        >
          {t(primary.label)}
          {primary.requires_signature && ' ✍'}
        </button>
      )}
      {rest.length > 0 && (
        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            {t('More')} ▾
          </button>
          {menuOpen && (
            <>
              <button aria-label={t('Close')} className="fixed inset-0 z-10 cursor-default" onClick={() => setMenuOpen(false)} />
              <div className="absolute left-0 z-20 mt-1 w-64 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                {rest.map((x) => (
                  <button
                    key={x.key}
                    disabled={!x.allowed || disabled}
                    onClick={() => {
                      setMenuOpen(false)
                      setActive(x)
                    }}
                    className="block w-full rounded-md px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-transparent"
                  >
                    {t(x.label)}
                    {x.requires_signature && ' ✍'}
                    <span className="ml-1 text-xs text-slate-400">→ {t(x.to_label)}</span>
                    {!x.allowed && x.reasons.length > 0 && (
                      <span className="block text-[11px] text-slate-400">{x.reasons.join(' · ')}</span>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {active && <TransitionDialog transition={active} onClose={() => setActive(null)} run={run} extraFields={undefined} />}
    </div>
  )
}
