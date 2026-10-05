import { useState } from 'react'
import { useItemSuggestions, useSubjectTransition, useSubjectWorkflow, useUpdateSuggestion } from '../../api/collabHooks'
import { apiErrorMessage } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import type { Item, ItemType, Suggestion } from '../../api/types'
import CommentsSection from '../CommentsSection'
import DiffText, { formatValue } from './DiffText'
import { input } from './Modal'
import StatusBadge from './StatusBadge'
import TransitionPanel from './TransitionPanel'
import { useT } from '../../i18n'

const STATUS_COLOR: Record<string, string> = {
  open: '#2563eb',
  accepted: '#16a34a',
  accepted_modified: '#0d9488',
  rejected: '#dc2626',
  withdrawn: '#94a3b8',
  outdated: '#d97706',
}

export function SuggestionStatus({ s }: { s: Suggestion }) {
  return <StatusBadge label={s.status_label} color={STATUS_COLOR[s.status]} small />
}

function SuggestionCard({ s, item, orgId }: { s: Suggestion; item: Item; orgId: string }) {
  const t = useT()
  const tx = t
  const { user } = useAuth()
  const [open, setOpen] = useState(s.status === 'open' || s.status === 'outdated')
  const [showThread, setShowThread] = useState(false)
  const { data: workflow } = useSubjectWorkflow('suggestion', open ? s.id : undefined)
  const transition = useSubjectTransition('suggestion')
  const update = useUpdateSuggestion()
  const [revising, setRevising] = useState(false)
  const [draft, setDraft] = useState(formatValue(s.proposed_value))
  const [error, setError] = useState<string | null>(null)
  const textual = typeof s.proposed_value === 'string' || s.proposed_value === null

  return (
    <div className="rounded-md border border-slate-200 bg-white">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs">
        <span className="font-mono font-semibold text-slate-700">{s.key}</span>
        <SuggestionStatus s={s} />
        <span
          className={`rounded px-1 text-[10px] font-semibold uppercase ${
            s.severity === 'major' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500'
          }`}
        >
          {s.severity}
        </span>
        <span className="text-slate-500">{s.kind}</span>
        <span className="flex-1 truncate text-slate-600">· {s.target_label}</span>
        <span className="text-slate-400">{s.author}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-slate-100 px-2 py-2 text-xs">
          <div className="rounded bg-slate-50 p-2 text-sm">
            {s.status === 'outdated' && s.diff_vs_current ? (
              <>
                <div className="mb-1 text-[11px] font-medium text-amber-700">
                  ⚠ {t('{key} changed since this was suggested (v{a} → v{b}). Diff against the current text:', {
                    key: item.key ?? '',
                    a: s.item_version,
                    b: s.item_current_version ?? '',
                  })}
                </div>
                <DiffText ops={s.diff_vs_current} />
              </>
            ) : s.diff ? (
              <DiffText ops={s.diff} />
            ) : (
              <span>{formatValue(s.proposed_value)}</span>
            )}
          </div>
          {s.final_value !== null && s.status === 'accepted_modified' && (
            <div className="text-slate-600">
              <b>{t('Applied as:')}</b> {formatValue(s.final_value)}
            </div>
          )}
          <div className="text-slate-600">
            <b>{t('Why:')}</b> {s.rationale}
          </div>
          {s.review_key && <div className="text-slate-500">{t('Raised in {review}', { review: s.review_key })}</div>}
          {s.resolution_text && (
            <div className="rounded border-l-2 border-slate-300 pl-2 text-slate-600">
              <b>{s.resolved_by}:</b> {s.resolution_text}
            </div>
          )}
          {s.apply_pending && (
            <div className="text-amber-700">
              {t('Accepted — will be applied once the change request is accepted and {key} is editable again.', { key: item.key ?? '' })}
            </div>
          )}

          {revising ? (
            <div className="space-y-1">
              {textual ? (
                <textarea rows={3} className={input} value={draft} onChange={(e) => setDraft(e.target.value)} />
              ) : null}
              <div className="flex gap-2">
                <button
                  className="rounded bg-blue-600 px-2 py-0.5 text-white"
                  onClick={() =>
                    update.mutate(
                      { id: s.id, payload: { proposed_value: draft } },
                      {
                        onSuccess: () => setRevising(false),
                        onError: (e) => setError(apiErrorMessage(e, t('Could not revise.'))),
                      },
                    )
                  }
                >
                  {t('Save revision')}
                </button>
                <button className="text-slate-500" onClick={() => setRevising(false)}>
                  {t('Cancel')}
                </button>
              </div>
            </div>
          ) : (
            user?.id === s.author_id &&
            (s.status === 'open' || s.status === 'outdated') &&
            textual && (
              <button className="text-blue-600 hover:underline" onClick={() => setRevising(true)}>
                {s.status === 'outdated' ? t('Update to current version…') : t('Revise…')}
              </button>
            )
          )}

          <TransitionPanel
            workflow={workflow}
            compact
            run={(key, inp) =>
              transition.mutateAsync({
                id: s.id,
                key,
                input: { ...inp, payload: { ...inp.payload, item_version: item.version } },
              })
            }
            extraFields={(t, values, set) =>
              t.key === 'accept_modified' && textual ? (
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">{tx('Text to apply (required)')}</span>
                  <textarea
                    rows={4}
                    className={input}
                    value={String(values.final_value ?? formatValue(s.proposed_value))}
                    onChange={(e) => set('final_value', e.target.value)}
                    onFocus={() => values.final_value === undefined && set('final_value', formatValue(s.proposed_value))}
                  />
                </label>
              ) : null
            }
          />
          {error && <p className="text-red-600">⚠ {error}</p>}
          <button className="text-slate-500 hover:text-blue-600" onClick={() => setShowThread((v) => !v)}>
            {showThread ? t('Hide discussion') : t('Discussion…')}
          </button>
          {showThread && <CommentsSection itemId={item.id} orgId={orgId} suggestionId={s.id} title={t('Discussion')} />}
        </div>
      )}
    </div>
  )
}

export default function SuggestionsPanel({
  item,
  orgId,
  onNew,
}: {
  item: Item
  itemType: ItemType
  orgId: string
  onNew: () => void
}) {
  const t = useT()
  const { user } = useAuth()
  const { data: suggestions, isLoading } = useItemSuggestions(item.id)
  const [showClosed, setShowClosed] = useState(false)
  const all = suggestions ?? []
  const active = all.filter((s) => s.status === 'open' || s.status === 'outdated')
  const closed = all.filter((s) => !(s.status === 'open' || s.status === 'outdated'))

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Change suggestions {all.length > 0 && `(${active.length} open)`}
        </h3>
        {user && (
          <button onClick={onNew} className="text-xs font-medium text-blue-600 hover:text-blue-800">
            + {t('Suggest a change')}
          </button>
        )}
      </div>
      {isLoading && <p className="text-xs text-slate-400">{t('Loading…')}</p>}
      {active.map((s) => (
        <SuggestionCard key={s.id} s={s} item={item} orgId={orgId} />
      ))}
      {!isLoading && active.length === 0 && <p className="text-xs text-slate-400">{t('No open suggestions.')}</p>}
      {closed.length > 0 && (
        <button className="text-xs text-slate-500 hover:text-blue-600" onClick={() => setShowClosed((v) => !v)}>
          {showClosed ? t('Hide') : t('Show')} {closed.length} resolved
        </button>
      )}
      {showClosed && closed.map((s) => <SuggestionCard key={s.id} s={s} item={item} orgId={orgId} />)}
    </div>
  )
}
