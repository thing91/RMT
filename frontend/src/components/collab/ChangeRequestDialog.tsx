import { useState } from 'react'
import { apiErrorDetail, apiErrorMessage } from '../../api/client'
import { useChangeRequests, useItemTransition, useSubjectWorkflow } from '../../api/collabHooks'
import { useItemLinks } from '../../api/hooks'
import type { Item } from '../../api/types'
import Modal, { btn, input } from './Modal'

/** Raise a change request on a workflow-locked item (e.g. Approved): runs
 * the workflow transition into "Change Requested", which opens a CR with an
 * impact analysis of everything linked to the item. */
export default function ChangeRequestDialog({
  item,
  projectId,
  onClose,
}: {
  item: Item
  projectId: string
  onClose: () => void
}) {
  const { data: workflow, isLoading } = useSubjectWorkflow('item', item.id)
  const { data: openCrs } = useChangeRequests(projectId, { item_id: item.id, status: 'open' })
  const { data: links } = useItemLinks(item.id)
  const transition = useItemTransition()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  // Whatever this item's workflow calls it: the transition into a
  // "change requested" state.
  const option = workflow?.transitions.find((t) => t.to === 'change_requested' || t.key === 'request_change')
  const existing = (openCrs ?? [])[0]

  async function submit() {
    if (!option) return
    setError(null)
    try {
      await transition.mutateAsync({ item, key: option.key, input: { comment: reason.trim() } })
      setDone(true)
    } catch (e) {
      const d = apiErrorDetail(e)
      setError([d?.message ?? apiErrorMessage(e, 'Could not request the change.'), ...(d?.reasons ?? [])].join(' '))
    }
  }

  const blocked = !isLoading && (!option || !option.allowed)

  return (
    <Modal
      title={`Request a change — ${item.key ?? item.title}`}
      onClose={onClose}
      footer={
        done ? (
          <button className={btn.primary} onClick={onClose}>
            Close
          </button>
        ) : (
          <>
            <button className={btn.secondary} onClick={onClose}>
              Cancel
            </button>
            <button
              className={btn.primary}
              disabled={blocked || !reason.trim() || transition.isPending || !!existing}
              onClick={submit}
            >
              Request change
            </button>
          </>
        )
      }
    >
      <div className="space-y-3 text-sm">
        {done ? (
          <p className="rounded-md bg-green-50 px-3 py-2 text-green-800">
            Change request opened. The approvers are notified; once they accept it the item goes back to Draft for
            editing, and re-approval will flag the linked items as suspect.
          </p>
        ) : (
          <>
            <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <b>{item.title}</b> is currently <b>{workflow?.state_label ?? '…'}</b>, so it can't be edited directly.
              A change request records why it must change and lists everything that may be affected
              {links ? ` (${links.length} linked item${links.length === 1 ? '' : 's'})` : ''}.
            </p>
            {existing && (
              <p className="rounded-md bg-violet-50 px-3 py-2 text-xs text-violet-800">
                {existing.key} is already open for this item (requested by {existing.requested_by}): “{existing.reason}”
              </p>
            )}
            {!existing && blocked && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {option
                  ? `You can't request a change here: ${option.reasons.join(' ')}`
                  : "This item's workflow has no change-request step from its current state."}{' '}
                You can still <b>suggest a change</b> instead — anyone can.
              </p>
            )}
            {!existing && !blocked && (
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500">Why does it need to change? (required)</span>
                <textarea autoFocus rows={4} className={input} value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
            )}
            {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">⚠ {error}</p>}
          </>
        )}
      </div>
    </Modal>
  )
}
