import { useCallback, useEffect, useRef, useState } from 'react'
import { apiErrorDetail, apiStatus, beacon } from '../../api/client'
import { useItemLockActions } from '../../api/collabHooks'
import type { EditLock } from '../../api/types'

const HEARTBEAT_MS = 60_000

/** Edit session on one item: takes the item's edit lock (a lease) on
 * `start()`, keeps it alive with a heartbeat while editing, and releases
 * it on `stop()`, on unmount, or — via sendBeacon — when the tab closes.
 * If the lease is lost (expired and taken, or overridden by an admin),
 * `lost` is set so the UI can tell the user before they try to save. */
export function useEditSession(itemId: string) {
  const actions = useItemLockActions(itemId)
  const [editing, setEditing] = useState(false)
  const [heldBy, setHeldBy] = useState<EditLock | null>(null)
  const [lost, setLost] = useState<string | null>(null)
  const editingRef = useRef(false)

  const stop = useCallback(async () => {
    if (!editingRef.current) return
    editingRef.current = false
    setEditing(false)
    setLost(null)
    try {
      await actions.release()
    } catch {
      // Already gone — nothing to release.
    }
  }, [actions])

  const start = useCallback(async (): Promise<{ ok: boolean; heldBy: EditLock | null; error?: unknown }> => {
    setHeldBy(null)
    setLost(null)
    try {
      await actions.acquire()
      editingRef.current = true
      setEditing(true)
      return { ok: true, heldBy: null }
    } catch (err) {
      const holder = apiStatus(err) === 423 ? (apiErrorDetail(err)?.lock ?? null) : null
      setHeldBy(holder)
      return { ok: false, heldBy: holder, error: err }
    }
  }, [actions])

  // Heartbeat while editing.
  useEffect(() => {
    if (!editing) return
    const id = window.setInterval(async () => {
      try {
        await actions.heartbeat()
      } catch (err) {
        if (apiStatus(err) === 409) {
          setLost(apiErrorDetail(err)?.message ?? 'You no longer hold the edit lock.')
        }
      }
    }, HEARTBEAT_MS)
    return () => window.clearInterval(id)
  }, [editing, actions])

  // Release on tab close / navigation away, and on unmount.
  useEffect(() => {
    const onUnload = () => {
      if (editingRef.current) beacon(`/items/${itemId}/lock/release`)
    }
    window.addEventListener('pagehide', onUnload)
    return () => {
      window.removeEventListener('pagehide', onUnload)
      if (editingRef.current) {
        editingRef.current = false
        actions.release().catch(() => undefined)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId])

  return { editing, start, stop, heldBy, lost, setLost }
}

export function sinceText(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  return `${h} h ${minutes % 60} min`
}
