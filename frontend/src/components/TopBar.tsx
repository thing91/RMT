import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import AuthBar from './AuthBar'
import NotificationBell from './NotificationBell'
import { useLiveEvents } from '../api/liveEvents'
import { useAuth } from '../auth/AuthContext'

export default function TopBar({ children }: { children?: ReactNode }) {
  const { projectId } = useParams<{ projectId?: string }>()
  const { user } = useAuth()
  useLiveEvents(projectId, !!user)
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link to="/" className="font-semibold text-slate-800 hover:text-blue-600">
          RMT
        </Link>
        {children}
      </div>
      <div className="flex items-center gap-4">
        <Link to="/glossary" className="text-sm font-medium text-slate-500 hover:text-blue-600">
          Glossary
        </Link>
        <Link to="/roadmap" className="text-sm font-medium text-slate-500 hover:text-blue-600">
          Roadmap
        </Link>
        <NotificationBell />
        <AuthBar />
      </div>
    </header>
  )
}
