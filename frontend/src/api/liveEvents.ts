import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, TOKEN_STORAGE_KEY } from './client'
import type { EditLock } from './types'

interface LockEvent {
  type: 'lock'
  project_id: string
  scope: 'item' | 'structure'
  target_id: string
  document_id: string | null
  lock: EditLock | null
}

/** Every live edit lock in a project — the source of the presence avatars.
 * Kept fresh by the SSE stream (see useLiveEvents); the slow refetch is only
 * a fallback if the stream drops. */
export function useProjectLocks(projectId?: string) {
  return useQuery({
    queryKey: ['project-locks', projectId],
    queryFn: async () => (await api.get<EditLock[]>(`/projects/${projectId}/locks`)).data,
    enabled: !!projectId,
    refetchInterval: 60_000,
    select: (locks) => locks.filter((l) => new Date(l.expires_at).getTime() > Date.now()),
  })
}

/** One EventSource per page: lock changes for the open project and the
 * signed-in user's notifications, applied straight into the React Query
 * cache so avatars, lock banners and the bell update instantly. */
export function useLiveEvents(projectId: string | undefined, signedIn: boolean) {
  const qc = useQueryClient()
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY)
    if (!token || !signedIn || typeof EventSource === 'undefined') return
    const params = new URLSearchParams({ token })
    if (projectId) params.set('project_id', projectId)
    const source = new EventSource(`/api/v1/events?${params}`)

    source.addEventListener('lock', (e) => {
      const evt = JSON.parse((e as MessageEvent).data) as LockEvent
      qc.setQueryData<EditLock[]>(['project-locks', evt.project_id], (prev) => {
        const rest = (prev ?? []).filter((l) => !(l.scope === evt.scope && l.target_id === evt.target_id))
        return evt.lock ? [...rest, evt.lock] : rest
      })
      if (evt.scope === 'item') qc.invalidateQueries({ queryKey: ['item-lock', evt.target_id] })
      else qc.invalidateQueries({ queryKey: ['structure-lock', evt.target_id] })
      // The lock may have ended with a save — refresh the item's content.
      if (!evt.lock && evt.scope === 'item') {
        qc.invalidateQueries({ queryKey: ['document-tree', evt.document_id] })
        qc.invalidateQueries({ queryKey: ['project-items', evt.project_id] })
      }
    })
    source.addEventListener('notification', () => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
    })
    // EventSource reconnects by itself; after a gap, resync from the API.
    source.addEventListener('ready', () => {
      if (projectId) qc.invalidateQueries({ queryKey: ['project-locks', projectId] })
    })
    return () => source.close()
  }, [projectId, signedIn, qc])
}
