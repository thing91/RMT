import { useRef, useState, type FormEvent } from 'react'
import { apiErrorMessage } from '../api/client'
import { useIsOrgAdmin } from '../api/collabHooks'
import {
  useCreateLocator,
  useCreateStandard,
  useDeleteLocator,
  useDeleteReferenceSource,
  useOrg,
  useStandards,
  useStandardsConsistency,
  useUpdateReferenceSource,
} from '../api/hooks'
import type { ReferenceSource } from '../api/types'
import { useT } from '../i18n'

function NewStandardForm({ orgId }: { orgId: string }) {
  const t = useT()
  const createStandard = useCreateStandard(orgId)
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [title, setTitle] = useState('')
  const [version, setVersion] = useState('')
  const [sourceType, setSourceType] = useState<'pdf' | 'external_link'>('external_link')
  const [externalUrl, setExternalUrl] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
        + {t('Add standard')}
      </button>
    )
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const form = new FormData()
    form.append('code', code)
    form.append('title', title)
    if (version) form.append('version', version)
    form.append('source_type', sourceType)
    if (sourceType === 'external_link') form.append('external_url', externalUrl)
    if (sourceType === 'pdf' && fileInput.current?.files?.[0]) form.append('file', fileInput.current.files[0])

    createStandard.mutate(form, {
      onSuccess: () => {
        setOpen(false)
        setCode('')
        setTitle('')
        setVersion('')
        setExternalUrl('')
      },
      onError: (err) => setError(apiErrorMessage(err, t('Could not add this standard.'))),
    })
  }

  return (
    <form onSubmit={submit} className="mb-6 space-y-2 rounded-lg border border-blue-200 bg-blue-50 p-4">
      <div className="grid grid-cols-2 gap-2">
        <input className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" placeholder={t('Code (e.g. ECSS-E-ST-10C)')} value={code} onChange={(e) => setCode(e.target.value)} required />
        <input className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" placeholder={t('Title')} value={title} onChange={(e) => setTitle(e.target.value)} required />
        <input className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" placeholder={t('Version (e.g. Rev. C)')} value={version} onChange={(e) => setVersion(e.target.value)} />
        <select className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={sourceType} onChange={(e) => setSourceType(e.target.value as 'pdf' | 'external_link')}>
          <option value="external_link">{t('External link')}</option>
          <option value="pdf">{t('Uploaded PDF')}</option>
        </select>
      </div>
      {sourceType === 'external_link' ? (
        <input className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" placeholder={t('https://…')} value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} required />
      ) : (
        <input ref={fileInput} type="file" accept="application/pdf" className="w-full text-sm" required />
      )}
      <div className="flex gap-2">
        <button type="submit" className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">{t('Add')}</button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500 hover:text-slate-700">{t('Cancel')}</button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  )
}

function LocatorList({ source }: { source: ReferenceSource }) {
  const t = useT()
  const createLocator = useCreateLocator()
  const deleteLocator = useDeleteLocator()
  const [label, setLabel] = useState('')
  const [page, setPage] = useState('')

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!label.trim()) return
    createLocator.mutate(
      { sourceId: source.id, payload: { label: label.trim(), page_number: page ? Number(page) : undefined } },
      { onSuccess: () => { setLabel(''); setPage('') } },
    )
  }

  return (
    <div className="mt-2 rounded-md bg-slate-50 p-2">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{t('Locators')}</p>
      <ul className="mb-2 space-y-1">
        {source.locators.map((loc) => (
          <li key={loc.id} className="flex items-center justify-between text-xs text-slate-600">
            <span>
              {loc.label} {loc.page_number ? `(p. ${loc.page_number})` : ''}
              <code className="ml-1 rounded bg-slate-200 px-1 text-[10px]">[[ref:{source.code}#{loc.label}]]</code>
            </span>
            <button onClick={() => deleteLocator.mutate(loc.id)} className="text-slate-400 hover:text-red-600">✕</button>
          </li>
        ))}
        {source.locators.length === 0 && <li className="text-xs text-slate-400">{t('No locators yet.')}</li>}
      </ul>
      <form onSubmit={submit} className="flex gap-1">
        <input className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs" placeholder={t('Label (e.g. Clause 5.4.2)')} value={label} onChange={(e) => setLabel(e.target.value)} />
        <input className="w-16 rounded-md border border-slate-300 px-2 py-1 text-xs" placeholder={t('Page')} value={page} onChange={(e) => setPage(e.target.value)} />
        <button type="submit" className="rounded-md bg-slate-700 px-2 py-1 text-xs font-medium text-white hover:bg-slate-800">{t('Add')}</button>
      </form>
    </div>
  )
}

function StandardCard({ source, allSources }: { source: ReferenceSource; allSources: ReferenceSource[] }) {
  const t = useT()
  const updateSource = useUpdateReferenceSource()
  const deleteSource = useDeleteReferenceSource()
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const supersededBy = allSources.find((s) => s.id === source.superseded_by)

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-1 flex items-center justify-between">
        <div>
          <span className="font-mono text-xs text-slate-400">{source.code}</span>{' '}
          <span className="font-semibold text-slate-800">{source.title}</span>
          {source.version && <span className="ml-1 text-xs text-slate-400">({source.version})</span>}
        </div>
        <div className="flex items-center gap-2">
          {supersededBy && <span className="text-xs text-amber-600" title={`Superseded by ${supersededBy.code}`}>{t('⚠ superseded')}</span>}
          <button onClick={() => setConfirmingDelete(true)} className="text-xs text-slate-400 hover:text-red-600">{t('Delete')}</button>
        </div>
      </div>
      <p className="text-xs text-slate-500">
        {source.source_type === 'pdf' ? (
          <a href={`/api/v1/reference-sources/${source.id}/file`} target="_blank" rel="noopener" className="text-blue-600 hover:underline">{t('View PDF')}</a>
        ) : (
          <a href={source.external_url ?? '#'} target="_blank" rel="noopener" className="text-blue-600 hover:underline">{source.external_url}</a>
        )}
      </p>
      <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
        <label>{t('Mark superseded by:')}</label>
        <select
          className="rounded-md border border-slate-300 px-1.5 py-1 text-xs"
          value={source.superseded_by ?? ''}
          onChange={(e) => updateSource.mutate({ id: source.id, payload: { superseded_by: e.target.value || null } })}
        >
          <option value="">{t('— none —')}</option>
          {allSources.filter((s) => s.id !== source.id).map((s) => (
            <option key={s.id} value={s.id}>{s.code} {s.version ?? ''}</option>
          ))}
        </select>
      </div>
      {confirmingDelete && (
        <div className="mt-2 rounded-md bg-red-50 p-2 text-xs">
          <p className="mb-1 text-red-800">Delete "{source.code}"? Existing citations will show as undefined.</p>
          <button onClick={() => deleteSource.mutate(source.id)} className="mr-2 rounded bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700">{t('Yes, delete')}</button>
          <button onClick={() => setConfirmingDelete(false)} className="text-slate-500 hover:text-slate-700">{t('Cancel')}</button>
        </div>
      )}
      <LocatorList source={source} />
    </div>
  )
}

export default function StandardsAdmin() {
  const t = useT()
  const orgAdmin = useIsOrgAdmin()
  const { org } = useOrg()
  const { data: standards, isLoading } = useStandards(org?.id)
  const { data: report } = useStandardsConsistency(org?.id)

  if (isLoading || !org) return <div className="p-6 text-slate-500">{t('Loading standards…')}</div>

  return (
    <div className="p-6">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-800">{t('Standards Library')}</h1>
        {!orgAdmin && (
          <p className="mb-4 rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-500">
            {t('Read-only — only an organization admin can change this organization-wide data.')}
          </p>
        )}
        {orgAdmin && <NewStandardForm orgId={org.id} />}
      </div>
      <p className="mb-4 max-w-2xl text-sm text-slate-500">
        {t("Shared by the whole organization — cite a clause from any requirement's description with")}{' '}
        <code className="rounded bg-slate-100 px-1">[[ref:CODE#locator]]</code>.{' '}
        {t('In HTML exports it becomes a link that jumps straight to the cited page.')}
      </p>

      {report && (report.unused_sources.length > 0 || report.superseded_citations.length > 0) && (
        <div className="mb-4 space-y-1 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {report.unused_sources.length > 0 && <p>⚠ {t('Never cited:')} {report.unused_sources.join(', ')}</p>}
          {report.superseded_citations.length > 0 && (
            <p>⚠ {t('Citations point at a superseded version:')} {report.superseded_citations.join(', ')}</p>
          )}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {(standards ?? []).map((s) => (
          <StandardCard key={s.id} source={s} allSources={standards ?? []} />
        ))}
        {(standards ?? []).length === 0 && <p className="text-sm text-slate-400">{t('No standards in the library yet.')}</p>}
      </div>
    </div>
  )
}
