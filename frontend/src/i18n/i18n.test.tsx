import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LanguageProvider, plural, timeAgo, useI18n } from '.'
import { pl } from './pl'

function Probe() {
  const { t, lang, setLang } = useI18n()
  return (
    <div>
      <span data-testid="lang">{lang}</span>
      <span data-testid="text">{t('Approved by {name}', { name: 'Anna' })}</span>
      <span data-testid="untranslated">{t('Some brand-new string')}</span>
      <button onClick={() => setLang(lang === 'pl' ? 'en' : 'pl')}>switch</button>
    </div>
  )
}

afterEach(() => localStorage.clear())

describe('i18n', () => {
  it('defaults to Polish, fills placeholders and falls back to English', () => {
    render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    )
    expect(screen.getByTestId('lang').textContent).toBe('pl')
    expect(screen.getByTestId('text').textContent).toBe('Zatwierdził(a): Anna')
    expect(screen.getByTestId('untranslated').textContent).toBe('Some brand-new string')
  })

  it('switches to English and remembers the choice', () => {
    render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    )
    act(() => screen.getByText('switch').click())
    expect(screen.getByTestId('text').textContent).toBe('Approved by Anna')
    expect(localStorage.getItem('rmt_lang')).toBe('en')
  })

  it('starts in the remembered language', () => {
    localStorage.setItem('rmt_lang', 'en')
    render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    )
    expect(screen.getByTestId('lang').textContent).toBe('en')
  })

  it('uses Polish plural forms', () => {
    expect(plural('pl', 1, 'wymaganie', 'wymagania', 'wymagań')).toBe('1 wymaganie')
    expect(plural('pl', 3, 'wymaganie', 'wymagania', 'wymagań')).toBe('3 wymagania')
    expect(plural('pl', 5, 'wymaganie', 'wymagania', 'wymagań')).toBe('5 wymagań')
    expect(plural('pl', 12, 'wymaganie', 'wymagania', 'wymagań')).toBe('12 wymagań')
    expect(plural('pl', 22, 'wymaganie', 'wymagania', 'wymagań')).toBe('22 wymagania')
    expect(plural('en', 1, 'x', 'y', 'z', 'item', 'items')).toBe('1 item')
    expect(plural('en', 2, 'x', 'y', 'z', 'item', 'items')).toBe('2 items')
  })

  it('formats relative times', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-05T12:00:00Z'))
    expect(timeAgo('pl', '2026-10-05T11:59:30Z')).toBe('przed chwilą')
    expect(timeAgo('pl', '2026-10-05T11:45:00Z')).toBe('15 min temu')
    expect(timeAgo('en', '2026-10-05T09:00:00Z')).toBe('3 h ago')
    expect(timeAgo('pl', '2026-10-02T12:00:00Z')).toBe('3 dn. temu')
    vi.useRealTimers()
  })

  it('has no empty translations', () => {
    const empty = Object.entries(pl).filter(([, v]) => !v.trim())
    expect(empty).toEqual([])
  })

  it('keeps placeholders in translations', () => {
    const broken = Object.entries(pl).filter(([k, v]) => {
      const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
      return names(k) !== names(v)
    })
    expect(broken).toEqual([])
  })
})
