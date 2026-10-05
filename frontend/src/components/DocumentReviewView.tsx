import { Fragment, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useProjectSuggestions } from '../api/collabHooks'
import {
  useDocumentComments,
  useDocumentTree,
  useGlossary,
  useItemTypes,
  useLinkTypes,
  useParameters,
  useProjectItems,
  useProjectLinks,
  useReferenceDocuments,
  useReopenComment,
  useStandards,
  useUpdateItem,
} from '../api/hooks'
import type { Item, ItemComment, ItemType, Link, LinkType } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { useI18n, useT } from '../i18n'
import { planInsertAfter } from '../structure/itemOrdering'
import AddItemForm from './AddItemForm'
import { attrDisplay, isLongText } from './attrDisplay'
import ChangeRequestDialog from './collab/ChangeRequestDialog'
import { InlineEditField, useItemInlineSave } from './collab/InlineEdit'
import { ItemPresence } from './collab/PresenceAvatar'
import StatusBadge from './collab/StatusBadge'
import StructureLockBar from './collab/StructureLockBar'
import SuggestionForm from './collab/SuggestionForm'
import DescriptionPreview from './DescriptionPreview'
import ItemDetailPanel, { type DetailTab } from './ItemDetailPanel'
import ItemStructureToolbar from './ItemStructureToolbar'
import LinkEndpointButtons from './LinkEndpointButtons'

interface Props {
  documentId: string
  projectId: string
  orgId: string
  /** One of two split-view panes: details panel stacked below instead of
   * docked to the right. */
  compact?: boolean
  /** Edit mode (only offered to editors): double-click to edit text in
   * place, insert and restructure. Otherwise the document reads like a
   * document — click a requirement for its details. */
  editMode?: boolean
  /** Text filter — key, title or description. */
  query?: string
  /** Workflow status value to show only. */
  statusFilter?: string
  showObsolete?: boolean
  resolvedOpen?: boolean
  onCloseResolved?: () => void
}

/** The nested tree response leaves `item.depth` at its default (0) — depth
 * is only meaningful for a pre-flattened listing — so flattening here
 * computes it locally. */
function flattenWithDepth(items: Item[], depth = 0): (Item & { depth: number })[] {
  return items.flatMap((i) => [{ ...i, depth }, ...flattenWithDepth(i.children, depth + 1)])
}

function headingClass(depth: number): string {
  if (depth === 0) return 'text-xl font-semibold text-slate-800'
  if (depth === 1) return 'text-lg font-medium text-slate-800'
  return 'text-base font-medium text-slate-700'
}

/** Hover-revealed "insert a new item here" affordance between rows. */
function InsertHereRow({ depth, onClick }: { depth: number; onClick: () => void }) {
  return (
    <div className="group/gap relative h-2" style={{ marginLeft: depth * 20 + 24, marginRight: 12 }}>
      <button
        onClick={onClick}
        className="absolute inset-x-0 top-0 z-10 flex h-4 -translate-y-1/2 items-center opacity-0 group-hover/gap:opacity-100"
      >
        <span className="h-px flex-1 bg-blue-300" />
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-xs leading-none text-white">
          +
        </span>
        <span className="h-px flex-1 bg-blue-300" />
      </button>
    </div>
  )
}

const ICON = {
  comment: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  suggest: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  ),
  change: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  ),
}

/** A row action button. Actions with something to show (a count) sit in
 * the row; the rest appear in a small overlay toolbar on hover, so they
 * never take space from the title. */
function RowAction({
  icon,
  count,
  title,
  tone,
  onClick,
}: {
  icon: React.ReactNode
  count?: number
  title: string
  tone: 'blue' | 'amber' | 'violet'
  onClick: () => void
}) {
  const has = !!count && count > 0
  const color = {
    blue: has ? 'text-blue-600' : 'text-slate-400 hover:text-blue-600',
    amber: has ? 'text-amber-600' : 'text-slate-400 hover:text-amber-600',
    violet: 'text-slate-400 hover:text-violet-600',
  }[tone]
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      title={title}
      aria-label={title}
      className={`flex items-center gap-0.5 rounded px-1 py-0.5 text-xs leading-none hover:bg-slate-100 ${color}`}
    >
      {icon}
      {has && <span className="font-medium">{count}</span>}
    </button>
  )
}

/** True when a click on a row should select it rather than do something
 * else (a button, a link, a field, or the end of a text selection). */
function isPlainRowClick(e: MouseEvent) {
  if ((e.target as HTMLElement).closest('button, a, input, textarea, select, [contenteditable]')) return false
  return !window.getSelection()?.toString()
}

function ItemRow({
  item,
  depth,
  itemType,
  showType,
  linksByItem,
  linkTypes,
  itemById,
  openComments,
  openSuggestions,
  descriptionContext,
  editMode,
  canEdit,
  selected,
  onOpen,
  onAddChild,
  onSuggest,
  onRequestChange,
}: {
  item: Item
  depth: number
  itemType: ItemType | undefined
  showType: boolean
  linksByItem: Map<string, Link[]>
  linkTypes: LinkType[]
  itemById: Map<string, Item>
  openComments: number
  openSuggestions: number
  descriptionContext: Omit<Parameters<typeof DescriptionPreview>[0], 'text'>
  editMode: boolean
  canEdit: boolean
  selected: boolean
  onOpen: (tab?: DetailTab) => void
  onAddChild?: () => void
  onSuggest: () => void
  onRequestChange: () => void
}) {
  const { t } = useI18n()
  const inline = useItemInlineSave(item)
  const isStructural = itemType?.behavior === 'structural'
  const selectedClass = selected ? 'bg-blue-50/70 ring-1 ring-inset ring-blue-200' : 'hover:bg-slate-50/80'
  const textEditable = editMode && canEdit && !item.read_only_reason && !item.obsolete
  // In Edit mode a double-click edits text in place. Opening the details
  // panel on the first click of that double-click would reflow the
  // document under the cursor, so a single click opens it a moment later
  // and a double-click cancels it.
  const openTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(openTimer.current), [])
  function handleClick(e: MouseEvent) {
    if (!isPlainRowClick(e)) return
    if (!editMode) {
      onOpen()
      return
    }
    window.clearTimeout(openTimer.current)
    if (e.detail > 1) return
    openTimer.current = window.setTimeout(() => onOpen(), 250)
  }
  const cancelOpen = () => window.clearTimeout(openTimer.current)

  if (isStructural) {
    return (
      <div
        data-item-row={item.id}
        onClick={handleClick}
        onDoubleClickCapture={cancelOpen}
        className={`group/row flex items-center gap-2 px-6 ${depth === 0 ? 'pb-1 pt-6' : 'pb-1 pt-4'} ${selectedClass}`}
      >
        <div className={`min-w-0 flex-1 ${headingClass(depth)} ${item.obsolete ? 'text-slate-400 line-through' : ''}`}>
          <span className="flex items-baseline gap-2">
            {item.number ? <span className="text-slate-400">{item.number}</span> : null}
            <span className="min-w-0 flex-1">
              <InlineEditField
                value={item.title}
                editable={textEditable}
                onBegin={inline.begin}
                onCancel={inline.cancel}
                onSave={(v) => inline.commit({ title: v })}
              />
            </span>
          </span>
        </div>
        {editMode && onAddChild && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onAddChild()
            }}
            className="invisible shrink-0 rounded px-1.5 text-xs font-normal text-slate-400 hover:bg-slate-100 hover:text-blue-600 group-hover/row:visible"
          >
            + {t('Add inside')}
          </button>
        )}
      </div>
    )
  }

  const links = linksByItem.get(item.id) ?? []
  const attrs = (itemType?.attributes ?? []).filter((a) => a.key !== 'status')
  const longAttrs = attrs.filter(isLongText)
  const metaParts: string[] = []
  if (showType && itemType) metaParts.push(itemType.name)
  for (const a of attrs.filter((x) => !isLongText(x))) {
    const v = attrDisplay(a, item.attributes[a.key], t('Yes'))
    if (v) metaParts.push(`${a.label}: ${v}`)
  }
  const linkText = links
    .map((link) => {
      const outgoing = link.source_item_id === item.id
      const other = itemById.get(outgoing ? link.target_item_id : link.source_item_id)
      const lt = linkTypes.find((x) => x.id === link.link_type_id)
      return `${outgoing ? lt?.name : lt?.inverse_name} ${other?.key ?? other?.title ?? '…'}`
    })
    .join(', ')

  return (
    <div
      data-item-row={item.id}
      onClick={handleClick}
      onDoubleClickCapture={cancelOpen}
      className={`group/row relative cursor-default px-6 py-2.5 ${selectedClass}`}
    >
      <div className={`flex items-start gap-2 ${item.obsolete ? 'opacity-60' : ''}`}>
        {item.key && <span className="mt-0.5 shrink-0 font-mono text-xs font-medium text-slate-500">{item.key}</span>}
        <div className={`min-w-0 flex-1 text-[15px] font-medium text-slate-800 ${item.obsolete ? 'line-through' : ''}`}>
          <InlineEditField
            value={item.title}
            editable={textEditable}
            onBegin={inline.begin}
            onCancel={inline.cancel}
            onSave={(v) => inline.commit({ title: v })}
            inputClassName="text-[15px] font-medium"
          />
        </div>
        <ItemPresence itemId={item.id} label={item.key ?? item.title} size={18} />
        {item.suspect_links > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onOpen('links')
            }}
            className="text-xs text-orange-600"
            title={t('linked item changed — re-verify')}
          >
            ⚠
          </button>
        )}
        <StatusBadge itemType={itemType} value={item.attributes.status} small />
        {(openSuggestions > 0 || openComments > 0) && (
          <div className="flex shrink-0 items-center">
            {openSuggestions > 0 && (
              <RowAction icon={ICON.suggest} count={openSuggestions} title={t('Suggest a change')} tone="amber" onClick={onSuggest} />
            )}
            {openComments > 0 && (
              <RowAction icon={ICON.comment} count={openComments} title={t('Comments')} tone="blue" onClick={() => onOpen('activity')} />
            )}
          </div>
        )}
      </div>
      <div className="absolute -top-3 right-3 z-10 hidden items-center rounded-md border border-slate-200 bg-white px-0.5 shadow-sm group-hover/row:flex">
        {editMode && <LinkEndpointButtons item={item} />}
        {item.has_workflow && item.read_only_reason && !item.obsolete && (
          <RowAction icon={ICON.change} title={t('Request a change')} tone="violet" onClick={onRequestChange} />
        )}
        {openSuggestions === 0 && (
          <RowAction icon={ICON.suggest} title={t('Suggest a change')} tone="amber" onClick={onSuggest} />
        )}
        {openComments === 0 && (
          <RowAction icon={ICON.comment} title={t('Comments')} tone="blue" onClick={() => onOpen('activity')} />
        )}
      </div>

      <div className={`mt-0.5 ${item.key ? 'pl-[4.5rem]' : ''} ${item.obsolete ? 'opacity-60' : ''}`}>
        <InlineEditField
          value={item.description_md ?? ''}
          editable={textEditable}
          multiline
          placeholder={t('Double-click to edit')}
          onBegin={inline.begin}
          onCancel={inline.cancel}
          onSave={(v) => inline.commit({ description_md: v })}
        >
          {item.description_md ? <DescriptionPreview text={item.description_md} {...descriptionContext} /> : null}
        </InlineEditField>

        {longAttrs.map((a) => {
          const v = attrDisplay(a, item.attributes[a.key])
          if (!v) return null
          return (
            <p key={a.id} className="mt-1 whitespace-pre-wrap text-sm text-slate-600">
              <span className="text-slate-400">{a.label}: </span>
              {v}
            </p>
          )
        })}

        {(metaParts.length > 0 || linkText) && (
          <p className="mt-1 text-xs text-slate-400">
            {metaParts.join(' · ')}
            {metaParts.length > 0 && linkText && ' · '}
            {linkText && <span className="text-slate-500">{linkText}</span>}
          </p>
        )}
      </div>
    </div>
  )
}

/** Visible item ids for a filter: a requirement matches by text and status;
 * a section stays when anything under it does. No filter → everything. */
function visibleIds(items: Item[], isStructural: (i: Item) => boolean, q: string, status: string): Set<string> {
  const out = new Set<string>()
  const query = q.trim().toLowerCase()
  const walk = (list: Item[]): boolean => {
    let any = false
    for (const i of list) {
      const childVisible = walk(i.children)
      let self: boolean
      if (isStructural(i)) self = childVisible || (!query && !status)
      else {
        const text = `${i.key ?? ''} ${i.title} ${i.description_md ?? ''}`.toLowerCase()
        self = (!query || text.includes(query)) && (!status || i.attributes.status === status)
        self = self || childVisible
      }
      if (self) {
        out.add(i.id)
        any = true
      }
    }
    return any
  }
  walk(items)
  return out
}

export default function DocumentReviewView({
  documentId,
  projectId,
  orgId,
  compact,
  editMode = false,
  query = '',
  statusFilter = '',
  showObsolete = false,
  resolvedOpen,
  onCloseResolved,
}: Props) {
  const t = useT()
  const { user } = useAuth()
  const { data: tree, isLoading } = useDocumentTree(documentId, showObsolete)
  const { data: openSuggestionList } = useProjectSuggestions(projectId, { status: 'open,outdated' })
  const { data: itemTypes } = useItemTypes(orgId)
  const { data: linkTypes } = useLinkTypes(orgId)
  const { data: projectItems } = useProjectItems(projectId)
  const { data: projectLinks } = useProjectLinks(projectId)
  const { data: documentComments } = useDocumentComments(documentId)
  const { data: glossaryTerms } = useGlossary(orgId)
  const { data: standards } = useStandards(orgId)
  const { data: referenceDocuments } = useReferenceDocuments(projectId)
  const { data: parameters } = useParameters(projectId)
  const updateItem = useUpdateItem()
  const [searchParams, setSearchParams] = useSearchParams()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailsId, setDetailsId] = useState<string | null>(null)
  const [detailsTab, setDetailsTab] = useState<DetailTab>('details')
  const [suggestingFor, setSuggestingFor] = useState<string | null>(null)
  const [changeRequestFor, setChangeRequestFor] = useState<string | null>(null)
  const [addingRoot, setAddingRoot] = useState(false)
  const [addingChildOf, setAddingChildOf] = useState<string | null>(null)
  const [insertAfterId, setInsertAfterId] = useState<string | null>(null)

  useEffect(() => {
    if (!editMode) {
      setAddingRoot(false)
      setAddingChildOf(null)
      setInsertAfterId(null)
    }
  }, [editMode])

  // Deep link (?item=<id> from the outline, search, notifications, reviews…):
  // scroll the row into view, flash it and open its details.
  useEffect(() => {
    const itemParam = searchParams.get('item')
    if (!itemParam || !tree || !itemTypes) return
    setSelectedId(itemParam)
    const target = flattenWithDepth(tree).find((i) => i.id === itemParam)
    const targetType = itemTypes.find((x) => x.id === target?.item_type_id)
    if (targetType?.behavior !== 'structural') {
      setDetailsId(itemParam)
      setDetailsTab('details')
    }
    const el = document.querySelector(`[data-item-row="${itemParam}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('rmt-toc-flash')
      setTimeout(() => el.classList.remove('rmt-toc-flash'), 1500)
    }
    const next = new URLSearchParams(searchParams)
    next.delete('item')
    setSearchParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, tree, itemTypes])

  const itemById = useMemo(() => new Map((projectItems ?? []).map((i) => [i.id, i])), [projectItems])

  const openSuggestionsByItem = useMemo(() => {
    const map = new Map<string, number>()
    for (const sg of openSuggestionList ?? []) map.set(sg.item_id, (map.get(sg.item_id) ?? 0) + 1)
    return map
  }, [openSuggestionList])

  const linksByItem = useMemo(() => {
    const map = new Map<string, Link[]>()
    for (const link of projectLinks ?? []) {
      if (!map.has(link.source_item_id)) map.set(link.source_item_id, [])
      if (!map.has(link.target_item_id)) map.set(link.target_item_id, [])
      map.get(link.source_item_id)!.push(link)
      if (link.target_item_id !== link.source_item_id) map.get(link.target_item_id)!.push(link)
    }
    return map
  }, [projectLinks])

  const openCommentsByItem = useMemo(() => {
    const map = new Map<string, number>()
    for (const thread of documentComments ?? []) {
      if (!thread.resolved) map.set(thread.item_id, (map.get(thread.item_id) ?? 0) + 1)
    }
    return map
  }, [documentComments])

  const resolvedThreads = useMemo(
    () =>
      (documentComments ?? [])
        .filter((c) => c.resolved)
        .sort((a, b) => (b.resolved_at ?? '').localeCompare(a.resolved_at ?? '')),
    [documentComments],
  )

  if (isLoading || !itemTypes || !linkTypes) {
    return <div className="p-6 text-slate-500">{t('Loading…')}</div>
  }

  const typeById = new Map(itemTypes.map((x) => [x.id, x]))
  const isStructural = (i: Item) => typeById.get(i.item_type_id)?.behavior === 'structural'
  const flatTree = tree ? flattenWithDepth(tree) : []
  const filtering = !!query.trim() || !!statusFilter
  const visible = filtering && tree ? visibleIds(tree, isStructural, query, statusFilter) : null
  const rows = visible ? flatTree.filter((i) => visible.has(i.id)) : flatTree
  const contentTypes = new Set(flatTree.filter((i) => !isStructural(i)).map((i) => i.item_type_id))
  const canEdit = !!user // the server enforces rights; the mode toggle is only offered to editors
  const selectedItem = flatTree.find((i) => i.id === selectedId) ?? null
  const detailsItem = flatTree.find((i) => i.id === detailsId) ?? itemById.get(detailsId ?? '') ?? null
  const detailsType = itemTypes.find((x) => x.id === detailsItem?.item_type_id)
  const suggestingItem = flatTree.find((i) => i.id === suggestingFor) ?? null
  const changeRequestItem = flatTree.find((i) => i.id === changeRequestFor) ?? null
  const descriptionContext = {
    glossaryTerms: glossaryTerms ?? [],
    referenceSources: [...(standards ?? []), ...(referenceDocuments ?? [])],
    parameters: parameters ?? [],
  }

  function open(item: Item, tab: DetailTab = 'details') {
    setSelectedId(item.id)
    setDetailsId(item.id)
    setDetailsTab(tab)
  }

  return (
    <div className={`flex h-full overflow-hidden ${compact ? 'flex-col' : ''}`}>
      <div className={`flex-1 overflow-auto ${compact ? 'p-3' : 'px-6 py-4'}`}>
        {editMode && selectedItem && (
          <div className="sticky top-0 z-20 -mx-1 mb-2 bg-slate-50/95 px-1 pt-1 backdrop-blur">
            <StructureLockBar documentId={documentId} />
            <ItemStructureToolbar selectedItem={selectedItem} allItems={flatTree} itemTypes={itemTypes} />
          </div>
        )}

        <div className="mx-auto max-w-4xl rounded-lg border border-slate-200 bg-white pb-2">
          {rows.map((item) => {
            const structural = isStructural(item)
            const insertPlan = planInsertAfter(flatTree, item)
            return (
              <Fragment key={item.id}>
                <ItemRow
                  item={item}
                  depth={item.depth}
                  itemType={typeById.get(item.item_type_id)}
                  showType={contentTypes.size > 1}
                  linksByItem={linksByItem}
                  linkTypes={linkTypes}
                  itemById={itemById}
                  openComments={openCommentsByItem.get(item.id) ?? 0}
                  openSuggestions={openSuggestionsByItem.get(item.id) ?? 0}
                  descriptionContext={descriptionContext}
                  editMode={editMode}
                  canEdit={canEdit}
                  selected={selectedId === item.id}
                  onOpen={(tab) => open(item, tab)}
                  onAddChild={structural ? () => setAddingChildOf(addingChildOf === item.id ? null : item.id) : undefined}
                  onSuggest={() => setSuggestingFor(item.id)}
                  onRequestChange={() => setChangeRequestFor(item.id)}
                />
                {editMode && addingChildOf === item.id && (
                  <div style={{ paddingLeft: (item.depth + 1) * 20 + 24 }} className="pb-2 pr-6">
                    <AddItemForm documentId={documentId} parentId={item.id} itemTypes={itemTypes} onDone={() => setAddingChildOf(null)} />
                  </div>
                )}
                {editMode && !filtering && (
                  <InsertHereRow depth={item.depth} onClick={() => setInsertAfterId(insertAfterId === item.id ? null : item.id)} />
                )}
                {editMode && insertAfterId === item.id && (
                  <div style={{ paddingLeft: item.depth * 20 + 24 }} className="pb-2 pr-6">
                    <AddItemForm
                      documentId={documentId}
                      parentId={item.parent_id}
                      itemTypes={itemTypes}
                      order={insertPlan.order}
                      onBeforeCreate={() =>
                        Promise.all(
                          insertPlan.shifts.map((s) => updateItem.mutateAsync({ id: s.id, payload: { order: s.order } })),
                        ).then(() => undefined)
                      }
                      onDone={() => setInsertAfterId(null)}
                    />
                  </div>
                )}
              </Fragment>
            )
          })}
          {rows.length === 0 && (
            <p className="px-6 py-8 text-center text-sm text-slate-400">
              {filtering ? t('No requirements match.') : t('No items yet.')}
            </p>
          )}
          {editMode && !filtering && (
            <div className="px-6 pt-2">
              {addingRoot ? (
                <AddItemForm documentId={documentId} parentId={null} itemTypes={itemTypes} onDone={() => setAddingRoot(false)} />
              ) : (
                <button
                  onClick={() => setAddingRoot(true)}
                  className="rounded-md border border-dashed border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-500 hover:border-blue-400 hover:text-blue-600"
                >
                  + {t('New item')}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {detailsItem && detailsType && (
        <ItemDetailPanel
          key={detailsItem.id}
          item={detailsItem}
          itemType={detailsType}
          itemTypes={itemTypes}
          linkTypes={linkTypes}
          allItems={projectItems ?? flatTree}
          onClose={() => setDetailsId(null)}
          orgId={orgId}
          compact={compact}
          editMode={editMode}
          initialTab={detailsTab}
        />
      )}

      {suggestingItem && (
        <SuggestionForm
          item={suggestingItem}
          itemType={itemTypes.find((x) => x.id === suggestingItem.item_type_id)!}
          linkTypes={linkTypes}
          allItems={projectItems ?? flatTree}
          projectId={projectId}
          onClose={() => setSuggestingFor(null)}
        />
      )}

      {changeRequestItem && (
        <ChangeRequestDialog item={changeRequestItem} projectId={projectId} onClose={() => setChangeRequestFor(null)} />
      )}

      {resolvedOpen && !detailsItem && (
        <ResolvedCommentsPanel threads={resolvedThreads} itemById={itemById} onClose={() => onCloseResolved?.()} />
      )}
    </div>
  )
}

function ResolvedCommentsPanel({
  threads,
  itemById,
  onClose,
}: {
  threads: ItemComment[]
  itemById: Map<string, Item>
  onClose: () => void
}) {
  const { t, lang } = useI18n()
  const reopenComment = useReopenComment()
  const fmt = (iso: string) => new Date(iso).toLocaleString(lang === 'pl' ? 'pl-PL' : 'en-GB')

  return (
    <div className="flex h-full w-96 shrink-0 flex-col border-l border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-800">{t('Resolved comments')}</h2>
        <button onClick={onClose} aria-label={t('Close')} className="text-slate-400 hover:text-slate-700">
          ✕
        </button>
      </div>
      <div className="flex-1 space-y-2 overflow-auto p-3">
        {threads.map((thread) => {
          const item = itemById.get(thread.item_id)
          return (
            <div key={thread.id} className="rounded-md border border-green-200 bg-green-50/40 p-2.5">
              <div className="mb-1 text-xs font-medium text-slate-500">
                {item?.key ?? ''}
                {item?.title ? ` — ${item.title}` : ''}
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-medium text-slate-700">{thread.author_name}</span>
                <span className="text-[11px] text-slate-400">{fmt(thread.created_at)}</span>
              </div>
              <p className="mt-0.5 whitespace-pre-wrap text-xs text-slate-700">{thread.body}</p>
              <div className="mt-1.5 text-[11px] text-green-700">
                ✓ {t('Resolved by {name}', { name: thread.resolved_by ?? '' })}
                {thread.resolved_at && ` · ${fmt(thread.resolved_at)}`}
              </div>
              <button
                onClick={() => reopenComment.mutate(thread.id)}
                className="mt-1.5 text-[11px] font-medium text-slate-500 hover:text-slate-800"
              >
                {t('Reopen')}
              </button>
            </div>
          )
        })}
        {threads.length === 0 && <p className="text-xs text-slate-400">{t('No resolved comments.')}</p>}
      </div>
    </div>
  )
}
