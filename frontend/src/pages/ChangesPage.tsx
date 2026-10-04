import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useChangeRequests, useClearSuspect, useProjectAudit, useSuspectLinks } from '../api/collabHooks'
import { useProjectItems } from '../api/hooks'
import StatusBadge from '../components/collab/StatusBadge'

const CR_COLOR = { open: '#9333ea', accepted: '#2563eb', rejected: '#dc2626', implemented: '#16a34a' }

/** Change management overview: change requests with their impact
 * analysis, suspect links waiting for re-verification, and the audit log. */
export default function ChangesPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const [tab, setTab] = useState<'crs' | 'suspect' | 'audit'>('suspect')
  return (
    <div className="mx-auto max-w-6xl p-6">
      <h1 className="mb-3 text-lg font-semibold text-slate-800">Change management</h1>
      <div className="mb-4 flex gap-1 border-b border-slate-200 text-sm">
        {(
          [
            ['suspect', 'Suspect links'],
            ['crs', 'Change requests'],
            ['audit', 'Audit log'],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-3 py-1.5 font-medium ${
              tab === k ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {l}
          </button>
        ))}
      </div>
      {tab === 'suspect' && <SuspectTab projectId={projectId!} />}
      {tab === 'crs' && <ChangeRequestsTab projectId={projectId!} />}
      {tab === 'audit' && <AuditTab projectId={projectId!} />}
    </div>
  )
}

function useItemRoute(projectId: string) {
  const { data: items } = useProjectItems(projectId)
  const docOf = new Map((items ?? []).map((i) => [i.id, i.document_id]))
  return (itemId: string) => `/projects/${projectId}/documents/${docOf.get(itemId) ?? ''}?item=${itemId}`
}

function SuspectTab({ projectId }: { projectId: string }) {
  const { data: links, isLoading } = useSuspectLinks(projectId)
  const clear = useClearSuspect()
  const route = useItemRoute(projectId)
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <p className="border-b border-slate-100 bg-orange-50 px-3 py-2 text-xs text-orange-800">
        A link becomes suspect when the item on one end was re-approved after a change request. Re-check that the
        other end (test, design, child requirement) still holds, then mark it re-verified.
      </p>
      <table className="w-full text-xs">
        <thead className="text-left text-slate-500">
          <tr>
            <th className="px-3 py-2 font-medium">From</th>
            <th className="font-medium">Link</th>
            <th className="font-medium">To</th>
            <th className="font-medium">Why</th>
            <th className="font-medium">Since</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {(links ?? []).map((l) => (
            <tr key={l.id} className="border-t border-slate-100">
              <td className="px-3 py-1.5">
                <Link to={route(l.source_item_id)} className="font-mono text-blue-700 hover:underline">
                  {l.source_key ?? l.source_title}
                </Link>
                {l.changed_item_id === l.source_item_id && <span className="ml-1 text-orange-600">changed</span>}
              </td>
              <td className="text-slate-500">{l.link_type}</td>
              <td>
                <Link to={route(l.target_item_id)} className="font-mono text-blue-700 hover:underline">
                  {l.target_key ?? l.target_title}
                </Link>
                {l.changed_item_id === l.target_item_id && <span className="ml-1 text-orange-600">changed</span>}
              </td>
              <td className="text-slate-600">{l.reason}</td>
              <td className="text-slate-400">{l.since && new Date(l.since).toLocaleDateString()}</td>
              <td className="pr-3 text-right">
                <button
                  className="font-medium text-orange-700 hover:underline"
                  onClick={() => clear.mutate({ linkId: l.id, comment: 'Re-verified' })}
                >
                  ✓ Re-verified
                </button>
              </td>
            </tr>
          ))}
          {!isLoading && (links ?? []).length === 0 && (
            <tr>
              <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                No suspect links. 🎉
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function ChangeRequestsTab({ projectId }: { projectId: string }) {
  const { data: crs, isLoading } = useChangeRequests(projectId)
  const route = useItemRoute(projectId)
  return (
    <div className="space-y-2">
      {(crs ?? []).map((cr) => (
        <details key={cr.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
          <summary className="flex cursor-pointer flex-wrap items-center gap-2">
            <span className="font-mono font-semibold">{cr.key}</span>
            <StatusBadge label={cr.status} color={CR_COLOR[cr.status]} small />
            <Link to={route(cr.item_id)} className="font-mono text-blue-700 hover:underline">
              {cr.item_key}
            </Link>
            <span className="text-slate-700">{cr.item_title}</span>
            <span className="text-xs text-slate-400">
              v{cr.base_version}
              {cr.implemented_version && ` → v${cr.implemented_version}`} · {cr.requested_by} ·{' '}
              {new Date(cr.created_at).toLocaleDateString()}
            </span>
          </summary>
          <div className="mt-2 space-y-1 text-xs">
            <p className="text-slate-600">
              <b>Reason:</b> {cr.reason}
            </p>
            {cr.decided_by && (
              <p className="text-slate-500">
                Decided by {cr.decided_by} on {cr.decided_at && new Date(cr.decided_at).toLocaleDateString()}
              </p>
            )}
            <p className="font-medium text-slate-500">Impact analysis ({cr.impact.length}):</p>
            <ul className="ml-4 list-disc text-slate-600">
              {cr.impact.map((e) => (
                <li key={e.item_id}>
                  {e.relation}:{' '}
                  <Link to={route(e.item_id)} className="font-mono text-blue-700 hover:underline">
                    {e.key ?? e.title}
                  </Link>{' '}
                  {e.title} <span className="text-slate-400">({e.item_type})</span>
                </li>
              ))}
              {cr.impact.length === 0 && <li>Nothing linked.</li>}
            </ul>
          </div>
        </details>
      ))}
      {!isLoading && (crs ?? []).length === 0 && <p className="text-sm text-slate-400">No change requests yet.</p>}
    </div>
  )
}

function AuditTab({ projectId }: { projectId: string }) {
  const [action, setAction] = useState('')
  const { data: events, error } = useProjectAudit(projectId, action ? { action } : {})
  return (
    <div>
      <select
        className="mb-2 rounded-md border border-slate-300 px-2 py-1 text-xs"
        value={action}
        onChange={(e) => setAction(e.target.value)}
      >
        <option value="">All events</option>
        <option value="workflow">Workflow transitions</option>
        <option value="lock">Lock overrides</option>
        <option value="review">Reviews</option>
        <option value="baseline">Baselines</option>
        <option value="item.delete">Deletions</option>
        <option value="link">Suspect clearance</option>
      </select>
      {error ? (
        <p className="text-sm text-slate-400">The audit log needs at least the reviewer role on this project.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-xs">
          {(events ?? []).map((e) => (
            <li key={e.id} className="flex gap-3 px-3 py-1.5">
              <span className="w-36 shrink-0 text-slate-400">{new Date(e.created_at).toLocaleString()}</span>
              <span className="w-28 shrink-0 font-medium text-slate-600">{e.actor ?? 'System'}</span>
              <span className="w-40 shrink-0 font-mono text-slate-400">{e.action}</span>
              <span className="text-slate-700">
                {e.summary}
                {typeof e.payload?.comment === 'string' && e.payload.comment && (
                  <span className="italic text-slate-500"> — “{e.payload.comment}”</span>
                )}
              </span>
            </li>
          ))}
          {(events ?? []).length === 0 && <li className="px-3 py-6 text-center text-slate-400">No events.</li>}
        </ul>
      )}
    </div>
  )
}
