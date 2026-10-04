import { useState, type FormEvent } from 'react'
import { apiErrorMessage } from '../api/client'
import { useAuth } from '../auth/AuthContext'

/** Compact top-right widget: an avatar/name button that opens a small
 * dropdown — either the sign-in form (anonymous) or a sign-out action
 * (signed in). Lives in the TopBar, not the sidebar. */
export default function AuthBar() {
  const { user, login, logout } = useAuth()
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
      setError(apiErrorMessage(err, 'Could not sign in.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-sm hover:bg-slate-100"
      >
        <span
          className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold text-white ${
            user ? 'bg-blue-600' : 'bg-slate-400'
          }`}
        >
          {user ? user.display_name.slice(0, 1).toUpperCase() : '?'}
        </span>
        <span className="font-medium text-slate-700">{user ? user.display_name : 'Sign in'}</span>
      </button>

      {open && (
        <>
          <button
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div className="absolute right-0 z-20 mt-2 w-64 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
            {user ? (
              <div className="space-y-2">
                <p className="text-sm text-slate-600">
                  Signed in as <span className="font-medium text-slate-800">{user.display_name}</span>
                </p>
                <button
                  onClick={() => {
                    logout()
                    setOpen(false)
                  }}
                  className="w-full rounded-md border border-slate-300 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                >
                  Sign out
                </button>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-2">
                <input
                  className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  placeholder="Username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoFocus
                />
                <input
                  type="password"
                  className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-md bg-blue-600 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  Sign in
                </button>
                {error && <p className="text-xs text-red-600">{error}</p>}
                <p className="text-[11px] text-slate-400">
                  No LDAP server configured — dev mode accepts "admin" with any password.
                </p>
              </form>
            )}
          </div>
        </>
      )}
    </div>
  )
}
