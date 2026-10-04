import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMarkAllNotificationsRead, useMarkNotificationRead, useNotifications } from '../api/collabHooks'
import { useAuth } from '../auth/AuthContext'

/** In-app inbox: status changes, comments, mentions, suggestions,
 * review invitations, lock overrides. Polls every 30 s. */
export default function NotificationBell() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { data } = useNotifications(!!user)
  const markRead = useMarkNotificationRead()
  const markAll = useMarkAllNotificationsRead()
  const [open, setOpen] = useState(false)
  if (!user) return null
  const unread = data?.unread ?? 0

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-full p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
        title="Notifications"
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-red-600 px-1 text-[10px] font-bold leading-4 text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <>
          <button aria-label="Close" onClick={() => setOpen(false)} className="fixed inset-0 z-10 cursor-default" />
          <div className="absolute right-0 z-20 mt-2 flex max-h-[70vh] w-96 flex-col rounded-lg border border-slate-200 bg-white shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
              <span className="text-sm font-semibold text-slate-700">Notifications</span>
              {unread > 0 && (
                <button className="text-xs text-blue-600 hover:underline" onClick={() => markAll.mutate()}>
                  Mark all read
                </button>
              )}
            </div>
            <ul className="flex-1 divide-y divide-slate-100 overflow-auto">
              {(data?.items ?? []).map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => {
                      if (!n.read) markRead.mutate(n)
                      setOpen(false)
                      if (n.url) navigate(n.url)
                    }}
                    className={`block w-full px-3 py-2 text-left hover:bg-slate-50 ${n.read ? '' : 'bg-blue-50/60'}`}
                  >
                    <div className="flex items-start gap-2">
                      {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-600" />}
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-slate-800">{n.title}</div>
                        {n.body && <div className="line-clamp-2 text-xs text-slate-500">{n.body}</div>}
                        <div className="mt-0.5 text-[11px] text-slate-400">{new Date(n.created_at).toLocaleString()}</div>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
              {(data?.items ?? []).length === 0 && (
                <li className="px-3 py-6 text-center text-xs text-slate-400">Nothing yet.</li>
              )}
            </ul>
          </div>
        </>
      )}
    </div>
  )
}
