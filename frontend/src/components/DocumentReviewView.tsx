import { apiErrorMessage } from '../api/client'
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
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
import type { Item, ItemComment, ItemType, ItemTypeAttribute, Link, LinkType } from '../api/types'
import { focusAtEnd, planInsertAfter } from '../structure/itemOrdering'
import AddItemForm from './AddItemForm'
import AttributeField from './AttributeField'
import ChangeRequestDialog from './collab/ChangeRequestDialog'
import { DocumentPresence, ItemPresence } from './collab/PresenceAvatar'
import StructureLockBar from './collab/StructureLockBar'
import SuggestionForm from './collab/SuggestionForm'
import CommentsSection from './CommentsSection'
import DescriptionPreview from './DescriptionPreview'
import ItemDetailPanel from './ItemDetailPanel'
import ItemStructureToolbar from './ItemStructureToolbar'
import LinkEndpointButtons from './LinkEndpointButtons'

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString()
}

interface Props {
  documentId: string
  projectId: string
  orgId: string
  /** One of two split-view panes: narrower comment margin, details panel
   * stacked below instead of docked to the right. */
  compact?: boolean
}

/** The nested tree response leaves `item.depth` at its default (0) — depth
 * is only meaningful for a pre-flattened listing per the API's own doc
 * comment — so flattening here has to compute it locally rather than trust
 * the field. */
function flattenWithDepth(items: Item[], depth = 0): (Item & { depth: number })[] {
  return items.flatMap((i) => [{ ...i, depth }, ...flattenWithDepth(i.children, depth + 1)])
}

function headingClass(depth: number): string {
  if (depth === 0) return 'text-xl font-semibold text-slate-800'
  if (depth === 1) return 'text-lg font-medium text-slate-800'
  return 'text-base font-medium text-slate-700'
}

/** Non-status attributes with a short, badge-sized value (dates, numbers,
 * enums, refs) — free-text and rich-text attributes (e.g. "Justification")
 * read better as a paragraph, so those are rendered separately below. */
function badgeValue(attr: ItemTypeAttribute, value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  switch (attr.data_type) {
    case 'enum':
      return attr.enum_options?.find((o) => o.value === value)?.label ?? String(value)
    case 'multi_enum': {
      const values = Array.isArray(value) ? (value as string[]) : []
      if (values.length === 0) return null
      return values.map((v) => attr.enum_options?.find((o) => o.value === v)?.label ?? v).join(', ')
    }
    case 'boolean':
      return value ? 'Yes' : null
    case 'number':
      return `${value}${attr.unit ? ` ${attr.unit}` : ''}`
    case 'date':
      return String(value)
    case 'user_ref':
    case 'item_ref':
      return String(value)
    default:
      return null
  }
}

/** Word-style "click text to edit it in place" field, used for title,
 * description and free-text attributes in Edit mode. In Review mode
 * (`editable=false`) it renders exactly what plain read-only markup would —
 * no wrapper, no click handler — so reviewers see nothing different. */
function InlineEditField({
  value,
  onSave,
  multiline,
  editable,
  placeholder,
  renderDisplay,
}: {
  value: string
  onSave: (next: string) => void
  multiline?: boolean
  editable: boolean
  placeholder?: string
  renderDisplay?: () => ReactNode
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  if (!editable) {
    return <>{renderDisplay ? renderDisplay() : value || null}</>
  }

  function commit() {
    setEditing(false)
    if (draft !== value) onSave(draft)
  }
  function cancel() {
    setDraft(value)
    setEditing(false)
  }

  if (editing) {
    return multiline ? (
      <textarea
        ref={focusAtEnd}
        autoFocus
        rows={4}
        className="w-full rounded-md border border-blue-400 px-2 py-1.5 text-sm focus:outline-none"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Escape' && cancel()}
      />
    ) : (
      <input
        ref={focusAtEnd}
        autoFocus
        className="w-full rounded-md border border-blue-400 px-2 py-1 text-[15px] font-medium focus:outline-none"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') cancel()
        }}
      />
    )
  }

  const display = renderDisplay ? renderDisplay() : value
  return (
    <div
      onClick={() => {
        setDraft(value)
        setEditing(true)
      }}
      title="Click to edit"
      className="-mx-1 cursor-text rounded px-1 hover:bg-amber-50/60"
    >
      {display || <span className="text-slate-300">{placeholder ?? 'Click to add…'}</span>}
    </div>
  )
}

/** Click-to-edit for a single attribute badge — swaps in the same
 * <AttributeField> control the detail panel uses. Discrete-choice types
 * (enum/boolean/date) close themselves the moment a value is picked;
 * free-typed and multi-select ones wait for a blur, same "click away when
 * done" rule as everywhere else in Document View's edit mode. */
function AttributeInlineEdit({
  attr,
  value,
  onChange,
  onDone,
}: {
  attr: ItemTypeAttribute
  value: unknown
  onChange: (v: unknown) => void
  onDone: () => void
}) {
  const instant = attr.data_type === 'enum' || attr.data_type === 'boolean' || attr.data_type === 'date'
  return (
    <span onBlur={onDone} className="inline-block min-w-[110px] align-middle">
      <AttributeField
        attribute={attr}
        value={value}
        onChange={(v) => {
          onChange(v)
          if (instant) onDone()
        }}
      />
    </span>
  )
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

/** Resolved threads are deliberately left out of this indicator — they're
 * hidden from the reading view entirely and only surface in the document's
 * "Resolved comments" panel, so from here an item with only resolved
 * history reads the same as one with no comments at all. */
function CommentGutterIcon({
  open,
  unresolvedCount,
  onClick,
}: {
  open: boolean
  unresolvedCount: number
  onClick: () => void
}) {
  const hasUnresolved = unresolvedCount > 0
  const label = hasUnresolved
    ? `${unresolvedCount} open comment${unresolvedCount === 1 ? '' : 's'} — click to view`
    : 'Add a comment'
  const colorClass = open
    ? 'text-blue-600'
    : hasUnresolved
      ? 'text-blue-500 hover:text-blue-700'
      : 'text-slate-300 hover:text-blue-500'
  return (
    <button onClick={onClick} title={label} className={`text-sm leading-none ${colorClass}`}>
      💬
    </button>
  )
}

/** "Suggest a change" — a formal, tracked proposal (RID) rather than a
 * free comment. Needs no edit rights and no edit lock. The badge counts the
 * item's open suggestions. */
function SuggestGutterIcon({ openCount, onClick }: { openCount: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={
        openCount > 0
          ? `Suggest a change (${openCount} open suggestion${openCount === 1 ? '' : 's'})`
          : 'Suggest a change'
      }
      className={`relative leading-none ${openCount > 0 ? 'text-amber-600 hover:text-amber-700' : 'text-slate-300 hover:text-amber-600'}`}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
      {openCount > 0 && (
        <span className="absolute -right-1.5 -top-1.5 min-w-3.5 rounded-full bg-amber-500 px-0.5 text-[9px] font-bold leading-3.5 text-white">
          {openCount}
        </span>
      )}
    </button>
  )
}

/** "Request a change" — only on items a workflow has made read-only
 * (Approved, Implemented, Verified…), where editing needs a change request. */
function ChangeRequestGutterIcon({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Request a change (opens a change request with impact analysis)"
      className="leading-none text-slate-300 hover:text-violet-600"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
        <path d="M21 3v5h-5" />
        <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
        <path d="M3 21v-5h5" />
      </svg>
    </button>
  )
}

/** Collapsed-by-default preview of the open thread(s) on an item — just
 * enough to read while scanning the document without every comment
 * permanently expanding the page. Clicking it (or the gutter icon) swaps in
 * the full interactive <CommentsSection>. */
function CommentPreview({ threads, onClick }: { threads: ItemComment[]; onClick: () => void }) {
  const latest = threads[0]
  const totalCount = threads.reduce((sum, t) => sum + 1 + t.replies.length, 0)
  return (
    <button
      onClick={onClick}
      className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-left hover:border-blue-300 hover:bg-blue-50/40"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-slate-700">{latest.author_name}</span>
        <span className="text-[10px] text-slate-400">{formatTime(latest.created_at)}</span>
      </div>
      <p className="mt-0.5 line-clamp-2 text-xs text-slate-600">{latest.body}</p>
      <p className="mt-1 text-[11px] font-medium text-blue-600">
        {totalCount} open comment{totalCount === 1 ? '' : 's'} — click to view
      </p>
    </button>
  )
}

function ItemRow({
  item,
  depth,
  itemTypes,
  linksByItem,
  linkTypes,
  itemById,
  commentsByItem,
  isOpen,
  onToggleComments,
  orgId,
  glossaryTerms,
  referenceSources,
  parameters,
  editMode,
  onAddChild,
  selected,
  onSelect,
  onOpenDetails,
  openSuggestions,
  onSuggest,
  onRequestChange,
  marginClass,
}: {
  item: Item
  depth: number
  itemTypes: ItemType[]
  linksByItem: Map<string, Link[]>
  linkTypes: LinkType[]
  itemById: Map<string, Item>
  commentsByItem: Map<string, ItemComment[]>
  isOpen: boolean
  onToggleComments: () => void
  orgId: string
  glossaryTerms: Parameters<typeof DescriptionPreview>[0]['glossaryTerms']
  referenceSources: Parameters<typeof DescriptionPreview>[0]['referenceSources']
  parameters: Parameters<typeof DescriptionPreview>[0]['parameters']
  editMode: boolean
  onAddChild?: () => void
  selected: boolean
  onSelect: () => void
  onOpenDetails: () => void
  openSuggestions: number
  onSuggest: () => void
  onRequestChange: () => void
  marginClass: string
}) {
  const updateItem = useUpdateItem()
  const [editingAttrKey, setEditingAttrKey] = useState<string | null>(null)
  const itemType = itemTypes.find((t) => t.id === item.item_type_id)
  const isStructural = itemType?.behavior === 'structural'

  function saveAttribute(key: string, value: unknown) {
    updateItem.mutate(
      { id: item.id, payload: { attributes: { ...item.attributes, [key]: value } }, etag: item.etag },
      { onError: (err) => window.alert(apiErrorMessage(err, 'Could not save this change.')) },
    )
  }

  const selectedClass = selected ? 'bg-blue-50/70 ring-1 ring-inset ring-blue-200' : ''
  const detailsButton = (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onOpenDetails()
      }}
      title="Details: workflow, history, links, suggestions"
      className="hidden shrink-0 rounded px-1.5 text-xs font-normal text-slate-400 hover:bg-slate-100 hover:text-blue-600 group-hover/row:block"
    >
      Details ▸
    </button>
  )

  if (isStructural) {
    return (
      <div
        data-item-row={item.id}
        onMouseDown={onSelect}
        className={`group/row grid ${marginClass} ${selectedClass}`}
      >
        <div className={`flex items-center gap-2 ${depth === 0 ? 'px-6 pb-1 pt-5' : 'px-6 pb-1 pt-3'}`}>
          <div className={`min-w-0 flex-1 ${headingClass(depth)} ${item.obsolete ? 'text-slate-400 line-through' : ''}`}>
            {item.number ? <span className="mr-2 text-slate-400">{item.number}</span> : null}
            <InlineEditField
              editable={editMode}
              value={item.title}
              onSave={(v) => updateItem.mutate({ id: item.id, payload: { title: v }, etag: item.etag }, { onError: alertError })}
              renderDisplay={() => <>{item.title}</>}
            />
          </div>
          {editMode && onAddChild && (
            <button
              onClick={onAddChild}
              className="hidden shrink-0 rounded px-1.5 text-xs font-normal text-slate-400 hover:bg-slate-100 hover:text-blue-600 group-hover/row:block"
            >
              + Add inside
            </button>
          )}
          {detailsButton}
        </div>
        <div className="border-l border-slate-100 bg-slate-50/60" />
      </div>
    )
  }

  const links = linksByItem.get(item.id) ?? []
  const threads = commentsByItem.get(item.id) ?? []
  const unresolvedThreads = threads
    .filter((t) => !t.resolved)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))

  const statusAttr = itemType?.attributes.find((a) => a.key === 'status' && a.data_type === 'enum')
  const statusValue = statusAttr ? item.attributes[statusAttr.key] : undefined
  const statusLabel = statusAttr?.enum_options?.find((o) => o.value === statusValue)?.label ?? (statusValue as string | undefined)
  const statusColorClass = item.approved_by
    ? item.approval_stale
      ? 'bg-amber-50 text-amber-700'
      : 'bg-green-50 text-green-700'
    : 'bg-slate-100 text-slate-600'

  const badgeAttrs = (itemType?.attributes ?? []).filter((a) => a.key !== 'status')
  const textAttrs = badgeAttrs.filter((a) => a.data_type === 'text' || a.data_type === 'rich_text')
  const shortAttrs = badgeAttrs.filter((a) => a.data_type !== 'text' && a.data_type !== 'rich_text')

  // Workflow-locked (e.g. Approved) items can't be edited inline — the way
  // to change them is a change request (or a suggestion).
  const contentEditable = editMode && !item.read_only_reason && !item.obsolete

  return (
    <div
      data-item-row={item.id}
      onMouseDown={onSelect}
      className={`group/row grid ${marginClass} ${selectedClass}`}
    >
      <div className="px-6 py-2">
        <div className="rounded-md border border-transparent px-2 py-1.5 hover:border-slate-200">
          <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
            <div className={`flex flex-wrap items-baseline gap-2 ${item.obsolete ? 'opacity-60' : ''}`}>
              {item.key && <span className="font-mono text-xs font-medium text-slate-500">{item.key}</span>}
              <ItemPresence itemId={item.id} label={item.key ?? item.title} size={18} />
              <InlineEditField
                editable={contentEditable}
                value={item.title}
                onSave={(v) => updateItem.mutate({ id: item.id, payload: { title: v }, etag: item.etag }, { onError: alertError })}
                renderDisplay={() => (
                  <span className={`text-[15px] font-medium text-slate-800 ${item.obsolete ? 'line-through' : ''}`}>
                    {item.title}
                  </span>
                )}
              />
              {item.suspect_links > 0 && (
                <span className="text-xs text-orange-600" title={`${item.suspect_links} suspect link(s) — re-verify`}>
                  ⚠
                </span>
              )}
            </div>
            <div className="flex items-center gap-2.5">
              {editMode && <LinkEndpointButtons item={item} />}
              {detailsButton}
              {item.has_workflow && item.read_only_reason && !item.obsolete && (
                <ChangeRequestGutterIcon onClick={onRequestChange} />
              )}
              <SuggestGutterIcon openCount={openSuggestions} onClick={onSuggest} />
              <CommentGutterIcon open={isOpen} unresolvedCount={unresolvedThreads.length} onClick={onToggleComments} />
            </div>
          </div>

          <InlineEditField
            editable={contentEditable}
            multiline
            value={item.description_md ?? ''}
            placeholder="Click to add a description…"
            onSave={(v) =>
              updateItem.mutate({ id: item.id, payload: { description_md: v }, etag: item.etag }, { onError: alertError })
            }
            renderDisplay={() =>
              item.description_md ? (
                <DescriptionPreview
                  text={item.description_md}
                  glossaryTerms={glossaryTerms}
                  referenceSources={referenceSources}
                  parameters={parameters}
                />
              ) : null
            }
          />

          {textAttrs.map((attr) => {
            const value = (item.attributes[attr.key] as string) ?? ''
            if (!value && !contentEditable) return null
            return (
              <div key={attr.id} className="mt-1.5 text-sm text-slate-600">
                <span className="font-medium text-slate-500">{attr.label}: </span>
                <InlineEditField
                  editable={contentEditable}
                  multiline
                  value={value}
                  placeholder={`Click to add ${attr.label.toLowerCase()}…`}
                  onSave={(v) => saveAttribute(attr.key, v)}
                />
              </div>
            )
          })}

          <div className="mt-2 flex flex-wrap gap-1.5">
            {itemType && (
              <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                {itemType.color && (
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: itemType.color }}
                  />
                )}
                {itemType.name}
              </span>
            )}
            {statusAttr &&
              (editMode && editingAttrKey === 'status' && !item.has_workflow ? (
                <AttributeInlineEdit
                  attr={statusAttr}
                  value={item.attributes[statusAttr.key]}
                  onChange={(v) => saveAttribute(statusAttr.key, v)}
                  onDone={() => setEditingAttrKey(null)}
                />
              ) : (
                (statusLabel || editMode) && (
                  <span
                    onClick={editMode && !item.has_workflow ? () => setEditingAttrKey('status') : undefined}
                    title={item.has_workflow ? 'Status follows the workflow — change it from the item details' : undefined}
                    className={`rounded px-1.5 py-0.5 text-xs ${statusColorClass} ${editMode && !item.has_workflow ? 'cursor-pointer hover:opacity-80' : ''}`}
                  >
                    {statusLabel ?? 'Set status'}
                  </span>
                )
              ))}
            {shortAttrs.map((attr) => {
              if (contentEditable && editingAttrKey === attr.key) {
                return (
                  <AttributeInlineEdit
                    key={attr.id}
                    attr={attr}
                    value={item.attributes[attr.key]}
                    onChange={(v) => saveAttribute(attr.key, v)}
                    onDone={() => setEditingAttrKey(null)}
                  />
                )
              }
              const label = badgeValue(attr, item.attributes[attr.key])
              if (!label && !contentEditable) return null
              return (
                <span
                  key={attr.id}
                  onClick={contentEditable ? () => setEditingAttrKey(attr.key) : undefined}
                  className={`rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 ${contentEditable ? 'cursor-pointer hover:bg-amber-100' : ''}`}
                >
                  {attr.label}: {label ?? '—'}
                </span>
              )
            })}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-1.5">
            <span className="text-xs text-slate-400">Links</span>
            {links.length === 0 && <span className="text-xs text-slate-400">none</span>}
            {links.map((link) => {
              const linkType = linkTypes.find((lt) => lt.id === link.link_type_id)
              const outgoing = link.source_item_id === item.id
              const otherId = outgoing ? link.target_item_id : link.source_item_id
              const other = itemById.get(otherId)
              const label = outgoing ? linkType?.name : linkType?.inverse_name
              return (
                <span
                  key={link.id}
                  className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs text-blue-700"
                >
                  {label ?? '—'} &rarr; {other?.key ?? other?.title ?? otherId.slice(0, 8)}
                </span>
              )
            })}
          </div>
        </div>
      </div>

      <div className="min-w-0 border-l border-slate-100 bg-slate-50/60 px-3 py-2">
        {isOpen ? (
          <div className="rounded-md border border-slate-200 bg-white p-2">
            <CommentsSection itemId={item.id} orgId={orgId} filter="unresolved" />
          </div>
        ) : (
          unresolvedThreads.length > 0 && <CommentPreview threads={unresolvedThreads} onClick={onToggleComments} />
        )}
      </div>
    </div>
  )
}

function alertError(err: unknown) {
  window.alert(apiErrorMessage(err, 'Could not save this change.'))
}

export default function DocumentReviewView({ documentId, projectId, orgId, compact }: Props) {
  const [showObsolete, setShowObsolete] = useState(false)
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

  // Comments stay collapsed to a one-line preview while reading — expanding
  // one is an explicit click, not something a page load or a mutation
  // decides for you. Only one item's thread is ever open at a time, and
  // clicking anywhere outside it (another row, the header, the resolved
  // panel) collapses it again, like a popover.
  const [openItemId, setOpenItemId] = useState<string | null>(null)
  const [resolvedPanelOpen, setResolvedPanelOpen] = useState(false)

  // Review mode (default) is the exact read+comment experience non-engineer
  // reviewers get; Edit mode adds inline editing, insertion and the
  // structure toolbar for whoever is authoring the document. Permissions
  // aren't re-checked here — a save fails server-side (403) without an
  // editor role.
  const [editMode, setEditMode] = useState(false)
  // The selected row drives the structure toolbar (move/indent/cut/paste);
  // "Details ▸" opens the full item panel (workflow, history, links…).
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailsId, setDetailsId] = useState<string | null>(null)
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

  function toggleComments(itemId: string) {
    setOpenItemId((prev) => (prev === itemId ? null : itemId))
  }

  useEffect(() => {
    if (!openItemId) return
    function handlePointerDown(e: MouseEvent) {
      const row = (e.target as HTMLElement).closest('[data-item-row]')
      if (row?.getAttribute('data-item-row') !== openItemId) setOpenItemId(null)
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [openItemId])

  // Deep link (?item=<id> from the table of contents, notifications,
  // reviews, RIDs…): scroll the row into view, flash it and open its details.
  useEffect(() => {
    const itemParam = searchParams.get('item')
    if (!itemParam || !tree || !itemTypes) return
    setSelectedId(itemParam)
    const target = flattenWithDepth(tree).find((i) => i.id === itemParam)
    const targetType = itemTypes?.find((t) => t.id === target?.item_type_id)
    // Sections (table-of-contents jumps) just scroll; requirements also open.
    if (targetType?.behavior !== 'structural') setDetailsId(itemParam)
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

  const commentsByItem = useMemo(() => {
    const map = new Map<string, ItemComment[]>()
    for (const thread of documentComments ?? []) {
      if (!map.has(thread.item_id)) map.set(thread.item_id, [])
      map.get(thread.item_id)!.push(thread)
    }
    return map
  }, [documentComments])

  // Resolved threads are excluded from the reading view entirely (per-item
  // margins only ever show open ones) and surface here instead, in one
  // document-wide panel a reviewer can open on demand.
  const resolvedThreads = useMemo(
    () =>
      (documentComments ?? [])
        .filter((t) => t.resolved)
        .sort((a, b) => (b.resolved_at ?? '').localeCompare(a.resolved_at ?? '')),
    [documentComments],
  )

  if (isLoading || !itemTypes || !linkTypes) {
    return <div className="p-6 text-slate-500">Loading document…</div>
  }

  const flatTree = tree ? flattenWithDepth(tree) : []
  const selectedItem = flatTree.find((i) => i.id === selectedId) ?? null
  const detailsItem = flatTree.find((i) => i.id === detailsId) ?? itemById.get(detailsId ?? '') ?? null
  const detailsType = itemTypes.find((t) => t.id === detailsItem?.item_type_id)
  const suggestingItem = flatTree.find((i) => i.id === suggestingFor) ?? null
  const changeRequestItem = flatTree.find((i) => i.id === changeRequestFor) ?? null
  const marginClass = compact ? 'grid-cols-[minmax(0,1fr)_200px]' : 'grid-cols-[minmax(0,1fr)_280px]'

  return (
    <div className={`flex h-full overflow-hidden ${compact ? 'flex-col' : ''}`}>
      <div className={`flex-1 overflow-auto ${compact ? 'p-3' : 'p-6'}`}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <DocumentPresence documentId={documentId} size={22} />
            <div className="flex overflow-hidden rounded-md border border-slate-200">
              <button
                onClick={() => setEditMode(false)}
                className={`px-2.5 py-1 text-xs font-medium ${
                  !editMode ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-50'
                }`}
              >
                Review
              </button>
              <button
                onClick={() => setEditMode(true)}
                className={`px-2.5 py-1 text-xs font-medium ${
                  editMode ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-50'
                }`}
              >
                ✎ Edit
              </button>
            </div>
          </div>
          <div className="flex items-center gap-3">
          <label className="flex items-center gap-1 text-xs text-slate-500">
            <input type="checkbox" checked={showObsolete} onChange={(e) => setShowObsolete(e.target.checked)} />
            Show obsolete
          </label>
          {resolvedThreads.length > 0 && (
            <button
              onClick={() => setResolvedPanelOpen((v) => !v)}
              className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
                resolvedPanelOpen
                  ? 'border-green-300 bg-green-50 text-green-700'
                  : 'border-slate-200 text-slate-500 hover:bg-slate-50'
              }`}
            >
              ✓ Resolved comments ({resolvedThreads.length})
            </button>
          )}
          </div>
        </div>

        {editMode && (
          <div className="sticky top-0 z-20 -mx-1 mb-2 bg-slate-50/95 px-1 pt-1 backdrop-blur">
            <StructureLockBar documentId={documentId} />
            <ItemStructureToolbar selectedItem={selectedItem} allItems={flatTree} itemTypes={itemTypes} />
          </div>
        )}

        {editMode && (
          <div className="mb-3">
            {!addingRoot ? (
              <button
                onClick={() => setAddingRoot(true)}
                className="rounded-md border border-dashed border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-500 hover:border-blue-400 hover:text-blue-600"
              >
                + Add root item
              </button>
            ) : (
              <AddItemForm
                documentId={documentId}
                parentId={null}
                itemTypes={itemTypes}
                onDone={() => setAddingRoot(false)}
              />
            )}
          </div>
        )}

        <div className="rounded-lg border border-slate-200 bg-white">
          {flatTree.map((item) => {
            const isStructural = itemTypes.find((t) => t.id === item.item_type_id)?.behavior === 'structural'
            const insertPlan = planInsertAfter(flatTree, item)
            return (
              <Fragment key={item.id}>
                <ItemRow
                  item={item}
                  depth={item.depth}
                  itemTypes={itemTypes}
                  linksByItem={linksByItem}
                  linkTypes={linkTypes}
                  itemById={itemById}
                  commentsByItem={commentsByItem}
                  isOpen={openItemId === item.id}
                  onToggleComments={() => toggleComments(item.id)}
                  orgId={orgId}
                  glossaryTerms={glossaryTerms ?? []}
                  referenceSources={[...(standards ?? []), ...(referenceDocuments ?? [])]}
                  parameters={parameters ?? []}
                  editMode={editMode}
                  onAddChild={
                    isStructural ? () => setAddingChildOf(addingChildOf === item.id ? null : item.id) : undefined
                  }
                  selected={selectedId === item.id}
                  onSelect={() => setSelectedId(item.id)}
                  onOpenDetails={() => {
                    setSelectedId(item.id)
                    setDetailsId(item.id)
                  }}
                  openSuggestions={openSuggestionsByItem.get(item.id) ?? 0}
                  onSuggest={() => setSuggestingFor(item.id)}
                  onRequestChange={() => setChangeRequestFor(item.id)}
                  marginClass={marginClass}
                />
                {editMode && addingChildOf === item.id && (
                  <div style={{ paddingLeft: (item.depth + 1) * 20 + 24 }} className="pb-2 pr-6">
                    <AddItemForm
                      documentId={documentId}
                      parentId={item.id}
                      itemTypes={itemTypes}
                      onDone={() => setAddingChildOf(null)}
                    />
                  </div>
                )}
                {editMode && <InsertHereRow depth={item.depth} onClick={() => setInsertAfterId(insertAfterId === item.id ? null : item.id)} />}
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
          {flatTree.length === 0 && <p className="p-4 text-sm text-slate-400">No items yet.</p>}
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
        />
      )}

      {suggestingItem && (
        <SuggestionForm
          item={suggestingItem}
          itemType={itemTypes.find((t) => t.id === suggestingItem.item_type_id)!}
          linkTypes={linkTypes}
          allItems={projectItems ?? flatTree}
          projectId={projectId}
          onClose={() => setSuggestingFor(null)}
        />
      )}

      {changeRequestItem && (
        <ChangeRequestDialog
          item={changeRequestItem}
          projectId={projectId}
          onClose={() => setChangeRequestFor(null)}
        />
      )}

      {resolvedPanelOpen && !detailsItem && (
        <ResolvedCommentsPanel
          threads={resolvedThreads}
          itemById={itemById}
          onClose={() => setResolvedPanelOpen(false)}
        />
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
  const reopenComment = useReopenComment()

  return (
    <div className="flex h-full w-96 shrink-0 flex-col border-l border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-800">Resolved comments</h2>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
          ✕
        </button>
      </div>
      <div className="flex-1 space-y-2 overflow-auto p-3">
        {threads.map((thread) => {
          const item = itemById.get(thread.item_id)
          return (
            <div key={thread.id} className="rounded-md border border-green-200 bg-green-50/40 p-2.5">
              <div className="mb-1 text-xs font-medium text-slate-500">
                {item?.key ?? 'Item'}
                {item?.title ? ` — ${item.title}` : ''}
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-medium text-slate-700">{thread.author_name}</span>
                <span className="text-[11px] text-slate-400">{formatTime(thread.created_at)}</span>
              </div>
              <p className="mt-0.5 whitespace-pre-wrap text-xs text-slate-700">{thread.body}</p>
              <div className="mt-1.5 text-[11px] text-green-700">
                ✓ Resolved by <span className="font-medium">{thread.resolved_by}</span>
                {thread.resolved_at && ` on ${formatTime(thread.resolved_at)}`}
              </div>
              <button
                onClick={() => reopenComment.mutate(thread.id)}
                className="mt-1.5 text-[11px] font-medium text-slate-500 hover:text-slate-800"
              >
                Reopen
              </button>
            </div>
          )
        })}
        {threads.length === 0 && <p className="text-xs text-slate-400">No resolved comments.</p>}
      </div>
    </div>
  )
}
