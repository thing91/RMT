import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { apiErrorMessage } from '../api/client'
import {
  useIdeas,
  useReleaseNotes,
  useRoadmapAction,
  useRoadmapBoard,
  useRoadmapMeta,
  useSimilarIdeas,
  type Idea,
  type IdeaFilters,
} from '../api/roadmap'
import { useAuth } from '../auth/AuthContext'
import Modal, { btn, input } from '../components/collab/Modal'
import StatusBadge from '../components/collab/StatusBadge'

const HORIZON_LABEL: Record<string, string> = { now: 'Now', next: 'Soon', later: 'Later' }

export function IdeaStatusBadge({ idea, small }: { idea: Pick<Idea, 'status' | 'status_label'>; small?: boolean }) {
  const { data: meta } = useRoadmapMeta()
  const color = meta?.states.find((s) => s.key === idea.status)?.color
  return <StatusBadge label={idea.status_label} color={color} small={small} />
}

export function VoteButton({ idea }: { idea: Idea }) {
  const action = useRoadmapAction()
  const closed = ['duplicate', 'declined', 'released'].includes(idea.status)
  return (
    <button
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        action.mutate({ method: idea.voted ? 'delete' : 'post', path: `/ideas/${idea.id}/vote` })
      }}
      disabled={closed || action.isPending}
      title={closed ? 'Voting closed' : idea.voted ? 'Remove your vote' : 'Vote for this idea'}
      className={`flex w-12 shrink-0 flex-col items-center rounded-md border py-1 text-xs font-semibold ${
        idea.voted ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300'
      } disabled:cursor-not-allowed disabled:opacity-60`}
    >
      <span aria-hidden>▲</span>
      {idea.votes}
    </button>
  )
}

export default function RoadmapPage() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as 'roadmap' | 'ideas' | 'releases') ?? 'roadmap'
  const [submitting, setSubmitting] = useState(false)
  const setTab = (t: string) => setParams({ tab: t }, { replace: true })

  if (!user) return <div className="p-8 text-sm text-slate-500">Sign in to see the roadmap and suggest improvements.</div>

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Roadmap</h1>
          <p className="text-sm text-slate-500">
            Suggest improvements to RMT, vote for the ones you need, and follow what happens to them.
          </p>
        </div>
        <button className={btn.primary} onClick={() => setSubmitting(true)}>
          + Suggest an idea
        </button>
      </div>
      <div className="mb-4 flex gap-1 border-b border-slate-200 text-sm">
        {[
          ['roadmap', 'Roadmap'],
          ['ideas', 'All ideas'],
          ['releases', 'Release notes'],
        ].map(([k, l]) => (
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
      {tab === 'roadmap' && <Board />}
      {tab === 'ideas' && <IdeaList />}
      {tab === 'releases' && <ReleaseNotes />}
      {submitting && <SubmitIdea onClose={() => setSubmitting(false)} />}
    </div>
  )
}

function CategoryFilter({ value, onChange }: { value?: string; onChange: (v?: string) => void }) {
  const { data: meta } = useRoadmapMeta()
  return (
    <select className="rounded-md border border-slate-300 px-2 py-1 text-xs" value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
      <option value="">All categories</option>
      {(meta?.categories ?? []).map((c) => (
        <option key={c}>{c}</option>
      ))}
    </select>
  )
}

function Board() {
  const [category, setCategory] = useState<string>()
  const { data: board } = useRoadmapBoard(category)
  const columns: [keyof NonNullable<typeof board>, string][] = [
    ['planned', 'Planned'],
    ['in_progress', 'In progress'],
    ['released', 'Released'],
  ]
  return (
    <div>
      <div className="mb-3">
        <CategoryFilter value={category} onChange={setCategory} />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {columns.map(([key, label]) => (
          <section key={key} className="rounded-lg bg-slate-100/70 p-2">
            <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {label} <span className="text-slate-400">{board?.[key].length ?? 0}</span>
            </h2>
            <div className="space-y-2">
              {(board?.[key] ?? []).map((idea) => (
                <Link
                  key={idea.id}
                  to={`/roadmap/ideas/${idea.id}`}
                  className="block rounded-md border border-slate-200 bg-white p-2.5 shadow-sm hover:border-blue-300"
                >
                  <div className="mb-1 flex items-center gap-2 text-[11px] text-slate-400">
                    <span className="font-mono">{idea.key}</span>
                    {idea.horizon && key !== 'released' && (
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 font-semibold text-white">{HORIZON_LABEL[idea.horizon]}</span>
                    )}
                    {idea.release && <span className="rounded bg-green-50 px-1.5 text-green-700">v{idea.release.version}</span>}
                    <span className="ml-auto">{idea.category}</span>
                  </div>
                  <div className="text-sm font-medium text-slate-800">{idea.title}</div>
                  <div className="mt-1 flex gap-3 text-[11px] text-slate-500">
                    <span>▲ {idea.votes}</span>
                    <span>💬 {idea.comments}</span>
                  </div>
                </Link>
              ))}
              {(board?.[key] ?? []).length === 0 && <p className="px-1 py-4 text-center text-xs text-slate-400">Nothing here yet.</p>}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

function IdeaList() {
  const [filters, setFilters] = useState<IdeaFilters>({ sort: 'votes' })
  const [search, setSearch] = useState('')
  const { data } = useIdeas(filters)
  const set = (patch: Partial<IdeaFilters>) => setFilters((f) => ({ ...f, ...patch }))
  return (
    <div className="flex gap-4">
      <aside className="w-48 shrink-0 space-y-0.5 text-sm">
        <button
          onClick={() => set({ status: undefined })}
          className={`flex w-full justify-between rounded-md px-2 py-1 ${!filters.status ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-600 hover:bg-slate-100'}`}
        >
          All <span className="text-slate-400">{(data?.facets ?? []).reduce((a, f) => a + f.count, 0)}</span>
        </button>
        {(data?.facets ?? []).map((f) => (
          <button
            key={f.status}
            onClick={() => set({ status: f.status })}
            className={`flex w-full justify-between rounded-md px-2 py-1 ${filters.status === f.status ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            {f.label} <span className="text-slate-400">{f.count}</span>
          </button>
        ))}
        <div className="border-t border-slate-200 pt-2">
          <label className="flex items-center gap-2 px-2 py-1 text-xs text-slate-600">
            <input type="checkbox" checked={!!filters.mine} onChange={(e) => set({ mine: e.target.checked })} /> Submitted by me
          </label>
          <label className="flex items-center gap-2 px-2 py-1 text-xs text-slate-600">
            <input type="checkbox" checked={!!filters.watched} onChange={(e) => set({ watched: e.target.checked })} /> Watched
          </label>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <form
            className="flex-1"
            onSubmit={(e) => {
              e.preventDefault()
              set({ q: search.trim() || undefined })
            }}
          >
            <input className={input} placeholder="Search ideas…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </form>
          <CategoryFilter value={filters.category} onChange={(category) => set({ category })} />
          <select className="rounded-md border border-slate-300 px-2 py-1 text-xs" value={filters.sort} onChange={(e) => set({ sort: e.target.value as IdeaFilters['sort'] })}>
            <option value="votes">Most votes</option>
            <option value="new">Newest</option>
            <option value="updated">Recently updated</option>
          </select>
        </div>
        <ul className="space-y-2">
          {(data?.items ?? []).map((idea) => (
            <li key={idea.id}>
              <Link to={`/roadmap/ideas/${idea.id}`} className="flex gap-3 rounded-lg border border-slate-200 bg-white p-3 hover:border-blue-300">
                <VoteButton idea={idea} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-800">{idea.title}</span>
                    <IdeaStatusBadge idea={idea} small />
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-sm text-slate-500">{idea.description}</p>
                  <div className="mt-1 flex gap-3 text-[11px] text-slate-400">
                    <span className="font-mono">{idea.key}</span>
                    <span>{idea.category}</span>
                    <span>💬 {idea.comments}</span>
                    <span>{new Date(idea.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
              </Link>
            </li>
          ))}
          {(data?.items ?? []).length === 0 && <li className="py-8 text-center text-sm text-slate-400">No ideas match.</li>}
        </ul>
      </div>
    </div>
  )
}

function ReleaseNotes() {
  const { data: notes } = useReleaseNotes()
  const { data: meta } = useRoadmapMeta()
  const action = useRoadmapAction()
  const [version, setVersion] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  return (
    <div className="space-y-3">
      {meta?.can_manage && (
        <div className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-3">
          <input className="w-24 rounded-md border border-slate-300 px-2 py-1 text-sm" placeholder="Version" value={version} onChange={(e) => setVersion(e.target.value)} />
          <input className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea className={input} rows={2} placeholder="What changed" value={body} onChange={(e) => setBody(e.target.value)} />
          <button
            className={btn.primary}
            disabled={!version.trim() || !title.trim()}
            onClick={() =>
              action.mutate(
                { method: 'post', path: '/release-notes', body: { version, title, body } },
                { onSuccess: () => { setVersion(''); setTitle(''); setBody('') } },
              )
            }
          >
            Publish release note
          </button>
        </div>
      )}
      {(notes ?? []).map((n) => (
        <article key={n.id} className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-baseline gap-2">
            <span className="rounded bg-green-50 px-1.5 text-xs font-semibold text-green-700">v{n.version}</span>
            <h3 className="font-medium text-slate-800">{n.title}</h3>
            <span className="ml-auto text-xs text-slate-400">{new Date(n.released_at).toLocaleDateString()}</span>
          </div>
          {n.body && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{n.body}</p>}
          {n.ideas.length > 0 && (
            <p className="mt-2 text-xs text-slate-500">
              Ideas shipped:{' '}
              {n.ideas.map((i, k) => (
                <span key={i.id}>
                  {k > 0 && ', '}
                  <Link className="text-blue-600 hover:underline" to={`/roadmap/ideas/${i.id}`}>
                    {i.key} {i.title}
                  </Link>
                </span>
              ))}
            </p>
          )}
        </article>
      ))}
      {(notes ?? []).length === 0 && <p className="py-8 text-center text-sm text-slate-400">No release notes yet.</p>}
    </div>
  )
}

function SubmitIdea({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const { data: meta } = useRoadmapMeta()
  const action = useRoadmapAction()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('Usability')
  const [error, setError] = useState<string | null>(null)
  const [debounced, setDebounced] = useState('')
  const { data: similar } = useSimilarIdeas(debounced)
  // Look up similar ideas once typing pauses, not on every keystroke.
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(title), 400)
    return () => window.clearTimeout(t)
  }, [title])

  return (
    <Modal
      wide
      title="Suggest an improvement"
      onClose={onClose}
      footer={
        <>
          <button className={btn.secondary} onClick={onClose}>
            Cancel
          </button>
          <button
            className={btn.primary}
            disabled={title.trim().length < 5 || action.isPending}
            onClick={() =>
              action.mutate(
                { method: 'post', path: '/ideas', body: { title, description, category } },
                {
                  onSuccess: (idea) => navigate(`/roadmap/ideas/${(idea as Idea).id}`),
                  onError: (e) => setError(apiErrorMessage(e, 'Could not submit.')),
                },
              )
            }
          >
            Submit idea
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <input
          autoFocus
          className={input}
          placeholder="Short title, e.g. “Bulk-edit attributes in table view”"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        {(similar ?? []).length > 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-2">
            <p className="mb-1 text-xs font-medium text-amber-800">
              Similar ideas already exist — consider voting for one of them instead:
            </p>
            <ul className="space-y-1">
              {similar!.map((i) => (
                <li key={i.id} className="flex items-center gap-2 text-xs">
                  <VoteButton idea={i} />
                  <Link to={`/roadmap/ideas/${i.id}`} className="text-blue-700 hover:underline" onClick={onClose}>
                    {i.key} {i.title}
                  </Link>
                  <IdeaStatusBadge idea={i} small />
                </li>
              ))}
            </ul>
          </div>
        )}
        <textarea className={input} rows={5} placeholder="What problem would this solve? How do you work around it today?" value={description} onChange={(e) => setDescription(e.target.value)} />
        <select className={input} value={category} onChange={(e) => setCategory(e.target.value)}>
          {(meta?.categories ?? []).map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <p className="text-[11px] text-slate-400">
          Ideas are visible to all users of RMT; your organization's name is hidden from other organizations. You'll be
          notified about every status change.
        </p>
        {error && <p className="text-xs text-red-600">⚠ {error}</p>}
      </div>
    </Modal>
  )
}
