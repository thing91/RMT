import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiErrorDetail, apiErrorMessage, apiStatus } from '../api/client'
import {
  can,
  useChangeRequests,
  useClearSuspect,
  useItemTransition,
  usePermissions,
  useSaveItemContent,
  useSubjectWorkflow,
  useSuspectLinks,
} from '../api/collabHooks'
import {
  useCreateLink,
  useDeleteItem,
  useDeleteLink,
  useGlossary,
  useItemLinks,
  useParameters,
  useProject,
  useReferenceDocuments,
  useStandards,
} from '../api/hooks'
import type { ApiErrorDetail, Item, ItemComment, ItemType, LinkType } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import AttributeField from './AttributeField'
import CommentsSection from './CommentsSection'
import ConflictDialog from './collab/ConflictDialog'
import HistoryPanel from './collab/HistoryPanel'
import LibraryRulesPanel from './collab/LibraryRulesPanel'
import LockBanner from './collab/LockBanner'
import StatusBadge from './collab/StatusBadge'
import SuggestionForm from './collab/SuggestionForm'
import SuggestionsPanel from './collab/SuggestionsPanel'
import TransitionPanel from './collab/TransitionPanel'
import { useEditSession } from './collab/useEditSession'
import WatchButton from './collab/WatchButton'
import DescriptionPreview from './DescriptionPreview'

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

type Tab = 'links' | 'comments' | 'suggestions' | 'history' | 'rules'

/** Item details with explicit edit sessions: "Edit" takes the item's edit
 * lock (a lease kept alive by heartbeats), "Save" writes all changes at
 * once with If-Match and releases the lock, "Cancel" just releases it.
 * Workflow transitions, change suggestions, history and links live below. */
export default function ItemDetailPanel({ item, itemType, itemTypes, linkTypes, allItems, onClose, orgId, compact }: Props) {
  const { projectId } = useParams<{ projectId: string }>()
  const { user } = useAuth()
  const { data: perms } = usePermissions(projectId)
  const { data: project } = useProject(projectId)
  const isLibrary = project?.kind === 'library'
  const save = useSaveItemContent()
  const deleteItem = useDeleteItem()
  const transition = useItemTransition()
  const session = useEditSession(item.id)
  const { data: workflow } = useSubjectWorkflow('item', item.has_workflow ? item.id : undefined)
  const { data: glossaryTerms } = useGlossary(orgId)
  const { data: standards } = useStandards(orgId)
  const { data: referenceDocuments } = useReferenceDocuments(projectId)
  const { data: parameters } = useParameters(projectId)
  const { data: openCrs } = useChangeRequests(item.has_workflow ? projectId : undefined, {
    item_id: item.id,
    status: 'open',
  })

  const [title, setTitle] = useState(item.title)
  const [description, setDescription] = useState(item.description_md ?? '')
  const [attributes, setAttributes] = useState<Record<string, unknown>>(item.attributes)
  const [baseEtag, setBaseEtag] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [conflict, setConflict] = useState<ApiErrorDetail | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('comments')
  const [suggesting, setSuggesting] = useState<{ fromComment?: ItemComment } | null>(null)

  // Outside an edit session the form always mirrors the latest saved item.
  useEffect(() => {
    if (session.editing) return
    setTitle(item.title)
    setDescription(item.description_md ?? '')
    setAttributes(item.attributes)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, item.version, session.editing])

  useEffect(() => {
    setMessage(null)
    setConfirmingDelete(false)
    setDeleteError(null)
  }, [item.id])

  const isContent = itemType.behavior === 'content'
  const lockedByOther = !!item.lock && item.lock.user_id !== user?.id && item.lock.scope === 'item'
  const canEdit = can(perms, 'item.edit') && !item.read_only_reason && !item.obsolete
  const editing = session.editing

  async function startEditing() {
    setMessage(null)
    const result = await session.start()
    if (result.ok) setBaseEtag(item.etag)
    else if (result.heldBy) setMessage(`${result.heldBy.user_name} is editing this right now.`)
    else setMessage(apiErrorMessage(result.error, 'Could not start editing.'))
  }

  function changes(): Partial<Item> {
    const payload: Partial<Item> = {}
    if (title !== item.title) payload.title = title
    if (description !== (item.description_md ?? '')) payload.description_md = description
    if (JSON.stringify(attributes) !== JSON.stringify(item.attributes)) payload.attributes = attributes
    return payload
  }

  async function doSave(etag: string) {
    const payload = changes()
    if (Object.keys(payload).length === 0) {
      await session.stop()
      return
    }
    try {
      await save.mutateAsync({ id: item.id, etag, payload })
      setConflict(null)
      setMessage(null)
      await session.stop()
    } catch (err) {
      const status = apiStatus(err)
      if (status === 412) setConflict(apiErrorDetail(err))
      else setMessage(apiErrorMessage(err, 'Could not save.'))
    }
  }

  async function cancelEditing() {
    await session.stop()
    setTitle(item.title)
    setDescription(item.description_md ?? '')
    setAttributes(item.attributes)
    setMessage(null)
  }

  function confirmDelete() {
    setDeleteError(null)
    deleteItem.mutate(item.id, {
      onSuccess: onClose,
      onError: (err) => setDeleteError(apiErrorMessage(err, 'Could not delete this item.')),
    })
  }

  const statusAttr = itemType.attributes.find((a) => a.key === 'status' && a.data_type === 'enum')
  const otherAttrs = itemType.attributes.filter((a) => !(item.has_workflow && a.key === 'status'))

  return (
    <div
      className={
        compact
          ? 'flex max-h-[28rem] shrink-0 flex-col border-t border-slate-200 bg-white'
          : 'flex h-full w-[26rem] max-w-full shrink-0 flex-col border-l border-slate-200 bg-white'
      }
    >
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-400">
            {itemType.name} {item.key ? `· ${item.key}` : ''}
            {isContent && (
              <span className="rounded bg-slate-100 px-1 font-mono normal-case text-slate-500" title="Content version">
                v{item.version}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {isContent && <WatchButton subjectType="item" subjectId={item.id} />}
          {isContent && projectId && (
            <Link
              to={`/projects/${projectId}/graph?center=${item.id}`}
              className="text-xs font-medium text-slate-400 hover:text-blue-600"
            >
              Graph
            </Link>
          )}
          {can(perms, 'structure.edit') && (
            <button
              onClick={() => setConfirmingDelete(true)}
              className="text-xs font-medium text-slate-400 hover:text-red-600"
            >
              Delete
            </button>
          )}
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>
      </div>

      {confirmingDelete && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm">
          <p className="mb-2 text-red-800">
            Delete <span className="font-medium">{item.title}</span>?{' '}
            {isContent
              ? 'Only an untouched, brand-new item can be deleted — anything with history is retired with "Make obsolete" instead.'
              : 'Only an empty section can be deleted.'}
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
          {deleteError && <p className="mt-2 text-xs text-red-700">⚠ {deleteError}</p>}
        </div>
      )}

      {lockedByOther && <LockBanner itemId={item.id} />}

      {item.obsolete && (
        <div className="border-b border-slate-200 bg-slate-100 px-4 py-2 text-xs text-slate-600">
          This item is <b>obsolete</b> — retired, kept for history and traceability.
        </div>
      )}
      {item.read_only_reason && !item.obsolete && (
        <div className="border-b border-indigo-200 bg-indigo-50 px-4 py-2 text-xs text-indigo-800">
          🔒 {item.read_only_reason}
        </div>
      )}
      {item.suspect_links > 0 && (
        <button
          onClick={() => setTab('links')}
          className="border-b border-orange-200 bg-orange-50 px-4 py-2 text-left text-xs text-orange-800"
        >
          ⚠ {item.suspect_links} suspect link{item.suspect_links === 1 ? '' : 's'} — a linked item changed; re-verify →
        </button>
      )}

      {isContent && !isLibrary && (
        <div className="border-b border-slate-200 px-4 py-1.5 text-[11px] text-slate-500">
          {item.source_item_id
            ? `Derived from a library requirement (v${item.source_version}) — applicable with modification.`
            : 'Project-specific requirement.'}
        </div>
      )}

      {item.approved_by && (
        <div className="border-b border-green-200 bg-green-50 px-4 py-1.5 text-xs text-green-800">
          Approved by <span className="font-medium">{item.approved_by}</span>
          {item.approved_at && ` on ${new Date(item.approved_at).toLocaleString()}`}
        </div>
      )}

      {isContent && item.has_workflow && (
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-2">
          <TransitionPanel
            workflow={workflow}
            disabled={editing}
            run={(key, input) => transition.mutateAsync({ item, key, input })}
          />
          {(openCrs ?? []).map((cr) => (
            <details key={cr.id} className="mt-1 text-xs text-slate-600">
              <summary className="cursor-pointer">
                <b>{cr.key}</b> open — requested by {cr.requested_by}: “{cr.reason}” · impact: {cr.impact.length}{' '}
                item(s)
              </summary>
              <ul className="ml-4 mt-1 list-disc">
                {cr.impact.map((e) => (
                  <li key={e.item_id}>
                    {e.relation}: <b>{e.key ?? e.title}</b> {e.key && `— ${e.title}`}{' '}
                    <span className="text-slate-400">({e.item_type})</span>
                  </li>
                ))}
                {cr.impact.length === 0 && <li>No linked items.</li>}
              </ul>
            </details>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2">
        {editing ? (
          <>
            <button
              onClick={() => baseEtag && doSave(baseEtag)}
              disabled={save.isPending}
              className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Save
            </button>
            <button onClick={cancelEditing} className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-600">
              Cancel
            </button>
            <span className="text-[11px] text-slate-400">You hold the edit lock while editing.</span>
          </>
        ) : (
          <>
            <button
              onClick={startEditing}
              disabled={!canEdit || lockedByOther}
              title={
                !can(perms, 'item.edit')
                  ? 'You need edit rights on this project.'
                  : (item.read_only_reason ?? (lockedByOther ? 'Someone else is editing.' : 'Start editing'))
              }
              className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              ✎ Edit
            </button>
            {isContent && user && (
              <button
                onClick={() => setSuggesting({})}
                className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                title="Propose a change without editing — works even when the item is locked or approved"
              >
                Suggest change
              </button>
            )}
          </>
        )}
      </div>
      {session.lost && (
        <div className="bg-red-50 px-4 py-2 text-xs text-red-700">
          ⚠ {session.lost} Saving may now conflict — you can still try; you'll see what changed.
        </div>
      )}
      {message && <div className="bg-red-50 px-4 py-2 text-xs text-red-700">⚠ {message}</div>}

      <div className="flex-1 overflow-auto p-4">
        <fieldset disabled={!editing} className="min-w-0">
          <label className="mb-1 block text-xs font-medium text-slate-500">Title</label>
          <input
            className="mb-4 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm font-medium focus:border-blue-500 focus:outline-none disabled:border-transparent disabled:bg-transparent disabled:px-0 disabled:text-slate-800"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          {isContent && (
            <>
              <label className="mb-1 block text-xs font-medium text-slate-500">Description</label>
              {editing ? (
                <textarea
                  className="mb-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                  rows={6}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              ) : null}
              {description && glossaryTerms ? (
                <div className="mb-4 rounded-md bg-slate-50 px-2 py-1.5">
                  <DescriptionPreview
                    text={description}
                    glossaryTerms={glossaryTerms}
                    referenceSources={[...(standards ?? []), ...(referenceDocuments ?? [])]}
                    parameters={parameters ?? []}
                  />
                </div>
              ) : (
                !editing && <p className="mb-4 text-sm text-slate-400">No description.</p>
              )}

              {(otherAttrs.length > 0 || (item.has_workflow && statusAttr)) && (
                <div className="mb-4 space-y-3">
                  {item.has_workflow && statusAttr && (
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-500">Status</label>
                      <StatusBadge itemType={itemType} value={item.attributes.status} />
                    </div>
                  )}
                  {otherAttrs.map((attr) => (
                    <div key={attr.id}>
                      <label className="mb-1 block text-xs font-medium text-slate-500">
                        {attr.label}
                        {attr.required ? ' *' : ''}
                      </label>
                      <AttributeField
                        attribute={attr}
                        value={attributes[attr.key]}
                        onChange={(v) => setAttributes((prev) => ({ ...prev, [attr.key]: v }))}
                      />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </fieldset>

        {isContent && (
          <>
            <div className="mb-3 flex gap-1 border-b border-slate-200 text-xs">
              {(
                [
                  ['comments', 'Comments'],
                  ['suggestions', 'Suggestions'],
                  ['links', `Links${item.suspect_links ? ' ⚠' : ''}`],
                  ['history', 'History'],
                  ...(isLibrary ? ([['rules', 'Applicability rules']] as [Tab, string][]) : []),
                ] as [Tab, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`-mb-px border-b-2 px-2 py-1.5 font-medium ${
                    tab === key ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {tab === 'comments' && (
              <CommentsSection itemId={item.id} orgId={orgId} onConvert={(c) => setSuggesting({ fromComment: c })} />
            )}
            {tab === 'suggestions' && (
              <SuggestionsPanel item={item} itemType={itemType} orgId={orgId} onNew={() => setSuggesting({})} />
            )}
            {tab === 'links' && (
              <LinksSection item={item} itemTypes={itemTypes} linkTypes={linkTypes} allItems={allItems} />
            )}
            {tab === 'history' && <HistoryPanel itemId={item.id} currentVersion={item.version} />}
            {tab === 'rules' && project && (
              <LibraryRulesPanel
                itemId={item.id}
                defs={project.mission_attribute_defs ?? []}
                canEdit={can(perms, 'item.edit')}
              />
            )}
          </>
        )}
      </div>

      {conflict && (
        <ConflictDialog
          conflict={conflict}
          mine={changes() as Record<string, unknown>}
          onClose={() => setConflict(null)}
          onReload={async () => {
            setConflict(null)
            await session.stop()
          }}
          onOverwrite={() => conflict.etag && doSave(conflict.etag)}
        />
      )}
      {suggesting && projectId && (
        <SuggestionForm
          item={item}
          itemType={itemType}
          linkTypes={linkTypes}
          allItems={allItems}
          projectId={projectId}
          fromComment={suggesting.fromComment}
          onClose={() => {
            setSuggesting(null)
            setTab('suggestions')
          }}
        />
      )}
    </div>
  )
}

function LinksSection({
  item,
  itemTypes,
  linkTypes,
  allItems,
}: {
  item: Item
  itemTypes: ItemType[]
  linkTypes: LinkType[]
  allItems: Item[]
}) {
  const { projectId } = useParams<{ projectId: string }>()
  const { data: links } = useItemLinks(item.id)
  const { data: suspects } = useSuspectLinks(projectId, item.id)
  const clearSuspect = useClearSuspect()
  const createLink = useCreateLink()
  const deleteLink = useDeleteLink()
  const [linkError, setLinkError] = useState<string | null>(null)
  const [linkTypeId, setLinkTypeId] = useState('')
  const [direction, setDirection] = useState<'outgoing' | 'incoming'>('outgoing')
  const [targetId, setTargetId] = useState('')

  const itemTypeById = new Map(itemTypes.map((t) => [t.id, t]))
  const itemById = new Map(allItems.map((i) => [i.id, i]))
  const suspectById = new Map((suspects ?? []).map((s) => [s.id, s]))

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
    <div>
      <ul className="mb-3 space-y-1.5">
        {(links ?? []).map((link) => {
          const linkType = linkTypes.find((lt) => lt.id === link.link_type_id)
          const isOutgoing = link.source_item_id === item.id
          const otherId = isOutgoing ? link.target_item_id : link.source_item_id
          const other = itemById.get(otherId)
          const suspect = suspectById.get(link.id)
          return (
            <li
              key={link.id}
              className={`rounded-md px-2 py-1.5 text-xs ${suspect ? 'border border-orange-200 bg-orange-50' : 'bg-slate-50'}`}
            >
              <div className="flex items-center justify-between">
                <span>
                  <span className="font-medium text-slate-600">
                    {isOutgoing ? linkType?.name : linkType?.inverse_name}
                  </span>{' '}
                  {other?.key ?? other?.title ?? otherId.slice(0, 8)}
                  {suspect && <span className="ml-1 font-semibold text-orange-700">⚠ suspect</span>}
                </span>
                <button onClick={() => deleteLink.mutate(link.id)} className="text-slate-400 hover:text-red-600">
                  ✕
                </button>
              </div>
              {suspect && (
                <div className="mt-1 flex items-center justify-between gap-2 text-orange-800">
                  <span>{suspect.reason}</span>
                  <button
                    className="shrink-0 font-medium text-orange-700 hover:underline"
                    onClick={() => clearSuspect.mutate({ linkId: link.id, comment: 'Re-verified' })}
                  >
                    ✓ Re-verified
                  </button>
                </div>
              )}
            </li>
          )
        })}
        {(links ?? []).length === 0 && <li className="text-xs text-slate-400">No links yet.</li>}
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
        <button type="submit" className="w-full rounded-md bg-blue-600 py-1 text-xs font-medium text-white hover:bg-blue-700">
          Add link
        </button>
        {linkError && <p className="rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-700">⚠ {linkError}</p>}
      </form>
    </div>
  )
}
