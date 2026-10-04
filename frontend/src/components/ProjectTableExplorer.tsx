import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n'
import { useSearchParams } from 'react-router-dom'
import { apiErrorMessage } from '../api/client'
import {
  useCreateTableView,
  useDeleteTableView,
  useItemTypes,
  useLinkTypes,
  useProjectItems,
  useProjectLinks,
  useTableViews,
  useUpdateItem,
  useUpdateTableView,
} from '../api/hooks'
import type { Item, ItemTypeAttribute, Link, LinkType, TableViewColumn } from '../api/types'
import AttributeField from './AttributeField'
import ItemDetailPanel from './ItemDetailPanel'
import ItemStructureToolbar from './ItemStructureToolbar'
import LinkEndpointButtons from './LinkEndpointButtons'
import { ItemPresence } from './collab/PresenceAvatar'

/** `autoFocus` alone leaves the caret at the start of any pre-filled value
 * (browsers don't move it to the end) — for an inline "edit in place" field
 * that's a trap: typing immediately would insert before the existing text
 * instead of appending. */
function focusAtEnd(el: HTMLInputElement | HTMLTextAreaElement | null) {
  if (!el) return
  el.focus()
  const len = el.value.length
  el.setSelectionRange(len, len)
}

function stripMarkdown(md: string | null): string {
  if (!md) return ''
  return md.replace(/[#*_`>-]/g, '').replace(/\s+/g, ' ').trim()
}

function renderAttributeValue(item: Item, key: string): string {
  const value = item.attributes[key]
  if (value === null || value === undefined) return '—'
  if (Array.isArray(value)) return value.join(', ')
  return String(value)
}

interface Props {
  projectId: string
  orgId: string
  compact?: boolean
  /** Edit mode: double-click a cell to edit it, structure toolbar shown. */
  editMode?: boolean
}

/** Splits the search box into free-text terms and an optional `type:` token
 * (matched against the item type's name/key/prefix) — one field instead of
 * a text box plus a type dropdown. Starting simple: terms match key, title
 * and description; more fields (attributes, item type by free text) can
 * join later. */
function parseSearch(query: string): { typeQuery: string | null; terms: string[] } {
  const tokens = query.trim().split(/\s+/).filter(Boolean)
  let typeQuery: string | null = null
  const terms: string[] = []
  for (const token of tokens) {
    const match = /^type:(.+)$/i.exec(token)
    if (match) {
      typeQuery = match[1]
    } else {
      terms.push(token)
    }
  }
  return { typeQuery, terms }
}

function itemLinkSummaries(
  itemId: string,
  links: Link[],
  linkTypes: LinkType[],
  itemById: Map<string, Item>,
) {
  return links
    .filter((l) => l.source_item_id === itemId || l.target_item_id === itemId)
    .map((l) => {
      const linkType = linkTypes.find((lt) => lt.id === l.link_type_id)
      const isOutgoing = l.source_item_id === itemId
      const otherId = isOutgoing ? l.target_item_id : l.source_item_id
      const other = itemById.get(otherId)
      return {
        id: l.id,
        otherId,
        label: (isOutgoing ? linkType?.name : linkType?.inverse_name) ?? '?',
        otherKey: other?.key ?? otherId.slice(0, 8),
      }
    })
}

export default function ProjectTableExplorer({ projectId, orgId, compact, editMode = false }: Props) {
  const t = useT()
  const { data: items, isLoading } = useProjectItems(projectId)
  const { data: itemTypes } = useItemTypes(orgId)
  const { data: linkTypes } = useLinkTypes(orgId)
  const { data: projectLinks } = useProjectLinks(projectId)
  const { data: tableViews } = useTableViews(projectId)
  const createView = useCreateTableView(projectId)
  const updateView = useUpdateTableView()
  const updateItem = useUpdateItem()
  const deleteView = useDeleteTableView()

  const [searchParams, setSearchParams] = useSearchParams()
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailsId, setDetailsId] = useState<string | null>(null)
  const [editingCell, setEditingCell] = useState<{ itemId: string; column: string } | null>(null)
  const [editText, setEditText] = useState('')
  const [editError, setEditError] = useState<string | null>(null)
  const [viewId, setViewId] = useState<string>('')
  const [columns, setColumns] = useState<TableViewColumn[]>([])
  const [error, setError] = useState<string | null>(null)
  const [newViewName, setNewViewName] = useState<string | null>(null)
  const [newViewScope, setNewViewScope] = useState<'personal' | 'shared'>('shared')

  const contentTypes = (itemTypes ?? []).filter((t) => t.behavior === 'content')
  const { typeQuery, terms: searchTerms } = parseSearch(searchQuery)
  const matchingTypeIds = typeQuery
    ? contentTypes
        .filter(
          (t) =>
            t.name.toLowerCase().includes(typeQuery.toLowerCase()) ||
            t.key.toLowerCase().includes(typeQuery.toLowerCase()) ||
            t.prefix.toLowerCase().includes(typeQuery.toLowerCase()),
        )
        .map((t) => t.id)
    : null
  // Column customization / saved views only make sense once the search
  // narrows things to exactly one type — same as picking one from the old
  // dropdown. An ambiguous or absent `type:` token just falls back to the
  // generic "all types" columns (Description instead of attributes).
  const activeType =
    matchingTypeIds && matchingTypeIds.length === 1
      ? contentTypes.find((t) => t.id === matchingTypeIds[0])
      : undefined
  const viewsForType = (tableViews ?? []).filter((v) => v.item_type_id === activeType?.id)
  const activeView = viewsForType.find((v) => v.id === viewId)

  // When the active type changes, load its default view (or all its
  // non-deprecated attributes if none is saved yet). Keyed off activeType's
  // id alone (via a ref, not a dependency) so a `tableViews` refetch — e.g.
  // right after saving a new view — doesn't clobber the just-picked state.
  const lastActiveTypeId = useRef<string | null>(null)
  useEffect(() => {
    const key = activeType?.id ?? null
    if (lastActiveTypeId.current === key) return
    lastActiveTypeId.current = key

    if (!activeType) {
      setColumns([])
      setViewId('')
      return
    }
    const defaultView = viewsForType.find((v) => v.is_default)
    if (defaultView) {
      setViewId(defaultView.id)
      setColumns(defaultView.columns)
    } else {
      setViewId('')
      setColumns(
        activeType.attributes.filter((a) => !a.deprecated).map((a) => ({ attribute_key: a.key, width: null })),
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeType?.id, tableViews])

  // Deep link from the sidebar's "Saved Table Views" list: ?view=<id> opens
  // that exact view instead of whatever the type's default happens to be.
  // Marks activeType as already-handled first (via the ref above) so the
  // effect right above doesn't immediately clobber it with the default view
  // once `searchQuery` causes `activeType` to resolve on the next render.
  useEffect(() => {
    const viewParam = searchParams.get('view')
    if (!viewParam || !tableViews || !itemTypes) return
    const view = tableViews.find((v) => v.id === viewParam)
    if (!view) return
    const type = itemTypes.find((t) => t.id === view.item_type_id)
    if (!type) return

    lastActiveTypeId.current = type.id
    setSearchQuery(`type:${type.name}`)
    setViewId(view.id)
    setColumns(view.columns)

    const next = new URLSearchParams(searchParams)
    next.delete('view')
    setSearchParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, tableViews, itemTypes])

  // Deep link from an email notification: ?item=<id> opens that item's
  // details directly instead of leaving the reader to hunt for it.
  useEffect(() => {
    const itemParam = searchParams.get('item')
    if (!itemParam) return
    setSelectedId(itemParam)
    setDetailsId(itemParam)
    const next = new URLSearchParams(searchParams)
    next.delete('item')
    setSearchParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  function selectView(id: string) {
    setViewId(id)
    if (id === '') {
      setColumns(
        (activeType?.attributes ?? []).filter((a) => !a.deprecated).map((a) => ({ attribute_key: a.key, width: null })),
      )
    } else {
      const v = (tableViews ?? []).find((tv) => tv.id === id)
      if (v) setColumns(v.columns)
    }
  }

  function toggleColumn(attr: ItemTypeAttribute) {
    setColumns((prev) =>
      prev.some((c) => c.attribute_key === attr.key)
        ? prev.filter((c) => c.attribute_key !== attr.key)
        : [...prev, { attribute_key: attr.key, width: null }],
    )
  }

  function moveColumn(index: number, dir: -1 | 1) {
    setColumns((prev) => {
      const next = [...prev]
      const target = index + dir
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  function saveChanges() {
    if (!activeView) return
    setError(null)
    updateView.mutate(
      { id: activeView.id, payload: { columns } },
      { onError: (err) => setError(apiErrorMessage(err, 'Could not save this view.')) },
    )
  }

  function saveAsNew(name: string, scope: 'personal' | 'shared') {
    if (!name.trim() || !activeType) return
    setError(null)
    createView.mutate(
      { name: name.trim(), scope, item_type_id: activeType.id, columns },
      {
        onSuccess: (v) => {
          setViewId(v.id)
          setNewViewName(null)
        },
        onError: (err) => setError(apiErrorMessage(err, 'Could not create this view.')),
      },
    )
  }

  if (isLoading) return <div className={compact ? 'p-3 text-sm text-slate-500' : 'p-6 text-slate-500'}>Loading table…</div>

  const visibleItems = (items ?? []).filter((item) => {
    if (matchingTypeIds && !matchingTypeIds.includes(item.item_type_id)) return false
    if (searchTerms.length === 0) return true
    const haystack = `${item.key ?? ''} ${item.title} ${item.description_md ?? ''}`.toLowerCase()
    return searchTerms.every((term) => haystack.includes(term.toLowerCase()))
  })
  const activeAttrs = activeType?.attributes ?? []
  const orderedColumns = columns
    .map((c) => activeAttrs.find((a) => a.key === c.attribute_key))
    .filter((a): a is ItemTypeAttribute => !!a && !a.deprecated)

  const selectedItem = (items ?? []).find((i) => i.id === selectedId) ?? null
  const detailsItem = (items ?? []).find((i) => i.id === detailsId) ?? null
  const detailsType = itemTypes?.find((t) => t.id === detailsItem?.item_type_id)
  const itemById = new Map((items ?? []).map((i) => [i.id, i]))

  function openDetails(id: string) {
    setSelectedId(id)
    setDetailsId(id)
  }

  // Double-click a Title/Description cell to edit it right there instead of
  // opening the full detail panel — attribute columns get their own inline
  // editor further down (reusing AttributeField, same as the detail panel).
  function startEditingText(item: Item, column: 'title' | 'description') {
    setSelectedId(item.id)
    setEditingCell({ itemId: item.id, column })
    setEditText(column === 'title' ? item.title : (item.description_md ?? ''))
    setEditError(null)
  }

  function commitTextEdit(item: Item, column: 'title' | 'description') {
    setEditingCell(null)
    const field = column === 'title' ? 'title' : 'description_md'
    const original = column === 'title' ? item.title : (item.description_md ?? '')
    if (editText === original) return
    updateItem.mutate(
      { id: item.id, payload: { [field]: editText }, etag: item.etag },
      { onError: (err) => setEditError(apiErrorMessage(err, 'Could not save this change.')) },
    )
  }

  const isDirty =
    !!activeType &&
    JSON.stringify(columns.map((c) => c.attribute_key)) !==
      JSON.stringify((activeView?.columns ?? []).map((c) => c.attribute_key))

  const searchBox = (
            <div className="relative">
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('Search key, title, description… (type:Requirement to filter by type)')}
                className="w-80 max-w-full rounded-md border border-slate-300 py-1 pl-2 pr-6 text-sm"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  title={t('Clear search')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  ✕
                </button>
              )}
            </div>
  )

  return (
    <div className={compact ? 'flex h-full flex-col' : 'flex h-full'}>
      <div className={`flex-1 overflow-auto ${compact ? 'p-3' : ''}`}>
        {(activeType || typeQuery) && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {typeQuery && matchingTypeIds && matchingTypeIds.length === 0 && (
              <span className="text-xs text-amber-600">No item type matches "{typeQuery}"</span>
            )}
            {typeQuery && matchingTypeIds && matchingTypeIds.length > 1 && (
              <span className="text-xs text-amber-600">
                "{typeQuery}" matches several types — narrow it down to customize columns
              </span>
            )}

            {activeType && (
              <select
                className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                value={viewId}
                onChange={(e) => selectView(e.target.value)}
              >
                <option value="">Default columns</option>
                {viewsForType.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                    {v.is_default ? ' ★' : ''}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {editMode ? (
          <ItemStructureToolbar
            selectedItem={selectedItem}
            allItems={items ?? []}
            itemTypes={itemTypes}
            extra={searchBox}
          />
        ) : (
          <div className="mb-3">{searchBox}</div>
        )}

        {activeType && (
          <div className="mb-4 rounded-lg border border-slate-200 bg-white p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Columns
              </span>
              <div className="flex gap-2">
                {activeView && isDirty && (
                  <button
                    onClick={saveChanges}
                    className="rounded-md bg-slate-700 px-2 py-1 text-xs font-medium text-white hover:bg-slate-800"
                  >
                    Save changes
                  </button>
                )}
                {isDirty && newViewName === null && (
                  <button
                    onClick={() => setNewViewName('')}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    Save as new view
                  </button>
                )}
                {activeView && (
                  <button
                    onClick={() => {
                      deleteView.mutate(activeView.id)
                      setViewId('')
                    }}
                    className="rounded-md px-2 py-1 text-xs text-slate-400 hover:text-red-600"
                  >
                    Delete view
                  </button>
                )}
              </div>
            </div>

            {newViewName !== null && (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  saveAsNew(newViewName, newViewScope)
                }}
                className="mb-2 flex items-center gap-2 rounded-md bg-slate-50 p-2"
              >
                <input
                  autoFocus
                  className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs"
                  placeholder="View name…"
                  value={newViewName}
                  onChange={(e) => setNewViewName(e.target.value)}
                />
                <select
                  className="rounded-md border border-slate-300 px-1.5 py-1 text-xs"
                  value={newViewScope}
                  onChange={(e) => setNewViewScope(e.target.value as 'personal' | 'shared')}
                  title="Shared views are visible to everyone on the project; personal views are just for you"
                >
                  <option value="shared">Shared</option>
                  <option value="personal">Personal</option>
                </select>
                <button
                  type="submit"
                  className="rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setNewViewName(null)}
                  className="text-xs text-slate-400 hover:text-slate-700"
                >
                  Cancel
                </button>
              </form>
            )}

            <div className="flex flex-wrap gap-2">
              {activeAttrs
                .filter((a) => !a.deprecated)
                .map((attr) => {
                  const idx = columns.findIndex((c) => c.attribute_key === attr.key)
                  const active = idx !== -1
                  return (
                    <div
                      key={attr.id}
                      className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${
                        active ? 'border-blue-300 bg-blue-50 text-blue-800' : 'border-slate-200 text-slate-500'
                      }`}
                    >
                      <label className="flex cursor-pointer items-center gap-1">
                        <input type="checkbox" checked={active} onChange={() => toggleColumn(attr)} />
                        {attr.label}
                      </label>
                      {active && (
                        <span className="ml-1 flex gap-0.5">
                          <button onClick={() => moveColumn(idx, -1)} className="hover:text-blue-900">
                            ←
                          </button>
                          <button onClick={() => moveColumn(idx, 1)} className="hover:text-blue-900">
                            →
                          </button>
                        </span>
                      )}
                    </div>
                  )
                })}
            </div>
            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
          </div>
        )}

        <div className="rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-3 py-2">Key</th>
                <th className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-3 py-2">Title</th>
                {orderedColumns.length > 0 ? (
                  orderedColumns.map((c) => (
                    <th key={c.id} className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-3 py-2">
                      {c.label}
                    </th>
                  ))
                ) : (
                  <th className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-3 py-2">Description</th>
                )}
                <th className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-3 py-2">Links</th>
                <th className="sticky top-0 z-10 w-24 border-b border-slate-200 bg-slate-50 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((item) => {
                const itemType = itemTypes?.find((t) => t.id === item.item_type_id)
                const isStructural = itemType?.behavior === 'structural'
                const itemLinks = isStructural
                  ? []
                  : itemLinkSummaries(item.id, projectLinks ?? [], linkTypes ?? [], itemById)
                return (
                  <tr
                    key={item.id}
                    onClick={() => !isStructural && setSelectedId(item.id)}
                    className={`group/row border-b border-slate-100 last:border-0 hover:bg-slate-50 ${
                      isStructural
                        ? item.depth === 0
                          ? 'border-t-2 border-t-slate-200 bg-slate-100 font-semibold text-slate-800'
                          : 'bg-slate-50 font-medium text-slate-600'
                        : 'cursor-pointer'
                    } ${selectedId === item.id ? 'bg-blue-50' : ''}`}
                  >
                    <td className="px-3 py-2 font-mono text-xs text-slate-500">
                      <span className="flex items-center gap-1.5">
                        {isStructural ? '' : item.key}
                        <ItemPresence itemId={item.id} label={item.key ?? item.title} size={18} />
                      </span>
                    </td>
                    <td
                      className="px-3 py-2"
                      colSpan={isStructural ? 3 + Math.max(orderedColumns.length, 1) : 1}
                      onDoubleClick={(e) => {
                        e.stopPropagation()
                        if (!editMode) return
                        startEditingText(item, 'title')
                      }}
                    >
                      {editingCell?.itemId === item.id && editingCell.column === 'title' ? (
                        <>
                          <input
                            ref={focusAtEnd}
                            className="w-full rounded-md border border-blue-400 px-1.5 py-0.5 text-sm focus:outline-none"
                            value={editText}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => setEditText(e.target.value)}
                            onBlur={() => commitTextEdit(item, 'title')}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') e.currentTarget.blur()
                              if (e.key === 'Escape') setEditingCell(null)
                            }}
                          />
                          {editError && <p className="mt-1 text-xs text-red-600">⚠ {editError}</p>}
                        </>
                      ) : (
                        <div
                          style={
                            item.depth > 0
                              ? {
                                  paddingLeft: item.depth * 20 - 2,
                                  borderLeft: '2px solid #e2e8f0',
                                  marginLeft: 2,
                                }
                              : undefined
                          }
                        >
                          <span className="truncate" title="Double-click to edit">
                            {isStructural && (
                              <span className="mr-2 text-slate-400">{item.number}</span>
                            )}
                            {item.title}
                          </span>
                        </div>
                      )}
                    </td>
                    {!isStructural && (
                      <>
                        {orderedColumns.length > 0 ? (
                          orderedColumns.map((c) => (
                            <td
                              key={c.id}
                              className="px-3 py-2 text-slate-600"
                              onDoubleClick={(e) => {
                                e.stopPropagation()
                                if (!editMode) return
                                setSelectedId(item.id)
                                if (c.key === 'status' && item.has_workflow) {
                                  setEditError('Status follows the workflow — use the transitions in the item details.')
                                  return
                                }
                                if (item.read_only_reason) {
                                  setEditError(item.read_only_reason)
                                  return
                                }
                                setEditingCell({ itemId: item.id, column: c.key })
                                setEditError(null)
                              }}
                            >
                              {editingCell?.itemId === item.id && editingCell.column === c.key ? (
                                <div
                                  onClick={(e) => e.stopPropagation()}
                                  onBlur={(e) => {
                                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                                      setEditingCell(null)
                                    }
                                  }}
                                >
                                  <AttributeField
                                    attribute={c}
                                    value={item.attributes[c.key]}
                                    onChange={(v) =>
                                      updateItem.mutate(
                                        {
                                          id: item.id,
                                          payload: { attributes: { ...item.attributes, [c.key]: v } },
                                          etag: item.etag,
                                        },
                                        {
                                          onError: (err) =>
                                            setEditError(apiErrorMessage(err, 'Could not save this change.')),
                                        },
                                      )
                                    }
                                  />
                                  {editError && <p className="mt-1 text-xs text-red-600">⚠ {editError}</p>}
                                </div>
                              ) : (
                                <span title="Double-click to edit">{renderAttributeValue(item, c.key)}</span>
                              )}
                            </td>
                          ))
                        ) : (
                          <td
                            className="px-3 py-2 text-slate-500"
                            onDoubleClick={(e) => {
                              e.stopPropagation()
                              if (!editMode) return
                              startEditingText(item, 'description')
                            }}
                          >
                            {editingCell?.itemId === item.id && editingCell.column === 'description' ? (
                              <>
                                <textarea
                                  ref={focusAtEnd}
                                  rows={3}
                                  className="w-full min-w-[220px] rounded-md border border-blue-400 px-1.5 py-1 text-sm focus:outline-none"
                                  value={editText}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) => setEditText(e.target.value)}
                                  onBlur={() => commitTextEdit(item, 'description')}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Escape') setEditingCell(null)
                                  }}
                                />
                                {editError && <p className="mt-1 text-xs text-red-600">⚠ {editError}</p>}
                              </>
                            ) : (
                              <span title="Double-click to edit">
                                {stripMarkdown(item.description_md).slice(0, 140)}
                              </span>
                            )}
                          </td>
                        )}
                        <td className="max-w-[200px] px-3 py-2 align-top">
                          {itemLinks.length > 0 ? (
                            <div className="flex flex-col gap-0.5">
                              {itemLinks.map((l) => (
                                <button
                                  key={l.id}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    openDetails(l.otherId)
                                  }}
                                  title={`${l.label}: ${l.otherKey}`}
                                  className="block w-full truncate text-left text-xs text-blue-600 hover:underline"
                                >
                                  <span className="text-slate-400">{l.label}:</span> {l.otherKey}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex items-center justify-end gap-1">
                            <LinkEndpointButtons item={item} />
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                openDetails(item.id)
                              }}
                              title="Show details"
                              className="shrink-0 rounded px-1.5 text-xs text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                            >
                              Details ▸
                            </button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                )
              })}
              {visibleItems.length === 0 && (
                <tr>
                  <td colSpan={5 + Math.max(orderedColumns.length, 1)} className="px-3 py-6 text-center text-slate-400">
                    No items match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {detailsItem && detailsType && itemTypes && linkTypes && (
        <ItemDetailPanel
          key={detailsItem.id}
          item={detailsItem}
          itemType={detailsType}
          itemTypes={itemTypes}
          linkTypes={linkTypes}
          allItems={items ?? []}
          onClose={() => setDetailsId(null)}
          orgId={orgId}
          compact={compact}
          editMode={editMode}
        />
      )}
    </div>
  )
}
