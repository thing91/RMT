import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, TOKEN_STORAGE_KEY } from '../api/client'
import type { User } from '../api/types'

interface AuthState {
  user: User | null
  isLoading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  // Everything cached so far was fetched as the previous identity (or
  // anonymously) — after signing in or out, refetch it all as the new one.
  const queryClient = useQueryClient()

  const loadMe = useCallback(async () => {
    try {
      const { data } = await api.get<User>('/auth/me')
      setUser(data)
    } catch {
      localStorage.removeItem(TOKEN_STORAGE_KEY)
      setUser(null)
    }
  }, [])

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY)
    if (!token) {
      setIsLoading(false)
      return
    }
    loadMe().finally(() => setIsLoading(false))
  }, [loadMe])

  async function login(username: string, password: string) {
    const { data } = await api.post<{ access_token: string }>('/auth/login', {
      username,
      password,
    })
    localStorage.setItem(TOKEN_STORAGE_KEY, data.access_token)
    await loadMe()
    await queryClient.resetQueries()
  }

  function logout() {
    localStorage.removeItem(TOKEN_STORAGE_KEY)
    setUser(null)
    queryClient.resetQueries()
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
