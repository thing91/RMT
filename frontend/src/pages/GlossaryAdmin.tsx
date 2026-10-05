import { useRef, useState, type FormEvent } from 'react'
import { apiErrorMessage } from '../api/client'
import { useIsOrgAdmin } from '../api/collabHooks'
import {
  useCreateGlossaryTerm,
  useDeleteGlossaryTerm,
  useGlossary,
  useGlossaryConsistency,
  useImportGlossary,
  useOrg,
  useUpdateGlossaryTerm,
} from '../api/hooks'
import type { GlossaryTerm } from '../api/types'
import { useT } from '../i18n'

function ImportButton({ orgId }: { orgId: string }) {
  const t = useT()
  const importGlossary = useImportGlossary(orgId)
  const fileInput = useRef<HTMLInputElement>(null)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    setResult(null)
    importGlossary.mutate(file, {
      onSuccess: (res) => {
        setResult(
          `Imported: ${res.created} created, ${res.updated} updated` +
            (res.errors.length ? ` (${res.errors.length} row(s) skipped)` : '.'),
        )
      },
      onError: (err) => setError(apiErrorMessage(err, 'Could not import this file.')),
    })
  }

  return (
    <div className="text-right">
      <input ref={fileInput} type="file" accept=".xlsx" className="hidden" onChange={handleFile} />
      <button
        onClick={() => fileInput.current?.click()}
        disabled={importGlossary.isPending}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
      >
        {t('Import XLSX')}
      </button>
      {result && <p className="mt-1 text-xs text-green-700">{result}</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}

function NewTermForm({ orgId }: { orgId: string }) {
  const t = useT()
  const createTerm = useCreateGlossaryTerm(orgId)
  const [open, setOpen] = useState(false)
  const [abbreviation, setAbbreviation] = useState('')
  const [term, setTerm] = useState('')
  const [definition, setDefinition] = useState('')
  const [category, setCategory] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
      >
        + {t('Add term')}
      </button>
    )
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!abbreviation.trim() || !term.trim() || !definition.trim()) return
    setError(null)
    createTerm.mutate(
      {
        abbreviation: abbreviation.trim(),
        term: term.trim(),
        definition: definition.trim(),
        category: category.trim() || undefined,
      },
      {
        onSuccess: () => {
          setOpen(false)
          setAbbreviation('')
          setTerm('')
          setDefinition('')
          setCategory('')
        },
        onError: (err) => setError(apiErrorMessage(err, t('Could not create this term.'))),
      },
    )
  }

  return (
    <form onSubmit={submit} className="mb-6 space-y-2 rounded-lg border border-blue-200 bg-blue-50 p-4">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">
            Abbreviation (used as [[ABBR]])
          </label>
          <input
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={abbreviation}
            onChange={(e) => setAbbreviation(e.target.value)}
            autoFocus
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">{t('Term')}</label>
          <input
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500">{t('Definition')}</label>
        <textarea
          className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          rows={2}
          value={definition}
          onChange={(e) => setDefinition(e.target.value)}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500">
          Category (optional — e.g. domain, unit, regulatory)
        </label>
        <input
          className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <button type="submit" className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
          {t('Create')}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500 hover:text-slate-700">
          {t('Cancel')}
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  )
}

function TermRow({ term }: { term: GlossaryTerm }) {
  const t = useT()
  const updateTerm = useUpdateGlossaryTerm()
  const deleteTerm = useDeleteGlossaryTerm()
  const [editing, setEditing] = useState(false)
  const [definition, setDefinition] = useState(term.definition)

  if (editing) {
    return (
      <tr className="border-b border-slate-100 last:border-0">
        <td className="px-3 py-2 font-mono text-xs text-slate-500">[[{term.abbreviation}]]</td>
        <td className="px-3 py-2 font-medium text-slate-800">{term.term}</td>
        <td className="px-3 py-2">
          <textarea
            autoFocus
            className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
            rows={2}
            value={definition}
            onChange={(e) => setDefinition(e.target.value)}
          />
        </td>
        <td className="px-3 py-2 text-right">
          <button
            onClick={() => {
              updateTerm.mutate({ id: term.id, payload: { definition } })
              setEditing(false)
            }}
            className="mr-2 text-xs font-medium text-blue-600 hover:text-blue-800"
          >
            {t('Save')}
          </button>
          <button onClick={() => setEditing(false)} className="text-xs text-slate-400 hover:text-slate-700">
            {t('Cancel')}
          </button>
        </td>
      </tr>
    )
  }

  return (
    <tr className="border-b border-slate-100 last:border-0">
      <td className="px-3 py-2 font-mono text-xs text-slate-500">[[{term.abbreviation}]]</td>
      <td className="px-3 py-2 font-medium text-slate-800">{term.term}</td>
      <td className="px-3 py-2 text-slate-600">{term.definition}</td>
      <td className="px-3 py-2 text-right">
        <button onClick={() => setEditing(true)} className="mr-2 text-xs text-slate-400 hover:text-slate-700">
          {t('Edit')}
        </button>
        <button onClick={() => deleteTerm.mutate(term.id)} className="text-xs text-slate-400 hover:text-red-600">
          {t('Delete')}
        </button>
      </td>
    </tr>
  )
}

export default function GlossaryAdmin() {
  const t = useT()
  const orgAdmin = useIsOrgAdmin()
  const { org } = useOrg()
  const { data: terms, isLoading } = useGlossary(org?.id)
  const { data: report } = useGlossaryConsistency(org?.id)

  if (isLoading || !org) return <div className="p-6 text-slate-500">{t('Loading glossary…')}</div>

  return (
    <div className="p-6">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-800">{t('Glossary')}</h1>
        <div className="flex items-center gap-2">
          <a
            href={`/api/v1/organizations/${org.id}/glossary/export.xlsx`}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            {t('Export XLSX')}
          </a>
          <a
            href={`/api/v1/organizations/${org.id}/glossary/export.html`}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            {t('Export HTML')}
          </a>
          <ImportButton orgId={org.id} />
          {!orgAdmin && (
          <p className="mb-4 rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-500">
            {t('Read-only — only an organization admin can change this organization-wide data.')}
          </p>
        )}
        {orgAdmin && <NewTermForm orgId={org.id} />}
        </div>
      </div>
      <p className="mb-4 max-w-2xl text-sm text-slate-500">
        {t('Shared by the whole organization — reference any term from a requirement with')}{' '}
        <code className="rounded bg-slate-100 px-1">[[ABBR]]</code>.{' '}
        {t('In HTML exports it becomes a tooltip linking to the glossary appendix.')}
      </p>

      {report && (report.unused_terms.length > 0 || report.undefined_references.length > 0) && (
        <div className="mb-4 space-y-1 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {report.unused_terms.length > 0 && (
            <p>⚠ {t('Unused terms (not referenced anywhere):')} {report.unused_terms.join(', ')}</p>
          )}
          {report.undefined_references.length > 0 && (
            <p>
              ⚠ {t('Undefined abbreviations used in content:')}{' '}
              {report.undefined_references.map((r) => `[[${r}]]`).join(', ')}
            </p>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">{t('Syntax')}</th>
              <th className="px-3 py-2">{t('Term')}</th>
              <th className="px-3 py-2">{t('Definition')}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {(terms ?? []).map((t) => (
              <TermRow key={t.id} term={t} />
            ))}
            {(terms ?? []).length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-slate-400">
                  {t('No terms yet.')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
