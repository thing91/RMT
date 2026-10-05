import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import { AuthProvider, useAuth } from './AuthContext'

let calls = 0

function Projects() {
  const { login, logout } = useAuth()
  const { data } = useQuery({
    queryKey: ['projects', 'org'],
    queryFn: async () => {
      calls += 1
      return localStorage.getItem('rmt_token') ? ['Private project'] : []
    },
  })
  return (
    <div>
      <span data-testid="projects">{(data ?? []).join(',') || 'none'}</span>
      <button onClick={() => login('admin', 'x')}>login</button>
      <button onClick={logout}>logout</button>
    </div>
  )
}

afterEach(() => {
  localStorage.clear()
  calls = 0
})

describe('AuthProvider', () => {
  // Regression: after signing in, the project list kept the anonymous result
  // until a manual reload.
  it('refetches everything after signing in and after signing out', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({ data: { access_token: 'tok' } })
    vi.spyOn(api, 'get').mockResolvedValue({ data: { id: 'u1', username: 'admin', display_name: 'Admin' } })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <Projects />
        </AuthProvider>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('projects').textContent).toBe('none'))

    await act(async () => screen.getByText('login').click())
    await waitFor(() => expect(screen.getByTestId('projects').textContent).toBe('Private project'))
    expect(localStorage.getItem('rmt_token')).toBe('tok')

    await act(async () => screen.getByText('logout').click())
    await waitFor(() => expect(screen.getByTestId('projects').textContent).toBe('none'))
    expect(calls).toBeGreaterThanOrEqual(3)
  })
})
