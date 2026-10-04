import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiErrorDetail, apiErrorMessage } from '../api/client'
import { useProjectSuggestions, useReview, useReviewAction, useProjectWorkflows } from '../api/collabHooks'
import { useOrg, useOrgUsers } from '../api/hooks'
import type { ReviewDetail } from '../api/types'
import Modal, { btn, input } from '../components/collab/Modal'
import StatusBadge from '../components/collab/StatusBadge'
import { SuggestionStatus } from '../components/collab/SuggestionsPanel'
import { suggestionsExportUrl } from '../api/collabHooks'

const VOTE_LABEL: Record<string, string> = {
  approve: '✓ Approve',
  approve_with_comments: '✓ Approve with comments',
  reject: '✕ Reject',
}

export default function ReviewDetailPage() {
  const { projectId, reviewId } = useParams<{ projectId: string; reviewId: string }>()
  const { data: review, isLoading } = useReview(reviewId)
  const { data: suggestions } = useProjectSuggestions(projectId, { review_id: reviewId })
  const action = useReviewAction(reviewId!)
  const [error, setError] = useState<string | null>(null)
  const [voting, setVoting] = useState<string | null>(null)
  const [voteComment, setVoteComment] = useState('')
  const [closing, setClosing] = useState(false)

  if (isLoading || !review) return <div className="p-6 text-slate-500">Loading…</div>

  async function run(path: string, body?: unknown, method: 'post' | 'delete' = 'post') {
    setError(null)
    try {
      await action.mutateAsync({ path, body, method })
      return true
    } catch (err) {
      const d = apiErrorDetail(err)
      setError([d?.message ?? apiErrorMessage(err, 'That did not work.'), ...(d?.reasons ?? [])].join(' '))
      return false
    }
  }

  const open = review.status === 'open'
  return (
    <div className="mx-auto max-w-5xl p-6">
      <Link to={`/projects/${projectId}/reviews`} className="text-xs text-slate-500 hover:text-blue-600">
        ← Reviews
      </Link>
      <div className="mt-1 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">
            {review.key} · {review.title}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <StatusBadge
              label={review.outcome ? `${review.status} — ${review.outcome}` : review.status}
              color={open ? '#2563eb' : review.status === 'closed' ? '#16a34a' : '#94a3b8'}
            />
            opened by {review.created_by} on {new Date(review.created_at).toLocaleDateString()}
            {review.due_date && <> · due {new Date(review.due_date).toLocaleDateString()}</>}
            {review.closed_at && (
              <>
                {' '}
                · closed by {review.closed_by} on {new Date(review.closed_at).toLocaleDateString()}
              </>
            )}
          </div>
          {review.description && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{review.description}</p>}
        </div>
        {open && review.can_manage && (
          <div className="flex shrink-0 gap-2">
            <button className={btn.secondary} onClick={() => run('/cancel')}>
              Cancel review
            </button>
            <button className={btn.primary} onClick={() => setClosing(true)}>
              Close review…
            </button>
          </div>
        )}
      </div>
      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">⚠ {error}</p>}
      {open && review.close_blockers.length > 0 && (
        <ul className="mt-3 list-disc rounded-md bg-amber-50 py-2 pl-6 pr-3 text-xs text-amber-800">
          {review.close_blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <section className="rounded-lg border border-slate-200 bg-white p-3 md:col-span-2">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Items ({review.items.length})
          </h2>
          <table className="w-full text-sm">
            <tbody>
              {review.items.map((i) => (
                <tr key={i.item_id} className="border-t border-slate-100">
                  <td className="py-1.5 pr-2">
                    <Link
                      to={`/projects/${projectId}/documents/${i.document_id}?item=${i.item_id}`}
                      className="font-mono text-xs text-blue-700 hover:underline"
                    >
                      {i.key}
                    </Link>
                  </td>
                  <td className="py-1.5 text-slate-700">{i.title}</td>
                  <td className="text-xs text-slate-500">{i.status}</td>
                  <td className="text-xs">
                    {i.changed_since ? (
                      <span className="text-amber-700" title="Changed since it was put up for review">
                        v{i.reviewed_version} → v{i.current_version}
                      </span>
                    ) : (
                      <span className="text-slate-400">v{i.reviewed_version}</span>
                    )}
                  </td>
                  <td className="text-right text-xs text-slate-500">
                    {i.open_suggestions > 0 && `${i.open_suggestions} open RID`}
                  </td>
                  {open && review.can_manage && (
                    <td className="pl-2 text-right">
                      <button
                        className="text-xs text-slate-400 hover:text-red-600"
                        onClick={() => run(`/items/${i.item_id}`, undefined, 'delete')}
                        title="Remove from review"
                      >
                        ✕
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-3">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Reviewers ({review.votes_in}/{review.votes_required} required votes)
          </h2>
          <ul className="space-y-1.5 text-sm">
            {review.participants.map((p) => (
              <li key={p.user_id}>
                <div className="flex items-center justify-between">
                  <span>
                    {p.name}
                    {!p.required && <span className="ml-1 text-xs text-slate-400">(optional)</span>}
                  </span>
                  <span
                    className={`text-xs ${
                      p.vote === 'reject' ? 'text-red-600' : p.vote ? 'text-green-700' : 'text-slate-400'
                    }`}
                  >
                    {p.vote ? VOTE_LABEL[p.vote] : 'pending'}
                  </span>
                </div>
                {p.vote_comment && <div className="text-xs italic text-slate-500">“{p.vote_comment}”</div>}
              </li>
            ))}
          </ul>
          {open && review.can_manage && <AddParticipant review={review} run={run} />}
          {open && review.i_am_participant && (
            <div className="mt-3 border-t border-slate-100 pt-3">
              <div className="mb-1 text-xs font-medium text-slate-500">
                Your vote{review.my_vote && `: ${VOTE_LABEL[review.my_vote]}`}
              </div>
              <div className="flex flex-wrap gap-1">
                {Object.entries(VOTE_LABEL).map(([v, l]) => (
                  <button
                    key={v}
                    onClick={() => setVoting(v)}
                    className={`rounded-md border px-2 py-0.5 text-xs ${
                      voting === v ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-300 text-slate-600'
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
              {voting && (
                <div className="mt-2 space-y-1">
                  <textarea
                    className={input}
                    rows={2}
                    placeholder={voting === 'reject' ? 'Why? (required)' : 'Comment (optional)'}
                    value={voteComment}
                    onChange={(e) => setVoteComment(e.target.value)}
                  />
                  <button
                    className={btn.primary}
                    disabled={voting === 'reject' && !voteComment.trim()}
                    onClick={async () => {
                      if (await run('/vote', { vote: voting, comment: voteComment.trim() || null })) {
                        setVoting(null)
                        setVoteComment('')
                      }
                    }}
                  >
                    Submit vote
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      <section className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Change suggestions / RIDs raised in this review ({(suggestions ?? []).length})
          </h2>
          {projectId && (
            <a className={btn.ghost} href={suggestionsExportUrl(projectId, { review_id: reviewId })}>
              Export RID table (XLSX)
            </a>
          )}
        </div>
        <table className="w-full text-xs">
          <tbody>
            {(suggestions ?? []).map((s) => (
              <tr key={s.id} className="border-t border-slate-100 align-top">
                <td className="py-1.5 pr-2 font-mono font-semibold">{s.key}</td>
                <td className="pr-2">
                  <Link
                    to={`/projects/${projectId}/documents/${s.document_id}?item=${s.item_id}`}
                    className="font-mono text-blue-700 hover:underline"
                  >
                    {s.item_key}
                  </Link>
                </td>
                <td className="pr-2 text-slate-500">{s.target_label}</td>
                <td className="pr-2 text-slate-700">{s.rationale}</td>
                <td className="pr-2 uppercase text-slate-500">{s.severity}</td>
                <td className="pr-2 text-slate-500">{s.author}</td>
                <td>
                  <SuggestionStatus s={s} />
                </td>
              </tr>
            ))}
            {(suggestions ?? []).length === 0 && (
              <tr>
                <td className="py-3 text-slate-400">
                  None yet — reviewers raise them from an item's “Suggest change” button.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {closing && <CloseReviewModal review={review} run={run} onClose={() => setClosing(false)} />}
    </div>
  )
}

function AddParticipant({ review, run }: { review: ReviewDetail; run: (p: string, b?: unknown) => Promise<boolean> }) {
  const { org } = useOrg()
  const { data: users } = useOrgUsers(org?.id)
  const [userId, setUserId] = useState('')
  const existing = new Set(review.participants.map((p) => p.user_id))
  return (
    <div className="mt-2 flex gap-1">
      <select className="flex-1 rounded-md border border-slate-300 px-1 py-0.5 text-xs" value={userId} onChange={(e) => setUserId(e.target.value)}>
        <option value="">Add reviewer…</option>
        {(users ?? [])
          .filter((u) => !existing.has(u.id))
          .map((u) => (
            <option key={u.id} value={u.id}>
              {u.display_name}
            </option>
          ))}
      </select>
      <button
        className={btn.secondary}
        disabled={!userId}
        onClick={async () => {
          if (await run('/participants', { user_id: userId, required: true })) setUserId('')
        }}
      >
        Add
      </button>
    </div>
  )
}

function CloseReviewModal({
  review,
  run,
  onClose,
}: {
  review: ReviewDetail
  run: (p: string, b?: unknown) => Promise<boolean>
  onClose: () => void
}) {
  const { projectId } = useParams<{ projectId: string }>()
  const { data: workflows } = useProjectWorkflows(projectId)
  const [outcome, setOutcome] = useState('approved')
  const [comment, setComment] = useState('')
  const [applyTransition, setApplyTransition] = useState('')
  const [password, setPassword] = useState('')
  const transitions = new Map<string, { label: string; signature: boolean }>()
  for (const w of workflows ?? [])
    for (const t of w.transitions)
      if (!transitions.has(t.key) && !(t.roles.length === 1 && t.roles[0] === 'system'))
        transitions.set(t.key, { label: t.label, signature: t.actions.some((a) => a.type === 'require_signature') })
  const needsSignature = !!applyTransition && transitions.get(applyTransition)?.signature

  return (
    <Modal
      title={`Close ${review.key}`}
      onClose={onClose}
      footer={
        <>
          <button className={btn.secondary} onClick={onClose}>
            Cancel
          </button>
          <button
            className={btn.primary}
            disabled={!!needsSignature && !password}
            onClick={async () => {
              const ok = await run('/close', {
                outcome,
                comment: comment.trim() || null,
                apply_transition: applyTransition || null,
                password: password || null,
              })
              if (ok) onClose()
            }}
          >
            Close review
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Outcome</span>
          <select className={input} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="approved">Approved</option>
            <option value="approved_with_changes">Approved with changes</option>
            <option value="rejected">Rejected</option>
            <option value="completed">Completed</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Also run on every reviewed item (optional)</span>
          <select className={input} value={applyTransition} onChange={(e) => setApplyTransition(e.target.value)}>
            <option value="">— nothing —</option>
            {[...transitions.entries()].map(([k, t]) => (
              <option key={k} value={k}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        {needsSignature && (
          <input
            type="password"
            className={input}
            placeholder="Electronic signature — your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
        <textarea className={input} rows={2} placeholder="Closing comment" value={comment} onChange={(e) => setComment(e.target.value)} />
      </div>
    </Modal>
  )
}
