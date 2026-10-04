import { useParams } from 'react-router-dom'
import { useProjectLocks } from '../../api/liveEvents'
import type { EditLock } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { sinceText } from './useEditSession'

// Identity colors: the validated categorical slots (light surface), in
// fixed order, picked by a stable hash of the user id — a person keeps
// their color everywhere. Initials are always shown, so color is never
// the only cue.
const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948']

export function userColor(userId: string): string {
  let h = 0
  for (const ch of userId) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

export function lockTitle(lock: EditLock, isMe: boolean, label?: string): string {
  const who = isMe ? 'You' : lock.user_name
  const what =
    lock.scope === 'structure'
      ? lock.implicit
        ? 'moving items in this document'
        : 'reorganizing this document (structure locked)'
      : `editing ${label ?? 'this item'}`
  return `${who} — ${what} · since ${sinceText(lock.acquired_at)}`
}

/** A round avatar with initials. `ring` marks "this is locked" (a dashed
 * ring for a structure lock); a small ✎/⇅ badge says what kind. */
export default function PresenceAvatar({
  lock,
  size = 22,
  label,
}: {
  lock: EditLock
  size?: number
  label?: string
}) {
  const { user } = useAuth()
  const isMe = user?.id === lock.user_id
  const color = userColor(lock.user_id)
  const structure = lock.scope === 'structure'
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, Math.round(size * 0.42)),
        backgroundColor: color,
        boxShadow: `0 0 0 2px #fff, 0 0 0 ${structure ? 3 : 4}px ${color}${structure ? '80' : ''}`,
      }}
      title={lockTitle(lock, isMe, label)}
      aria-label={lockTitle(lock, isMe, label)}
      role="img"
    >
      {initials(lock.user_name)}
      <span
        className="absolute -bottom-1 -right-1.5 flex items-center justify-center rounded-full bg-white text-[8px] leading-none shadow-sm"
        style={{ width: Math.max(10, Math.round(size * 0.45)), height: Math.max(10, Math.round(size * 0.45)), color }}
        aria-hidden
      >
        {structure ? '⇅' : '✎'}
      </span>
    </span>
  )
}

/** Live lock on one item (from the project-wide lock list). */
export function ItemPresence({ itemId, label, size }: { itemId: string; label?: string; size?: number }) {
  const { projectId } = useParams<{ projectId: string }>()
  const { data: locks } = useProjectLocks(projectId)
  const lock = locks?.find((l) => l.scope === 'item' && l.target_id === itemId)
  return lock ? <PresenceAvatar lock={lock} label={label} size={size} /> : null
}

/** Everyone currently working in a document: its structure lock holder
 * plus each person editing an item in it (one avatar per person). */
export function DocumentPresence({ documentId, size = 18, max = 4 }: { documentId: string; size?: number; max?: number }) {
  const { projectId } = useParams<{ projectId: string }>()
  const { data: locks } = useProjectLocks(projectId)
  const inDoc = (locks ?? []).filter((l) => l.document_id === documentId)
  if (inDoc.length === 0) return null
  // One avatar per person; a structure lock wins (it blocks more).
  const byUser = new Map<string, EditLock>()
  for (const l of inDoc) {
    const prev = byUser.get(l.user_id)
    if (!prev || (l.scope === 'structure' && prev.scope !== 'structure')) byUser.set(l.user_id, l)
  }
  const shown = [...byUser.values()]
  const counts = new Map<string, number>()
  for (const l of inDoc) if (l.scope === 'item') counts.set(l.user_id, (counts.get(l.user_id) ?? 0) + 1)
  return (
    <span className="inline-flex items-center -space-x-1">
      {shown.slice(0, max).map((l) => (
        <PresenceAvatar
          key={l.user_id}
          lock={l}
          size={size}
          label={l.scope === 'item' ? `${counts.get(l.user_id) ?? 1} item(s) in this document` : undefined}
        />
      ))}
      {shown.length > max && <span className="pl-2 text-[10px] text-slate-500">+{shown.length - max}</span>}
    </span>
  )
}
