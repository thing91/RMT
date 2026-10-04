import { useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { apiErrorMessage } from '../api/client'
import { useBaselines, useCreateBaseline, useDeleteBaseline, useGitLog } from '../api/hooks'
import { useI18n } from '../i18n'

/** Baselines — named snapshots of the whole project — plus the change history
 * kept in the project's version store. */
export default function BaselinesPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const { t } = useI18n()
  const { data: baselines } = useBaselines(projectId)
  const { data: gitLog } = useGitLog(projectId)
  const createBaseline = useCreateBaseline(projectId ?? '')
  const deleteBaseline = useDeleteBaseline()
  const [name, setName] = useState('')
  const [locks, setLocks] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showLog, setShowLog] = useState(false)

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setError(null)
    createBaseline.mutate(
      { name: name.trim(), locks_items: locks },
      {
        onSuccess: () => setName(''),
        onError: (err) => setError(apiErrorMessage(err, t('Could not create this baseline.'))),
      },
    )
  }

  return (
    <div className="mx-auto max-w-4xl p-8">
      <h1 className="mb-1 text-xl font-semibold text-slate-800">{t('Baselines')}</h1>
      <p className="mb-5 max-w-2xl text-sm text-slate-500">
        {t('A baseline is a named snapshot of every requirement and link in the project at this moment. Use it to mark a milestone and compare against it later.')}
      </p>

      <form onSubmit={submit} className="mb-4 flex flex-wrap items-center gap-2">
        <input
          className="min-w-64 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          placeholder={t('Baseline name (e.g. PDR)')}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <label
          className="flex items-center gap-1 text-xs text-slate-600"
          title={t('Requirements in a milestone baseline can only change through an accepted change request.')}
        >
          <input type="checkbox" checked={locks} onChange={(e) => setLocks(e.target.checked)} />
          {t('Milestone (freeze requirements)')}
        </label>
        <button type="submit" className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
          {t('Create baseline')}
        </button>
      </form>
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">{t('Name')}</th>
              <th className="px-3 py-2 font-medium">{t('Created')}</th>
              <th className="px-3 py-2 font-medium">{t('Requirements')}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {(baselines ?? []).map((b) => (
              <tr key={b.id} className="group border-b border-slate-100 last:border-0">
                <td className="px-3 py-2 font-medium text-slate-800">
                  {b.name}
                  {b.locks_items && (
                    <span className="ml-2 rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] font-medium text-indigo-700">
                      {t('milestone')}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-slate-500">{new Date(b.created_at).toLocaleString()}</td>
                <td className="px-3 py-2 text-slate-600">{b.item_count}</td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => {
                      if (window.confirm(t('Delete baseline "{name}"?', { name: b.name }))) deleteBaseline.mutate(b.id)
                    }}
                    className="invisible text-xs text-slate-400 hover:text-red-600 group-hover:visible"
                  >
                    {t('Delete')}
                  </button>
                </td>
              </tr>
            ))}
            {(baselines ?? []).length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-slate-400">
                  {t('No baselines yet. Create one when you reach a milestone.')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <button onClick={() => setShowLog((v) => !v)} className="mt-8 text-sm font-medium text-slate-500 hover:text-slate-800">
        {showLog ? '▾' : '▸'} {t('Change history (version store)')}
      </button>
      {showLog && (
        <div className="mt-2 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <ul className="divide-y divide-slate-100">
            {(gitLog ?? []).map((c) => (
              <li key={c.sha} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="flex-1 text-slate-700">{c.message}</span>
                <span className="text-xs text-slate-400">{new Date(c.date).toLocaleString()}</span>
              </li>
            ))}
            {(gitLog ?? []).length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-slate-400">{t('No changes recorded yet.')}</li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
