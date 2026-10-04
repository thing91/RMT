import { useState, type FormEvent } from 'react'
import { apiErrorMessage } from '../api/client'
import { useCreateItem } from '../api/hooks'
import type { ItemType } from '../api/types'

interface Props {
  documentId: string
  parentId: string | null
  itemTypes: ItemType[]
  onDone: () => void
  /** Explicit insertion position — callers doing a "insert below this row"
   * action pass one; the plain "append at the end" callers (root/child add
   * buttons) leave it unset and the backend appends. */
  order?: number
  /** Runs (and is awaited) before the create call — used to renumber later
   * siblings first so a positional insert doesn't collide with them. */
  onBeforeCreate?: () => Promise<void>
}

export default function AddItemForm({
  documentId,
  parentId,
  itemTypes,
  onDone,
  order,
  onBeforeCreate,
}: Props) {
  const createItem = useCreateItem(documentId)
  const [itemTypeId, setItemTypeId] = useState(itemTypes[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim() || !itemTypeId) return
    setError(null)
    setSubmitting(true)
    try {
      await onBeforeCreate?.()
      await createItem.mutateAsync({ item_type_id: itemTypeId, parent_id: parentId, title, order })
      onDone()
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not create this item.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      className="my-1 flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 p-2"
    >
      <select
        className="rounded-md border border-slate-300 px-2 py-1 text-xs"
        value={itemTypeId}
        onChange={(e) => setItemTypeId(e.target.value)}
      >
        {itemTypes.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <input
        autoFocus
        className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs"
        placeholder="Title…"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        Add
      </button>
      <button type="button" onClick={onDone} className="text-xs text-slate-400 hover:text-slate-700">
        Cancel
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </form>
  )
}
