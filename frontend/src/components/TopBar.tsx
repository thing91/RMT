import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useIsOrgAdmin } from '../api/collabHooks'
import { useLiveEvents } from '../api/liveEvents'
import { useAuth } from '../auth/AuthContext'
import { useT } from '../i18n'
import AuthBar from './AuthBar'
import CommandPalette from './CommandPalette'
import NotificationBell from './NotificationBell'

/** RMT · breadcrumb · search (Ctrl+K) · glossary · bell · ⚙ (org admins) · account. */
export default function TopBar({ children }: { children?: ReactNode }) {
  const { projectId } = useParams<{ projectId?: string }>()
  const { user } = useAuth()
  const t = useT()
  const orgAdmin = useIsOrgAdmin()
  useLiveEvents(projectId, !!user)
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-slate-200 bg-white px-4">
      <div className="flex min-w-0 shrink items-center gap-2 text-sm text-slate-500">
        <Link to="/" className="font-semibold text-slate-800 hover:text-blue-600">
          RMT
        </Link>
        {children}
      </div>
      <div className="flex flex-1 justify-center">
        <CommandPalette />
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Link
          to="/glossary"
          title={t('Glossary')}
          aria-label={t('Glossary')}
          className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
          </svg>
        </Link>
        <NotificationBell />
        {orgAdmin && (
          <Link
            to="/admin"
            title={t('Organization administration')}
            aria-label={t('Organization administration')}
            className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
            </svg>
          </Link>
        )}
        <AuthBar />
      </div>
    </header>
  )
}
