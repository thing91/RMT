import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { pl } from './pl'

export type Lang = 'pl' | 'en'
const STORAGE_KEY = 'rmt_lang'

/** Translate an English UI string. The English text *is* the key, so a
 * string without a Polish entry simply stays English (never blank).
 * `{name}` placeholders are filled from `vars`. Requirement content
 * (titles, descriptions) is never translated — only the interface. */
export type T = (text: string, vars?: Record<string, string | number>) => string

interface I18n {
  lang: Lang
  setLang: (lang: Lang) => void
  t: T
}

function fill(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m))
}

function initialLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'pl' || stored === 'en') return stored
  } catch {
    // storage blocked — fall through to the default
  }
  return 'pl'
}

const Ctx = createContext<I18n>({ lang: 'en', setLang: () => undefined, t: fill })

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang)
  const setLang = useCallback((next: Lang) => {
    setLangState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // not persisted — still switches for this session
    }
    document.documentElement.lang = next
  }, [])
  const t = useCallback<T>((text, vars) => fill(lang === 'pl' ? (pl[text] ?? text) : text, vars), [lang])
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useI18n(): I18n {
  return useContext(Ctx)
}

export function useT(): T {
  return useContext(Ctx).t
}

/** Polish plural forms: 1 wymaganie, 2–4 wymagania, 5+ wymagań; English
 * just uses one/other. */
export function plural(lang: Lang, n: number, one: string, few: string, many: string, enOne?: string, enMany?: string) {
  if (lang === 'en') return `${n} ${n === 1 ? (enOne ?? one) : (enMany ?? many)}`
  const mod10 = n % 10
  const mod100 = n % 100
  const form = n === 1 ? one : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? few : many
  return `${n} ${form}`
}

/** "3 min temu" / "3 min ago" without a library. */
export function timeAgo(lang: Lang, iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  const pick = (pl: string, en: string) => (lang === 'pl' ? pl : en)
  if (s < 60) return pick('przed chwilą', 'just now')
  if (s < 3600) return pick(`${Math.round(s / 60)} min temu`, `${Math.round(s / 60)} min ago`)
  if (s < 86400) return pick(`${Math.round(s / 3600)} godz. temu`, `${Math.round(s / 3600)} h ago`)
  const d = Math.round(s / 86400)
  if (d < 30) return pick(`${d} dn. temu`, `${d} d ago`)
  return new Date(iso).toLocaleDateString(lang === 'pl' ? 'pl-PL' : 'en-GB')
}
