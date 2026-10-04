import { Fragment, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { apiErrorMessage } from '../api/client'
import { can, usePermissions, useSubjectTransition, useSubjectWorkflow } from '../api/collabHooks'
import { useDocuments, useProject } from '../api/hooks'
import {
  useApplicability,
  useApplicabilityRecord,
  useApplicabilitySummary,
  useClearRecordSuspect,
  useLibraries,
  useReleases,
  useSetMissionAttributes,
  useSubscribe,
  useSubscriptionAction,
  useSubscriptions,
  useUpdatePreview,
  type RecordFilters,
} from '../api/libraryHooks'
import type { ApplicabilityRecord, ApplicabilityStatus, LibrarySubscription, MissionAttributeDef } from '../api/types'
import DiffText, { fieldLabel } from '../components/collab/DiffText'
import Modal, { btn, input } from '../components/collab/Modal'
import TransitionPanel from '../components/collab/TransitionPanel'

// Categorical slots from the validated reference palette (light surface),
// in stack order. Every segment also carries a visible count (contrast relief).
const STATUS_META: { key: ApplicabilityStatus; label: string; color: string }[] = [
  { key: 'to_be_assessed', label: 'To be assessed', color: '#eb6834' },
  { key: 'applicable', label: 'Applicable', color: '#2a78d6' },
  { key: 'applicable_modified', label: 'With modification', color: '#1baf7a' },
  { key: 'not_applicable_pending', label: 'N/A — awaiting approval', color: '#eda100' },
  { key: 'not_applicable', label: 'Not applicable', color: '#4a3aa7' },
]
const COLOR = Object.fromEntries(STATUS_META.map((s) => [s.key, s.color])) as Record<ApplicabilityStatus, string>

export default function ApplicabilityPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const [searchParams] = useSearchParams()
  const { data: project } = useProject(projectId)
  const { data: perms } = usePermissions(projectId)
  const { data: subs } = useSubscriptions(projectId)
  const { data: summary } = useApplicabilitySummary(projectId)
  const [filters, setFilters] = useState<RecordFilters>({})
  const { data: records, isLoading } = useApplicability(projectId, filters)
  const [expanded, setExpanded] = useState<string | null>(searchParams.get('record'))
  const [importing, setImporting] = useState(false)

  if (!project || !projectId) return <div className="p-6 text-slate-500">Loading…</div>
  if (project.kind === 'library')
    return (
      <div className="p-6 text-sm text-slate-500">
        This is a library. Manage its releases on the <Link to="../releases" relative="path" className="text-blue-600">Releases</Link> page.
      </div>
    )

  const isAdmin = can(perms, 'project.admin')
  const subsystems = Object.keys(summary?.by_subsystem ?? {}).sort()

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Applicability matrix</h1>
          <p className="text-sm text-slate-500">
            Every generic library requirement gets an explicit decision: applicable as-is, applicable with a
            modification (a project copy), or not applicable with a justification.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <a className={btn.secondary} href={`/api/v1/projects/${projectId}/applicability/export.xlsx`}>
            Export Excel
          </a>
          <a className={btn.secondary} href={`/api/v1/projects/${projectId}/applicability/export.reqif`}>
            Export ReqIF
          </a>
          {isAdmin && (
            <button className={btn.primary} onClick={() => setImporting(true)}>
              + Import library
            </button>
          )}
        </div>
      </div>

      {(subs ?? []).map((s) => (
        <SubscriptionCard key={s.library_id} projectId={projectId} sub={s} canManage={isAdmin} />
      ))}
      {(subs ?? []).length === 0 && (
        <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-400">
          No library imported yet{isAdmin ? ' — use “Import library”.' : '.'}
        </p>
      )}

      <MissionAttributes projectId={projectId} values={project.mission_attributes ?? {}} canEdit={isAdmin} />

      {summary && summary.total > 0 && <Dashboard summary={summary} onPick={(sub, st) => setFilters({ subsystem: sub, status: st })} />}

      {summary && summary.total > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2 text-xs">
            <select
              className="rounded-md border border-slate-300 px-2 py-1"
              value={filters.status ?? ''}
              onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value || undefined }))}
            >
              <option value="">Any status</option>
              {STATUS_META.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
            <select
              className="rounded-md border border-slate-300 px-2 py-1"
              value={filters.subsystem ?? ''}
              onChange={(e) => setFilters((f) => ({ ...f, subsystem: e.target.value || undefined }))}
            >
              <option value="">All subsystems</option>
              {subsystems.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-slate-600">
              <input
                type="checkbox"
                checked={!!filters.suspect}
                onChange={(e) => setFilters((f) => ({ ...f, suspect: e.target.checked || undefined }))}
              />
              Suspect only
            </label>
            {(filters.status || filters.subsystem || filters.suspect) && (
              <button className={btn.ghost} onClick={() => setFilters({})}>
                Clear filters
              </button>
            )}
            <span className="ml-auto text-slate-400">{(records ?? []).length} records</span>
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">Subsystem</th>
                <th className="font-medium">ID</th>
                <th className="font-medium">Requirement</th>
                <th className="font-medium">Decision</th>
                <th className="font-medium">Justification</th>
              </tr>
            </thead>
            <tbody>
              {(records ?? []).map((r) => (
                <Fragment key={r.id}>
                  <tr
                    onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                    className={`cursor-pointer border-t border-slate-100 align-top hover:bg-slate-50 ${expanded === r.id ? 'bg-blue-50/40' : ''}`}
                  >
                    <td className="px-3 py-2 text-xs text-slate-500">{r.subsystem}</td>
                    <td className="py-2 font-mono text-xs text-slate-600">
                      {r.key}
                      <span className="block text-[10px] text-slate-400">
                        v{r.source_version} · {r.release_name}
                      </span>
                    </td>
                    <td className="py-2 pr-2">
                      <span className="text-slate-800">{r.resolved_title}</span>
                      {r.suspect && (
                        <span className="ml-1 rounded bg-orange-100 px-1 text-[10px] font-semibold text-orange-800" title={r.suspect_reason ?? ''}>
                          ⚠ suspect
                        </span>
                      )}
                      {r.removed_from_library && (
                        <span className="ml-1 rounded bg-slate-200 px-1 text-[10px] text-slate-600">removed from library</span>
                      )}
                      {r.missing_parameters.length > 0 && (
                        <span className="ml-1 rounded bg-amber-50 px-1 text-[10px] text-amber-800">
                          missing parameter: {r.missing_parameters.join(', ')}
                        </span>
                      )}
                      {r.suggested_status && r.status === 'to_be_assessed' && (
                        <span className="ml-1 rounded bg-violet-50 px-1 text-[10px] text-violet-700" title={r.suggested_reason ?? ''}>
                          suggested: {r.suggested_status.replace('_', ' ')}
                        </span>
                      )}
                    </td>
                    <td className="py-2">
                      <StatusPill status={r.status} label={r.status_label} />
                      {r.modified_item_key && (
                        <span className="block font-mono text-[11px] text-slate-500">→ {r.modified_item_key}</span>
                      )}
                    </td>
                    <td className="max-w-xs py-2 pr-3 text-xs text-slate-600">{r.rationale}</td>
                  </tr>
                  {expanded === r.id && (
                    <tr className="bg-slate-50">
                      <td colSpan={5} className="px-3 py-3">
                        <RecordPanel projectId={projectId} record={r} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {!isLoading && (records ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-xs text-slate-400">
                    Nothing matches the filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {importing && <ImportModal projectId={projectId} onClose={() => setImporting(false)} />}
    </div>
  )
}

function StatusPill({ status, label }: { status: ApplicabilityStatus; label: string }) {
  const c = COLOR[status]
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-slate-700" style={{ backgroundColor: `${c}1f` }}>
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c }} />
      {label}
    </span>
  )
}

function Dashboard({
  summary,
  onPick,
}: {
  summary: NonNullable<ReturnType<typeof useApplicabilitySummary>['data']>
  onPick: (subsystem: string, status: string) => void
}) {
  const rows = Object.entries(summary.by_subsystem).sort(([a], [b]) => a.localeCompare(b))
  const decided = summary.total - summary.totals.to_be_assessed - summary.totals.not_applicable_pending
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <div>
          <span className="text-2xl font-semibold text-slate-800">
            {decided}/{summary.total}
          </span>
          <span className="ml-2 text-sm text-slate-500">decided</span>
        </div>
        <span className={`text-sm font-medium ${summary.complete ? 'text-green-700' : 'text-slate-500'}`}>
          {summary.complete ? '✓ Matrix complete' : `${summary.totals.to_be_assessed} still to be assessed`}
        </span>
        {summary.suspect > 0 && <span className="text-sm text-orange-700">⚠ {summary.suspect} suspect</span>}
      </div>
      <div className="mb-3 flex flex-wrap gap-3 text-xs text-slate-600">
        {STATUS_META.map((s) => (
          <span key={s.key} className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
            {s.label} <span className="text-slate-400">{summary.totals[s.key] ?? 0}</span>
          </span>
        ))}
      </div>
      <div className="space-y-2">
        {rows.map(([subsystem, counts]) => {
          const total = Object.values(counts).reduce((a, b) => a + b, 0)
          return (
            <div key={subsystem} className="flex items-center gap-3">
              <span className="w-28 shrink-0 truncate text-xs text-slate-600" title={subsystem}>
                {subsystem}
              </span>
              <div className="flex h-5 flex-1 gap-[2px]">
                {STATUS_META.filter((s) => counts[s.key]).map((s) => (
                  <button
                    key={s.key}
                    onClick={() => onPick(subsystem, s.key)}
                    title={`${subsystem} · ${s.label}: ${counts[s.key]} of ${total}`}
                    className="flex items-center justify-center rounded-[4px] text-[10px] font-semibold text-white first:rounded-l-[4px] hover:opacity-80"
                    style={{ width: `${(counts[s.key] / total) * 100}%`, backgroundColor: s.color, minWidth: 18 }}
                  >
                    {counts[s.key]}
                  </button>
                ))}
              </div>
              <span className="w-8 shrink-0 text-right text-xs text-slate-400">{total}</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function SubscriptionCard({ projectId, sub, canManage }: { projectId: string; sub: LibrarySubscription; canManage: boolean }) {
  const { data: documents } = useDocuments(projectId)
  const action = useSubscriptionAction(projectId, sub.library_id)
  const [reviewing, setReviewing] = useState(false)
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-slate-800">{sub.library_name}</span>
        <span className="rounded bg-violet-50 px-1.5 py-0.5 text-xs font-medium text-violet-700">{sub.release.name}</span>
        <span className="text-xs text-slate-400">
          {sub.release.item_count} requirements · released {new Date(sub.release.released_at).toLocaleDateString()}
        </span>
        {canManage && (
          <label className="ml-auto flex items-center gap-1 text-xs text-slate-500">
            Copies go to
            <select
              className="rounded border border-slate-300 px-1 py-0.5"
              value={sub.target_document_id ?? ''}
              onChange={(e) => action.mutate({ action: 'patch', body: { target_document_id: e.target.value || null } })}
            >
              <option value="">— choose each time —</option>
              {(documents ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {sub.update_available && sub.latest_release && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-800">
          New release <b>{sub.latest_release.name}</b> is available.
          {canManage && (
            <button className="font-semibold underline" onClick={() => setReviewing(true)}>
              Review changes…
            </button>
          )}
        </div>
      )}
      {sub.declined_release && (
        <p className="mt-2 text-xs text-slate-500">
          Staying on {sub.release.name} instead of {sub.declined_release.name}: “{sub.declined_justification}”
        </p>
      )}
      {reviewing && sub.latest_release && (
        <UpdateModal projectId={projectId} sub={sub} releaseId={sub.latest_release.id} onClose={() => setReviewing(false)} />
      )}
    </section>
  )
}

function UpdateModal({ projectId, sub, releaseId, onClose }: { projectId: string; sub: LibrarySubscription; releaseId: string; onClose: () => void }) {
  const { data: diff } = useUpdatePreview(projectId, sub.library_id, releaseId)
  const action = useSubscriptionAction(projectId, sub.library_id)
  const [justification, setJustification] = useState('')
  const [error, setError] = useState<string | null>(null)
  const onError = (e: unknown) => setError(apiErrorMessage(e, 'That did not work.'))

  return (
    <Modal
      wide
      title={`${sub.library_name}: ${sub.release.name} → ${sub.latest_release?.name}`}
      onClose={onClose}
      footer={
        <>
          <input
            className="mr-auto w-80 rounded-md border border-slate-300 px-2 py-1 text-xs"
            placeholder="Justification for staying on the current release"
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
          />
          <button
            className={btn.secondary}
            disabled={!justification.trim()}
            onClick={() => action.mutate({ action: 'decline', body: { release_id: releaseId, justification } }, { onSuccess: onClose, onError })}
          >
            Stay on {sub.release.name}
          </button>
          <button className={btn.primary} onClick={() => action.mutate({ action: 'adopt', body: { release_id: releaseId } }, { onSuccess: onClose, onError })}>
            Adopt {sub.latest_release?.name}
          </button>
        </>
      }
    >
      {!diff ? (
        <p className="text-sm text-slate-400">Comparing releases…</p>
      ) : (
        <div className="space-y-4 text-sm">
          <p className="text-xs text-slate-500">
            Adopting adds new requirements as “To be assessed” and flags records of changed or removed requirements
            as suspect, so their decisions get re-confirmed.
          </p>
          <DiffSection title={`New (${diff.added.length})`} entries={diff.added} />
          <DiffSection title={`Changed (${diff.changed.length})`} entries={diff.changed} showChanges />
          <DiffSection title={`Removed (${diff.removed.length})`} entries={diff.removed} />
          {error && <p className="text-xs text-red-600">⚠ {error}</p>}
        </div>
      )}
    </Modal>
  )
}

function DiffSection({
  title,
  entries,
  showChanges,
}: {
  title: string
  entries: NonNullable<ReturnType<typeof useUpdatePreview>['data']>['added']
  showChanges?: boolean
}) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {entries.length === 0 && <p className="text-xs text-slate-400">None.</p>}
      <ul className="space-y-1">
        {entries.map((e) => (
          <li key={e.item_id} className="rounded bg-slate-50 px-2 py-1 text-xs">
            <span className="font-mono text-slate-500">{e.key}</span> {e.title}{' '}
            <span className="text-slate-400">({e.subsystem})</span>
            {showChanges &&
              e.changes?.map((c) => (
                <div key={c.field} className="mt-1">
                  <span className="font-medium text-slate-500">{fieldLabel(c.field)}: </span>
                  {c.ops ? <DiffText ops={c.ops} /> : String(c.new)}
                </div>
              ))}
          </li>
        ))}
      </ul>
    </div>
  )
}

function ImportModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { data: project } = useProject(projectId)
  const { data: libraries } = useLibraries(project?.org_id)
  const { data: documents } = useDocuments(projectId)
  const [libraryId, setLibraryId] = useState('')
  const { data: releases } = useReleases(libraryId || undefined)
  const [releaseId, setReleaseId] = useState('')
  const [documentId, setDocumentId] = useState('')
  const subscribe = useSubscribe(projectId)
  const [error, setError] = useState<string | null>(null)
  const chosenRelease = releaseId || releases?.[0]?.id || ''

  return (
    <Modal
      title="Import a generic requirements library"
      onClose={onClose}
      footer={
        <>
          <button className={btn.secondary} onClick={onClose}>
            Cancel
          </button>
          <button
            className={btn.primary}
            disabled={!libraryId || !chosenRelease || subscribe.isPending}
            onClick={() =>
              subscribe.mutate(
                { library_id: libraryId, release_id: chosenRelease, target_document_id: documentId || null },
                { onSuccess: onClose, onError: (e) => setError(apiErrorMessage(e, 'Could not import.')) },
              )
            }
          >
            Import
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-xs text-slate-500">
          Importing creates one applicability record per generic requirement (status “To be assessed”) — a reference
          to the released library version, not a copy.
        </p>
        <select className={input} value={libraryId} onChange={(e) => { setLibraryId(e.target.value); setReleaseId('') }}>
          <option value="">Library…</option>
          {(libraries ?? []).map((l) => (
            <option key={l.id} value={l.id} disabled={!l.latest_release}>
              {l.name} ({l.requirement_count} requirements{l.latest_release ? '' : ', not released yet'})
            </option>
          ))}
        </select>
        {libraryId && (
          <select className={input} value={chosenRelease} onChange={(e) => setReleaseId(e.target.value)}>
            {(releases ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} — {r.item_count} requirements, {new Date(r.released_at).toLocaleDateString()}
              </option>
            ))}
          </select>
        )}
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Document for “with modification” copies</span>
          <select className={input} value={documentId} onChange={(e) => setDocumentId(e.target.value)}>
            <option value="">— choose each time —</option>
            {(documents ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        {error && <p className="text-xs text-red-600">⚠ {error}</p>}
      </div>
    </Modal>
  )
}

function MissionAttributes({ projectId, values, canEdit }: { projectId: string; values: Record<string, unknown>; canEdit: boolean }) {
  const { data: project } = useProject(projectId)
  const { data: libraries } = useLibraries(project?.org_id)
  const { data: subs } = useSubscriptions(projectId)
  const save = useSetMissionAttributes(projectId)
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const defs: MissionAttributeDef[] = useMemo(() => {
    const used = new Set((subs ?? []).map((s) => s.library_id))
    const seen = new Map<string, MissionAttributeDef>()
    for (const l of libraries ?? []) if (used.has(l.id)) for (const d of l.mission_attribute_defs) seen.set(d.key, d)
    return [...seen.values()]
  }, [libraries, subs])
  if (defs.length === 0) return null
  const current = draft ?? values

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Mission attributes</h2>
        <span className="text-[11px] text-slate-400">Used by library rules to suggest a decision — a person always confirms.</span>
      </div>
      <div className="flex flex-wrap items-end gap-4 text-sm">
        {defs.map((d) => (
          <label key={d.key} className="text-xs text-slate-600">
            <span className="mb-1 block font-medium">{d.label ?? d.key}</span>
            {d.type === 'boolean' ? (
              <select
                disabled={!canEdit}
                className="rounded-md border border-slate-300 px-2 py-1"
                value={current[d.key] === undefined ? '' : String(current[d.key])}
                onChange={(e) =>
                  setDraft({ ...current, [d.key]: e.target.value === '' ? undefined : e.target.value === 'true' })
                }
              >
                <option value="">—</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            ) : d.type === 'enum' ? (
              <select
                disabled={!canEdit}
                className="rounded-md border border-slate-300 px-2 py-1"
                value={String(current[d.key] ?? '')}
                onChange={(e) => setDraft({ ...current, [d.key]: e.target.value || undefined })}
              >
                <option value="">—</option>
                {(d.options ?? []).map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            ) : (
              <input
                disabled={!canEdit}
                type={d.type === 'number' ? 'number' : 'text'}
                className="w-32 rounded-md border border-slate-300 px-2 py-1"
                value={String(current[d.key] ?? '')}
                onChange={(e) =>
                  setDraft({ ...current, [d.key]: d.type === 'number' ? Number(e.target.value) : e.target.value })
                }
              />
            )}
          </label>
        ))}
        {canEdit && draft && (
          <button
            className={btn.primary}
            onClick={() =>
              save.mutate(draft, {
                onSuccess: (r) => {
                  setDraft(null)
                  setResult(`${r.suggestions} suggestion(s) from rules.`)
                },
              })
            }
          >
            Save
          </button>
        )}
        {result && <span className="text-xs text-slate-500">{result}</span>}
      </div>
    </section>
  )
}

function RecordPanel({ projectId, record }: { projectId: string; record: ApplicabilityRecord }) {
  const { data: detail } = useApplicabilityRecord(record.id)
  const { data: workflow } = useSubjectWorkflow('applicability', record.id)
  const transition = useSubjectTransition('applicability')
  const clearSuspect = useClearRecordSuspect()
  const { data: documents } = useDocuments(projectId)
  const { data: perms } = usePermissions(projectId)
  const [error, setError] = useState<string | null>(null)

  const suggestionKey =
    record.suggested_status === 'applicable' ? 'mark_applicable' : record.suggested_status === 'not_applicable' ? 'propose_not_applicable' : null

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2 text-sm">
        <div className="font-medium text-slate-800">{record.resolved_title}</div>
        <p className="whitespace-pre-wrap text-slate-600">{record.resolved_description || <i className="text-slate-400">No text.</i>}</p>
        {record.missing_parameters.length > 0 && (
          <p className="text-xs text-amber-700">
            Set the project parameter(s) {record.missing_parameters.join(', ')} under{' '}
            <Link className="underline" to={`/projects/${projectId}/parameters`}>
              Parameters
            </Link>{' '}
            — filling a parameter is not a modification.
          </p>
        )}
        {record.suspect && (
          <div className="rounded-md bg-orange-50 px-2 py-1.5 text-xs text-orange-800">
            ⚠ {record.suspect_reason}
            {can(perms, 'applicability.decide') && (
              <button className="ml-2 font-semibold underline" onClick={() => clearSuspect.mutate(record.id)}>
                Decision still valid
              </button>
            )}
          </div>
        )}
        {detail && detail.modification_diff.length > 0 && (
          <div className="rounded-md border border-slate-200 bg-white p-2 text-xs">
            <div className="mb-1 font-medium text-slate-500">
              Project copy{' '}
              <Link
                className="font-mono text-blue-700 hover:underline"
                to={`/projects/${projectId}/documents/${record.modified_document_id}?item=${record.modified_item_id}`}
              >
                {record.modified_item_key}
              </Link>{' '}
              vs. library:
            </div>
            {detail.modification_diff.map((c) => (
              <div key={c.field}>
                <span className="text-slate-500">{fieldLabel(c.field)}: </span>
                {c.ops ? <DiffText ops={c.ops} /> : String(c.new)}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="space-y-2 text-xs">
        {record.suggested_status && record.status === 'to_be_assessed' && suggestionKey && (
          <div className="rounded-md bg-violet-50 px-2 py-1.5 text-violet-800">
            Rule suggests <b>{record.suggested_status.replace('_', ' ')}</b>: {record.suggested_reason}
            {can(perms, 'applicability.decide') && (
              <button
                className="ml-2 font-semibold underline"
                onClick={() =>
                  transition
                    .mutateAsync({ id: record.id, key: suggestionKey, input: { comment: record.suggested_reason ?? undefined } })
                    .catch((e) => setError(apiErrorMessage(e, 'Could not apply.')))
                }
              >
                Accept suggestion
              </button>
            )}
          </div>
        )}
        <TransitionPanel
          workflow={workflow}
          run={(key, inp) => transition.mutateAsync({ id: record.id, key, input: inp })}
          extraFields={(t, values, set) =>
            t.key === 'mark_modified' ? (
              <div className="space-y-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">Create the project copy in</span>
                  <select className={input} value={String(values.document_id ?? '')} onChange={(e) => set('document_id', e.target.value)}>
                    <option value="">(the library's default document)</option>
                    {(documents ?? []).map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">Modified text</span>
                  <textarea
                    rows={4}
                    className={input}
                    value={String(values.description_md ?? record.description_md ?? '')}
                    onChange={(e) => set('description_md', e.target.value)}
                  />
                </label>
              </div>
            ) : null
          }
        />
        {(record.decided_by || record.approved_by) && (
          <p className="text-slate-500">
            {record.decided_by && <>Decided by {record.decided_by} {record.decided_at && `on ${new Date(record.decided_at).toLocaleDateString()}`}. </>}
            {record.approved_by && <>Approved by {record.approved_by}.</>}
          </p>
        )}
        {workflow && workflow.history.length > 0 && (
          <ol className="space-y-0.5 border-l border-slate-200 pl-2 text-slate-500">
            {workflow.history.map((h) => (
              <li key={h.id}>
                {new Date(h.at).toLocaleDateString()} · {h.actor}: {h.from_label} → <b>{h.to_label}</b>
                {h.comment && <i> — “{h.comment}”</i>}
              </li>
            ))}
          </ol>
        )}
        {error && <p className="text-red-600">⚠ {error}</p>}
      </div>
    </div>
  )
}
