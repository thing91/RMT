import { useState } from 'react'
import { apiErrorMessage } from '../../api/client'
import { useItemLock, useItemLockActions } from '../../api/collabHooks'
import { btn } from './Modal'
import { sinceText } from './useEditSession'
import PresenceAvatar from './PresenceAvatar'

/** "Edytuje: Anna, 3 min" — shown while someone else holds the item's
 * edit lock. Offers "notify me when free" and, for lock.override holders,
 * release/take over (both audited). */
export default function LockBanner({ itemId }: { itemId: string }) {
  const { data } = useItemLock(itemId)
  const actions = useItemLockActions(itemId)
  const [note, setNote] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'release' | 'take' | null>(null)

  if (!data?.lock || data.mine) return null
  const lock = data.lock

  async function run(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn()
      setNote(ok)
    } catch (err) {
      setNote(apiErrorMessage(err, 'That did not work.'))
    } finally {
      setConfirm(null)
    }
  }

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
      <div className="flex flex-wrap items-center gap-2">
        <PresenceAvatar lock={lock} size={22} />
        <span>
          <b>{lock.user_name}</b> is editing this ({sinceText(lock.acquired_at)}) — read-only for you.
        </span>
        <button
          className={btn.ghost}
          onClick={() => run(actions.notifyWhenFree, "OK — you'll be notified when it's free.")}
        >
          Notify me when free
        </button>
        {data.can_override &&
          (confirm ? (
            <span className="flex items-center gap-1">
              {confirm === 'take' ? 'Take over' : 'Release'} {lock.user_name}'s lock? Their unsaved work may be lost.
              <button
                className="font-semibold text-red-700 hover:underline"
                onClick={() =>
                  run(
                    () => actions.override(confirm === 'take'),
                    confirm === 'take' ? 'You now hold the lock.' : 'Lock released.',
                  )
                }
              >
                Yes
              </button>
              <button className={btn.ghost} onClick={() => setConfirm(null)}>
                No
              </button>
            </span>
          ) : (
            <>
              <button className={btn.ghost} onClick={() => setConfirm('release')}>
                Release lock
              </button>
              <button className={btn.ghost} onClick={() => setConfirm('take')}>
                Take over
              </button>
            </>
          ))}
      </div>
      {note && <div className="mt-1 text-amber-700">{note}</div>}
    </div>
  )
}
