import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiErrorMessage } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { useDocumentTree, useItemTypes, useLinkTypes, useUpdateItem } from '../api/hooks'
import type { Item, ItemType } from '../api/types'
import { focusAtEnd, planInsertAfter } from '../structure/itemOrdering'
import AddItemForm from './AddItemForm'
import StatusBadge from './collab/StatusBadge'
import StructureLockBar from './collab/StructureLockBar'
import ItemDetailPanel from './ItemDetailPanel'
import ItemStructureToolbar from './ItemStructureToolbar'
import LinkEndpointButtons from './LinkEndpointButtons'

interface Props {
  documentId: string
  orgId: string
  compact?: boolean
}

function flatten(items: Item[]): Item[] {
  return items.flatMap((i) => [i, ...flatten(i.children)])
}

function TreeNode({
  item,
  depth,
  documentId,
  itemTypes,
  allItems,
  selectedId,
  onSelect,
  onOpenDetails,
  addingChildOf,
  setAddingChildOf,
  insertBelowId,
  setInsertBelowId,
}: {
  item: Item
  depth: number
  documentId: string
  itemTypes: ItemType[] | undefined
  allItems: Item[]
  selectedId: string | null
  onSelect: (id: string) => void
  onOpenDetails: (id: string) => void
  addingChildOf: string | null
  setAddingChildOf: (id: string | null) => void
  insertBelowId: string | null
  setInsertBelowId: (id: string | null) => void
}) {
  const { user } = useAuth()
  const currentUserId = user?.id
  const [collapsed, setCollapsed] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(item.title)
  const updateItem = useUpdateItem()
  const itemType = itemTypes?.find((t) => t.id === item.item_type_id)
  const isStructural = itemType?.behavior === 'structural'
  const insertPlan = planInsertAfter(allItems, item)

  function commitTitle() {
    setEditingTitle(false)
    if (titleDraft !== item.title)
      updateItem.mutate(
        { id: item.id, payload: { title: titleDraft }, etag: item.etag },
        { onError: (err) => window.alert(apiErrorMessage(err, 'Could not rename this item.')) },
      )
  }

  return (
    <div>
      <div
        className={`group/row flex items-center gap-1.5 rounded-md py-1 pr-1.5 text-sm hover:bg-slate-100 ${
          selectedId === item.id ? 'bg-blue-50' : ''
        } ${isStructural && depth === 0 ? 'mt-3 border-t border-slate-200 pt-2 first:mt-0 first:border-t-0 first:pt-1' : ''}`}
      >
        {/* Continuous vertical guide line per ancestor level — the same
            fixed-width column repeated at every row gives the illusion of
            one line running from a parent down through its descendants. */}
        {Array.from({ length: depth }).map((_, i) => (
          <span key={i} className="h-6 w-5 shrink-0 self-stretch border-l border-slate-200" />
        ))}
        <span className="w-1 shrink-0" />
        {item.children.length > 0 ? (
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="w-4 shrink-0 text-slate-400 hover:text-slate-700"
          >
            {collapsed ? '▶' : '▼'}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        {editingTitle ? (
          <input
            ref={focusAtEnd}
            className="flex-1 rounded-md border border-blue-400 px-1.5 py-0.5 text-sm focus:outline-none"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') {
                setTitleDraft(item.title)
                setEditingTitle(false)
              }
            }}
          />
        ) : (
          <button
            onClick={() => onSelect(item.id)}
            onDoubleClick={() => {
              if (item.read_only_reason || (item.lock && item.lock.user_id !== currentUserId)) return
              setTitleDraft(item.title)
              setEditingTitle(true)
            }}
            title={item.read_only_reason ?? 'Double-click to edit'}
            className={`flex-1 truncate text-left ${item.obsolete ? 'text-slate-400 line-through decoration-slate-300' : ''} ${
              isStructural
                ? depth === 0
                  ? 'text-[15px] font-semibold text-slate-800'
                  : 'font-medium text-slate-600'
                : 'text-slate-700'
            }`}
          >
            {isStructural ? (
              <span className="mr-2 text-slate-400">{item.number}</span>
            ) : (
              <span className="mr-2 rounded bg-slate-100 px-1 font-mono text-xs text-slate-500">
                {item.key}
              </span>
            )}
            {item.title}
          </button>
        )}

        {!isStructural && item.has_workflow && <StatusBadge itemType={itemType} value={item.attributes.status} small />}
        {item.lock && item.lock.user_id !== currentUserId && (
          <span
            className="shrink-0 rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-800"
            title={`${item.lock.user_name} is editing this`}
          >
            ✎ {item.lock.user_name}
          </span>
        )}
        {item.suspect_links > 0 && (
          <span className="shrink-0 text-xs text-orange-600" title={`${item.suspect_links} suspect link(s)`}>
            ⚠
          </span>
        )}

        {!isStructural && <LinkEndpointButtons item={item} />}

        <button
          onClick={(e) => {
            e.stopPropagation()
            onOpenDetails(item.id)
          }}
          title="Show details"
          className="shrink-0 rounded px-1.5 text-xs text-slate-400 hover:bg-slate-200 hover:text-slate-700"
        >
          Details ▸
        </button>

        {isStructural && (
          <button
            onClick={() => setAddingChildOf(item.id)}
            className="hidden shrink-0 rounded px-1.5 text-xs text-slate-400 hover:bg-slate-200 hover:text-slate-700 group-hover/row:block"
          >
            + Add inside
          </button>
        )}
      </div>

      {addingChildOf === item.id && itemTypes && (
        <div style={{ paddingLeft: (depth + 1) * 20 + 4 }}>
          <AddItemForm
            documentId={documentId}
            parentId={item.id}
            itemTypes={itemTypes}
            onDone={() => setAddingChildOf(null)}
          />
        </div>
      )}

      {!collapsed &&
        item.children.map((child) => (
          <TreeNode
            key={child.id}
            item={child}
            depth={depth + 1}
            documentId={documentId}
            itemTypes={itemTypes}
            allItems={allItems}
            selectedId={selectedId}
            onSelect={onSelect}
            onOpenDetails={onOpenDetails}
            addingChildOf={addingChildOf}
            setAddingChildOf={setAddingChildOf}
            insertBelowId={insertBelowId}
            setInsertBelowId={setInsertBelowId}
          />
        ))}

      {/* Hover affordance: insert a new sibling right after this item,
          under the same parent — the "don't make me scroll to a button up
          top" interaction. */}
      <div className="group/gap relative h-2" style={{ marginLeft: depth * 20 + 4 }}>
        <button
          onClick={() => setInsertBelowId(insertBelowId === item.id ? null : item.id)}
          className="absolute inset-x-0 top-0 z-10 flex h-4 -translate-y-1/2 items-center opacity-0 group-hover/gap:opacity-100"
        >
          <span className="h-px flex-1 bg-blue-300" />
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-xs leading-none text-white">
            +
          </span>
          <span className="h-px flex-1 bg-blue-300" />
        </button>
      </div>

      {insertBelowId === item.id && itemTypes && (
        <div style={{ paddingLeft: depth * 20 + 4 }}>
          <AddItemForm
            documentId={documentId}
            parentId={item.parent_id}
            itemTypes={itemTypes}
            order={insertPlan.order}
            onBeforeCreate={() =>
              Promise.all(
                insertPlan.shifts.map((s) =>
                  updateItem.mutateAsync({ id: s.id, payload: { order: s.order } }),
                ),
              ).then(() => undefined)
            }
            onDone={() => setInsertBelowId(null)}
          />
        </div>
      )}
    </div>
  )
}

export default function DocumentExplorer({ documentId, orgId, compact }: Props) {
  const [showObsolete, setShowObsolete] = useState(false)
  const { data: tree, isLoading } = useDocumentTree(documentId, showObsolete)
  const { data: itemTypes } = useItemTypes(orgId)
  const { data: linkTypes } = useLinkTypes(orgId)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [addingChildOf, setAddingChildOf] = useState<string | null>(null)
  const [insertBelowId, setInsertBelowId] = useState<string | null>(null)
  const [addingRoot, setAddingRoot] = useState(false)
  const [detailsId, setDetailsId] = useState<string | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()

  // Deep link from an email notification: ?item=<id> opens that item's
  // details directly instead of leaving the reader to hunt for it in the
  // tree.
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

  const allItems = tree ? flatten(tree) : []
  const selectedItem = allItems.find((i) => i.id === selectedId) ?? null
  const detailsItem = allItems.find((i) => i.id === detailsId) ?? null
  const detailsType = itemTypes?.find((t) => t.id === detailsItem?.item_type_id)

  function selectItem(id: string | null) {
    setSelectedId(id)
  }

  // Opening details also selects the item, so the structure toolbar above
  // reflects whatever you're currently looking at.
  function openDetails(id: string) {
    setSelectedId(id)
    setDetailsId(id)
  }

  if (isLoading) return <div className="p-6 text-slate-500">Loading tree…</div>

  return (
    <div className={compact ? 'flex h-full flex-col' : 'flex h-full'}>
      <div className={`flex-1 overflow-auto ${compact ? 'p-3' : 'p-6'}`}>
        {!compact && (
          <div className="mb-4 flex items-center justify-between">
            <h1 className="text-lg font-semibold text-slate-800">Tree View</h1>
            <button
              onClick={() => setAddingRoot(true)}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              + Add root item
            </button>
          </div>
        )}

        {addingRoot && itemTypes && (
          <AddItemForm
            documentId={documentId}
            parentId={null}
            itemTypes={itemTypes}
            onDone={() => setAddingRoot(false)}
          />
        )}

        <div className="flex flex-wrap items-start justify-between gap-2">
          <StructureLockBar documentId={documentId} />
          <label className="flex items-center gap-1 text-xs text-slate-500">
            <input type="checkbox" checked={showObsolete} onChange={(e) => setShowObsolete(e.target.checked)} />
            Show obsolete
          </label>
        </div>
        <ItemStructureToolbar selectedItem={selectedItem} allItems={allItems} itemTypes={itemTypes} />

        <div className="rounded-lg border border-slate-200 bg-white p-2">
          {compact && (
            <button
              onClick={() => setAddingRoot((v) => !v)}
              className="mb-1 w-full rounded-md border border-dashed border-slate-300 py-1 text-xs text-slate-400 hover:border-blue-400 hover:text-blue-600"
            >
              + Add root item
            </button>
          )}
          {tree?.map((item) => (
            <TreeNode
              key={item.id}
              item={item}
              depth={0}
              documentId={documentId}
              itemTypes={itemTypes}
              allItems={allItems}
              selectedId={selectedId}
              onSelect={selectItem}
              onOpenDetails={openDetails}
              addingChildOf={addingChildOf}
              setAddingChildOf={setAddingChildOf}
              insertBelowId={insertBelowId}
              setInsertBelowId={setInsertBelowId}
            />
          ))}
          {tree?.length === 0 && (
            <p className="p-4 text-sm text-slate-400">No items yet — add the first one above.</p>
          )}
        </div>
      </div>

      {detailsItem && detailsType && itemTypes && linkTypes && (
        <ItemDetailPanel
          key={detailsItem.id}
          item={detailsItem}
          itemType={detailsType}
          itemTypes={itemTypes}
          linkTypes={linkTypes}
          allItems={allItems}
          onClose={() => setDetailsId(null)}
          orgId={orgId}
          compact={compact}
        />
      )}
    </div>
  )
}
