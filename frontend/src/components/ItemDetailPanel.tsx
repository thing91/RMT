import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiErrorMessage } from '../api/client'
import {
  can,
  useChangeRequests,
  useClearSuspect,
  useItemSuggestions,
  useItemTransition,
  usePermissions,
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
import type { Item, ItemComment, ItemType, ItemTypeAttribute, LinkType } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { useI18n, useT } from '../i18n'
import AttributeField from './AttributeField'
import { attrDisplay, isLongText } from './attrDisplay'
import ActivityTimeline from './collab/ActivityTimeline'
import { InlineEditField, useItemInlineSave } from './collab/InlineEdit'
import LibraryRulesPanel from './collab/LibraryRulesPanel'
import LockBanner from './collab/LockBanner'
import StatusBadge from './collab/StatusBadge'
import SuggestionForm from './collab/SuggestionForm'
import SuggestionsPanel from './collab/SuggestionsPanel'
import WatchButton from './collab/WatchButton'
import WorkflowActions from './collab/WorkflowActions'
import DescriptionPreview from './DescriptionPreview'

export type DetailTab = 'details' | 'activity' | 'links' | 'suggestions' | 'rules'

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
  /** The document is in Edit mode: fields become click-to-edit (with an
   * automatic edit lock) for users allowed to edit this item. */
  editMode?: boolean
  initialTab?: DetailTab
}

/** One attribute in the details tab: its value, and — when editable — a
 * click turns it into the matching input. Picking a value (enum, date,
 * yes/no) saves at once; typed values save when you click away. */
function AttributeRow({
  attr,
  item,
  editable,
  inline,
}: {
  attr: ItemTypeAttribute
  item: Item
  editable: boolean
  inline: ReturnType<typeof useItemInlineSave>
}) {
  const t = useT()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<unknown>(item.attributes[attr.key])
  const shown = attrDisplay(attr, item.attributes[attr.key], t('Yes'))
  const instant = attr.data_type === 'enum' || attr.data_type === 'boolean' || attr.data_type === 'date'

  async function start() {
    if (!editable || editing) return
    if (await inline.begin()) {
      setDraft(item.attributes[attr.key])
      setEditing(true)
    }
  }
  function finish(value: unknown) {
    setEditing(false)
    if (JSON.stringify(value ?? null) === JSON.stringify(item.attributes[attr.key] ?? null)) inline.cancel()
    else inline.commit({ attributes: { ...item.attributes, [attr.key]: value } })
  }

  if (!editable && !shown) return null
  return (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)] items-baseline gap-2 py-1">
      <span className="text-xs text-slate-500">
        {attr.label}
        {attr.required ? ' *' : ''}
      </span>
      {editing ? (
        <span
          onBlur={(e) => {
            if (!instant && !e.currentTarget.contains(e.relatedTarget as Node | null)) finish(draft)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setEditing(false)
              inline.cancel()
            }
          }}
        >
          <AttributeField
            attribute={attr}
            value={draft}
            onChange={(v) => {
              setDraft(v)
              if (instant) finish(v)
            }}
          />
        </span>
      ) : (
        <span
          onClick={start}
          title={editable ? t('Click to edit') : undefined}
          className={`text-sm ${isLongText(attr) ? 'whitespace-pre-wrap' : ''} ${shown ? 'text-slate-800' : 'text-slate-300'} ${
            editable ? '-mx-1 cursor-text rounded px-1 hover:bg-amber-50/70' : ''
          }`}
        >
          {shown ?? t('Click to edit')}
        </span>
      )}
    </div>
  )
}

/** Item details: header with the status and the next workflow step, one
 * banner for whatever matters most right now, and a few tabs. Editing is
 * in place — no Edit/Save buttons: in the document's Edit mode click a
 * field, change it, click away. */
export default function ItemDetailPanel({
  item,
  itemType,
  itemTypes,
  linkTypes,
  allItems,
  onClose,
  orgId,
  compact,
  editMode,
  initialTab,
}: Props) {
  const { projectId } = useParams<{ projectId: string }>()
  const { t, lang } = useI18n()
  const { user } = useAuth()
  const { data: perms } = usePermissions(projectId)
  const { data: project } = useProject(projectId)
  const isLibrary = project?.kind === 'library'
  const deleteItem = useDeleteItem()
  const transition = useItemTransition()
  const inline = useItemInlineSave(item)
  const { data: workflow } = useSubjectWorkflow('item', item.has_workflow ? item.id : undefined)
  const { data: glossaryTerms } = useGlossary(orgId)
  const { data: standards } = useStandards(orgId)
  const { data: referenceDocuments } = useReferenceDocuments(projectId)
  const { data: parameters } = useParameters(projectId)
  const { data: suggestions } = useItemSuggestions(item.id)
  const { data: openCrs } = useChangeRequests(item.has_workflow ? projectId : undefined, {
    item_id: item.id,
    status: 'open',
  })

  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [tab, setTab] = useState<DetailTab>(initialTab ?? 'details')
  const [suggesting, setSuggesting] = useState<{ fromComment?: ItemComment } | null>(null)

  useEffect(() => {
    setConfirmingDelete(false)
    setDeleteError(null)
  }, [item.id])
  useEffect(() => {
    if (initialTab) setTab(initialTab)
  }, [initialTab])

  const isContent = itemType.behavior === 'content'
  const lockedByOther = !!item.lock && item.lock.user_id !== user?.id && item.lock.scope === 'item'
  const editable = !!editMode && can(perms, 'item.edit') && !item.read_only_reason && !item.obsolete && !lockedByOther
  const openSuggestionCount = (suggestions ?? []).filter((s) => s.status === 'open' || s.status === 'outdated').length

  function confirmDelete() {
    setDeleteError(null)
    deleteItem.mutate(item.id, {
      onSuccess: onClose,
      onError: (err) => setDeleteError(apiErrorMessage(err, t('Could not delete this item.'))),
    })
  }

  const statusAttr = itemType.attributes.find((a) => a.key === 'status' && a.data_type === 'enum')
  const attrs = itemType.attributes.filter((a) => !(item.has_workflow && a.key === 'status'))

  // One banner — the most important thing to know right now.
  let banner: ReactNode = null
  if (lockedByOther) banner = <LockBanner itemId={item.id} />
  else if (item.obsolete)
    banner = (
      <div className="border-b border-slate-200 bg-slate-100 px-4 py-2 text-xs text-slate-600">
        {t('This requirement is retired — kept for history and traceability.')}
      </div>
    )
  else if (item.suspect_links > 0)
    banner = (
      <button
        onClick={() => setTab('links')}
        className="border-b border-orange-200 bg-orange-50 px-4 py-2 text-left text-xs text-orange-800"
      >
        ⚠ {t('linked item changed — re-verify')} →
      </button>
    )
  else if ((openCrs ?? []).length > 0)
    banner = (
      <div className="border-b border-violet-200 bg-violet-50 px-4 py-2 text-xs text-violet-800">
        {(openCrs ?? []).map((cr) => (
          <div key={cr.id}>
            <b>{cr.key}</b> · {t('Open change request')}: “{cr.reason}” · {t('impact')}: {cr.impact.length}
          </div>
        ))}
      </div>
    )
  else if (item.read_only_reason)
    banner = <div className="border-b border-indigo-200 bg-indigo-50 px-4 py-2 text-xs text-indigo-800">🔒 {item.read_only_reason}</div>

  const tabs: [DetailTab, string, number?][] = isContent
    ? [
        ['details', t('Details')],
        ['activity', t('Activity')],
        ['links', t('Links'), item.suspect_links],
        ['suggestions', t('Suggestions'), openSuggestionCount],
        ...(isLibrary ? ([['rules', t('Rules')]] as [DetailTab, string][]) : []),
      ]
    : [['details', t('Details')]]

  return (
    <div
      className={
        compact
          ? 'flex max-h-[28rem] shrink-0 flex-col border-t border-slate-200 bg-white'
          : 'flex h-full w-[26rem] max-w-full shrink-0 flex-col border-l border-slate-200 bg-white'
      }
    >
      <div className="border-b border-slate-200 px-4 pb-3 pt-3">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          {item.key && <span className="font-mono font-medium">{item.key}</span>}
          <span className="text-slate-400">{itemType.name}</span>
          <span className="flex-1" />
          {isContent && <WatchButton subjectType="item" subjectId={item.id} />}
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-label={t('More')}
              className="rounded px-1.5 text-base leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              ⋯
            </button>
            {menuOpen && (
              <>
                <button aria-label={t('Close')} className="fixed inset-0 z-10 cursor-default" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 z-20 mt-1 w-48 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                  {isContent && projectId && (
                    <Link
                      to={`/projects/${projectId}/graph?center=${item.id}`}
                      className="block rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
                    >
                      {t('Graph')}
                    </Link>
                  )}
                  {can(perms, 'structure.edit') && (
                    <button
                      onClick={() => {
                        setMenuOpen(false)
                        setConfirmingDelete(true)
                      }}
                      className="block w-full rounded-md px-2 py-1.5 text-left text-sm text-red-600 hover:bg-red-50"
                    >
                      {t('Delete item')}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
          <button onClick={onClose} aria-label={t('Close')} className="text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>
        <div className={`mt-1 text-[15px] font-semibold text-slate-800 ${item.obsolete ? 'line-through opacity-60' : ''}`}>
          <InlineEditField
            value={item.title}
            editable={editable}
            trigger="click"
            onBegin={inline.begin}
            onCancel={inline.cancel}
            onSave={(v) => inline.commit({ title: v })}
          />
        </div>
        {isContent && (item.has_workflow || user) && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {item.has_workflow && (
              <WorkflowActions workflow={workflow} run={(key, input) => transition.mutateAsync({ item, key, input })} />
            )}
            {user && (
              <button
                onClick={() => setSuggesting({})}
                title={t('Propose a change without editing — works even when the item is locked or approved')}
                className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                {t('Suggest a change')}
              </button>
            )}
          </div>
        )}
      </div>

      {confirmingDelete && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm">
          <p className="mb-2 text-red-800">
            {isContent
              ? t('Only an untouched, brand-new item can be deleted — anything with history is retired instead.')
              : t('Only an empty section can be deleted.')}
          </p>
          <div className="flex gap-2">
            <button
              onClick={confirmDelete}
              disabled={deleteItem.isPending}
              className="rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {t('Yes, delete')}
            </button>
            <button
              onClick={() => setConfirmingDelete(false)}
              className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              {t('Cancel')}
            </button>
          </div>
          {deleteError && <p className="mt-2 text-xs text-red-700">⚠ {deleteError}</p>}
        </div>
      )}

      {banner}

      {tabs.length > 1 && (
        <div className="flex gap-1 border-b border-slate-200 px-3 text-xs">
          {tabs.map(([key, label, count]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`-mb-px flex items-center gap-1 border-b-2 px-2 py-2 font-medium ${
                tab === key ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {label}
              {!!count && count > 0 && (
                <span className="rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-800">{count}</span>
              )}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-auto p-4">
        {tab === 'details' && (
          <div>
            {isContent && (
              <div className="mb-4">
                <InlineEditField
                  value={item.description_md ?? ''}
                  editable={editable}
                  multiline
                  trigger="click"
                  placeholder={t('Click to add a description…')}
                  onBegin={inline.begin}
                  onCancel={inline.cancel}
                  onSave={(v) => inline.commit({ description_md: v })}
                >
                  {item.description_md && glossaryTerms ? (
                    <DescriptionPreview
                      text={item.description_md}
                      glossaryTerms={glossaryTerms}
                      referenceSources={[...(standards ?? []), ...(referenceDocuments ?? [])]}
                      parameters={parameters ?? []}
                    />
                  ) : !editable ? (
                    <p className="text-sm text-slate-400">{t('No description.')}</p>
                  ) : null}
                </InlineEditField>
              </div>
            )}

            {isContent && (
              <div className="divide-y divide-slate-100 border-t border-slate-100">
                {item.has_workflow && statusAttr && (
                  <div className="grid grid-cols-[8rem_minmax(0,1fr)] items-baseline gap-2 py-1">
                    <span className="text-xs text-slate-500">{t('Status')}</span>
                    <span>
                      <StatusBadge itemType={itemType} value={item.attributes.status} />
                    </span>
                  </div>
                )}
                {attrs.map((attr) => (
                  <AttributeRow key={attr.id} attr={attr} item={item} editable={editable} inline={inline} />
                ))}
              </div>
            )}

            {isContent && (
              <div className="mt-4 space-y-1 text-[11px] text-slate-400">
                {item.approved_by && (
                  <p>
                    {t('Approved by {name}', { name: item.approved_by })}
                    {item.approved_at &&
                      ` · ${new Date(item.approved_at).toLocaleString(lang === 'pl' ? 'pl-PL' : 'en-GB')}`}
                  </p>
                )}
                {!isLibrary && (
                  <p>
                    {item.source_item_id
                      ? t('Derived from the generic library (v{v}).', { v: item.source_version ?? '?' })
                      : t('Project-specific requirement.')}
                  </p>
                )}
                <p>
                  {t('Version')} {item.version}
                </p>
              </div>
            )}
          </div>
        )}

        {tab === 'activity' && (
          <ActivityTimeline itemId={item.id} orgId={orgId} onConvert={(c) => setSuggesting({ fromComment: c })} />
        )}
        {tab === 'suggestions' && (
          <SuggestionsPanel item={item} itemType={itemType} orgId={orgId} onNew={() => setSuggesting({})} />
        )}
        {tab === 'links' && <LinksSection item={item} itemTypes={itemTypes} linkTypes={linkTypes} allItems={allItems} />}
        {tab === 'rules' && project && (
          <LibraryRulesPanel itemId={item.id} defs={project.mission_attribute_defs ?? []} canEdit={can(perms, 'item.edit')} />
        )}
      </div>

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
  const t = useT()
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
      onError: (err) => setLinkError(apiErrorMessage(err, t('Could not create this link.'))),
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
                  {suspect && <span className="ml-1 font-semibold text-orange-700">⚠ {t('needs re-verification')}</span>}
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
                    ✓ {t('Re-verified')}
                  </button>
                </div>
              )}
            </li>
          )
        })}
        {(links ?? []).length === 0 && <li className="text-xs text-slate-400">{t('No links yet.')}</li>}
      </ul>

      <form onSubmit={submitLink} className="space-y-2 rounded-md border border-slate-200 p-2">
        <select
          className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
          value={linkTypeId}
          onChange={(e) => setLinkTypeId(e.target.value)}
        >
          <option value="">{t('Link type…')}</option>
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
            <option value="">{t('Target item…')}</option>
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
          {t('Add link')}
        </button>
        {linkError && <p className="rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-700">⚠ {linkError}</p>}
      </form>
    </div>
  )
}
