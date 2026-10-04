import type { ReactNode } from 'react'
import { useCreateItem, useUpdateItem } from '../api/hooks'
import type { Item, ItemType } from '../api/types'
import { useItemClipboard } from '../structure/ItemClipboardContext'

/** Is `candidateId` the same as, or a descendant of, `ancestorId`? Used to
 * stop a paste (or indent) from nesting an item inside its own subtree. */
function isSelfOrDescendant(allItems: Item[], candidateId: string, ancestorId: string): boolean {
  if (candidateId === ancestorId) return true
  let current = allItems.find((i) => i.id === candidateId)
  while (current?.parent_id) {
    if (current.parent_id === ancestorId) return true
    current = allItems.find((i) => i.id === current!.parent_id)
  }
  return false
}

interface Props {
  selectedItem: Item | null
  allItems: Item[]
  itemTypes: ItemType[] | undefined
  /** Extra controls (e.g. Table View's search box) rendered at the start of
   * this same bar, so a view-specific control doesn't need its own row. */
  extra?: ReactNode
}

/** ReqView-style structure toolbar: reorder siblings, promote/demote
 * nesting level, and cut/copy + paste to relocate or duplicate an item
 * (with its whole subtree) elsewhere. Acts on the current selection rather
 * than per-row buttons, matching ReqView's top-of-screen toolbar. Rendered
 * in both Tree View and Table View — the clipboard lives in
 * ItemClipboardContext (provided above both) so it survives switching
 * between them. */
export default function ItemStructureToolbar({ selectedItem, allItems, itemTypes, extra }: Props) {
  const updateItem = useUpdateItem()
  const { clipboard, setClipboard } = useItemClipboard()
  // Only meaningfully used once a paste actually fires (guarded by
  // canPaste/selectedItem checks below) — the empty-string fallback here
  // never reaches a real request.
  const createItem = useCreateItem(selectedItem?.document_id ?? '')

  const siblings = selectedItem
    ? allItems
        .filter(
          (i) => i.parent_id === selectedItem.parent_id && i.document_id === selectedItem.document_id,
        )
        .sort((a, b) => a.order - b.order)
    : []
  const idx = selectedItem ? siblings.findIndex((s) => s.id === selectedItem.id) : -1
  const parent = selectedItem ? allItems.find((i) => i.id === selectedItem.parent_id) : undefined
  const prevSibling = idx > 0 ? siblings[idx - 1] : undefined
  const prevSiblingType = prevSibling ? itemTypes?.find((t) => t.id === prevSibling.item_type_id) : undefined

  const canMoveUp = idx > 0
  const canMoveDown = idx !== -1 && idx < siblings.length - 1
  const canOutdent = !!selectedItem?.parent_id
  const canIndent = !!prevSibling && prevSiblingType?.behavior === 'structural'

  const clipboardItem = clipboard ? allItems.find((i) => i.id === clipboard.id) : undefined
  // A cut item can only be reparented within its own document (the update
  // endpoint has no way to change document_id); a copy is a fresh create in
  // whatever document the paste target belongs to, so it's unrestricted.
  const crossDocumentCutBlocked =
    !!selectedItem &&
    !!clipboardItem &&
    clipboard?.mode === 'cut' &&
    clipboardItem.document_id !== selectedItem.document_id
  const canPaste =
    !!selectedItem &&
    !!clipboardItem &&
    !!clipboard &&
    !crossDocumentCutBlocked &&
    (clipboard.mode === 'copy'
      ? selectedItem.id !== clipboardItem.id
      : !isSelfOrDescendant(allItems, selectedItem.id, clipboardItem.id))

  function moveBy(dir: -1 | 1) {
    if (!selectedItem) return
    const targetIdx = idx + dir
    if (targetIdx < 0 || targetIdx >= siblings.length) return
    const other = siblings[targetIdx]
    updateItem.mutate({ id: selectedItem.id, payload: { order: other.order } })
    updateItem.mutate({ id: other.id, payload: { order: selectedItem.order } })
  }

  function outdent() {
    if (!selectedItem || !parent) return
    const grandparentId = parent.parent_id
    const gpSiblings = allItems
      .filter((i) => i.parent_id === grandparentId && i.document_id === selectedItem.document_id)
      .sort((a, b) => a.order - b.order)
    const parentIdx = gpSiblings.findIndex((s) => s.id === parent.id)
    gpSiblings
      .slice(parentIdx + 1)
      .forEach((s) => updateItem.mutate({ id: s.id, payload: { order: s.order + 1 } }))
    updateItem.mutate({
      id: selectedItem.id,
      payload: { parent_id: grandparentId, order: parent.order + 1 },
    })
  }

  function indent() {
    if (!selectedItem || !prevSibling || !canIndent) return
    const newSiblings = allItems.filter((i) => i.parent_id === prevSibling.id)
    const order = newSiblings.length > 0 ? Math.max(...newSiblings.map((c) => c.order)) + 1 : 0
    updateItem.mutate({ id: selectedItem.id, payload: { parent_id: prevSibling.id, order } })
  }

  function toggleClipboard(mode: 'cut' | 'copy') {
    if (!selectedItem) return
    setClipboard(
      clipboard?.id === selectedItem.id && clipboard.mode === mode
        ? null
        : { id: selectedItem.id, mode },
    )
  }

  const selectedType = selectedItem
    ? itemTypes?.find((t) => t.id === selectedItem.item_type_id)
    : undefined

  /** Recursively recreates `source` (and its children, in order) under
   * `newParentId` — a copy gets fresh server-assigned ids/keys, so children
   * have to be created one at a time, each waiting for its new parent's id. */
  async function duplicateSubtree(
    source: Item,
    newParentId: string | null,
    order: number,
    isRoot: boolean,
  ) {
    const created = await createItem.mutateAsync({
      item_type_id: source.item_type_id,
      parent_id: newParentId,
      title: isRoot ? `${source.title} (Copy)` : source.title,
      description_md: source.description_md ?? undefined,
      attributes: source.attributes,
      order,
    })
    const children = allItems
      .filter((i) => i.parent_id === source.id)
      .sort((a, b) => a.order - b.order)
    for (let i = 0; i < children.length; i++) {
      await duplicateSubtree(children[i], created.id, i, false)
    }
  }

  // Pasting onto a Section drops the item inside it (as its last child) —
  // pasting onto a content item places it right after, as a new sibling.
  // Otherwise there'd be no way to paste something into an empty chapter.
  async function pasteOnSelected() {
    if (!selectedItem || !clipboard || !clipboardItem || !canPaste) return

    if (selectedType?.behavior === 'structural') {
      const children = allItems.filter(
        (i) => i.parent_id === selectedItem.id && i.id !== clipboardItem.id,
      )
      const order = children.length > 0 ? Math.max(...children.map((c) => c.order)) + 1 : 0
      if (clipboard.mode === 'copy') {
        await duplicateSubtree(clipboardItem, selectedItem.id, order, true)
      } else {
        updateItem.mutate({ id: clipboardItem.id, payload: { parent_id: selectedItem.id, order } })
      }
    } else {
      const targetSiblings = allItems
        .filter(
          (i) =>
            i.parent_id === selectedItem.parent_id &&
            i.document_id === selectedItem.document_id &&
            i.id !== clipboardItem.id,
        )
        .sort((a, b) => a.order - b.order)
      const anchorIdx = targetSiblings.findIndex((s) => s.id === selectedItem.id)
      targetSiblings
        .slice(anchorIdx + 1)
        .forEach((s) => updateItem.mutate({ id: s.id, payload: { order: s.order + 1 } }))
      if (clipboard.mode === 'copy') {
        await duplicateSubtree(clipboardItem, selectedItem.parent_id, selectedItem.order + 1, true)
      } else {
        updateItem.mutate({
          id: clipboardItem.id,
          payload: { parent_id: selectedItem.parent_id, order: selectedItem.order + 1 },
        })
      }
    }

    // A cut is consumed by one paste; a copy stays on the clipboard so the
    // same item can be pasted again elsewhere.
    if (clipboard.mode === 'cut') setClipboard(null)
  }

  const btnClass = (enabled: boolean) =>
    `flex h-7 w-7 items-center justify-center rounded-md border text-sm ${
      enabled
        ? 'border-slate-300 text-slate-600 hover:bg-slate-100'
        : 'cursor-not-allowed border-slate-100 text-slate-300'
    }`

  const pasteTitle = crossDocumentCutBlocked
    ? "Cut items can't move to a different document — use Copy instead"
    : selectedType?.behavior === 'structural'
      ? clipboard?.mode === 'copy'
        ? 'Paste — duplicate the copied item inside this section'
        : 'Paste — move the cut item inside this section'
      : clipboard?.mode === 'copy'
        ? 'Paste — duplicate the copied item right after the selected one'
        : 'Paste — insert the cut item right after the selected one'

  return (
    <div className="mb-2 flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white px-1.5 py-1.5">
      {extra && (
        <>
          {extra}
          <span className="mx-1 h-5 w-px bg-slate-200" />
        </>
      )}
      <span className="mr-1 truncate text-xs text-slate-400">
        {selectedItem
          ? `Selected: ${selectedItem.key ?? selectedItem.title}`
          : 'Select an item below to reorder, nest, or move it'}
      </span>
      <button
        title="Move up"
        disabled={!canMoveUp}
        onClick={() => moveBy(-1)}
        className={btnClass(canMoveUp)}
      >
        ↑
      </button>
      <button
        title="Move down"
        disabled={!canMoveDown}
        onClick={() => moveBy(1)}
        className={btnClass(canMoveDown)}
      >
        ↓
      </button>
      <button
        title="Outdent — move up one nesting level"
        disabled={!canOutdent}
        onClick={outdent}
        className={btnClass(canOutdent)}
      >
        ⇤
      </button>
      <button
        title={
          canIndent
            ? 'Indent — nest under the previous item'
            : prevSibling
              ? 'Can only nest under a Section'
              : 'No previous item to nest under'
        }
        disabled={!canIndent}
        onClick={indent}
        className={btnClass(canIndent)}
      >
        ⇥
      </button>
      <span className="mx-1 h-5 w-px bg-slate-200" />
      <button
        title="Copy — pick a new position, then Paste to duplicate it there"
        disabled={!selectedItem}
        onClick={() => toggleClipboard('copy')}
        className={
          selectedItem && clipboard?.id === selectedItem.id && clipboard.mode === 'copy'
            ? 'flex h-7 w-7 items-center justify-center rounded-md border border-blue-300 bg-blue-100 text-sm text-blue-700'
            : btnClass(!!selectedItem)
        }
      >
        ⧉
      </button>
      <button
        title="Cut — pick a new position, then Paste to move it there"
        disabled={!selectedItem}
        onClick={() => toggleClipboard('cut')}
        className={
          selectedItem && clipboard?.id === selectedItem.id && clipboard.mode === 'cut'
            ? 'flex h-7 w-7 items-center justify-center rounded-md border border-amber-300 bg-amber-100 text-sm text-amber-700'
            : btnClass(!!selectedItem)
        }
      >
        ✂
      </button>
      <button title={pasteTitle} disabled={!canPaste} onClick={pasteOnSelected} className={btnClass(canPaste)}>
        📋
      </button>
      {clipboardItem && clipboard && (
        <span className={clipboard.mode === 'copy' ? 'text-xs text-blue-600' : 'text-xs text-amber-600'}>
          {clipboard.mode === 'copy' ? 'Copied' : 'Cut'}: {clipboardItem.key ?? clipboardItem.title} — select
          where it should go, then press Paste
        </span>
      )}
    </div>
  )
}
