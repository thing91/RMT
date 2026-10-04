import { QueryClient } from '@tanstack/react-query'
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { EditLock } from '../../api/types'
import { renderWithApp } from '../../test/render'
import { DocumentPresence, ItemPresence, initials, lockTitle, userColor } from './PresenceAvatar'

const now = new Date()
const future = new Date(now.getTime() + 600_000).toISOString()

function lock(partial: Partial<EditLock>): EditLock {
  return {
    scope: 'item',
    target_id: 'i1',
    document_id: 'd1',
    user_id: 'u-anna',
    user_name: 'Anna Nowak',
    acquired_at: now.toISOString(),
    expires_at: future,
    implicit: false,
    ...partial,
  }
}

function withLocks(locks: EditLock[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  client.setQueryData(['project-locks', 'p1'], locks)
  return client
}

describe('presence helpers', () => {
  it('gives each person a stable color and initials', () => {
    expect(userColor('u-anna')).toBe(userColor('u-anna'))
    expect(initials('Anna Nowak')).toBe('AN')
    expect(initials('admin')).toBe('A')
  })

  it('describes item and structure locks', () => {
    expect(lockTitle(lock({}), false, 'SYS-008')).toMatch(/^Anna Nowak — editing SYS-008/)
    expect(lockTitle(lock({ scope: 'structure' }), false)).toMatch(/reorganizing this document/)
    expect(lockTitle(lock({ scope: 'structure', implicit: true }), true)).toMatch(/^You — moving items/)
  })
})

describe('ItemPresence', () => {
  it('shows an avatar only for the locked item', () => {
    const client = withLocks([lock({ target_id: 'i1' })])
    renderWithApp(
      <>
        <ItemPresence itemId="i1" label="SYS-001" />
        <ItemPresence itemId="i2" label="SYS-002" />
      </>,
      { client },
    )
    const avatars = screen.getAllByRole('img')
    expect(avatars).toHaveLength(1)
    expect(avatars[0].getAttribute('title')).toMatch(/editing SYS-001/)
    expect(avatars[0].textContent).toContain('AN')
  })

  it('ignores expired leases', () => {
    const client = withLocks([lock({ expires_at: new Date(now.getTime() - 1000).toISOString() })])
    renderWithApp(<ItemPresence itemId="i1" />, { client })
    expect(screen.queryByRole('img')).toBeNull()
  })
})

describe('DocumentPresence', () => {
  it('shows one avatar per person in the document, preferring their structure lock', () => {
    const client = withLocks([
      lock({ target_id: 'i1' }),
      lock({ target_id: 'i2' }),
      lock({ scope: 'structure', target_id: 'd1' }),
      lock({ target_id: 'i3', user_id: 'u-bob', user_name: 'Bob Kowalski' }),
      lock({ target_id: 'i9', document_id: 'other', user_id: 'u-eve', user_name: 'Eve' }),
    ])
    renderWithApp(<DocumentPresence documentId="d1" />, { client })
    const titles = screen.getAllByRole('img').map((a) => a.getAttribute('title'))
    expect(titles).toHaveLength(2)
    expect(titles[0]).toMatch(/Anna Nowak — reorganizing/)
    expect(titles[1]).toMatch(/Bob Kowalski — editing 1 item/)
  })
})
