import { useQuery } from '@tanstack/react-query'
import { api } from './client'

export interface SearchHit {
  kind: 'item' | 'document' | 'review' | 'suggestion' | 'project'
  id: string
  key: string | null
  title: string
  subtitle: string | null
  project_id: string
  document_id: string | null
  status: string | null
}

export type WorkKind = 'approve' | 'vote' | 'suggestion' | 'reverify' | 'change_request'

export interface WorkEntry {
  kind: WorkKind
  id: string
  key: string | null
  title: string
  detail: string | null
  project_id: string
  document_id: string | null
  item_id: string | null
  review_id: string | null
  since: string | null
}

export interface ProjectOverview {
  documents: { id: string; name: string; group_id: string | null; statuses: Record<string, number>; total: number }[]
  activity: {
    at: string
    actor: string | null
    action: string
    summary: string
    subject_type: string
    subject_id: string | null
    transition: string | null
    to: string | null
  }[]
}

export function useSearch(q: string, projectId?: string) {
  return useQuery({
    queryKey: ['search', q, projectId ?? null],
    queryFn: async () =>
      (await api.get<SearchHit[]>('/search', { params: { q, ...(projectId ? { project_id: projectId } : {}) } })).data,
    enabled: q.trim().length >= 2,
    staleTime: 10_000,
    placeholderData: (prev) => prev,
  })
}

export function useMyWork(projectId?: string, enabled = true) {
  return useQuery({
    queryKey: ['my-work', projectId],
    queryFn: async () =>
      (await api.get<{ counts: Record<WorkKind, number>; entries: WorkEntry[] }>(`/projects/${projectId}/my-work`)).data,
    enabled: !!projectId && enabled,
  })
}

export function useWorkSummary(enabled: boolean) {
  return useQuery({
    queryKey: ['work-summary'],
    queryFn: async () => (await api.get<Record<string, number>>('/me/work-summary')).data,
    enabled,
  })
}

export function useProjectOverview(projectId?: string) {
  return useQuery({
    queryKey: ['project-overview', projectId],
    queryFn: async () => (await api.get<ProjectOverview>(`/projects/${projectId}/overview`)).data,
    enabled: !!projectId,
  })
}

/** Where a search hit or a work entry should take you. Items open in the
 * Document View, scrolled to and with their details panel open. */
export function linkFor(e: {
  kind: string
  project_id: string
  document_id?: string | null
  id: string
  item_id?: string | null
  review_id?: string | null
}): string {
  const base = `/projects/${e.project_id}`
  if (e.kind === 'project') return base
  if (e.kind === 'review' || e.kind === 'vote') return `${base}/reviews/${e.review_id ?? e.id}`
  if (e.kind === 'document') return `${base}/documents/${e.document_id ?? e.id}`
  const itemId = e.item_id ?? (e.kind === 'item' ? e.id : null)
  if (e.document_id && itemId) return `${base}/documents/${e.document_id}?item=${itemId}`
  if (e.document_id) return `${base}/documents/${e.document_id}`
  return base
}
