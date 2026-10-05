import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

export interface ApiToken {
  id: string
  name: string
  prefix: string
  created_at: string
  expires_at: string | null
  last_used_at: string | null
  revoked_at: string | null
}

export interface RecordChange {
  id: string
  at: string
  entity_type: string
  entity_id: string
  action: 'create' | 'update' | 'delete'
  label: string | null
  changes: Record<string, [unknown, unknown]>
  actor_name: string | null
  project_id: string | null
}

export function useApiTokens(enabled = true) {
  return useQuery({
    queryKey: ['api-tokens'],
    queryFn: async () => (await api.get<ApiToken[]>('/me/api-tokens')).data,
    enabled,
  })
}

export function useCreateApiToken() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: { name: string; expires_in_days: number | null }) =>
      (await api.post<ApiToken & { token: string }>('/me/api-tokens', payload)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-tokens'] }),
  })
}

export function useRevokeApiToken() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => api.delete(`/me/api-tokens/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-tokens'] }),
  })
}

/** The OpenAPI document — used to list the API's areas on the API page. */
export function useOpenApi() {
  return useQuery({
    queryKey: ['openapi'],
    queryFn: async () =>
      (await api.get<{ paths: Record<string, Record<string, { tags?: string[]; summary?: string }>> }>(
        '/openapi.json',
        { baseURL: '/api' },
      )).data,
    staleTime: Infinity,
  })
}

export function useRecordHistory(entityType?: string, entityId?: string) {
  return useQuery({
    queryKey: ['record-history', entityType, entityId],
    queryFn: async () => (await api.get<RecordChange[]>(`/changes/${entityType}/${entityId}`)).data,
    enabled: !!entityType && !!entityId,
  })
}
