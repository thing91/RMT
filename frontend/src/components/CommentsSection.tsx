import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth/AuthContext'
import { apiErrorMessage } from '../api/client'
import {
  useCreateComment,
  useDeleteComment,
  useItemComments,
  useOrgUsers,
  useReopenComment,
  useResolveComment,
  useUpdateComment,
} from '../api/hooks'
import type { ItemComment, OrgUser } from '../api/types'
import { useSuggestionComments } from '../api/collabHooks'
import MentionTextarea from './MentionTextarea'
import { useT } from '../i18n'

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString()
}

/** Highlights `@username` tokens that resolve to a real org user — same
 * "only decorate what actually resolves" convention as DescriptionPreview's
 * glossary/standard/parameter refs, just without the "undefined" styling
 * since an unresolved `@word` here is far more likely to just be an email
 * address or a stray "@" than a broken reference. */
function renderWithMentions(body: string, users: OrgUser[]) {
  const byUsername = new Map(users.map((u) => [u.username.toLowerCase(), u]))
  const parts: (string | { user: OrgUser; raw: string })[] = []
  let lastIndex = 0
  for (const match of body.matchAll(/@([A-Za-z0-9_.-]+)/g)) {
    const index = match.index ?? 0
    const user = byUsername.get(match[1].toLowerCase())
    if (!user) continue
    if (index > lastIndex) parts.push(body.slice(lastIndex, index))
    parts.push({ user, raw: match[0] })
    lastIndex = index + match[0].length
  }
  if (lastIndex < body.length) parts.push(body.slice(lastIndex))
  return parts.map((part, i) =>
    typeof part === 'string' ? (
      <span key={i}>{part}</span>
    ) : (
      <span key={i} className="font-medium text-blue-700" title={part.user.display_name}>
        {part.raw}
      </span>
    ),
  )
}

export function CommentForm({
  onSubmit,
  onCancel,
  autoFocus,
  placeholder,
  submitLabel,
  users,
}: {
  onSubmit: (body: string) => void
  onCancel?: () => void
  autoFocus?: boolean
  placeholder: string
  submitLabel: string
  users: OrgUser[]
}) {
  const t = useT()
  const [body, setBody] = useState('')

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!body.trim()) return
    onSubmit(body.trim())
    setBody('')
  }

  return (
    <form onSubmit={submit} className="space-y-1.5">
      <MentionTextarea
        autoFocus={autoFocus}
        rows={2}
        placeholder={placeholder}
        value={body}
        onChange={setBody}
        users={users}
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!body.trim()}
          className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="text-xs text-slate-400 hover:text-slate-700">
            {t('Cancel')}
          </button>
        )}
      </div>
    </form>
  )
}

function CommentRow({
  comment,
  currentUserId,
  isReply,
  onReply,
  users,
}: {
  comment: ItemComment
  currentUserId: string | undefined
  isReply: boolean
  onReply?: () => void
  users: OrgUser[]
}) {
  const t = useT()
  const updateComment = useUpdateComment()
  const deleteComment = useDeleteComment()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(comment.body)
  const [error, setError] = useState<string | null>(null)
  const isOwn = comment.author_id === currentUserId

  function saveEdit() {
    if (!draft.trim()) return
    setError(null)
    updateComment.mutate(
      { id: comment.id, body: draft.trim() },
      {
        onSuccess: () => setEditing(false),
        onError: (err) => setError(apiErrorMessage(err, t('Could not save this edit.'))),
      },
    )
  }

  return (
    <div className={isReply ? 'ml-6 border-l-2 border-slate-100 pl-3' : ''}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-slate-700">{comment.author_name}</span>
        <span className="text-[11px] text-slate-400">{formatTime(comment.created_at)}</span>
      </div>
      {editing ? (
        <div className="mt-1 space-y-1.5">
          <MentionTextarea
            autoFocus
            className="w-full rounded-md border border-blue-400 px-2 py-1.5 text-sm focus:outline-none"
            rows={2}
            value={draft}
            onChange={setDraft}
            users={users}
          />
          <div className="flex gap-2">
            <button
              onClick={saveEdit}
              className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700"
            >
              {t('Save')}
            </button>
            <button
              onClick={() => {
                setEditing(false)
                setDraft(comment.body)
                setError(null)
              }}
              className="text-xs text-slate-400 hover:text-slate-700"
            >
              {t('Cancel')}
            </button>
          </div>
          {error && <p className="text-xs text-red-600">⚠ {error}</p>}
        </div>
      ) : (
        <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-700">
          {renderWithMentions(comment.body, users)}
        </p>
      )}
      {!editing && (
        <div className="mt-1 flex gap-3 text-xs text-slate-400">
          {onReply && (
            <button onClick={onReply} className="hover:text-blue-600">
              {t('Reply')}
            </button>
          )}
          {isOwn && (
            <button onClick={() => setEditing(true)} className="hover:text-slate-700">
              {t('Edit')}
            </button>
          )}
          <button onClick={() => deleteComment.mutate(comment.id)} className="hover:text-red-600">
            {t('Delete')}
          </button>
        </div>
      )}
    </div>
  )
}

export function Thread({
  thread,
  currentUserId,
  users,
  onConvert,
}: {
  thread: ItemComment
  currentUserId: string | undefined
  users: OrgUser[]
  onConvert?: (comment: ItemComment) => void
}) {
  const t = useT()
  const createComment = useCreateComment(thread.item_id)
  const resolveComment = useResolveComment()
  const reopenComment = useReopenComment()
  const [replying, setReplying] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  function submitReply(body: string) {
    createComment.mutate(
      { body, parent_comment_id: thread.id },
      { onSuccess: () => setReplying(false) },
    )
  }

  function toggleResolve() {
    setActionError(null)
    const mutation = thread.resolved ? reopenComment : resolveComment
    mutation.mutate(thread.id, {
      onError: (err) => setActionError(apiErrorMessage(err, t('Could not update this thread.'))),
    })
  }

  return (
    <div
      className={`rounded-md border p-2.5 ${
        thread.resolved ? 'border-green-200 bg-green-50/50' : 'border-slate-200 bg-slate-50'
      }`}
    >
      {thread.resolved && (
        <div className="mb-2 flex items-center justify-between text-xs text-green-700">
          <span>
            ✓ Resolved by <span className="font-medium">{thread.resolved_by}</span>
            {thread.resolved_at && ` on ${formatTime(thread.resolved_at)}`}
          </span>
        </div>
      )}
      <CommentRow
        comment={thread}
        currentUserId={currentUserId}
        isReply={false}
        onReply={() => setReplying((v) => !v)}
        users={users}
      />

      {thread.replies.length > 0 && (
        <div className="mt-2 space-y-2">
          {thread.replies.map((reply) => (
            <CommentRow key={reply.id} comment={reply} currentUserId={currentUserId} isReply users={users} />
          ))}
        </div>
      )}

      {replying && (
        <div className="ml-6 mt-2 border-l-2 border-slate-100 pl-3">
          <CommentForm
            autoFocus
            placeholder={t('Write a reply…')}
            submitLabel={t('Reply')}
            onSubmit={submitReply}
            onCancel={() => setReplying(false)}
            users={users}
          />
        </div>
      )}

      <div className="mt-2 flex items-center gap-2">
        <button onClick={toggleResolve} className="text-xs font-medium text-slate-500 hover:text-slate-800">
          {thread.resolved ? t('Reopen') : '✓ Mark resolved'}
        </button>
        {onConvert && currentUserId && (
          <button
            onClick={() => onConvert(thread)}
            title={t('Turn this discussion into a formal change suggestion that must be resolved')}
            className="text-xs font-medium text-slate-500 hover:text-blue-700"
          >
            → {t('Make it a suggestion')}
          </button>
        )}
        {actionError && <span className="text-xs text-red-600">⚠ {actionError}</span>}
      </div>
    </div>
  )
}

/** Item-level discussion (§ user request, not in the original brief) — a
 * flat two-level thread per top-level comment (comment + replies), each
 * thread independently resolvable/reopenable. Modeled on GitHub PR review
 * comments / Google Docs suggestions rather than arbitrary nesting. */
export default function CommentsSection({
  itemId,
  orgId,
  filter = 'all',
  suggestionId,
  onConvert,
  title = 'Comments',
}: {
  itemId: string
  orgId: string
  /** 'unresolved' hides resolved threads entirely — Document View uses this
   * so a resolved discussion doesn't clutter the reading view; it stays
   * reachable from the document-level "Resolved comments" panel instead. */
  filter?: 'all' | 'unresolved'
  /** Show/post the discussion thread of this change suggestion instead of
   * the item's general comments. */
  suggestionId?: string
  /** Offer "make it a suggestion" on each thread. */
  onConvert?: (comment: ItemComment) => void
  title?: string
}) {
  const t = useT()
  const { user } = useAuth()
  const itemThreads = useItemComments(suggestionId ? undefined : itemId)
  const suggestionThreads = useSuggestionComments(suggestionId)
  const { data: allThreads, isLoading } = suggestionId ? suggestionThreads : itemThreads
  const { data: orgUsers } = useOrgUsers(orgId)
  const createComment = useCreateComment(itemId)

  const users = orgUsers ?? []
  const threads = filter === 'unresolved' ? (allThreads ?? []).filter((t) => !t.resolved) : allThreads ?? []
  const openCount = threads.filter((t) => !t.resolved).length
  const resolvedCount = threads.filter((t) => t.resolved).length

  function submitTopLevel(body: string) {
    createComment.mutate(suggestionId ? { body, suggestion_id: suggestionId } : { body })
  }

  return (
    <div className="border-t border-slate-200 pt-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {t(title)}{threads.length > 0 && ` (${t('{n} open', { n: openCount })}${resolvedCount ? `, ${t('{n} resolved', { n: resolvedCount })}` : ''})`}
      </h3>

      <div className="mb-3">
        <CommentForm placeholder={t('Add a comment… (@ to mention someone)')} submitLabel={t('Comment')} onSubmit={submitTopLevel} users={users} />
      </div>

      {isLoading && <p className="text-xs text-slate-400">{t('Loading comments…')}</p>}

      <div className="space-y-2">
        {threads.map((thread) => (
          <Thread key={thread.id} thread={thread} currentUserId={user?.id} users={users} onConvert={onConvert} />
        ))}
        {!isLoading && threads.length === 0 && (
          <p className="text-xs text-slate-400">
            {filter === 'unresolved' ? t('No open comments.') : t('No comments yet.')}
          </p>
        )}
      </div>
    </div>
  )
}
