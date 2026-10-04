import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { apiErrorMessage } from '../api/client'
import {
  useCreateDocument,
  useCreateDocumentGroup,
  useDeleteDocumentGroup,
  useDocumentGroups,
  useProject,
  useUpdateDocument,
  useUpdateDocumentGroup,
} from '../api/hooks'
import type { DocumentGroup } from '../api/types'
import { linkFor, useMyWork, useProjectOverview, type ProjectOverview, type WorkKind } from '../api/workspaceHooks'
import { DocumentPresence } from '../components/collab/PresenceAvatar'
import { useI18n, useT, timeAgo } from '../i18n'
import { useStatusPalette } from '../status/palette'

const WORK_TILES: { kind: WorkKind; label: string }[] = [
  { kind: 'approve', label: 'to approve' },
  { kind: 'vote', label: 'review votes' },
  { kind: 'suggestion', label: 'suggestions to resolve' },
  { kind: 'reverify', label: 'to re-verify' },
  { kind: 'change_request', label: 'change requests to decide' },
]

function WaitingForYou({ projectId }: { projectId: string }) {
  const { t, lang } = useI18n()
  const { data } = useMyWork(projectId)
  const [kind, setKind] = useState<WorkKind | null>(null)
  if (!data) return null
  const tiles = WORK_TILES.filter((x) => (data.counts[x.kind] ?? 0) > 0)
  const entries = data.entries.filter((e) => !kind || e.kind === kind)

  return (
    <section className="mb-10">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">{t('Waiting for you')}</h2>
      {tiles.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white px-4 py-5 text-sm text-slate-500">
          {t('Nothing is waiting for you. 🎉')}
        </p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            {tiles.map((x) => (
              <button
                key={x.kind}
                onClick={() => setKind(kind === x.kind ? null : x.kind)}
                className={`flex items-baseline gap-2 rounded-lg border px-4 py-2.5 text-left ${
                  kind === x.kind ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <span className="text-xl font-semibold text-slate-800">{data.counts[x.kind]}</span>
                <span className="text-sm text-slate-600">{t(x.label)}</span>
              </button>
            ))}
          </div>
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white">
            {entries.slice(0, 10).map((e) => (
              <li key={`${e.kind}-${e.id}`}>
                <Link to={linkFor(e)} className="flex items-baseline gap-3 px-4 py-2 text-sm hover:bg-slate-50">
                  {e.key && <span className="shrink-0 font-mono text-xs text-slate-500">{e.key}</span>}
                  <span className="min-w-0 flex-1 truncate text-slate-800">{e.title}</span>
                  {e.detail && <span className="max-w-[40%] shrink-0 truncate text-xs text-slate-400">{e.detail}</span>}
                  {e.since && <span className="shrink-0 text-xs text-slate-400">{timeAgo(lang, e.since)}</span>}
                </Link>
              </li>
            ))}
            {entries.length > 10 && (
              <li className="px-4 py-2 text-xs text-slate-400">
                {t('and {n} more', { n: entries.length - 10 })}
              </li>
            )}
          </ul>
        </>
      )}
    </section>
  )
}

function StatusBar({ statuses, total }: { statuses: Record<string, number>; total: number }) {
  const t = useT()
  const palette = useStatusPalette()
  if (total === 0) return <div className="h-1.5 rounded-full bg-slate-100" />
  const order = palette.sort(Object.keys(statuses))
  return (
    <div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-slate-100">
        {order.map((s) => (
          <div
            key={s}
            style={{ width: `${(statuses[s] / total) * 100}%`, backgroundColor: palette.get(s).color }}
            title={`${t(palette.get(s).label)}: ${statuses[s]}`}
          />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
        {order.map((s) => (
          <span key={s} className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: palette.get(s).color }} />
            {t(palette.get(s).label)} {statuses[s]}
          </span>
        ))}
      </div>
    </div>
  )
}

function NewDocumentForm({ projectId, groupId }: { projectId: string; groupId: string | null }) {
  const t = useT()
  const createDocument = useCreateDocument(projectId)
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex min-h-[88px] w-full items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-200 text-sm font-medium text-slate-400 hover:border-blue-400 hover:text-blue-600"
      >
        + {t('New document')}
      </button>
    )
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setError(null)
    createDocument.mutate(
      { name: name.trim(), group_id: groupId },
      {
        onSuccess: (doc) => navigate(`/projects/${projectId}/documents/${doc.id}`),
        onError: (err) => setError(apiErrorMessage(err, t('Could not create this document.'))),
      },
    )
  }

  return (
    <form onSubmit={submit} className="flex min-h-[88px] flex-col justify-between gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3">
      <input
        autoFocus
        className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        placeholder={t('Document name')}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <div className="flex gap-2">
        <button type="submit" className="rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700">
          {t('Create')}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500 hover:text-slate-700">
          {t('Cancel')}
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </form>
  )
}

function DocumentCard({
  doc,
  projectId,
  groups,
}: {
  doc: ProjectOverview['documents'][number]
  projectId: string
  groups: DocumentGroup[]
}) {
  const { t, lang } = useI18n()
  const updateDocument = useUpdateDocument()
  return (
    <div className="group flex min-h-[88px] flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 hover:border-blue-300 hover:shadow-sm">
      <Link to={`/projects/${projectId}/documents/${doc.id}`} className="flex items-start justify-between gap-2">
        <span className="font-medium text-slate-800">{doc.name}</span>
        <DocumentPresence documentId={doc.id} />
      </Link>
      <div className="text-xs text-slate-400">
        {lang === 'pl' ? `${doc.total} wymagań` : `${doc.total} requirements`}
      </div>
      <StatusBar statuses={doc.statuses} total={doc.total} />
      {groups.length > 0 && (
        <select
          value={doc.group_id ?? ''}
          onChange={(e) => updateDocument.mutate({ id: doc.id, payload: { group_id: e.target.value || null } })}
          aria-label={t('Groups')}
          className="invisible mt-auto w-fit rounded border border-slate-200 bg-slate-50 px-1 py-0.5 text-[11px] text-slate-500 group-hover:visible"
        >
          <option value="">{t('Ungrouped')}</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}

function GroupHeader({ group, onRename, onDelete }: { group: DocumentGroup; onRename: (name: string) => void; onDelete: () => void }) {
  const t = useT()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(group.name)

  function commit() {
    setEditing(false)
    if (name.trim() && name.trim() !== group.name) onRename(name.trim())
    else setName(group.name)
  }

  return (
    <div className="group/hdr mb-2 mt-6 flex items-center gap-2">
      {editing ? (
        <input
          autoFocus
          className="rounded-md border border-blue-400 px-1.5 py-0.5 text-sm font-medium text-slate-800 focus:outline-none"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') {
              setName(group.name)
              setEditing(false)
            }
          }}
        />
      ) : (
        <h3 onDoubleClick={() => setEditing(true)} title={t('Double-click to rename')} className="text-sm font-medium text-slate-500">
          {group.name}
        </h3>
      )}
      <button onClick={onDelete} className="hidden text-xs text-slate-300 hover:text-red-600 group-hover/hdr:inline">
        {t('Delete group')}
      </button>
    </div>
  )
}

function NewGroupForm({ projectId }: { projectId: string }) {
  const t = useT()
  const createGroup = useCreateDocumentGroup(projectId)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    createGroup.mutate({ name: name.trim() }, { onSuccess: () => setName('') })
    setOpen(false)
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-4 text-xs font-medium text-slate-400 hover:text-blue-600">
        + {t('New group')}
      </button>
    )
  }
  return (
    <form onSubmit={submit} className="mt-4 flex items-center gap-2">
      <input
        autoFocus
        className="rounded-md border border-slate-300 px-2 py-1 text-sm"
        placeholder={t('Group name')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => !name.trim() && setOpen(false)}
      />
      <button type="submit" className="rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700">
        {t('Create')}
      </button>
    </form>
  )
}

function RecentActivity({ activity }: { activity: ProjectOverview['activity'] }) {
  const { t, lang } = useI18n()
  if (activity.length === 0) return null
  return (
    <section className="mt-10">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">{t('Recent activity')}</h2>
      <ul className="space-y-1.5">
        {activity.map((a, i) => (
          <li key={i} className="flex items-baseline gap-2 text-sm">
            <span className="w-24 shrink-0 text-xs text-slate-400">{timeAgo(lang, a.at)}</span>
            <span className="font-medium text-slate-700">{a.actor ?? t('System')}</span>
            <span className="min-w-0 flex-1 truncate text-slate-500">{a.summary}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Project home: what is waiting for you, the documents with their status
 * at a glance, and what happened lately. */
export default function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>()
  const t = useT()
  const { data: project, isLoading } = useProject(projectId)
  const { data: overview } = useProjectOverview(projectId)
  const { data: groups } = useDocumentGroups(projectId)
  const updateGroup = useUpdateDocumentGroup()
  const deleteGroup = useDeleteDocumentGroup()

  if (isLoading) return <div className="p-6 text-slate-500">{t('Loading…')}</div>
  if (!project || !projectId) return <div className="p-6 text-slate-500">{t('Project not found.')}</div>

  const docs = overview?.documents ?? []
  const groupList = groups ?? []
  const buckets: { group: DocumentGroup | null; documents: typeof docs }[] = [
    { group: null, documents: docs.filter((d) => !d.group_id || !groupList.some((g) => g.id === d.group_id)) },
    ...groupList.map((g) => ({ group: g, documents: docs.filter((d) => d.group_id === g.id) })),
  ]

  return (
    <div className="mx-auto max-w-5xl p-8">
      <h1 className="mb-6 text-2xl font-semibold text-slate-800">{project.name}</h1>

      <WaitingForYou projectId={projectId} />

      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">{t('Documents')}</h2>
        {buckets.map((bucket) => (
            <div key={bucket.group?.id ?? 'ungrouped'}>
              {bucket.group && (
                <GroupHeader
                  group={bucket.group}
                  onRename={(name) => updateGroup.mutate({ id: bucket.group!.id, payload: { name } })}
                  onDelete={() => deleteGroup.mutate(bucket.group!.id)}
                />
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {bucket.documents.map((doc) => (
                  <DocumentCard key={doc.id} doc={doc} projectId={projectId} groups={groupList} />
                ))}
                {bucket.group === null && <NewDocumentForm projectId={projectId} groupId={null} />}
              </div>
            </div>
        ))}
        <NewGroupForm projectId={projectId} />
      </section>

      <RecentActivity activity={overview?.activity ?? []} />
    </div>
  )
}
