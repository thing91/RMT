import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiErrorMessage } from '../api/client'
import {
  useApproveItem,
  useCreateLink,
  useDeleteItem,
  useDeleteLink,
  useGlossary,
  useItemLinks,
  useParameters,
  useReferenceDocuments,
  useStandards,
  useUpdateItem,
} from '../api/hooks'
import type { Item, ItemType, LinkType } from '../api/types'
import AttributeField from './AttributeField'
import CommentsSection from './CommentsSection'
import DescriptionPreview from './DescriptionPreview'

function countDescendants(item: Item): number {
  return item.children.reduce((sum, child) => sum + 1 + countDescendants(child), 0)
}

interface Props {
  item: Item
  itemType: ItemType
  itemTypes: ItemType[]
  linkTypes: LinkType[]
  allItems: Item[]
  onClose: () => void
  orgId: string
  /** Stacked below a narrow split-view pane instead of docked to the right
   * of a full-width tree — full width, capped height, its own scroll. */
  compact?: boolean
}

export default function ItemDetailPanel({
  item,
  itemType,
  itemTypes,
  linkTypes,
  allItems,
  onClose,
  orgId,
  compact,
}: Props) {
  const { projectId } = useParams<{ projectId: string }>()
  const updateItem = useUpdateItem()
  const deleteItem = useDeleteItem()
  const approveItem = useApproveItem()
  const { data: glossaryTerms } = useGlossary(orgId)
  const { data: standards } = useStandards(orgId)
  const { data: referenceDocuments } = useReferenceDocuments(projectId)
  const { data: parameters } = useParameters(projectId)
  const { data: links } = useItemLinks(item.id)
  const createLink = useCreateLink()
  const deleteLink = useDeleteLink()

  const [title, setTitle] = useState(item.title)
  const [description, setDescription] = useState(item.description_md ?? '')
  const [linkError, setLinkError] = useState<string | null>(null)
  const [linkTypeId, setLinkTypeId] = useState('')
  const [direction, setDirection] = useState<'outgoing' | 'incoming'>('outgoing')
  const [targetId, setTargetId] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [approveNote, setApproveNote] = useState('')
  const [approvingValue, setApprovingValue] = useState<string | null>(null)
  const [approveError, setApproveError] = useState<string | null>(null)

  const statusAttr = itemType.attributes.find((a) => a.key === 'status' && a.data_type === 'enum')
  const currentStatus = statusAttr ? item.attributes[statusAttr.key] : undefined
  const gatedOptions = (statusAttr?.enum_options ?? []).filter(
    (o) => o.requires_approval && o.value !== currentStatus,
  )

  function submitApproval(value: string) {
    setApproveError(null)
    approveItem.mutate(
      { itemId: item.id, payload: { status_value: value, note: approveNote.trim() || undefined } },
      {
        onSuccess: () => {
          setApprovingValue(null)
          setApproveNote('')
        },
        onError: (err) => setApproveError(apiErrorMessage(err, 'Could not approve this item.')),
      },
    )
  }

  const descendantCount = countDescendants(item)

  function confirmDelete() {
    deleteItem.mutate(item.id, { onSuccess: onClose })
  }

  const itemTypeById = new Map(itemTypes.map((t) => [t.id, t]))
  const itemById = new Map(allItems.map((i) => [i.id, i]))

  function saveField(field: 'title' | 'description_md', value: string) {
    updateItem.mutate({ id: item.id, payload: { [field]: value } })
  }

  function setAttribute(key: string, value: unknown) {
    updateItem.mutate({
      id: item.id,
      payload: { attributes: { ...item.attributes, [key]: value } },
    })
  }

  function submitLink(e: FormEvent) {
    e.preventDefault()
    setLinkError(null)
    if (!linkTypeId || !targetId) return
    const payload =
      direction === 'outgoing'
        ? { source_item_id: item.id, target_item_id: targetId, link_type_id: linkTypeId }
        : { source_item_id: targetId, target_item_id: item.id, link_type_id: linkTypeId }
    createLink.mutate(payload, {
      onSuccess: () => setTargetId(''),
      onError: (err) => setLinkError(apiErrorMessage(err, 'Could not create this link.')),
    })
  }

  return (
    <div
      className={
        compact
          ? 'flex max-h-80 shrink-0 flex-col border-t border-slate-200 bg-white'
          : 'flex h-full w-96 max-w-full shrink-0 flex-col border-l border-slate-200 bg-white'
      }
    >
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
            {itemType.name} {item.key ? `· ${item.key}` : ''}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {itemType.behavior === 'content' && projectId && (
            <Link
              to={`/projects/${projectId}/graph?center=${item.id}`}
              className="text-xs font-medium text-slate-400 hover:text-blue-600"
            >
              View Graph
            </Link>
          )}
          <button
            onClick={() => setConfirmingDelete(true)}
            className="text-xs font-medium text-slate-400 hover:text-red-600"
          >
            Delete
          </button>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>
      </div>

      {confirmingDelete && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm">
          <p className="mb-2 text-red-800">
            Delete <span className="font-medium">{item.title}</span>?
            {descendantCount > 0 && (
              <>
                {' '}
                This will also delete{' '}
                <span className="font-medium">
                  {descendantCount} nested item{descendantCount === 1 ? '' : 's'}
                </span>
                .
              </>
            )}{' '}
            This can't be undone.
          </p>
          <div className="flex gap-2">
            <button
              onClick={confirmDelete}
              disabled={deleteItem.isPending}
              className="rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              Yes, delete
            </button>
            <button
              onClick={() => setConfirmingDelete(false)}
              className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {item.approved_by && (
        <div
          className={`border-b px-4 py-2 text-xs ${
            item.approval_stale ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-green-200 bg-green-50 text-green-800'
          }`}
        >
          Approved by <span className="font-medium">{item.approved_by}</span>
          {item.approved_at && ` on ${new Date(item.approved_at).toLocaleString()}`}
          {item.approval_stale && ' — edited since approval, may need re-approval'}
        </div>
      )}

      {itemType.behavior === 'content' && gatedOptions.length > 0 && (
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-2">
          {approvingValue === null ? (
            <div className="flex flex-wrap gap-1.5">
              {gatedOptions.map((o) => (
                <button
                  key={o.value}
                  onClick={() => setApprovingValue(o.value)}
                  className="rounded-md bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700"
                >
                  Approve → {o.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-1.5">
              <input
                autoFocus
                className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
                placeholder="Optional note (included in the notification email)…"
                value={approveNote}
                onChange={(e) => setApproveNote(e.target.value)}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => submitApproval(approvingValue)}
                  disabled={approveItem.isPending}
                  className="rounded-md bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  Confirm approval
                </button>
                <button
                  onClick={() => {
                    setApprovingValue(null)
                    setApproveError(null)
                  }}
                  className="text-xs text-slate-400 hover:text-slate-700"
                >
                  Cancel
                </button>
              </div>
              {approveError && <p className="text-xs text-red-600">⚠ {approveError}</p>}
            </div>
          )}
        </div>
      )}

      <div className="flex-1 overflow-auto p-4">
        <label className="mb-1 block text-xs font-medium text-slate-500">Title</label>
        <input
          className="mb-4 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm font-medium focus:border-blue-500 focus:outline-none"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => saveField('title', title)}
        />

        {itemType.behavior === 'content' && (
          <>
            <label className="mb-1 block text-xs font-medium text-slate-500">Description</label>
            <textarea
              className="mb-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() => saveField('description_md', description)}
            />
            {description && glossaryTerms && (
              <div className="mb-4 rounded-md bg-slate-50 px-2 py-1.5">
                <DescriptionPreview
                  text={description}
                  glossaryTerms={glossaryTerms}
                  referenceSources={[...(standards ?? []), ...(referenceDocuments ?? [])]}
                  parameters={parameters ?? []}
                />
              </div>
            )}

            {itemType.attributes.length > 0 && (
              <div className="mb-4 space-y-3">
                {itemType.attributes.map((attr) => (
                  <div key={attr.id}>
                    <label className="mb-1 block text-xs font-medium text-slate-500">
                      {attr.label}
                      {attr.required ? ' *' : ''}
                    </label>
                    <AttributeField
                      attribute={attr}
                      value={item.attributes[attr.key]}
                      onChange={(v) => setAttribute(attr.key, v)}
                    />
                  </div>
                ))}
              </div>
            )}

            <div className="border-t border-slate-200 pt-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Links
              </h3>
              <ul className="mb-3 space-y-1.5">
                {(links ?? []).map((link) => {
                  const linkType = linkTypes.find((lt) => lt.id === link.link_type_id)
                  const isOutgoing = link.source_item_id === item.id
                  const otherId = isOutgoing ? link.target_item_id : link.source_item_id
                  const other = itemById.get(otherId)
                  return (
                    <li
                      key={link.id}
                      className="flex items-center justify-between rounded-md bg-slate-50 px-2 py-1.5 text-xs"
                    >
                      <span>
                        <span className="font-medium text-slate-600">
                          {isOutgoing ? linkType?.name : linkType?.inverse_name}
                        </span>{' '}
                        {other?.key ?? other?.title ?? otherId.slice(0, 8)}
                      </span>
                      <button
                        onClick={() => deleteLink.mutate(link.id)}
                        className="text-slate-400 hover:text-red-600"
                      >
                        ✕
                      </button>
                    </li>
                  )
                })}
                {(links ?? []).length === 0 && (
                  <li className="text-xs text-slate-400">No links yet.</li>
                )}
              </ul>

              <form onSubmit={submitLink} className="space-y-2 rounded-md border border-slate-200 p-2">
                <select
                  className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
                  value={linkTypeId}
                  onChange={(e) => setLinkTypeId(e.target.value)}
                >
                  <option value="">Link type…</option>
                  {linkTypes.map((lt) => (
                    <option key={lt.id} value={lt.id}>
                      {lt.name}
                    </option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <select
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                    value={direction}
                    onChange={(e) => setDirection(e.target.value as 'outgoing' | 'incoming')}
                  >
                    <option value="outgoing">this →</option>
                    <option value="incoming">→ this</option>
                  </select>
                  <select
                    className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs"
                    value={targetId}
                    onChange={(e) => setTargetId(e.target.value)}
                  >
                    <option value="">Target item…</option>
                    {allItems
                      .filter((i) => i.id !== item.id && itemTypeById.get(i.item_type_id)?.behavior === 'content')
                      .map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.key ?? i.title} — {i.title}
                        </option>
                      ))}
                  </select>
                </div>
                <button
                  type="submit"
                  className="w-full rounded-md bg-blue-600 py-1 text-xs font-medium text-white hover:bg-blue-700"
                >
                  Add link
                </button>
                {linkError && (
                  <p className="rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-700">
                    ⚠ {linkError}
                  </p>
                )}
              </form>
            </div>

            <CommentsSection itemId={item.id} orgId={orgId} />
          </>
        )}
      </div>
    </div>
  )
}
