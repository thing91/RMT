import { useEffect, useState } from 'react'
import { apiErrorMessage } from '../../api/client'
import { can, usePermissions, useStructureLock, useStructureLockActions } from '../../api/collabHooks'
import { useParams } from 'react-router-dom'
import { sinceText } from './useEditSession'

/** The document's structure lock (order/hierarchy), separate from item
 * content locks. Toolbar moves take a short implicit lease automatically;
 * "Reorganize" takes an explicit lock for a longer restructuring session
 * (and blocks others from adding items meanwhile). */
export default function StructureLockBar({ documentId }: { documentId: string }) {
  const { projectId } = useParams<{ projectId: string }>()
  const { data: perms } = usePermissions(projectId)
  const { data } = useStructureLock(documentId)
  const actions = useStructureLockActions(documentId)
  const [error, setError] = useState<string | null>(null)
  const mineExplicit = !!data?.mine && !!data.lock && !data.lock.implicit

  useEffect(() => {
    if (!mineExplicit) return
    const id = window.setInterval(() => actions.heartbeat().catch(() => undefined), 60_000)
    return () => {
      window.clearInterval(id)
    }
  }, [mineExplicit, actions])

  if (!can(perms, 'structure.edit')) return null
  const lock = data?.lock
  const otherHolds = !!lock && !data?.mine

  async function run(fn: () => Promise<unknown>) {
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(apiErrorMessage(err, 'That did not work.'))
    }
  }

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
      {otherHolds && lock && (
        <span className="rounded-md bg-amber-50 px-2 py-1 text-amber-800">
          ⇅ {lock.user_name} is {lock.implicit ? 'moving items' : 'reorganizing this document'} (
          {sinceText(lock.acquired_at)}) — structure changes are blocked for you
          {lock.implicit ? ' for a moment.' : '.'}
        </span>
      )}
      {mineExplicit ? (
        <button
          className="rounded-md bg-amber-500 px-2 py-1 font-medium text-white hover:bg-amber-600"
          onClick={() => run(actions.release)}
        >
          ⇅ Done reorganizing
        </button>
      ) : (
        !otherHolds && (
          <button
            className="rounded-md border border-slate-200 px-2 py-1 text-slate-500 hover:bg-slate-100"
            title="Lock the document structure while you reorganize it (others can still edit item text)"
            onClick={() => run(actions.acquire)}
          >
            ⇅ Reorganize…
          </button>
        )
      )}
      {otherHolds && data?.can_override && (
        <button className="text-slate-500 hover:text-red-600" onClick={() => run(() => actions.override(false))}>
          Release their structure lock
        </button>
      )}
      {error && <span className="text-red-600">⚠ {error}</span>}
    </div>
  )
}
