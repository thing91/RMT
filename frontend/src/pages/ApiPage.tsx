import { useMemo, useState, type FormEvent } from 'react'
import { apiErrorMessage } from '../api/client'
import { useApiTokens, useCreateApiToken, useOpenApi, useRevokeApiToken } from '../api/developerHooks'
import { useAuth } from '../auth/AuthContext'
import { useI18n } from '../i18n'

function CopyButton({ text }: { text: string }) {
  const { t } = useI18n()
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={() =>
        navigator.clipboard?.writeText(text).then(
          () => {
            setDone(true)
            window.setTimeout(() => setDone(false), 1500)
          },
          () => undefined,
        )
      }
      className="shrink-0 rounded-md border border-slate-200 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50"
    >
      {done ? t('Copied') : t('Copy')}
    </button>
  )
}

function Code({ children }: { children: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md bg-slate-900 px-3 py-2">
      <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-xs leading-relaxed text-slate-100">
        {children}
      </pre>
      <CopyButton text={children} />
    </div>
  )
}

function Tokens() {
  const { t, lang } = useI18n()
  const { data: tokens } = useApiTokens()
  const create = useCreateApiToken()
  const revoke = useRevokeApiToken()
  const [name, setName] = useState('')
  const [days, setDays] = useState('90')
  const [fresh, setFresh] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(lang === 'pl' ? 'pl-PL' : 'en-GB') : '—')

  function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    create.mutate(
      { name: name.trim(), expires_in_days: days === 'never' ? null : Number(days) },
      {
        onSuccess: (row) => {
          setFresh(row.token)
          setName('')
        },
        onError: (err) => setError(apiErrorMessage(err, t('Could not create the token.'))),
      },
    )
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-slate-800">{t('Your API tokens')}</h2>
      <p className="max-w-2xl text-sm text-slate-500">
        {t('A token works like your own sign-in, with your permissions — use it for scripts and integrations instead of your password. Revoke it as soon as it is no longer needed.')}
      </p>
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <input
          id="api-token-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('Token name (e.g. CI export)')}
          aria-label={t('Token name (e.g. CI export)')}
          className="min-w-56 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
        <select
          id="api-token-expiry"
          value={days}
          onChange={(e) => setDays(e.target.value)}
          aria-label={t('Expires')}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        >
          <option value="30">{t('30 days')}</option>
          <option value="90">{t('90 days')}</option>
          <option value="365">{t('1 year')}</option>
          <option value="never">{t('Never expires')}</option>
        </select>
        <button
          type="submit"
          disabled={!name.trim() || create.isPending}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {t('Create token')}
        </button>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {fresh && (
        <div className="space-y-1 rounded-md border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-medium text-amber-800">
            {t('Copy the token now — it will not be shown again.')}
          </p>
          <Code>{fresh}</Code>
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">{t('Name')}</th>
              <th className="px-3 py-2 font-medium">{t('Token')}</th>
              <th className="px-3 py-2 font-medium">{t('Created')}</th>
              <th className="px-3 py-2 font-medium">{t('Expires')}</th>
              <th className="px-3 py-2 font-medium">{t('Last used')}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {(tokens ?? []).map((tok) => {
              const dead = !!tok.revoked_at || (!!tok.expires_at && new Date(tok.expires_at) < new Date())
              return (
                <tr key={tok.id} className={`border-b border-slate-100 last:border-0 ${dead ? 'text-slate-400' : ''}`}>
                  <td className="px-3 py-2 font-medium">{tok.name}</td>
                  <td className="px-3 py-2 font-mono text-xs">{tok.prefix}…</td>
                  <td className="px-3 py-2">{fmt(tok.created_at)}</td>
                  <td className="px-3 py-2">{tok.expires_at ? fmt(tok.expires_at) : t('never')}</td>
                  <td className="px-3 py-2">{fmt(tok.last_used_at)}</td>
                  <td className="px-3 py-2 text-right">
                    {tok.revoked_at ? (
                      <span className="text-xs">{t('revoked')}</span>
                    ) : (
                      <button
                        onClick={() => revoke.mutate(tok.id)}
                        className="text-xs text-slate-500 hover:text-red-600"
                      >
                        {t('Revoke')}
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
            {(tokens ?? []).length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                  {t('No tokens yet.')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/** ⚙ → API: where the REST API lives, how to authenticate, examples, the
 * areas it covers, and the signed-in user's personal API tokens. */
export default function ApiPage() {
  const { t } = useI18n()
  const { user } = useAuth()
  const { data: spec } = useOpenApi()
  const origin = window.location.origin
  const base = `${origin}/api/v1`

  const areas = useMemo(() => {
    const byTag = new Map<string, number>()
    for (const methods of Object.values(spec?.paths ?? {})) {
      for (const op of Object.values(methods)) {
        const tag = op.tags?.[0] ?? 'other'
        byTag.set(tag, (byTag.get(tag) ?? 0) + 1)
      }
    }
    return [...byTag.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [spec])

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-800">{t('REST API')}</h2>
        <p className="max-w-2xl text-sm text-slate-500">
          {t('Everything the application does goes through this API, so anything you can do in the browser you can also script. Reads of public projects work without signing in; everything else needs a token.')}
        </p>
        <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
          <dt className="text-slate-500">{t('Base address')}</dt>
          <dd className="flex min-w-0 items-center gap-2 font-mono text-xs">
            <span className="truncate">{base}</span>
            <CopyButton text={base} />
          </dd>
          <dt className="text-slate-500">{t('Documentation')}</dt>
          <dd className="flex flex-wrap gap-3">
            <a href="/api/docs" target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">
              {t('Interactive (Swagger)')} ↗
            </a>
            <a href="/api/redoc" target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">
              {t('Reference (ReDoc)')} ↗
            </a>
            <a href="/api/openapi.json" target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">
              OpenAPI JSON ↗
            </a>
          </dd>
          <dt className="text-slate-500">{t('Authentication')}</dt>
          <dd className="text-slate-700">
            {t('Header')} <code className="rounded bg-slate-100 px-1 text-xs">Authorization: Bearer &lt;token&gt;</code>
          </dd>
          <dt className="text-slate-500">{t('Concurrency')}</dt>
          <dd className="text-slate-700">
            {t('Item reads return an ETag; send it back as If-Match when changing an item (412 means someone else changed it first).')}
          </dd>
        </dl>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-800">{t('Examples')}</h2>
        <p className="text-xs text-slate-500">{t('List the projects you can see:')}</p>
        <Code>{`curl -H "Authorization: Bearer $RMT_TOKEN" ${base}/organizations`}</Code>
        <p className="text-xs text-slate-500">{t('Export a document to Excel:')}</p>
        <Code>{`curl -H "Authorization: Bearer $RMT_TOKEN" -o srs.xlsx ${base}/documents/<document-id>/export.xlsx`}</Code>
        <p className="text-xs text-slate-500">{t('History of one requirement:')}</p>
        <Code>{`curl -H "Authorization: Bearer $RMT_TOKEN" ${base}/changes/items/<item-id>`}</Code>
      </section>

      {user ? <Tokens /> : <p className="text-sm text-slate-500">{t('Sign in to create API tokens.')}</p>}

      {areas.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-800">{t('What the API covers')}</h2>
          <div className="flex flex-wrap gap-1.5">
            {areas.map(([tag, n]) => (
              <a
                key={tag}
                href={`/api/docs#/${encodeURIComponent(tag)}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:border-blue-300"
              >
                {tag} <span className="text-slate-400">{n}</span>
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
