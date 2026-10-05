import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { apiErrorMessage } from '../api/client'
import { can, usePermissions } from '../api/collabHooks'
import { useProject } from '../api/hooks'
import { useCreateRelease, useReleaseDiff, useReleases, useSetMissionDefs } from '../api/libraryHooks'
import type { MissionAttributeDef } from '../api/types'
import DiffText, { fieldLabel } from '../components/collab/DiffText'
import { btn, input } from '../components/collab/Modal'
import { useT } from '../i18n'

/** A library project's releases: projects consume a library only through a
 * released, immutable snapshot — never its working draft. */
export default function LibraryReleasesPage() {
  const t = useT()
  const { projectId } = useParams<{ projectId: string }>()
  const { data: project } = useProject(projectId)
  const { data: perms } = usePermissions(projectId)
  const { data: releases } = useReleases(projectId)
  const create = useCreateRelease(projectId!)
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  if (!project) return <div className="p-6 text-slate-500">{t('Loading…')}</div>
  if (project.kind !== 'library')
    return <div className="p-6 text-sm text-slate-500">{t('Only library projects have releases.')}</div>

  const canRelease = can(perms, 'library.release') || can(perms, 'project.admin')

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-800">{t('Library releases')}</h1>
        <p className="text-sm text-slate-500">
          {t('Releasing freezes the current version of every requirement. Projects import or adopt a specific release and are told when a newer one exists. Each document of the library is a subsystem.')}
        </p>
      </div>

      {canRelease && (
        <section className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3">
          <label className="text-xs">
            <span className="mb-1 block font-medium text-slate-500">{t('Release name')}</span>
            <input className="w-48 rounded-md border border-slate-300 px-2 py-1.5 text-sm" placeholder={`${project.name} v1.0`} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="flex-1 text-xs">
            <span className="mb-1 block font-medium text-slate-500">{t('Notes')}</span>
            <input className={input} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <button
            className={btn.primary}
            disabled={!name.trim() || create.isPending}
            onClick={() =>
              create.mutate(
                { name: name.trim(), notes: notes.trim() || undefined },
                {
                  onSuccess: () => {
                    setName('')
                    setNotes('')
                    setError(null)
                  },
                  onError: (e) => setError(apiErrorMessage(e, t('Could not release.'))),
                },
              )
            }
          >
            {t('Release')}
          </button>
          {error && <p className="w-full text-xs text-red-600">⚠ {error}</p>}
        </section>
      )}

      <section className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {(releases ?? []).map((r) => (
          <div key={r.id} className="px-3 py-2 text-sm">
            <button className="flex w-full items-center gap-3 text-left" onClick={() => setOpen(open === r.id ? null : r.id)}>
              <span className="font-medium text-slate-800">{r.name}</span>
              <span className="text-xs text-slate-500">
                {r.item_count} requirements · {r.released_by} · {new Date(r.released_at).toLocaleString()}
              </span>
              {r.notes && <span className="truncate text-xs italic text-slate-400">{r.notes}</span>}
              <span className="ml-auto text-xs text-blue-600">{open === r.id ? 'Hide changes' : 'Changes'}</span>
            </button>
            {open === r.id && <ReleaseChanges releaseId={r.id} first={!r.previous_release_id} />}
          </div>
        ))}
        {(releases ?? []).length === 0 && <p className="px-3 py-6 text-center text-xs text-slate-400">{t('Not released yet.')}</p>}
      </section>

      <MissionDefsEditor libraryId={project.id} defs={project.mission_attribute_defs ?? []} canEdit={can(perms, 'project.admin')} />
    </div>
  )
}

function ReleaseChanges({ releaseId, first }: { releaseId: string; first: boolean }) {
  const t = useT()
  const { data: diff } = useReleaseDiff(releaseId)
  if (!diff) return <p className="py-2 text-xs text-slate-400">{t('Loading…')}</p>
  if (first) return <p className="py-2 text-xs text-slate-500">{t('First release — {n} requirements.', { n: diff.added.length })}</p>
  return (
    <div className="space-y-2 py-2 text-xs">
      {(['added', 'changed', 'removed'] as const).map((k) => (
        <div key={k}>
          <div className="font-semibold uppercase tracking-wide text-slate-500">
            {k} ({diff[k].length})
          </div>
          {diff[k].map((e) => (
            <div key={e.item_id} className="ml-2">
              <span className="font-mono text-slate-500">{e.key}</span> {e.title} <span className="text-slate-400">({e.subsystem})</span>
              {e.changes?.map((c) => (
                <div key={c.field} className="ml-4">
                  <span className="text-slate-500">{t(fieldLabel(c.field))}: </span>
                  {c.ops ? <DiffText ops={c.ops} /> : String(c.new)}
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function MissionDefsEditor({ libraryId, defs, canEdit }: { libraryId: string; defs: MissionAttributeDef[]; canEdit: boolean }) {
  const t = useT()
  const save = useSetMissionDefs(libraryId)
  const [rows, setRows] = useState<MissionAttributeDef[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const current = rows ?? defs
  const update = (i: number, patch: Partial<MissionAttributeDef>) =>
    setRows(current.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{t('Mission attributes')}</h2>
      <p className="mb-2 text-xs text-slate-500">
        {t('Characteristics of a mission (orbit, satellite class, propulsion…) that requirement rules can test to suggest applicability. Projects fill in the values.')}
      </p>
      <table className="mb-2 w-full text-xs">
        <tbody>
          {current.map((d, i) => (
            <tr key={i}>
              <td className="py-0.5 pr-2">
                <input disabled={!canEdit} className="w-32 rounded border border-slate-300 px-1 py-0.5 font-mono" placeholder={t('key')} value={d.key} onChange={(e) => update(i, { key: e.target.value })} />
              </td>
              <td className="pr-2">
                <input disabled={!canEdit} className="w-40 rounded border border-slate-300 px-1 py-0.5" placeholder={t('Label')} value={d.label ?? ''} onChange={(e) => update(i, { label: e.target.value })} />
              </td>
              <td className="pr-2">
                <select disabled={!canEdit} className="rounded border border-slate-300 px-1 py-0.5" value={d.type} onChange={(e) => update(i, { type: e.target.value as MissionAttributeDef['type'] })}>
                  <option value="boolean">{t('Yes/No')}</option>
                  <option value="enum">{t('Choice')}</option>
                  <option value="number">{t('Number')}</option>
                  <option value="text">{t('Text')}</option>
                </select>
              </td>
              <td className="pr-2">
                {d.type === 'enum' && (
                  <input disabled={!canEdit} className="w-48 rounded border border-slate-300 px-1 py-0.5" placeholder={t('LEO, MEO, GEO')} value={(d.options ?? []).join(', ')} onChange={(e) => update(i, { options: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
                )}
              </td>
              <td>
                {canEdit && (
                  <button className="text-slate-400 hover:text-red-600" onClick={() => setRows(current.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {canEdit && (
        <div className="flex gap-2">
          <button className={btn.secondary} onClick={() => setRows([...current, { key: '', type: 'boolean' }])}>
            + {t('Attribute')}
          </button>
          {rows && (
            <button
              className={btn.primary}
              onClick={() =>
                save.mutate(rows.filter((r) => r.key.trim()), {
                  onSuccess: () => setRows(null),
                  onError: (e) => setError(apiErrorMessage(e, t('Could not save.'))),
                })
              }
            >
              {t('Save')}
            </button>
          )}
          {error && <span className="text-xs text-red-600">⚠ {error}</span>}
        </div>
      )}
    </section>
  )
}
