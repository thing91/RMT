import { useState, type ReactNode } from 'react'
import { apiErrorDetail, apiErrorMessage } from '../../api/client'
import type { TransitionInput } from '../../api/collabHooks'
import type { SubjectWorkflow, TransitionOption } from '../../api/types'
import Modal, { btn, input } from './Modal'
import StatusBadge from './StatusBadge'
import { useT } from '../../i18n'

interface Props {
  workflow: SubjectWorkflow | undefined
  /** Runs the transition; reject to show the error inside the dialog. */
  run: (key: string, input: TransitionInput) => Promise<unknown>
  /** Extra inputs a transition needs (e.g. final text for "accept with
   * modification"), rendered inside the confirmation dialog. */
  extraFields?: (
    t: TransitionOption,
    values: Record<string, unknown>,
    set: (k: string, v: unknown) => void,
  ) => ReactNode
  compact?: boolean
  disabled?: boolean
}

/** Current state + one button per available transition. Transitions the
 * user may not run are shown disabled with the reasons as a tooltip, so
 * it's clear *why* something can't happen yet. */
export default function TransitionPanel({ workflow, run, extraFields, compact, disabled }: Props) {
  const tr = useT()
  const [active, setActive] = useState<TransitionOption | null>(null)
  if (!workflow) return null
  const current = workflow.states.find((s) => s.key === workflow.state)
  const transitions = workflow.transitions

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${compact ? '' : 'py-1'}`}>
      <StatusBadge label={workflow.state_label} color={current?.color} />
      {transitions.length > 0 && <span className="text-slate-300">→</span>}
      {transitions.map((t) => (
        <button
          key={t.key}
          disabled={!t.allowed || disabled}
          title={t.allowed ? `${tr(t.label)} → ${tr(t.to_label)}` : t.reasons.join('\n')}
          onClick={() => setActive(t)}
          className={`rounded-md border px-2 py-0.5 text-xs font-medium ${
            t.allowed && !disabled
              ? 'border-slate-300 bg-white text-slate-700 hover:border-blue-400 hover:text-blue-700'
              : 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400'
          }`}
        >
          {tr(t.label)}
          {t.requires_signature && ' ✍'}
        </button>
      ))}
      {active && (
        <TransitionDialog transition={active} onClose={() => setActive(null)} run={run} extraFields={extraFields} />
      )}
    </div>
  )
}

export function TransitionDialog({
  transition,
  onClose,
  run,
  extraFields,
}: {
  transition: TransitionOption
  onClose: () => void
  run: Props['run']
  extraFields: Props['extraFields']
}) {
  const t = useT()
  const [comment, setComment] = useState('')
  const [password, setPassword] = useState('')
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [error, setError] = useState<string | null>(null)
  const [reasons, setReasons] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    setError(null)
    setReasons([])
    try {
      await run(transition.key, {
        comment: comment.trim() || undefined,
        password: password || undefined,
        payload: values,
      })
      onClose()
    } catch (err) {
      const d = apiErrorDetail(err)
      setError(d?.message ?? apiErrorMessage(err, t('Could not run this transition.')))
      setReasons(
        (d?.reasons ?? []).filter(
          (r) => !['signature_required', 'signature_failed', 'comment_required', 'wrong_state'].includes(r),
        ),
      )
    } finally {
      setBusy(false)
    }
  }

  const missingComment = transition.requires_comment && !comment.trim()
  const missingPassword = transition.requires_signature && !password

  return (
    <Modal
      title={`${t(transition.label)} → ${t(transition.to_label)}`}
      onClose={onClose}
      footer={
        <>
          <button className={btn.secondary} onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className={btn.primary} disabled={busy || missingComment || missingPassword} onClick={submit}>
            {transition.requires_signature ? t('Sign & confirm') : t('Confirm')}
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">
            {transition.requires_comment ? t('Justification (required)') : t('Comment (optional)')}
          </span>
          <textarea autoFocus rows={3} className={input} value={comment} onChange={(e) => setComment(e.target.value)} />
        </label>
        {extraFields?.(transition, values, (k, v) => setValues((prev) => ({ ...prev, [k]: v })))}
        {transition.requires_signature && (
          <label className="block rounded-md border border-amber-200 bg-amber-50 p-3">
            <span className="mb-1 block text-xs font-medium text-amber-800">
              {t('Electronic signature — re-enter your password to sign this step')}
            </span>
            <input
              type="password"
              className={input}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            <span className="mt-1 block text-[11px] text-amber-700">
              {t('Your signature, its meaning and a hash of the exact content are recorded permanently.')}
            </span>
          </label>
        )}
        {error && (
          <div className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
            ⚠ {error}
            {reasons.length > 0 && (
              <ul className="mt-1 list-disc pl-4">
                {reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
