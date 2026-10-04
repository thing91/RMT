import { Fragment, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  suggestionsExportUrl,
  useProjectSuggestions,
  useReviews,
  useSuggestion as useSuggestionDetail,
  type SuggestionFilters,
} from '../api/collabHooks'
import { btn } from '../components/collab/Modal'
import { SuggestionStatus } from '../components/collab/SuggestionsPanel'
import DiffText from '../components/collab/DiffText'
import { useAuth } from '../auth/AuthContext'

/** Project-wide list of change suggestions (RIDs) with filters and the
 * customer-facing XLSX export. */
export default function SuggestionsPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const { user } = useAuth()
  const [filters, setFilters] = useState<SuggestionFilters>({ status: 'open,outdated' })
  const [mine, setMine] = useState(false)
  const effective = { ...filters, author_id: mine && user ? user.id : undefined }
  const { data: suggestions, isLoading } = useProjectSuggestions(projectId, effective)
  const { data: reviews } = useReviews(projectId)
  const [expanded, setExpanded] = useState<string | null>(null)

  const set = (k: keyof SuggestionFilters, v: string) => setFilters((f) => ({ ...f, [k]: v || undefined }))
  const select = 'rounded-md border border-slate-300 px-2 py-1 text-xs'

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Change suggestions (RIDs)</h1>
          <p className="text-sm text-slate-500">
            Formal proposals to change a requirement — each must be accepted, accepted with modification or rejected
            with a justification.
          </p>
        </div>
        {projectId && (
          <a className={btn.secondary} href={suggestionsExportUrl(projectId, effective)}>
            Export to Excel
          </a>
        )}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select className={select} value={filters.status ?? ''} onChange={(e) => set('status', e.target.value)}>
          <option value="open,outdated">Open (incl. outdated)</option>
          <option value="accepted,accepted_modified">Accepted</option>
          <option value="rejected">Rejected</option>
          <option value="withdrawn">Withdrawn</option>
          <option value="">Any status</option>
        </select>
        <select className={select} value={filters.review_id ?? ''} onChange={(e) => set('review_id', e.target.value)}>
          <option value="">Any review</option>
          {(reviews ?? []).map((r) => (
            <option key={r.id} value={r.id}>
              {r.key} {r.title}
            </option>
          ))}
        </select>
        <select className={select} value={filters.kind ?? ''} onChange={(e) => set('kind', e.target.value)}>
          <option value="">Technical + editorial</option>
          <option value="technical">Technical</option>
          <option value="editorial">Editorial</option>
        </select>
        <select className={select} value={filters.severity ?? ''} onChange={(e) => set('severity', e.target.value)}>
          <option value="">Major + minor</option>
          <option value="major">Major</option>
          <option value="minor">Minor</option>
        </select>
        {user && (
          <label className="flex items-center gap-1 text-xs text-slate-600">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Mine
          </label>
        )}
      </div>
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">ID</th>
              <th className="font-medium">Requirement</th>
              <th className="font-medium">Field</th>
              <th className="font-medium">Justification</th>
              <th className="font-medium">Class</th>
              <th className="font-medium">Author</th>
              <th className="font-medium">Review</th>
              <th className="font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {(suggestions ?? []).map((s) => (
              <Fragment key={s.id}>
                <tr
                  key={s.id}
                  className="cursor-pointer border-t border-slate-100 align-top hover:bg-slate-50"
                  onClick={() => setExpanded(expanded === s.id ? null : s.id)}
                >
                  <td className="px-3 py-1.5 font-mono font-semibold">{s.key}</td>
                  <td>
                    <Link
                      onClick={(e) => e.stopPropagation()}
                      to={`/projects/${projectId}/documents/${s.document_id}?item=${s.item_id}`}
                      className="font-mono text-blue-700 hover:underline"
                    >
                      {s.item_key}
                    </Link>
                  </td>
                  <td className="text-slate-500">{s.target_label}</td>
                  <td className="max-w-xs truncate text-slate-700">{s.rationale}</td>
                  <td className="text-slate-500">
                    <span className={s.severity === 'major' ? 'font-semibold text-red-700' : ''}>{s.severity}</span> ·{' '}
                    {s.kind}
                  </td>
                  <td className="text-slate-500">{s.author}</td>
                  <td className="text-slate-500">{s.review_key}</td>
                  <td>
                    <SuggestionStatus s={s} />
                  </td>
                </tr>
                {expanded === s.id && (
                  <tr key={`${s.id}-x`} className="bg-slate-50">
                    <td colSpan={8} className="px-3 py-2">
                      <ExpandedSuggestion id={s.id} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {!isLoading && (suggestions ?? []).length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-slate-400">
                  No suggestions match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ExpandedSuggestion({ id }: { id: string }) {
  const { data: s } = useSuggestionDetail(id)
  if (!s) return <span className="text-slate-400">Loading…</span>
  return (
    <div className="space-y-1">
      <div className="text-sm">
        <DiffText ops={s.status === 'outdated' ? s.diff_vs_current : s.diff} />
      </div>
      <div className="text-slate-600">
        <b>Why:</b> {s.rationale}
      </div>
      {s.resolution_text && (
        <div className="text-slate-600">
          <b>Response ({s.resolved_by}):</b> {s.resolution_text}
        </div>
      )}
      <div className="text-slate-400">Open the requirement to accept, reject or discuss it.</div>
    </div>
  )
}
