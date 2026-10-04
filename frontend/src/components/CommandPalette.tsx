import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { linkFor, useSearch, type SearchHit } from '../api/workspaceHooks'
import { useT } from '../i18n'

const GROUPS: { kind: SearchHit['kind']; label: string }[] = [
  { kind: 'item', label: 'Requirements' },
  { kind: 'document', label: 'Documents' },
  { kind: 'review', label: 'Reviews' },
  { kind: 'suggestion', label: 'Change suggestions' },
  { kind: 'project', label: 'Projects' },
]

/** The search box in the top bar. Ctrl+K / ⌘K focuses it from anywhere.
 * Searches the current project (or every readable project outside one);
 * Enter opens the hit — a requirement opens in its document with the
 * details panel. */
export default function CommandPalette() {
  const t = useT()
  const navigate = useNavigate()
  const { projectId } = useParams<{ projectId?: string }>()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const { data: hits, isFetching } = useSearch(debounced, projectId)

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(q), 150)
    return () => window.clearTimeout(id)
  }, [q])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(true)
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const ordered = useMemo(() => {
    const list: SearchHit[] = []
    for (const g of GROUPS) list.push(...(hits ?? []).filter((h) => h.kind === g.kind))
    return list
  }, [hits])

  useEffect(() => setActive(0), [debounced])

  function go(hit: SearchHit) {
    navigate(linkFor(hit))
    setOpen(false)
    setQ('')
    inputRef.current?.blur()
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, ordered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter' && ordered[active]) {
      e.preventDefault()
      go(ordered[active])
    } else if (e.key === 'Escape') {
      setOpen(false)
      inputRef.current?.blur()
    }
  }

  const showList = open && q.trim().length >= 2
  let index = -1
  return (
    <div className="relative w-full max-w-md">
      <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 focus-within:border-blue-400 focus-within:bg-white">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-slate-400" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKeyDown}
          placeholder={t('Search requirements, documents, reviews…')}
          aria-label={t('Search…')}
          className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
        />
        <kbd className="hidden shrink-0 rounded border border-b-2 border-slate-200 bg-white px-1 font-mono text-[10px] text-slate-400 sm:block">
          Ctrl K
        </kbd>
      </div>
      {showList && (
        <div className="absolute left-0 right-0 z-40 mt-1 max-h-[70vh] overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl">
          {ordered.length === 0 && (
            <p className="px-3 py-4 text-center text-sm text-slate-400">{isFetching ? t('Loading…') : t('No results.')}</p>
          )}
          {GROUPS.map((g) => {
            const group = ordered.filter((h) => h.kind === g.kind)
            if (group.length === 0) return null
            return (
              <div key={g.kind}>
                <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{t(g.label)}</div>
                {group.map((h) => {
                  index += 1
                  const i = index
                  return (
                    <button
                      key={`${h.kind}-${h.id}`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => go(h)}
                      onMouseEnter={() => setActive(i)}
                      className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm ${i === active ? 'bg-blue-50' : ''}`}
                    >
                      {h.key && <span className="shrink-0 font-mono text-xs text-slate-500">{h.key}</span>}
                      <span className="min-w-0 flex-1 truncate text-slate-800">{h.title}</span>
                      {h.subtitle && <span className="shrink-0 truncate text-xs text-slate-400">{h.subtitle}</span>}
                    </button>
                  )
                })}
              </div>
            )
          })}
          <div className="mt-1 border-t border-slate-100 px-3 pt-1.5 text-[11px] text-slate-400">
            ↵ {t('open')} · ↑↓ {t('select')} · Esc {t('close')}
          </div>
        </div>
      )}
    </div>
  )
}
