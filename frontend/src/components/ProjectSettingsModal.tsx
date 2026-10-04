import { useState } from 'react'
import ReferenceDocumentsPanel from './ReferenceDocumentsPanel'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, apiErrorMessage } from '../api/client'
import { useProject } from '../api/hooks'
import type { Project } from '../api/types'
import { useT } from '../i18n'

const tabClass = (active: boolean) =>
  `-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
    active ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'
  }`

type Tab = 'general' | 'reference-documents'

/** Settings that belong to this project only. Item types, link types and
 * workflows are organization-wide and live under ⚙ Administration. */
export default function ProjectSettingsModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const t = useT()
  const [tab, setTab] = useState<Tab>('general')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="flex h-[75vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-end justify-between border-b border-slate-200 px-4 pt-3">
          <div className="flex gap-1">
            <span className="mr-3 pb-2 text-sm font-semibold text-slate-800">{t('Project settings')}</span>
            <button onClick={() => setTab('general')} className={tabClass(tab === 'general')}>
              {t('General')}
            </button>
            <button onClick={() => setTab('reference-documents')} className={tabClass(tab === 'reference-documents')}>
              {t('Reference documents')}
            </button>
          </div>
          <button onClick={onClose} title={t('Close')} aria-label={t('Close')} className="pb-2 text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-auto">
          {tab === 'general' && <GeneralSettings projectId={projectId} />}
          {tab === 'reference-documents' && <ReferenceDocumentsPanel projectId={projectId} />}
        </div>
      </div>
    </div>
  )
}

function GeneralSettings({ projectId }: { projectId: string }) {
  const t = useT()
  const { data: project } = useProject(projectId)
  const qc = useQueryClient()
  const [prefix, setPrefix] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: async (key_prefix: string | null) =>
      (await api.patch<Project>(`/projects/${projectId}`, { key_prefix })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', projectId] })
      setMessage(t('Saved — applies to items created from now on; existing keys never change.'))
    },
    onError: (e) => setMessage(apiErrorMessage(e, t('Could not save.'))),
  })
  if (!project) return null
  const value = prefix ?? project.key_prefix ?? ''
  return (
    <div className="max-w-lg space-y-3 p-6 text-sm">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-500">{t('Key prefix')}</span>
        <input
          className="w-40 rounded-md border border-slate-300 px-2 py-1.5 font-mono uppercase"
          placeholder={t('e.g. GENSAT')}
          maxLength={12}
          value={value}
          onChange={(e) => setPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
        />
        <span className="mt-1 block text-xs text-slate-500">
          {t('Put in front of every new requirement key in this project:')}{' '}
          <span className="font-mono">{value ? `${value}-SYS-001` : 'SYS-001'}</span>
        </span>
      </label>
      <button
        className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
        onClick={() => save.mutate(value || null)}
      >
        {t('Save')}
      </button>
      {message && <p className="text-xs text-slate-500">{message}</p>}
    </div>
  )
}
