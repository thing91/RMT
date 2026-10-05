import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { apiErrorMessage } from '../api/client'
import { can, useCreateReview, usePermissions, useReviews } from '../api/collabHooks'
import { useDocuments, useItemTypes, useOrg, useOrgUsers, useProjectItems } from '../api/hooks'
import Modal, { btn, input } from '../components/collab/Modal'
import StatusBadge from '../components/collab/StatusBadge'
import { useT } from '../i18n'

const REVIEW_STATUS_COLOR = { open: '#2563eb', closed: '#16a34a', cancelled: '#94a3b8' }

export default function ReviewsPage() {
  const t = useT()
  const { projectId } = useParams<{ projectId: string }>()
  const [status, setStatus] = useState('open')
  const { data: reviews, isLoading } = useReviews(projectId, status ? { status } : {})
  const { data: perms } = usePermissions(projectId)
  const [creating, setCreating] = useState(false)

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">{t('Reviews')}</h1>
          <p className="text-sm text-slate-500">
            {t('A review covers a set of requirements (pinned to the reviewed version), has required reviewers who vote, and collects comments and change suggestions.')}
          </p>
        </div>
        {can(perms, 'review.manage') && (
          <button className={btn.primary} onClick={() => setCreating(true)}>
            + {t('New review')}
          </button>
        )}
      </div>
      <div className="mb-3 flex gap-1 text-xs">
        {[
          ['open', t('Open')],
          ['closed', t('Closed')],
          ['', 'All'],
        ].map(([v, l]) => (
          <button
            key={v}
            onClick={() => setStatus(v)}
            className={`rounded-md px-2.5 py-1 ${status === v ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`}
          >
            {l}
          </button>
        ))}
      </div>
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">{t('Review')}</th>
              <th className="font-medium">{t('Status')}</th>
              <th className="font-medium">{t('Items')}</th>
              <th className="font-medium">{t('Votes')}</th>
              <th className="font-medium">{t('Created')}</th>
            </tr>
          </thead>
          <tbody>
            {(reviews ?? []).map((r) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2">
                  <Link to={r.id} className="font-medium text-blue-700 hover:underline">
                    {r.key} · {r.title}
                  </Link>
                </td>
                <td>
                  <StatusBadge label={r.outcome ? `${r.status} — ${r.outcome}` : r.status} color={REVIEW_STATUS_COLOR[r.status]} small />
                </td>
                <td className="text-slate-600">{r.item_count}</td>
                <td className="text-slate-600">
                  {r.votes_in}/{r.votes_required}
                </td>
                <td className="text-xs text-slate-500">
                  {r.created_by} · {new Date(r.created_at).toLocaleDateString()}
                  {r.due_date && ` · due ${new Date(r.due_date).toLocaleDateString()}`}
                </td>
              </tr>
            ))}
            {!isLoading && (reviews ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-xs text-slate-400">
                  {t('No reviews.')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {creating && projectId && <CreateReviewModal projectId={projectId} onClose={() => setCreating(false)} />}
    </div>
  )
}

function CreateReviewModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const t = useT()
  const navigate = useNavigate()
  const { org } = useOrg()
  const { data: users } = useOrgUsers(org?.id)
  const { data: items } = useProjectItems(projectId)
  const { data: documents } = useDocuments(projectId)
  const { data: itemTypes } = useItemTypes(org?.id)
  const create = useCreateReview(projectId)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [documentId, setDocumentId] = useState('')
  const [statusFilter, setStatusFilter] = useState('review')
  const [itemIds, setItemIds] = useState<Set<string>>(new Set())
  const [participants, setParticipants] = useState<Record<string, boolean>>({})
  const [closeRule, setCloseRule] = useState<'none' | 'major' | 'all'>('major')
  const [requireVotes, setRequireVotes] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const contentTypeIds = new Set((itemTypes ?? []).filter((t) => t.behavior === 'content').map((t) => t.id))
  const candidates = useMemo(
    () =>
      (items ?? []).filter(
        (i) =>
          contentTypeIds.has(i.item_type_id) &&
          (!documentId || i.document_id === documentId) &&
          (!statusFilter || i.attributes.status === statusFilter),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, documentId, statusFilter, itemTypes],
  )

  function toggle(id: string) {
    setItemIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function submit() {
    setError(null)
    create.mutate(
      {
        title: title.trim(),
        description: description.trim() || undefined,
        item_ids: [...itemIds],
        participants: Object.entries(participants).map(([user_id, required]) => ({ user_id, required })),
        close_requires_resolved: closeRule,
        require_all_votes: requireVotes,
        due_date: dueDate ? new Date(dueDate).toISOString() : null,
      },
      {
        onSuccess: (r) => navigate(`/projects/${projectId}/reviews/${r.id}`),
        onError: (err) => setError(apiErrorMessage(err, t('Could not create the review.'))),
      },
    )
  }

  return (
    <Modal
      wide
      title={t('New review')}
      onClose={onClose}
      footer={
        <>
          <button className={btn.secondary} onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className={btn.primary} disabled={!title.trim() || itemIds.size === 0 || create.isPending} onClick={submit}>
            Open review ({itemIds.size} items)
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <div className="flex gap-2">
          <input className={input} placeholder={t('Title, e.g. PDR — EPS requirements')} value={title} onChange={(e) => setTitle(e.target.value)} />
          <input type="date" className="rounded-md border border-slate-300 px-2 text-sm" value={dueDate} onChange={(e) => setDueDate(e.target.value)} title={t('Due date')} />
        </div>
        <textarea className={input} rows={2} placeholder={t('Scope / instructions (optional)')} value={description} onChange={(e) => setDescription(e.target.value)} />

        <div>
          <div className="mb-1 flex items-center gap-2 text-xs">
            <span className="font-medium text-slate-500">{t('Items')}</span>
            <select className="rounded border border-slate-300 px-1 py-0.5" value={documentId} onChange={(e) => setDocumentId(e.target.value)}>
              <option value="">{t('All documents')}</option>
              {(documents ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <select className="rounded border border-slate-300 px-1 py-0.5" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">{t('Any status')}</option>
              <option value="draft">{t('Draft')}</option>
              <option value="review">{t('In Review')}</option>
              <option value="approved">{t('Approved')}</option>
            </select>
            <button className={btn.ghost} onClick={() => setItemIds(new Set(candidates.map((c) => c.id)))}>
              Select all ({candidates.length})
            </button>
            <button className={btn.ghost} onClick={() => setItemIds(new Set())}>
              {t('Clear')}
            </button>
          </div>
          <div className="max-h-48 overflow-auto rounded-md border border-slate-200">
            {candidates.map((i) => (
              <label key={i.id} className="flex items-center gap-2 border-b border-slate-100 px-2 py-1 text-xs last:border-0">
                <input type="checkbox" checked={itemIds.has(i.id)} onChange={() => toggle(i.id)} />
                <span className="font-mono text-slate-500">{i.key}</span>
                <span className="truncate">{i.title}</span>
              </label>
            ))}
            {candidates.length === 0 && <p className="p-2 text-xs text-slate-400">{t('No matching items.')}</p>}
          </div>
        </div>

        <div>
          <div className="mb-1 text-xs font-medium text-slate-500">{t('Reviewers (tick “required” for mandatory votes)')}</div>
          <div className="max-h-40 overflow-auto rounded-md border border-slate-200">
            {(users ?? []).map((u) => (
              <div key={u.id} className="flex items-center gap-3 border-b border-slate-100 px-2 py-1 text-xs last:border-0">
                <label className="flex flex-1 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={u.id in participants}
                    onChange={(e) =>
                      setParticipants((prev) => {
                        const next = { ...prev }
                        if (e.target.checked) next[u.id] = true
                        else delete next[u.id]
                        return next
                      })
                    }
                  />
                  {u.display_name}
                </label>
                {u.id in participants && (
                  <label className="flex items-center gap-1 text-slate-500">
                    <input
                      type="checkbox"
                      checked={participants[u.id]}
                      onChange={(e) => setParticipants((prev) => ({ ...prev, [u.id]: e.target.checked }))}
                    />
                    {t('required')}
                  </label>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-4 text-xs text-slate-600">
          <label className="flex items-center gap-1">
            {t('Closing requires resolving')}
            <select className="rounded border border-slate-300 px-1 py-0.5" value={closeRule} onChange={(e) => setCloseRule(e.target.value as 'none' | 'major' | 'all')}>
              <option value="major">{t('Major suggestions')}</option>
              <option value="all">{t('all suggestions')}</option>
              <option value="none">{t('nothing')}</option>
            </select>
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={requireVotes} onChange={(e) => setRequireVotes(e.target.checked)} />
            {t('all required reviewers must vote')}
          </label>
        </div>
        {error && <p className="rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-700">⚠ {error}</p>}
      </div>
    </Modal>
  )
}
