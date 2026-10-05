import { useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { apiErrorMessage } from '../api/client'
import { can, usePermissions } from '../api/collabHooks'
import { useCreateDocumentBaseline, useDocumentBaselines } from '../api/hooks'
import { useI18n } from '../i18n'
import Modal, { btn, input } from './collab/Modal'

/** "Version: current ▾" — switches between the live document and its
 * frozen baselines (read-only). Shown only once a baseline exists. */
export function BaselineSwitcher() {
  const { projectId, documentId, baselineId } = useParams<{ projectId: string; documentId: string; baselineId?: string }>()
  const { t, lang } = useI18n()
  const navigate = useNavigate()
  const { data: baselines } = useDocumentBaselines(documentId)
  if (!documentId || !baselines || baselines.length === 0) return null
  const base = `/projects/${projectId}/documents/${documentId}`
  return (
    <select
      id="document-version"
      value={baselineId ?? ''}
      onChange={(e) => navigate(e.target.value ? `${base}/baselines/${e.target.value}` : base)}
      aria-label={t('Version')}
      className={`rounded-md border px-1.5 py-1 text-xs ${
        baselineId ? 'border-indigo-300 bg-indigo-50 text-indigo-800' : 'border-slate-200 bg-slate-50 text-slate-600'
      }`}
    >
      <option value="">{t('Current version')}</option>
      {baselines.map((b) => (
        <option key={b.id} value={b.id}>
          🔒 {b.name} · {new Date(b.created_at).toLocaleDateString(lang === 'pl' ? 'pl-PL' : 'en-GB')}
        </option>
      ))}
    </select>
  )
}

/** Freeze the document as it is now under a name (e.g. "SRR"). */
export function CreateBaselineDialog({ onClose }: { onClose: () => void }) {
  const { projectId, documentId } = useParams<{ projectId: string; documentId: string }>()
  const { t } = useI18n()
  const navigate = useNavigate()
  const { data: perms } = usePermissions(projectId)
  const create = useCreateDocumentBaseline(documentId ?? '')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [locks, setLocks] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function submit(e?: FormEvent) {
    e?.preventDefault()
    if (!name.trim()) return
    setError(null)
    create.mutate(
      { name: name.trim(), description: description.trim() || undefined, locks_items: locks },
      {
        onSuccess: (b) => {
          onClose()
          navigate(`/projects/${projectId}/documents/${documentId}/baselines/${b.id}`)
        },
        onError: (err) => setError(apiErrorMessage(err, t('Could not create this baseline.'))),
      },
    )
  }

  return (
    <Modal
      title={t('Create a document baseline')}
      onClose={onClose}
      footer={
        <>
          <button className={btn.secondary} onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className={btn.primary} disabled={!name.trim() || create.isPending} onClick={() => submit()}>
            {t('Create baseline')}
          </button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-3 text-sm">
        <p className="text-xs text-slate-500">
          {t('A baseline freezes this document exactly as it is now — every requirement, its text, attributes, status and links. It can be viewed at any time but never changed; the document itself keeps evolving.')}
        </p>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">{t('Name')}</span>
          <input
            id="baseline-name"
            autoFocus
            className={input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('e.g. SRR — System Requirements Review')}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">{t('Description (optional)')}</span>
          <textarea
            id="baseline-description"
            rows={2}
            className={input}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        {can(perms, 'project.admin') && (
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input id="baseline-locks" type="checkbox" checked={locks} onChange={(e) => setLocks(e.target.checked)} />
            {t('Milestone (freeze requirements)')}
          </label>
        )}
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">⚠ {error}</p>}
      </form>
    </Modal>
  )
}
