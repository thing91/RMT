import type { Item } from '../api/types'

/** `autoFocus` alone leaves the caret at the start of any pre-filled value
 * (browsers don't move it to the end) — for an inline "edit in place" field
 * that's a trap: typing immediately would insert before the existing text
 * instead of appending. Shared by every inline-rename control (Tree View's
 * title, Document View's title/description/attributes). */
export function focusAtEnd(el: HTMLInputElement | HTMLTextAreaElement | null) {
  if (!el) return
  el.focus()
  const len = el.value.length
  el.setSelectionRange(len, len)
}

/** Computes the order value for a new item inserted directly after
 * `afterItem` among its siblings, plus the order-shift patches every later
 * sibling needs first so nothing collides (§4.3 ordering has no gaps built
 * in, so a real "insert here" has to renumber, not just append). */
export function planInsertAfter(allItems: Item[], afterItem: Item) {
  const siblings = allItems
    .filter((i) => i.parent_id === afterItem.parent_id)
    .sort((a, b) => a.order - b.order)
  const idx = siblings.findIndex((s) => s.id === afterItem.id)
  const shifts = siblings.slice(idx + 1).map((s) => ({ id: s.id, order: s.order + 1 }))
  return { order: afterItem.order + 1, shifts }
}
