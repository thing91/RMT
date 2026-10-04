import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiErrorMessage } from '../api/client'
import { useSubjectTransition, useSubjectWorkflow } from '../api/collabHooks'
import {
  useIdea,
  useIdeaComments,
  useIdeas,
  useReleaseNotes,
  useRoadmapAction,
  useRoadmapMeta,
  type IdeaDetail,
} from '../api/roadmap'
import { btn, input } from '../components/collab/Modal'
import TransitionPanel from '../components/collab/TransitionPanel'
import { IdeaStatusBadge, VoteButton } from './RoadmapPage'

const HORIZON: Record<string, string> = { now: 'Now', next: 'Soon', later: 'Later' }

export default function IdeaPage() {
  const { ideaId } = useParams<{ ideaId: string }>()
  const { data: idea, isLoading } = useIdea(ideaId)
  const action = useRoadmapAction()
  const [editing, setEditing] = useState(false)

  if (isLoading || !idea) return <div className="p-6 text-slate-500">Loading…</div>

  return (
    <div className="mx-auto max-w-5xl p-6">
      <Link to="/roadmap?tab=ideas" className="text-xs text-slate-500 hover:text-blue-600">
        ← All ideas
      </Link>
      <div className="mt-2 flex gap-4">
        <VoteButton idea={idea} />
        <div className="min-w-0 flex-1">
          {editing ? (
            <EditIdea idea={idea} onDone={() => setEditing(false)} />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold text-slate-800">{idea.title}</h1>
                <IdeaStatusBadge idea={idea} />
                {idea.horizon && !['released', 'declined', 'duplicate'].includes(idea.status) && (
                  <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                    {{ now: 'Now', next: 'Soon', later: 'Later' }[idea.horizon]}
                  </span>
                )}
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{idea.description || <i className="text-slate-400">No description.</i>}</p>
            </>
          )}
          {idea.duplicate_of && (
            <p className="mt-2 rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-600">
              Duplicate of{' '}
              <Link className="text-blue-700 hover:underline" to={`/roadmap/ideas/${idea.duplicate_of.id}`}>
                {idea.duplicate_of.key} {idea.duplicate_of.title}
              </Link>{' '}
              — votes and followers were moved there.
            </p>
          )}
          {idea.release && (
            <p className="mt-2 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
              Shipped in <b>v{idea.release.version}</b> — {idea.release.title}
            </p>
          )}
        </div>
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-3">
        <div className="space-y-6 md:col-span-2">
          <Comments idea={idea} />
        </div>
        <aside className="space-y-4 text-sm">
          <section className="rounded-lg border border-slate-200 bg-white p-3">
            <dl className="space-y-1.5 text-xs">
              <Row k="ID" v={idea.key} />
              <Row k="Category" v={idea.category} />
              <Row k="Submitted by" v={`${idea.author} · ${idea.organization}`} />
              <Row k="Submitted" v={new Date(idea.created_at).toLocaleDateString()} />
              <Row k="Followers" v={String(idea.watchers)} />
            </dl>
            <div className="mt-3 flex gap-2">
              <button className={btn.secondary} onClick={() => action.mutate({ method: 'post', path: `/ideas/${idea.id}/watch` })}>
                {idea.watching ? '★ Following' : '☆ Follow'}
              </button>
              {idea.can_edit && !editing && (
                <button className={btn.ghost} onClick={() => setEditing(true)}>
                  Edit
                </button>
              )}
            </div>
          </section>

          {idea.can_manage && <ProductPanel idea={idea} />}

          <section className="rounded-lg border border-slate-200 bg-white p-3">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Status history</h2>
            <ol className="relative ml-2 border-l border-slate-200 text-xs">
              {idea.timeline.map((t, i) => (
                <li key={i} className="mb-2 ml-3">
                  <span className="absolute -left-1 mt-1 h-2 w-2 rounded-full bg-blue-400" />
                  <b className="text-slate-700">{t.to}</b> <span className="text-slate-400">· {t.actor}</span>
                  <div className="text-slate-400">{new Date(t.at).toLocaleString()}</div>
                  {t.comment && <div className="italic text-slate-500">“{t.comment}”</div>}
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-slate-400">{k}</dt>
      <dd className="text-right text-slate-700">{v}</dd>
    </div>
  )
}

function EditIdea({ idea, onDone }: { idea: IdeaDetail; onDone: () => void }) {
  const { data: meta } = useRoadmapMeta()
  const action = useRoadmapAction()
  const [title, setTitle] = useState(idea.title)
  const [description, setDescription] = useState(idea.description)
  const [category, setCategory] = useState(idea.category)
  return (
    <div className="space-y-2">
      <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea className={input} rows={5} value={description} onChange={(e) => setDescription(e.target.value)} />
      <select className={input} value={category} onChange={(e) => setCategory(e.target.value)}>
        {(meta?.categories ?? []).map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
      <div className="flex gap-2">
        <button
          className={btn.primary}
          onClick={() => action.mutate({ method: 'patch', path: `/ideas/${idea.id}`, body: { title, description, category } }, { onSuccess: onDone })}
        >
          Save
        </button>
        <button className={btn.secondary} onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  )
}

function ProductPanel({ idea }: { idea: IdeaDetail }) {
  const { data: workflow } = useSubjectWorkflow('idea', idea.id)
  const transition = useSubjectTransition('idea')
  const action = useRoadmapAction()
  const { data: notes } = useReleaseNotes()
  const { data: others } = useIdeas({ sort: 'votes' })
  const [note, setNote] = useState(idea.internal_note ?? '')
  return (
    <section className="space-y-3 rounded-lg border border-violet-200 bg-violet-50/50 p-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-violet-700">Product team</h2>
      <TransitionPanel
        workflow={workflow}
        run={(key, inp) => transition.mutateAsync({ id: idea.id, key, input: inp })}
        extraFields={(t, values, set) =>
          t.key === 'release' ? (
            <select className={input} value={String(values.release_note_id ?? '')} onChange={(e) => set('release_note_id', e.target.value)}>
              <option value="">Release-notes entry (required)…</option>
              {(notes ?? []).map((n) => (
                <option key={n.id} value={n.id}>
                  v{n.version} — {n.title}
                </option>
              ))}
            </select>
          ) : t.key === 'mark_duplicate' ? (
            <select className={input} value={String(values.duplicate_of_id ?? '')} onChange={(e) => set('duplicate_of_id', e.target.value)}>
              <option value="">Original idea (required)…</option>
              {(others?.items ?? [])
                .filter((o) => o.id !== idea.id && o.status !== 'duplicate')
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.key} {o.title}
                  </option>
                ))}
            </select>
          ) : null
        }
      />
      <div className="grid grid-cols-3 gap-2 text-xs">
        {(
          [
            ['horizon', 'Horizon', ['', 'now', 'next', 'later']],
            ['priority', 'Priority', ['', 'low', 'medium', 'high']],
            ['effort', 'Effort', ['', 'S', 'M', 'L', 'XL']],
          ] as const
        ).map(([field, label, options]) => (
          <label key={field}>
            <span className="mb-0.5 block text-slate-500">{label}</span>
            <select
              className="w-full rounded border border-slate-300 px-1 py-0.5"
              value={(idea[field] as string | null) ?? ''}
              onChange={(e) => action.mutate({ method: 'patch', path: `/ideas/${idea.id}`, body: { [field]: e.target.value || null } })}
            >
              {options.map((o) => (
                <option key={o} value={o}>
                  {o ? (HORIZON[o] ?? o) : '—'}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <label className="block text-xs">
        <span className="mb-0.5 block text-slate-500">Internal note (never shown to users)</span>
        <textarea
          className="w-full rounded border border-slate-300 px-1 py-0.5"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note !== (idea.internal_note ?? '') && action.mutate({ method: 'patch', path: `/ideas/${idea.id}`, body: { internal_note: note } })}
        />
      </label>
    </section>
  )
}

function Comments({ idea }: { idea: IdeaDetail }) {
  const { data: comments } = useIdeaComments(idea.id)
  const action = useRoadmapAction()
  const [body, setBody] = useState('')
  const [official, setOfficial] = useState(false)
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [reply, setReply] = useState('')
  const [error, setError] = useState<string | null>(null)
  const top = (comments ?? []).filter((c) => !c.parent_id)
  const replies = (id: string) => (comments ?? []).filter((c) => c.parent_id === id)

  function post(text: string, parent: string | null, isOfficial: boolean, done: () => void) {
    setError(null)
    action.mutate(
      { method: 'post', path: `/ideas/${idea.id}/comments`, body: { body: text, official: isOfficial, parent_id: parent } },
      { onSuccess: done, onError: (e) => setError(apiErrorMessage(e, 'Could not post.')) },
    )
  }

  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Discussion ({(comments ?? []).length})</h2>
      {idea.status === 'needs_info' && idea.mine && (
        <p className="mb-2 rounded-md bg-violet-50 px-3 py-2 text-xs text-violet-800">
          The product team needs more information — your reply sends the idea back to review.
        </p>
      )}
      <div className="mb-4 space-y-2">
        <textarea className={input} rows={3} placeholder="Add a comment…" value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="flex items-center gap-3">
          <button className={btn.primary} disabled={!body.trim()} onClick={() => post(body, null, official, () => { setBody(''); setOfficial(false) })}>
            Comment
          </button>
          {idea.can_manage && (
            <label className="flex items-center gap-1 text-xs text-violet-700">
              <input type="checkbox" checked={official} onChange={(e) => setOfficial(e.target.checked)} /> Official reply (notifies all followers)
            </label>
          )}
        </div>
        {error && <p className="text-xs text-red-600">⚠ {error}</p>}
      </div>
      <ul className="space-y-3">
        {top.map((c) => (
          <li key={c.id} className={`rounded-lg border p-3 ${c.official ? 'border-violet-300 bg-violet-50' : 'border-slate-200 bg-white'}`}>
            <div className="flex items-baseline justify-between text-xs">
              <span className={`font-medium ${c.official ? 'text-violet-800' : 'text-slate-700'}`}>
                {c.official && '★ '}
                {c.author}
              </span>
              <span className="text-slate-400">{new Date(c.created_at).toLocaleString()}</span>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{c.body}</p>
            {replies(c.id).map((r) => (
              <div key={r.id} className={`ml-4 mt-2 border-l-2 pl-3 ${r.official ? 'border-violet-300' : 'border-slate-200'}`}>
                <div className="text-xs font-medium text-slate-600">
                  {r.official && '★ '}
                  {r.author} <span className="font-normal text-slate-400">· {new Date(r.created_at).toLocaleString()}</span>
                </div>
                <p className="whitespace-pre-wrap text-sm text-slate-700">{r.body}</p>
              </div>
            ))}
            {replyTo === c.id ? (
              <div className="ml-4 mt-2 space-y-1">
                <textarea className={input} rows={2} value={reply} onChange={(e) => setReply(e.target.value)} />
                <button className={btn.primary} disabled={!reply.trim()} onClick={() => post(reply, c.id, false, () => { setReply(''); setReplyTo(null) })}>
                  Reply
                </button>
              </div>
            ) : (
              <button className="mt-1 text-xs text-slate-500 hover:text-blue-600" onClick={() => setReplyTo(c.id)}>
                Reply
              </button>
            )}
          </li>
        ))}
        {top.length === 0 && <li className="text-sm text-slate-400">No comments yet.</li>}
      </ul>
    </section>
  )
}
