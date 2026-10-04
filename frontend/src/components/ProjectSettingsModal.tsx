import { useState } from 'react'
import ItemTypesAdmin from '../pages/ItemTypesAdmin'
import LinkTypesAdmin from '../pages/LinkTypesAdmin'
import ReferenceDocumentsPanel from './ReferenceDocumentsPanel'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, apiErrorMessage } from '../api/client'
import { useProject } from '../api/hooks'
import type { Project } from '../api/types'

const tabClass = (active: boolean) =>
  `rounded-md px-3 py-1.5 text-sm font-medium ${
    active ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
  }`

type Tab = 'general' | 'item-types' | 'link-types' | 'reference-documents'

/** Item Types / Link Types / Reference Documents management, reachable from
 * a project's sidebar instead of living as permanent top-level nav — the
 * first two are still org-wide resources under the hood (§ known
 * simplification: no project-level schema scoping), this just relocates
 * where you go to edit them. Reference Documents genuinely are
 * project-scoped (§5.4). */
export default function ProjectSettingsModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('general')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="flex h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
          <div className="flex gap-1">
            <button onClick={() => setTab('general')} className={tabClass(tab === 'general')}>
              General
            </button>
            <button onClick={() => setTab('item-types')} className={tabClass(tab === 'item-types')}>
              Item Types
            </button>
            <button onClick={() => setTab('link-types')} className={tabClass(tab === 'link-types')}>
              Link Types
            </button>
            <button onClick={() => setTab('reference-documents')} className={tabClass(tab === 'reference-documents')}>
              Reference Documents
            </button>
          </div>
          <button onClick={onClose} title="Close" className="text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-auto">
          {tab === 'general' && <GeneralSettings projectId={projectId} />}
          {tab === 'item-types' && <ItemTypesAdmin />}
          {tab === 'link-types' && <LinkTypesAdmin />}
          {tab === 'reference-documents' && <ReferenceDocumentsPanel projectId={projectId} />}
        </div>
      </div>
    </div>
  )
}

function GeneralSettings({ projectId }: { projectId: string }) {
  const { data: project } = useProject(projectId)
  const qc = useQueryClient()
  const [prefix, setPrefix] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: async (key_prefix: string | null) =>
      (await api.patch<Project>(`/projects/${projectId}`, { key_prefix })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', projectId] })
      setMessage('Saved — applies to items created from now on; existing keys never change.')
    },
    onError: (e) => setMessage(apiErrorMessage(e, 'Could not save.')),
  })
  if (!project) return null
  const value = prefix ?? project.key_prefix ?? ''
  return (
    <div className="max-w-lg space-y-3 p-6 text-sm">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-500">Key prefix</span>
        <input
          className="w-40 rounded-md border border-slate-300 px-2 py-1.5 font-mono uppercase"
          placeholder="e.g. GENSAT"
          maxLength={12}
          value={value}
          onChange={(e) => setPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
        />
        <span className="mt-1 block text-xs text-slate-500">
          Put in front of every new item key in this project:{' '}
          <span className="font-mono">{value ? `${value}-SYS-001` : 'SYS-001'}</span>. Libraries get one by default so
          their requirements are never confused with a project's own.
        </span>
      </label>
      <button
        className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
        onClick={() => save.mutate(value || null)}
      >
        Save
      </button>
      {message && <p className="text-xs text-slate-500">{message}</p>}
    </div>
  )
}
