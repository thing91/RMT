// Roadmap of improvement ideas: types + hooks.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { WorkflowState } from './types'

export type IdeaStatus =
  | 'submitted'
  | 'under_review'
  | 'needs_info'
  | 'planned'
  | 'in_progress'
  | 'released'
  | 'declined'
  | 'duplicate'

export interface Idea {
  id: string
  number: number
  key: string
  title: string
  description: string
  category: string
  status: IdeaStatus
  status_label: string
  horizon: 'now' | 'next' | 'later' | null
  votes: number
  comments: number
  voted: boolean
  watching: boolean
  mine: boolean
  author: string
  organization: string
  created_at: string
  updated_at: string
  status_changed_at: string
  duplicate_of: { id: string; key: string; title: string } | null
  release: { id: string; version: string; title: string } | null
  priority: string | null
  effort: string | null
  internal_note: string | null
}

export interface IdeaDetail extends Idea {
  watchers: number
  timeline: { at: string; actor: string; from: string | null; to: string; comment: string | null; notes: Record<string, unknown> }[]
  can_manage: boolean
  can_edit: boolean
}

export interface IdeaComment {
  id: string
  parent_id: string | null
  author: string
  official: boolean
  body: string
  created_at: string
  mine: boolean
}

export interface ReleaseNote {
  id: string
  version: string
  title: string
  body: string | null
  released_at: string
  ideas: { id: string; key: string; title: string }[]
}

export interface RoadmapMeta {
  categories: string[]
  horizons: string[]
  states: WorkflowState[]
  can_manage: boolean
}

export interface IdeaFilters {
  status?: string
  category?: string
  q?: string
  mine?: boolean
  watched?: boolean
  sort?: 'votes' | 'new' | 'updated'
}

const KEYS = ['ideas', 'idea', 'roadmap-board', 'idea-comments', 'release-notes', 'workflow', 'notifications']

function useRefresh() {
  const qc = useQueryClient()
  return () => KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
}

export function useRoadmapMeta() {
  return useQuery({
    queryKey: ['roadmap-meta'],
    queryFn: async () => (await api.get<RoadmapMeta>('/roadmap/meta')).data,
    staleTime: 60_000,
  })
}

export function useIdeas(filters: IdeaFilters) {
  return useQuery({
    queryKey: ['ideas', filters],
    queryFn: async () =>
      (
        await api.get<{ items: Idea[]; facets: { status: IdeaStatus; label: string; count: number }[] }>(
          '/roadmap/ideas',
          { params: Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined && v !== '' && v !== false)) },
        )
      ).data,
  })
}

export function useRoadmapBoard(category?: string) {
  return useQuery({
    queryKey: ['roadmap-board', category ?? null],
    queryFn: async () =>
      (await api.get<Record<'planned' | 'in_progress' | 'released', Idea[]>>('/roadmap/board', {
        params: category ? { category } : {},
      })).data,
  })
}

export function useSimilarIdeas(title: string) {
  return useQuery({
    queryKey: ['ideas', 'similar', title],
    queryFn: async () => (await api.get<Idea[]>('/roadmap/ideas/similar', { params: { title } })).data,
    enabled: title.trim().length >= 5,
  })
}

export function useIdea(id?: string) {
  return useQuery({
    queryKey: ['idea', id],
    queryFn: async () => (await api.get<IdeaDetail>(`/roadmap/ideas/${id}`)).data,
    enabled: !!id,
  })
}

export function useIdeaComments(id?: string) {
  return useQuery({
    queryKey: ['idea-comments', id],
    queryFn: async () => (await api.get<IdeaComment[]>(`/roadmap/ideas/${id}/comments`)).data,
    enabled: !!id,
  })
}

export function useReleaseNotes() {
  return useQuery({
    queryKey: ['release-notes'],
    queryFn: async () => (await api.get<ReleaseNote[]>('/roadmap/release-notes')).data,
  })
}

export function useRoadmapAction() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async ({ method, path, body }: { method: 'post' | 'delete' | 'patch'; path: string; body?: unknown }) =>
      (await api.request({ method, url: `/roadmap${path}`, data: body })).data,
    onSuccess: refresh,
  })
}
