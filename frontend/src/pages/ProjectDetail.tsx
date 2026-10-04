import { useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { apiErrorMessage } from '../api/client'
import {
  useBaselines,
  useCreateBaseline,
  useCreateDocument,
  useCreateDocumentGroup,
  useDeleteBaseline,
  useDeleteDocumentGroup,
  useDocumentGroups,
  useDocuments,
  useGitLog,
  useProject,
  useUpdateDocument,
  useUpdateDocumentGroup,
} from '../api/hooks'
import type { Document, DocumentGroup } from '../api/types'
import ProjectSettingsModal from '../components/ProjectSettingsModal'
import { groupDocuments } from '../documents/groupDocuments'
import { DocumentPresence } from '../components/collab/PresenceAvatar'

function NewDocumentForm({ projectId, groupId }: { projectId: string; groupId: string | null }) {
  const createDocument = useCreateDocument(projectId)
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex min-h-[96px] w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-300 text-slate-400 hover:border-blue-400 hover:text-blue-600"
      >
        <span className="text-2xl leading-none">+</span>
        <span className="text-sm font-medium">New document</span>
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
        onError: (err) => setError(apiErrorMessage(err, 'Could not create this document.')),
      },
    )
  }

  return (
    <form onSubmit={submit} className="flex min-h-[96px] flex-col justify-between rounded-xl border border-blue-200 bg-blue-50 p-4">
      <input
        autoFocus
        className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        placeholder="Document name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <div className="flex gap-2">
        <button type="submit" className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
          Create
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500 hover:text-slate-700">
          Cancel
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
  doc: Document
  projectId: string
  groups: DocumentGroup[]
}) {
  const navigate = useNavigate()
  const updateDocument = useUpdateDocument()

  return (
    <div className="flex min-h-[96px] flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-blue-300 hover:shadow-md">
      <button
        onClick={() => navigate(`/projects/${projectId}/documents/${doc.id}`)}
        className="text-left"
      >
        <div className="flex items-center justify-between gap-2 font-semibold text-slate-800">
          {doc.name}
          <DocumentPresence documentId={doc.id} />
        </div>
        <span className="text-sm text-blue-600">Open →</span>
      </button>
      {groups.length > 0 && (
        <select
          value={doc.group_id ?? ''}
          onChange={(e) =>
            updateDocument.mutate({ id: doc.id, payload: { group_id: e.target.value || null } })
          }
          className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-1 text-xs text-slate-500"
        >
          <option value="">Ungrouped</option>
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

function GroupHeader({
  group,
  onRename,
  onDelete,
}: {
  group: DocumentGroup
  onRename: (name: string) => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(group.name)

  function commit() {
    setEditing(false)
    if (name.trim() && name.trim() !== group.name) onRename(name.trim())
    else setName(group.name)
  }

  return (
    <div className="group/hdr mb-2 mt-8 flex items-center gap-2">
      {editing ? (
        <input
          autoFocus
          className="rounded-md border border-blue-400 px-1.5 py-0.5 text-sm font-semibold text-slate-800 focus:outline-none"
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
        <h2
          onDoubleClick={() => setEditing(true)}
          title="Double-click to rename"
          className="text-sm font-semibold uppercase tracking-wide text-slate-500"
        >
          {group.name}
        </h2>
      )}
      <button
        onClick={onDelete}
        className="hidden text-xs text-slate-300 hover:text-red-600 group-hover/hdr:inline"
      >
        Delete group
      </button>
    </div>
  )
}

function NewGroupForm({ projectId }: { projectId: string }) {
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
      <button
        onClick={() => setOpen(true)}
        className="mt-8 text-sm font-medium text-slate-400 hover:text-blue-600"
      >
        + New group
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="mt-8 flex items-center gap-2">
      <input
        autoFocus
        className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        placeholder="Group name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => !name.trim() && setOpen(false)}
      />
      <button type="submit" className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
        Create
      </button>
    </form>
  )
}

function BaselinesSection({ projectId }: { projectId: string }) {
  const { data: baselines } = useBaselines(projectId)
  const { data: gitLog } = useGitLog(projectId)
  const createBaseline = useCreateBaseline(projectId)
  const deleteBaseline = useDeleteBaseline()
  const [name, setName] = useState('')
  const [locks, setLocks] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setError(null)
    createBaseline.mutate(
      { name: name.trim(), locks_items: locks },
      {
        onSuccess: () => setName(''),
        onError: (err) => setError(apiErrorMessage(err, 'Could not create this baseline.')),
      },
    )
  }

  return (
    <div className="mt-10">
      <h2 className="mb-1 text-lg font-semibold text-slate-800">Baselines</h2>
      <p className="mb-4 max-w-2xl text-sm text-slate-500">
        A baseline freezes every item and link in the project as of right now (§4.7). Each item
        write is also mirrored to a local Git commit below (§7) — not yet tied together
        (`git_commit_sha` stays null until a baseline records the commit it was cut from), and not
        yet pushed to a remote.
      </p>

      <form onSubmit={submit} className="mb-4 flex items-center gap-2">
        <input
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          placeholder="Baseline name (e.g. Sprint 4 review)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <label
          className="flex items-center gap-1 text-xs text-slate-600"
          title="Milestone baseline: frozen items become read-only (outside Draft) until a change request is accepted"
        >
          <input type="checkbox" checked={locks} onChange={(e) => setLocks(e.target.checked)} />
          Milestone — lock frozen items
        </label>
        <button
          type="submit"
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          Create baseline
        </button>
      </form>
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Created</th>
              <th className="px-3 py-2">Items</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {(baselines ?? []).map((b) => (
              <tr key={b.id} className="border-b border-slate-100 last:border-0">
                <td className="px-3 py-2 font-medium text-slate-800">
                  {b.name}
                  {b.locks_items && (
                    <span className="ml-2 rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] font-medium text-indigo-700">
                      🔒 milestone
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-slate-500">
                  {new Date(b.created_at).toLocaleString()}
                </td>
                <td className="px-3 py-2 text-slate-600">{b.item_count}</td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => deleteBaseline.mutate(b.id)}
                    className="text-xs text-slate-400 hover:text-red-600"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {(baselines ?? []).length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-slate-400">
                  No baselines yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h3 className="mb-2 mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Git Sync Log
      </h3>
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <ul className="divide-y divide-slate-100">
          {(gitLog ?? []).map((c) => (
            <li key={c.sha} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="font-mono text-xs text-slate-400">{c.sha.slice(0, 7)}</span>
              <span className="flex-1 text-slate-700">{c.message}</span>
              <span className="text-xs text-slate-400">{new Date(c.date).toLocaleString()}</span>
            </li>
          ))}
          {(gitLog ?? []).length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-slate-400">
              No commits yet — edit an item to trigger the first sync.
            </li>
          )}
        </ul>
      </div>
    </div>
  )
}

export default function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>()
  const { data: project, isLoading: projectLoading } = useProject(projectId)
  const { data: documents, isLoading: documentsLoading } = useDocuments(projectId)
  const { data: groups } = useDocumentGroups(projectId)
  const updateGroup = useUpdateDocumentGroup()
  const deleteGroup = useDeleteDocumentGroup()
  const [settingsOpen, setSettingsOpen] = useState(false)

  if (projectLoading || documentsLoading) {
    return <div className="p-6 text-slate-500">Loading…</div>
  }
  if (!project || !projectId) {
    return <div className="p-6 text-slate-500">Project not found.</div>
  }

  const buckets = groupDocuments(documents ?? [], groups ?? [])

  return (
    <div className="mx-auto max-w-5xl p-8">
      <div className="mb-1 flex items-start justify-between">
        <h1 className="text-2xl font-semibold text-slate-800">{project.name}</h1>
        <button
          onClick={() => setSettingsOpen(true)}
          className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          ⚙ Project settings
        </button>
      </div>
      <p className="mb-6 text-sm text-slate-500">Documents in this project</p>

      {buckets.map((bucket) => (
        <div key={bucket.group?.id ?? 'ungrouped'}>
          {bucket.group ? (
            <GroupHeader
              group={bucket.group}
              onRename={(name) => updateGroup.mutate({ id: bucket.group!.id, payload: { name } })}
              onDelete={() => deleteGroup.mutate(bucket.group!.id)}
            />
          ) : (
            (groups ?? []).length > 0 && (
              <h2 className="mb-2 mt-8 text-sm font-semibold uppercase tracking-wide text-slate-400">
                Ungrouped
              </h2>
            )
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {bucket.documents.map((doc) => (
              <DocumentCard key={doc.id} doc={doc} projectId={projectId} groups={groups ?? []} />
            ))}
            {bucket.group === null && <NewDocumentForm projectId={projectId} groupId={null} />}
          </div>
        </div>
      ))}

      <NewGroupForm projectId={projectId} />

      <BaselinesSection projectId={projectId} />

      {settingsOpen && <ProjectSettingsModal projectId={projectId} onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
