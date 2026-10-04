import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type {
  ApplicabilityRecord,
  ApplicabilityRecordDetail,
  ApplicabilitySummary,
  LibraryRelease,
  LibraryRuleSpec,
  LibrarySubscription,
  LibrarySummary,
  MissionAttributeDef,
  ReleaseDiff,
} from './types'

const KEYS = ['applicability', 'applicability-summary', 'library-subscriptions', 'releases', 'libraries', 'project']

function useRefresh(extra: string[] = []) {
  const qc = useQueryClient()
  return () => [...KEYS, ...extra].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
}

export function useLibraries(orgId?: string) {
  return useQuery({
    queryKey: ['libraries', orgId],
    queryFn: async () => (await api.get<LibrarySummary[]>(`/organizations/${orgId}/libraries`)).data,
    enabled: !!orgId,
  })
}

export function useReleases(libraryId?: string) {
  return useQuery({
    queryKey: ['releases', libraryId],
    queryFn: async () => (await api.get<LibraryRelease[]>(`/projects/${libraryId}/releases`)).data,
    enabled: !!libraryId,
  })
}

export function useCreateRelease(libraryId: string) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async (payload: { name: string; notes?: string }) =>
      (await api.post<LibraryRelease>(`/projects/${libraryId}/releases`, payload)).data,
    onSuccess: refresh,
  })
}

export function useReleaseDiff(releaseId?: string, against?: string) {
  return useQuery({
    queryKey: ['release-diff', releaseId, against ?? null],
    queryFn: async () =>
      (await api.get<ReleaseDiff>(`/library-releases/${releaseId}/diff`, { params: against ? { against } : {} })).data,
    enabled: !!releaseId,
  })
}

export function useSubscriptions(projectId?: string) {
  return useQuery({
    queryKey: ['library-subscriptions', projectId],
    queryFn: async () => (await api.get<LibrarySubscription[]>(`/projects/${projectId}/libraries`)).data,
    enabled: !!projectId,
  })
}

export function useSubscribe(projectId: string) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async (payload: { library_id: string; release_id: string; target_document_id?: string | null }) =>
      (await api.post<LibrarySubscription>(`/projects/${projectId}/libraries`, payload)).data,
    onSuccess: refresh,
  })
}

export function useUpdatePreview(projectId?: string, libraryId?: string, releaseId?: string) {
  return useQuery({
    queryKey: ['update-preview', projectId, libraryId, releaseId],
    queryFn: async () =>
      (
        await api.get<ReleaseDiff>(`/projects/${projectId}/libraries/${libraryId}/update-preview`, {
          params: { release_id: releaseId },
        })
      ).data,
    enabled: !!projectId && !!libraryId && !!releaseId,
  })
}

export function useSubscriptionAction(projectId: string, libraryId: string) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async ({
      action,
      body,
    }: {
      action: 'adopt' | 'decline' | 'patch'
      body: Record<string, unknown>
    }) =>
      action === 'patch'
        ? (await api.patch(`/projects/${projectId}/libraries/${libraryId}`, body)).data
        : (await api.post(`/projects/${projectId}/libraries/${libraryId}/${action}`, body)).data,
    onSuccess: refresh,
  })
}

export interface RecordFilters {
  library_id?: string
  status?: string
  subsystem?: string
  suspect?: boolean
}

export function useApplicability(projectId?: string, filters: RecordFilters = {}) {
  return useQuery({
    queryKey: ['applicability', projectId, filters],
    queryFn: async () =>
      (
        await api.get<ApplicabilityRecord[]>(`/projects/${projectId}/applicability`, {
          params: Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined && v !== '')),
        })
      ).data,
    enabled: !!projectId,
  })
}

export function useApplicabilityRecord(id?: string) {
  return useQuery({
    queryKey: ['applicability', 'record', id],
    queryFn: async () => (await api.get<ApplicabilityRecordDetail>(`/applicability/${id}`)).data,
    enabled: !!id,
  })
}

export function useApplicabilitySummary(projectId?: string) {
  return useQuery({
    queryKey: ['applicability-summary', projectId],
    queryFn: async () => (await api.get<ApplicabilitySummary>(`/projects/${projectId}/applicability/summary`)).data,
    enabled: !!projectId,
  })
}

export function useClearRecordSuspect() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async (id: string) => (await api.post(`/applicability/${id}/clear-suspect`)).data,
    onSuccess: refresh,
  })
}

export function useSetMissionAttributes(projectId: string) {
  const refresh = useRefresh(['projects'])
  return useMutation({
    mutationFn: async (values: Record<string, unknown>) =>
      (await api.put<{ suggestions: number }>(`/projects/${projectId}/mission-attributes`, { values })).data,
    onSuccess: refresh,
  })
}

export function useSetMissionDefs(libraryId: string) {
  const refresh = useRefresh(['projects'])
  return useMutation({
    mutationFn: async (defs: MissionAttributeDef[]) =>
      (await api.put(`/projects/${libraryId}/mission-attribute-defs`, { defs })).data,
    onSuccess: refresh,
  })
}

export function useLibraryRules(itemId?: string) {
  return useQuery({
    queryKey: ['library-rules', itemId],
    queryFn: async () => (await api.get<{ rules: LibraryRuleSpec[] }>(`/items/${itemId}/library-rules`)).data.rules,
    enabled: !!itemId,
  })
}

export function useSetLibraryRules(itemId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (rules: LibraryRuleSpec[]) =>
      (await api.put<{ rules: LibraryRuleSpec[] }>(`/items/${itemId}/library-rules`, { rules })).data.rules,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['library-rules', itemId] }),
  })
}
