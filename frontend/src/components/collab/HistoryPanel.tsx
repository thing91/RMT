import { useState } from 'react'
import { useItemAudit, useItemDiff, useItemVersions, useSignatures, useSubjectWorkflow } from '../../api/collabHooks'
import DiffText, { fieldLabel, formatValue } from './DiffText'
import { useT } from '../../i18n'

const REASON_LABEL: Record<string, string> = {
  create: 'Created',
  edit: 'Edited',
  transition: 'Workflow',
  suggestion: 'Suggestion applied',
  import: 'Imported',
  migration: 'Initial version',
  revert: 'Reverted',
}

/** Version history with a diff against the previous version (or the
 * current state), the workflow timeline, signatures and audit events. */
export default function HistoryPanel({ itemId, currentVersion }: { itemId: string; currentVersion: number }) {
  const t = useT()
  const { data: versions } = useItemVersions(itemId)
  const { data: workflow } = useSubjectWorkflow('item', itemId)
  const { data: signatures } = useSignatures(itemId)
  const { data: audit } = useItemAudit(itemId)
  const [selected, setSelected] = useState<number | null>(null)
  const [compareCurrent, setCompareCurrent] = useState(false)

  const from = selected ? (compareCurrent ? selected : selected - 1) : undefined
  const to = selected ? (compareCurrent ? undefined : selected) : undefined
  const { data: diff } = useItemDiff(itemId, from && from >= 1 ? from : undefined, to)

  const otherAudit = (audit ?? []).filter((e) => e.action !== 'workflow.transition')

  return (
    <div className="space-y-4 text-xs">
      <section>
        <h4 className="mb-1 font-semibold uppercase tracking-wide text-slate-500">{t('Versions')}</h4>
        <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
          {(versions ?? []).map((v) => (
            <li key={v.version}>
              <button
                onClick={() => setSelected(selected === v.version ? null : v.version)}
                className={`flex w-full items-start gap-2 px-2 py-1.5 text-left hover:bg-slate-50 ${
                  selected === v.version ? 'bg-blue-50' : ''
                }`}
              >
                <span className="w-8 shrink-0 font-mono font-semibold text-slate-700">v{v.version}</span>
                <span className="flex-1">
                  <span className="font-medium text-slate-700">{t(REASON_LABEL[v.reason] ?? v.reason)}</span>
                  {v.source_ref && <span className="text-slate-500"> · {v.source_ref}</span>}
                  {v.status && <span className="text-slate-500"> · {v.status}</span>}
                  <span className="block text-slate-400">
                    {v.author ?? 'system'}
                    {v.changed_by && v.changed_by !== v.author && ` (applied by ${v.changed_by})`} ·{' '}
                    {new Date(v.created_at).toLocaleString()}
                  </span>
                  {v.note && <span className="block italic text-slate-500">“{v.note}”</span>}
                </span>
              </button>
              {selected === v.version && (
                <div className="border-t border-slate-100 bg-slate-50 px-2 py-2">
                  <label className="mb-2 flex items-center gap-1 text-slate-500">
                    <input
                      type="checkbox"
                      checked={compareCurrent}
                      onChange={(e) => setCompareCurrent(e.target.checked)}
                    />
                    {t('Compare v{a} with the current version (v{b}) instead of v{c}', { a: v.version, b: currentVersion, c: v.version - 1 })}
                  </label>
                  {v.version === 1 && !compareCurrent ? (
                    <p className="text-slate-400">{t('First version — nothing to compare against.')}</p>
                  ) : (
                    <div className="space-y-2">
                      {(diff?.changes ?? []).length === 0 && <p className="text-slate-400">{t('No content changes.')}</p>}
                      {(diff?.changes ?? []).map((c) => (
                        <div key={c.field}>
                          <div className="font-semibold text-slate-500">{t(fieldLabel(c.field))}</div>
                          {c.ops ? (
                            <DiffText ops={c.ops} />
                          ) : (
                            <span>
                              <del className="text-red-600">{formatValue(c.old)}</del> →{' '}
                              <ins className="text-green-700 no-underline">{formatValue(c.new)}</ins>
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      {workflow && workflow.history.length > 0 && (
        <section>
          <h4 className="mb-1 font-semibold uppercase tracking-wide text-slate-500">{t('Workflow timeline')}</h4>
          <ol className="relative ml-2 border-l border-slate-200">
            {workflow.history.map((h) => (
              <li key={h.id} className="mb-2 ml-3">
                <span className="absolute -left-1 mt-1 h-2 w-2 rounded-full bg-blue-400" />
                <div className="text-slate-700">
                  <b>{h.from_label}</b> → <b>{h.to_label}</b> <span className="text-slate-400">by {h.actor}</span>
                </div>
                <div className="text-slate-400">
                  {new Date(h.at).toLocaleString()}
                  {typeof h.notes?.change_request === 'string' && ` · ${h.notes.change_request}`}
                  {h.notes?.signed ? ' · ✍ signed' : ''}
                </div>
                {h.comment && <div className="italic text-slate-500">“{h.comment}”</div>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {(signatures ?? []).length > 0 && (
        <section>
          <h4 className="mb-1 font-semibold uppercase tracking-wide text-slate-500">{t('Electronic signatures')}</h4>
          <ul className="space-y-1">
            {signatures!.map((s) => (
              <li key={s.id} className="rounded-md bg-slate-50 px-2 py-1">
                ✍ <b>{s.user}</b> — {s.meaning} (v{s.subject_version}) · {new Date(s.signed_at).toLocaleString()}
                <span className="block font-mono text-[10px] text-slate-400" title={t('SHA-256 of the signed content')}>
                  {s.content_hash.slice(0, 32)}…
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {otherAudit.length > 0 && (
        <section>
          <h4 className="mb-1 font-semibold uppercase tracking-wide text-slate-500">{t('Audit')}</h4>
          <ul className="space-y-1">
            {otherAudit.map((e) => (
              <li key={e.id} className="text-slate-600">
                <span className="text-slate-400">{new Date(e.created_at).toLocaleString()} · </span>
                {e.summary}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
