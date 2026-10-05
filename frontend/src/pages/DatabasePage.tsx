import { useState } from 'react'
import { api, apiErrorMessage } from '../api/client'
import { useIsOrgAdmin } from '../api/collabHooks'
import { useI18n } from '../i18n'

interface Manifest {
  created_at: string
  app_version: string
  alembic_revision: string
  current_revision: string
  tables: Record<string, number>
  files: string[]
}

/** ⚙ → Backup & migration: download the whole database as one file, or
 * replace this installation's data with such a file. */
export default function DatabasePage() {
  const { t, lang } = useI18n()
  const isAdmin = useIsOrgAdmin()
  const [exporting, setExporting] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const fmt = (iso: string) => new Date(iso).toLocaleString(lang === 'pl' ? 'pl-PL' : 'en-GB')

  if (!isAdmin) {
    return <p className="p-6 text-sm text-slate-500">{t('Only an organization admin can export or import the database.')}</p>
  }

  async function download() {
    setExporting(true)
    setError(null)
    try {
      const r = await api.get('/admin/database/export', { responseType: 'blob' })
      const name = /filename="?([^"]+)"?/.exec(r.headers['content-disposition'] ?? '')?.[1] ?? 'rmt-export.zip'
      const url = URL.createObjectURL(r.data as Blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(apiErrorMessage(err, t('Could not export the database.')))
    } finally {
      setExporting(false)
    }
  }

  async function pick(f: File | null) {
    setFile(f)
    setManifest(null)
    setDone(null)
    setError(null)
    if (!f) return
    const form = new FormData()
    form.append('file', f)
    try {
      setManifest((await api.post<Manifest>('/admin/database/inspect', form)).data)
    } catch (err) {
      setError(apiErrorMessage(err, t('This file is not an RMT database export.')))
    }
  }

  async function runImport() {
    if (!file) return
    setBusy(true)
    setError(null)
    const form = new FormData()
    form.append('file', file)
    form.append('confirm', confirm)
    try {
      const r = (await api.post<{ rows: number; tables: number; backup: string }>('/admin/database/import', form)).data
      setDone(t('Imported {rows} rows into {tables} tables. The previous data was saved as {backup}.', r))
      setFile(null)
      setManifest(null)
      setConfirm('')
    } catch (err) {
      setError(apiErrorMessage(err, t('Could not import the database.')))
    } finally {
      setBusy(false)
    }
  }

  const rows = manifest ? Object.values(manifest.tables).reduce((a, b) => a + b, 0) : 0
  const older = manifest && manifest.alembic_revision !== manifest.current_revision

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-6">
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-800">{t('Export')}</h2>
        <p className="max-w-2xl text-sm text-slate-500">
          {t('One file with the whole database — every organization, project, requirement, version, comment and setting — plus uploaded PDFs. Use it as a backup or to move RMT to another server.')}
        </p>
        <button
          onClick={download}
          disabled={exporting}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {exporting ? t('Preparing…') : t('Download export')}
        </button>
        <p className="text-xs text-slate-400">
          {t('From the command line:')} <code className="rounded bg-slate-100 px-1">python -m app.dbtool export rmt.zip</code>
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-800">{t('Import')}</h2>
        <p className="max-w-2xl text-sm text-slate-500">
          {t('Replaces all data in this installation with the contents of an export. An export from an older RMT version is migrated to this version automatically. The current data is backed up first.')}
        </p>
        <input
          id="db-import-file"
          type="file"
          accept=".zip,application/zip"
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
          className="text-sm"
        />
        {manifest && (
          <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 text-sm">
            <p>
              {t('Export from {when}', { when: fmt(manifest.created_at) })} ·{' '}
              {t('{rows} rows in {tables} tables, {files} files', {
                rows,
                tables: Object.keys(manifest.tables).length,
                files: manifest.files.length,
              })}
            </p>
            <p className="text-xs text-slate-500">
              {older
                ? t('Made by an older version (schema {from}) — it will be migrated to {to}.', {
                    from: manifest.alembic_revision,
                    to: manifest.current_revision,
                  })
                : t('Same version as this installation.')}
            </p>
            <div className="rounded-md border border-red-200 bg-red-50 p-3">
              <p className="mb-2 text-xs font-medium text-red-800">
                {t('Everything currently in this installation will be replaced. Type REPLACE to confirm.')}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  id="db-import-confirm"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  aria-label={t('Type REPLACE to confirm')}
                  className="w-40 rounded-md border border-red-300 px-2 py-1 font-mono text-sm"
                />
                <button
                  onClick={runImport}
                  disabled={confirm !== 'REPLACE' || busy}
                  className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-40"
                >
                  {busy ? t('Importing…') : t('Replace all data')}
                </button>
              </div>
            </div>
          </div>
        )}
        {done && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">✓ {done}</p>}
        <p className="text-xs text-slate-400">
          {t('From the command line:')} <code className="rounded bg-slate-100 px-1">python -m app.dbtool import rmt.zip --replace</code>
        </p>
      </section>
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">⚠ {error}</p>}
    </div>
  )
}
