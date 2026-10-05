import { useState } from 'react'
import { apiErrorMessage } from '../api/client'
import { useCreateLink, useLinkTypes } from '../api/hooks'
import { useLinkCreation } from './LinkCreationContext'
import { useT } from '../i18n'

export default function LinkCreationPopup({ orgId }: { orgId: string }) {
  const t = useT()
  const { source, target, clear } = useLinkCreation()
  const { data: linkTypes } = useLinkTypes(orgId)
  const createLink = useCreateLink()
  const [linkTypeId, setLinkTypeId] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (!source || !target) return null

  function submit() {
    if (!linkTypeId || !source || !target) return
    setError(null)
    createLink.mutate(
      { source_item_id: source.id, target_item_id: target.id, link_type_id: linkTypeId },
      {
        onSuccess: () => {
          clear()
          setLinkTypeId('')
        },
        onError: (err) => setError(apiErrorMessage(err, t('Could not create this link.'))),
      },
    )
  }

  return (
    <>
      <button
        aria-label={t('Cancel')}
        onClick={clear}
        className="fixed inset-0 z-30 bg-slate-900/20"
      />
      <div className="fixed left-1/2 top-1/2 z-40 w-96 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-slate-200 bg-white p-4 shadow-xl">
        <h3 className="mb-3 text-sm font-semibold text-slate-800">{t('Create link')}</h3>
        <div className="mb-3 flex items-center gap-2 text-sm">
          <span className="rounded-md bg-blue-50 px-2 py-1 font-mono text-xs text-blue-800">
            {source.key ?? source.title}
          </span>
          <span className="text-slate-400">→</span>
          <span className="rounded-md bg-purple-50 px-2 py-1 font-mono text-xs text-purple-800">
            {target.key ?? target.title}
          </span>
        </div>
        <label className="mb-1 block text-xs font-medium text-slate-500">{t('Link type')}</label>
        <select
          autoFocus
          className="mb-3 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          value={linkTypeId}
          onChange={(e) => setLinkTypeId(e.target.value)}
        >
          <option value="">{t('Select…')}</option>
          {(linkTypes ?? []).map((lt) => (
            <option key={lt.id} value={lt.id}>
              {lt.name}
            </option>
          ))}
        </select>
        {error && <p className="mb-3 text-xs text-red-600">⚠ {error}</p>}
        <div className="flex gap-2">
          <button
            onClick={submit}
            disabled={!linkTypeId || createLink.isPending}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {t('Create link')}
          </button>
          <button
            onClick={clear}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            {t('Cancel')}
          </button>
        </div>
      </div>
    </>
  )
}
