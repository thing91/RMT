import { useRef, useState, type ReactNode } from 'react'
import { apiErrorMessage, apiStatus } from '../../api/client'
import { useSaveItemContent } from '../../api/collabHooks'
import type { Item } from '../../api/types'
import { useT } from '../../i18n'
import { focusAtEnd } from '../../structure/itemOrdering'
import { useEditSession } from './useEditSession'

/** Edit-in-place for one item: `begin()` takes the item's edit lock (so
 * others see who is editing), `commit()` saves with If-Match against the
 * version you started from and releases the lock, `cancel()` just releases.
 * There is no separate Edit/Save step — start typing, click away, done. */
export function useItemInlineSave(item: Item) {
  const t = useT()
  const session = useEditSession(item.id)
  const save = useSaveItemContent()
  const etagRef = useRef<string | null>(null)

  async function begin(): Promise<boolean> {
    const result = await session.start()
    if (result.ok) {
      etagRef.current = item.etag
      return true
    }
    window.alert(
      result.heldBy
        ? t('{name} is editing this right now.', { name: result.heldBy.user_name })
        : apiErrorMessage(result.error, t('Could not start editing.')),
    )
    return false
  }

  async function commit(payload: Partial<Item>) {
    try {
      if (Object.keys(payload).length > 0) {
        await save.mutateAsync({ id: item.id, etag: etagRef.current ?? item.etag ?? `"${item.id}:${item.version}"`, payload })
      }
    } catch (err) {
      window.alert(
        apiStatus(err) === 412
          ? t('Someone else changed this while you were editing — reloaded the latest version.')
          : apiErrorMessage(err, t('Could not save.')),
      )
    } finally {
      etagRef.current = null
      await session.stop()
    }
  }

  async function cancel() {
    etagRef.current = null
    await session.stop()
  }

  return { begin, commit, cancel, saving: save.isPending }
}

/** Text that turns into an input in place. `trigger` is how editing starts:
 * a double-click in the document (a single click there selects the row and
 * opens its details) or a single click in the details panel. Not editable →
 * exactly the display markup, nothing else. */
export function InlineEditField({
  value,
  editable,
  onBegin,
  onSave,
  onCancel,
  multiline,
  trigger = 'dblclick',
  placeholder,
  inputClassName,
  children,
}: {
  value: string
  editable: boolean
  onBegin: () => Promise<boolean>
  onSave: (next: string) => void
  onCancel: () => void
  multiline?: boolean
  trigger?: 'click' | 'dblclick'
  placeholder?: string
  inputClassName?: string
  children?: ReactNode
}) {
  const t = useT()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const busy = useRef(false)

  if (!editable) return <>{children ?? value}</>

  async function start() {
    if (busy.current || editing) return
    busy.current = true
    try {
      if (await onBegin()) {
        setDraft(value)
        setEditing(true)
      }
    } finally {
      busy.current = false
    }
  }
  function commit() {
    setEditing(false)
    if (draft !== value) onSave(draft)
    else onCancel()
  }
  function cancel() {
    setEditing(false)
    setDraft(value)
    onCancel()
  }

  if (editing) {
    return multiline ? (
      <textarea
        ref={focusAtEnd}
        autoFocus
        rows={Math.min(12, Math.max(3, draft.split('\n').length + 1))}
        className={`w-full rounded-md border border-blue-400 px-2 py-1.5 text-sm focus:outline-none ${inputClassName ?? ''}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Escape' && cancel()}
        onClick={(e) => e.stopPropagation()}
      />
    ) : (
      <input
        ref={focusAtEnd}
        autoFocus
        className={`w-full rounded-md border border-blue-400 px-2 py-1 focus:outline-none ${inputClassName ?? ''}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') cancel()
        }}
        onClick={(e) => e.stopPropagation()}
      />
    )
  }

  const hint = trigger === 'dblclick' ? t('Double-click to edit') : t('Click to edit')
  return (
    <div
      onClick={trigger === 'click' ? start : undefined}
      onDoubleClick={
        trigger === 'dblclick'
          ? (e) => {
              e.stopPropagation()
              window.getSelection()?.removeAllRanges()
              start()
            }
          : undefined
      }
      title={hint}
      className="-mx-1 cursor-text rounded px-1 hover:bg-amber-50/70"
    >
      {children ?? value}
      {!value && <span className="text-sm text-slate-300">{placeholder ?? hint}</span>}
    </div>
  )
}
