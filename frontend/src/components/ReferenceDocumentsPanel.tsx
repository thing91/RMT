import { useRef, useState, type FormEvent } from 'react'
import { apiErrorMessage } from '../api/client'
import {
  useCreateLocator,
  useCreateReferenceDocument,
  useDeleteLocator,
  useDeleteReferenceSource,
  useReferenceDocuments,
} from '../api/hooks'
import type { ReferenceSource } from '../api/types'
import { useT } from '../i18n'

function NewDocumentForm({ projectId }: { projectId: string }) {
  const t = useT()
  const createDoc = useCreateReferenceDocument(projectId)
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [title, setTitle] = useState('')
  const [sourceType, setSourceType] = useState<'pdf' | 'external_link'>('pdf')
  const [externalUrl, setExternalUrl] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-xs font-medium text-blue-600 hover:text-blue-800">
        + {t('Add reference document')}
      </button>
    )
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const form = new FormData()
    form.append('code', code)
    form.append('title', title)
    form.append('source_type', sourceType)
    if (sourceType === 'external_link') form.append('external_url', externalUrl)
    if (sourceType === 'pdf' && fileInput.current?.files?.[0]) form.append('file', fileInput.current.files[0])

    createDoc.mutate(form, {
      onSuccess: () => {
        setOpen(false)
        setCode('')
        setTitle('')
        setExternalUrl('')
      },
      onError: (err) => setError(apiErrorMessage(err, t('Could not add this document.'))),
    })
  }

  return (
    <form onSubmit={submit} className="mt-2 space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="grid grid-cols-2 gap-2">
        <input className="rounded-md border border-slate-300 px-2 py-1 text-xs" placeholder={t('Code (short id)')} value={code} onChange={(e) => setCode(e.target.value)} required />
        <input className="rounded-md border border-slate-300 px-2 py-1 text-xs" placeholder={t('Title')} value={title} onChange={(e) => setTitle(e.target.value)} required />
        <select className="rounded-md border border-slate-300 px-2 py-1 text-xs" value={sourceType} onChange={(e) => setSourceType(e.target.value as 'pdf' | 'external_link')}>
          <option value="pdf">{t('Uploaded PDF')}</option>
          <option value="external_link">{t('External link')}</option>
        </select>
      </div>
      {sourceType === 'external_link' ? (
        <input className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs" placeholder={t('https://…')} value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} required />
      ) : (
        <input ref={fileInput} type="file" accept="application/pdf" className="w-full text-xs" required />
      )}
      <div className="flex gap-2">
        <button type="submit" className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700">{t('Add')}</button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500 hover:text-slate-700">{t('Cancel')}</button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </form>
  )
}

function DocumentCard({ source }: { source: ReferenceSource }) {
  const t = useT()
  const deleteSource = useDeleteReferenceSource()
  const createLocator = useCreateLocator()
  const deleteLocator = useDeleteLocator()
  const [label, setLabel] = useState('')

  function addLocator(e: FormEvent) {
    e.preventDefault()
    if (!label.trim()) return
    createLocator.mutate({ sourceId: source.id, payload: { label: label.trim() } }, { onSuccess: () => setLabel('') })
  }

  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <div className="mb-1 flex items-center justify-between">
        <div>
          <span className="font-mono text-xs text-slate-400">{source.code}</span>{' '}
          <span className="text-sm font-medium text-slate-800">{source.title}</span>
        </div>
        <button onClick={() => deleteSource.mutate(source.id)} className="text-xs text-slate-400 hover:text-red-600">{t('Delete')}</button>
      </div>
      <p className="mb-2 text-xs text-slate-500">
        {source.source_type === 'pdf' ? (
          <a href={`/api/v1/reference-sources/${source.id}/file`} target="_blank" rel="noopener" className="text-blue-600 hover:underline">{t('View PDF')}</a>
        ) : (
          <a href={source.external_url ?? '#'} target="_blank" rel="noopener" className="text-blue-600 hover:underline">{source.external_url}</a>
        )}
      </p>
      <ul className="mb-1 space-y-0.5">
        {source.locators.map((loc) => (
          <li key={loc.id} className="flex items-center justify-between text-xs text-slate-500">
            <code className="rounded bg-slate-100 px-1">[[ref:{source.code}#{loc.label}]]</code>
            <button onClick={() => deleteLocator.mutate(loc.id)} className="text-slate-400 hover:text-red-600">✕</button>
          </li>
        ))}
      </ul>
      <form onSubmit={addLocator} className="flex gap-1">
        <input className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs" placeholder={t('Locator label (e.g. Section 3.1)')} value={label} onChange={(e) => setLabel(e.target.value)} />
        <button type="submit" className="rounded-md bg-slate-700 px-2 py-1 text-xs font-medium text-white hover:bg-slate-800">{t('Add')}</button>
      </form>
    </div>
  )
}

/** §5.4's per-project half of the reference library — visibility follows
 * the owning project's ACL (unlike org-wide standards), so this lives
 * inside project settings rather than a global admin page. */
export default function ReferenceDocumentsPanel({ projectId }: { projectId: string }) {
  const t = useT()
  const { data: documents, isLoading } = useReferenceDocuments(projectId)

  if (isLoading) return <div className="p-6 text-sm text-slate-500">{t('Loading…')}</div>

  return (
    <div className="p-6">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-800">{t('Reference Documents')}</h1>
        <NewDocumentForm projectId={projectId} />
      </div>
      <p className="mb-4 max-w-2xl text-sm text-slate-500">
        {t("Documents specific to this project — e.g. the analysis a requirement's rationale is drawn from. Cite with")}{' '}
        <code className="rounded bg-slate-100 px-1">[[ref:CODE#locator]]</code>{t(', same as a standard.')}
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {(documents ?? []).map((s) => (
          <DocumentCard key={s.id} source={s} />
        ))}
        {(documents ?? []).length === 0 && <p className="text-sm text-slate-400">{t('No reference documents yet.')}</p>}
      </div>
    </div>
  )
}
