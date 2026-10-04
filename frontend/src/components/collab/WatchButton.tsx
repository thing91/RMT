import { useAuth } from '../../auth/AuthContext'
import { useToggleWatch, useWatch } from '../../api/collabHooks'

export default function WatchButton({ subjectType, subjectId }: { subjectType: string; subjectId: string }) {
  const { user } = useAuth()
  const { data } = useWatch(subjectType, subjectId)
  const toggle = useToggleWatch(subjectType, subjectId)
  if (!user) return null
  const watching = !!data?.watching
  return (
    <button
      onClick={() => toggle.mutate(watching)}
      disabled={toggle.isPending}
      title={watching ? 'Stop getting notifications about this' : 'Get notified about changes, comments and status'}
      className={`text-xs font-medium ${watching ? 'text-blue-600' : 'text-slate-400'} hover:text-blue-700`}
    >
      {watching ? '★ Watching' : '☆ Watch'}
      {data && data.watchers > 0 && <span className="ml-1 text-slate-400">({data.watchers})</span>}
    </button>
  )
}
