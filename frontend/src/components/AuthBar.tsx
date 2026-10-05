import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { apiErrorMessage } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { useI18n } from '../i18n'

/** Account menu (avatar, top right): who you are, interface language,
 * ideas & roadmap, sign out — or the sign-in form. Application
 * administration has its own ⚙ button next to it (AdminButton). */
export default function AuthBar() {
  const { user, login, logout } = useAuth()
  const { t, lang, setLang } = useI18n()
  const [open, setOpen] = useState(false)
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(username, password)
      setOpen(false)
      setPassword('')
    } catch (err) {
      setError(apiErrorMessage(err, t('Could not sign in.')))
    } finally {
      setSubmitting(false)
    }
  }

  const item = 'block w-full rounded-md px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100'

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 text-sm hover:bg-slate-100"
        aria-label={user ? user.display_name : t('Sign in')}
      >
        <span
          className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold text-white ${
            user ? 'bg-blue-600' : 'bg-slate-400'
          }`}
        >
          {user ? user.display_name.slice(0, 1).toUpperCase() : '?'}
        </span>
        {!user && <span className="font-medium text-slate-700">{t('Sign in')}</span>}
      </button>

      {open && (
        <>
          <button aria-label={t('Close')} onClick={() => setOpen(false)} className="fixed inset-0 z-10 cursor-default" />
          <div className="absolute right-0 z-20 mt-2 w-64 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
            {user ? (
              <div className="space-y-1">
                <div className="px-2 pb-2 pt-1">
                  <div className="text-sm font-medium text-slate-800">{user.display_name}</div>
                  <div className="text-xs text-slate-500">{user.username}</div>
                </div>
                <div className="flex items-center justify-between border-t border-slate-100 px-2 py-2 text-sm text-slate-600">
                  {t('Language')}
                  <span className="flex overflow-hidden rounded-md border border-slate-200 text-xs">
                    {(['pl', 'en'] as const).map((l) => (
                      <button
                        key={l}
                        onClick={() => setLang(l)}
                        className={`px-2 py-0.5 font-medium ${lang === l ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
                      >
                        {l.toUpperCase()}
                      </button>
                    ))}
                  </span>
                </div>
                <div className="border-t border-slate-100 pt-1">
                  <Link to="/admin/api" className={item} onClick={() => setOpen(false)}>
                    {t('API & tokens')}
                  </Link>
                  <Link to="/roadmap" className={item} onClick={() => setOpen(false)}>
                    {t('Ideas & roadmap')}
                  </Link>
                </div>
                <div className="border-t border-slate-100 pt-1">
                  <button
                    onClick={() => {
                      logout()
                      setOpen(false)
                    }}
                    className={item}
                  >
                    {t('Sign out')}
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-2 p-1">
                <input
                  className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  placeholder={t('Username')}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoFocus
                />
                <input
                  type="password"
                  className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  placeholder={t('Password')}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-md bg-blue-600 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {t('Sign in')}
                </button>
                {error && <p className="text-xs text-red-600">{error}</p>}
                <p className="text-[11px] text-slate-400">{t('No LDAP server configured — dev mode accepts any password.')}</p>
              </form>
            )}
          </div>
        </>
      )}
    </div>
  )
}
