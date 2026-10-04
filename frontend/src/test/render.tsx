import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from '../auth/AuthContext'

/** Render inside the app's providers, at a route with :projectId, with a
 * query cache that can be pre-filled. */
export function renderWithApp(
  ui: ReactNode,
  { projectId = 'p1', client }: { projectId?: string; client?: QueryClient } = {},
) {
  const qc = client ?? new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  const result = render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <MemoryRouter initialEntries={[`/projects/${projectId}`]}>
          <Routes>
            <Route path="/projects/:projectId" element={ui} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
  return { ...result, qc }
}
