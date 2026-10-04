import { useRef, useState, type KeyboardEvent } from 'react'
import type { OrgUser } from '../api/types'

interface Props {
  value: string
  onChange: (value: string) => void
  users: OrgUser[]
  placeholder?: string
  rows?: number
  autoFocus?: boolean
  className?: string
}

/** A trigger match is "@" followed by non-whitespace, with either nothing
 * or whitespace right before the "@" — so "foo@bar" doesn't trigger but
 * "hi @bar" does, same rule most mention pickers use. */
function findMentionQuery(text: string, cursor: number): { atIndex: number; query: string } | null {
  const upToCursor = text.slice(0, cursor)
  const match = upToCursor.match(/(?:^|\s)@([A-Za-z0-9_.-]*)$/)
  if (!match) return null
  const atIndex = upToCursor.lastIndexOf('@')
  return { atIndex, query: match[1] }
}

/** Textarea with GitHub/Slack-style "@" autocomplete against the org
 * directory (§ user request) — picking a suggestion inserts "@username "
 * so the backend's plain-text mention parser (app/services/mentions.py)
 * can find it later; there's no rich-text mention "chip" to keep in sync. */
export default function MentionTextarea({
  value,
  onChange,
  users,
  placeholder,
  rows = 2,
  autoFocus,
  className,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [mention, setMention] = useState<{ atIndex: number; query: string } | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)

  const suggestions = mention
    ? users
        .filter(
          (u) =>
            u.username.toLowerCase().includes(mention.query.toLowerCase()) ||
            u.display_name.toLowerCase().includes(mention.query.toLowerCase()),
        )
        .slice(0, 6)
    : []
  const isOpen = mention !== null && suggestions.length > 0

  function updateMentionState(text: string, cursor: number) {
    const next = findMentionQuery(text, cursor)
    setMention(next)
    setActiveIndex(0)
  }

  function selectUser(user: OrgUser) {
    if (!mention || !textareaRef.current) return
    const cursor = textareaRef.current.selectionStart
    const before = value.slice(0, mention.atIndex)
    const after = value.slice(cursor)
    const inserted = `@${user.username} `
    const next = `${before}${inserted}${after}`
    onChange(next)
    setMention(null)
    requestAnimationFrame(() => {
      const pos = before.length + inserted.length
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(pos, pos)
    })
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (!isOpen) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length)
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      selectUser(suggestions[activeIndex])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setMention(null)
    }
  }

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        autoFocus={autoFocus}
        className={
          className ??
          'w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none'
        }
        rows={rows}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          updateMentionState(e.target.value, e.target.selectionStart)
        }}
        onKeyDown={handleKeyDown}
        onClick={(e) => updateMentionState(value, e.currentTarget.selectionStart)}
        onBlur={() => setTimeout(() => setMention(null), 100)}
      />
      {isOpen && (
        <ul className="absolute left-0 top-full z-10 mt-1 w-56 max-w-full rounded-md border border-slate-200 bg-white py-1 shadow-lg">
          {suggestions.map((u, i) => (
            <li key={u.id}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  selectUser(u)
                }}
                className={`flex w-full flex-col px-2.5 py-1 text-left text-xs ${
                  i === activeIndex ? 'bg-blue-50' : 'hover:bg-slate-50'
                }`}
              >
                <span className="font-medium text-slate-700">{u.display_name}</span>
                <span className="text-slate-400">@{u.username}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
