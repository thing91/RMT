// React Query hooks for collaboration features: edit locks, versions,
// workflow, reviews, change suggestions, notifications and permissions.
import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type {
  AppNotification,
  AuditEvent,
  BulkTransitionResult,
  ChangeRequest,
  Item,
  ItemVersion,
  ItemVersionDetail,
  LockStatus,
  NotificationPage,
  Permissions,
  ReviewDetail,
  ReviewSummary,
  Signature,
  SubjectWorkflow,
  Suggestion,
  SuspectLink,
  VersionDiff,
  WatchState,
  WorkflowCatalog,
  WorkflowDefinition,
  WorkflowTemplate,
} from './types'

function useInvalidate(keys: string[]) {
  const qc = useQueryClient()
  return () => keys.forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
}

const ITEM_KEYS = ['document-tree', 'project-items', 'item', 'item-versions', 'workflow', 'item-lock', 'item-audit']

// ---- permissions -------------------------------------------------------------

export function usePermissions(projectId?: string) {
  return useQuery({
    queryKey: ['permissions', projectId ?? null],
    queryFn: async () =>
      (await api.get<Permissions>('/me/permissions', { params: projectId ? { project_id: projectId } : {} })).data,
    staleTime: 60_000,
  })
}

export function useIsOrgAdmin(): boolean {
  const { data } = usePermissions()
  return !!data?.org_admin
}

export function can(perms: Permissions | undefined, permission: string): boolean {
  return !!perms && (perms.permissions.includes(permission) || perms.org_permissions.includes(permission))
}

// ---- items: single fetch, versions, history --------------------------------------

export function useItem(itemId?: string) {
  return useQuery({
    queryKey: ['item', itemId],
    queryFn: async () => (await api.get<Item>(`/items/${itemId}`)).data,
    enabled: !!itemId,
  })
}

export function useItemVersions(itemId?: string) {
  return useQuery({
    queryKey: ['item-versions', itemId],
    queryFn: async () => (await api.get<ItemVersion[]>(`/items/${itemId}/versions`)).data,
    enabled: !!itemId,
  })
}

export function useItemVersion(itemId?: string, version?: number) {
  return useQuery({
    queryKey: ['item-version', itemId, version],
    queryFn: async () => (await api.get<ItemVersionDetail>(`/items/${itemId}/versions/${version}`)).data,
    enabled: !!itemId && !!version,
  })
}

export function useItemDiff(itemId?: string, fromVersion?: number, toVersion?: number) {
  return useQuery({
    queryKey: ['item-diff', itemId, fromVersion, toVersion ?? 'current'],
    queryFn: async () =>
      (
        await api.get<VersionDiff>(`/items/${itemId}/diff`, {
          params: { from_version: fromVersion, ...(toVersion ? { to_version: toVersion } : {}) },
        })
      ).data,
    enabled: !!itemId && !!fromVersion,
  })
}

export function useItemAudit(itemId?: string) {
  return useQuery({
    queryKey: ['item-audit', itemId],
    queryFn: async () => (await api.get<AuditEvent[]>(`/items/${itemId}/audit`)).data,
    enabled: !!itemId,
  })
}

export function useProjectAudit(projectId?: string, params: { action?: string } = {}) {
  return useQuery({
    queryKey: ['project-audit', projectId, params],
    queryFn: async () => (await api.get<AuditEvent[]>(`/projects/${projectId}/audit`, { params })).data,
    enabled: !!projectId,
  })
}

export function useSignatures(itemId?: string) {
  return useQuery({
    queryKey: ['signatures', itemId],
    queryFn: async () => (await api.get<Signature[]>(`/items/${itemId}/signatures`)).data,
    enabled: !!itemId,
  })
}

/** Content save: always sends If-Match with the ETag the edit was based on. */
export function useSaveItemContent() {
  const invalidate = useInvalidate([...ITEM_KEYS, 'suggestions', 'item-suggestions'])
  return useMutation({
    mutationFn: async ({ id, etag, payload }: { id: string; etag: string; payload: Partial<Item> }) =>
      (await api.patch<Item>(`/items/${id}`, payload, { headers: { 'If-Match': etag } })).data,
    onSuccess: invalidate,
  })
}

// ---- edit locks -----------------------------------------------------------------

export function useItemLock(itemId?: string, poll = true) {
  return useQuery({
    queryKey: ['item-lock', itemId],
    queryFn: async () => (await api.get<LockStatus>(`/items/${itemId}/lock`)).data,
    enabled: !!itemId,
    refetchInterval: poll ? 60_000 : false,
  })
}

export function useItemLockActions(itemId: string) {
  const qc = useQueryClient()
  return useMemo(() => {
    const refresh = () => {
      qc.invalidateQueries({ queryKey: ['item-lock', itemId] })
      qc.invalidateQueries({ queryKey: ['document-tree'] })
      qc.invalidateQueries({ queryKey: ['project-locks'] })
    }
    return {
      acquire: async () => {
        const r = (await api.post<LockStatus>(`/items/${itemId}/lock`)).data
        refresh()
        return r
      },
      heartbeat: async () => (await api.post<LockStatus>(`/items/${itemId}/lock/heartbeat`)).data,
      release: async () => {
        const r = (await api.delete<LockStatus>(`/items/${itemId}/lock`)).data
        refresh()
        return r
      },
      override: async (takeOver: boolean) => {
        const r = (
          await api.post<LockStatus>(`/items/${itemId}/lock/override`, null, { params: { take_over: takeOver } })
        ).data
        refresh()
        return r
      },
      notifyWhenFree: async () => (await api.post<LockStatus>(`/items/${itemId}/lock/notify-when-free`)).data,
    }
  }, [qc, itemId])
}

export function useStructureLock(documentId?: string) {
  return useQuery({
    queryKey: ['structure-lock', documentId],
    queryFn: async () => (await api.get<LockStatus>(`/documents/${documentId}/structure-lock`)).data,
    enabled: !!documentId,
    refetchInterval: 60_000,
  })
}

export function useStructureLockActions(documentId: string) {
  const qc = useQueryClient()
  return useMemo(() => {
    const refresh = () => qc.invalidateQueries({ queryKey: ['structure-lock', documentId] })
    return {
      acquire: async () => {
        const r = (await api.post<LockStatus>(`/documents/${documentId}/structure-lock`)).data
        refresh()
        return r
      },
      heartbeat: async () => (await api.post<LockStatus>(`/documents/${documentId}/structure-lock/heartbeat`)).data,
      release: async () => {
        const r = (await api.delete<LockStatus>(`/documents/${documentId}/structure-lock`)).data
        refresh()
        return r
      },
      override: async (takeOver: boolean) => {
        const r = (
          await api.post<LockStatus>(`/documents/${documentId}/structure-lock/override`, null, {
            params: { take_over: takeOver },
          })
        ).data
        refresh()
        return r
      },
    }
  }, [qc, documentId])
}

// ---- workflow ---------------------------------------------------------------------

export function useSubjectWorkflow(kind: string, id?: string) {
  return useQuery({
    queryKey: ['workflow', kind, id],
    queryFn: async () => (await api.get<SubjectWorkflow>(`/workflow/${kind}/${id}`)).data,
    enabled: !!id,
  })
}

export interface TransitionInput {
  comment?: string
  password?: string
  payload?: Record<string, unknown>
}

export function useItemTransition() {
  const invalidate = useInvalidate([
    ...ITEM_KEYS,
    'change-requests',
    'suspect-links',
    'notifications',
    'suggestions',
    'item-suggestions',
    'signatures',
  ])
  return useMutation({
    mutationFn: async ({ item, key, input }: { item: Item; key: string; input: TransitionInput }) =>
      (
        await api.post<Item>(`/items/${item.id}/transitions/${key}`, input, {
          headers: { 'If-Match': item.etag ?? String(item.version) },
        })
      ).data,
    onSuccess: invalidate,
  })
}

export function useSubjectTransition(kind: string) {
  const invalidate = useInvalidate([
    'workflow',
    'suggestions',
    'item-suggestions',
    'suggestion',
    'ideas',
    'idea',
    'applicability',
    ...ITEM_KEYS,
    'change-requests',
    'notifications',
  ])
  return useMutation({
    mutationFn: async ({ id, key, input }: { id: string; key: string; input: TransitionInput }) =>
      (await api.post<SubjectWorkflow>(`/workflow/${kind}/${id}/transitions/${key}`, input)).data,
    onSuccess: invalidate,
  })
}

export function useDocumentTransition(documentId: string) {
  const invalidate = useInvalidate(ITEM_KEYS)
  return useMutation({
    mutationFn: async ({ key, input, itemIds }: { key: string; input: TransitionInput; itemIds?: string[] }) =>
      (
        await api.post<BulkTransitionResult>(`/documents/${documentId}/transitions/${key}`, {
          ...input,
          item_ids: itemIds,
        })
      ).data,
    onSuccess: invalidate,
  })
}

export function useWorkflowTemplates() {
  return useQuery({
    queryKey: ['workflow-templates'],
    queryFn: async () => (await api.get<WorkflowTemplate[]>('/workflow-templates')).data,
    staleTime: Infinity,
  })
}

export function useWorkflowCatalog() {
  return useQuery({
    queryKey: ['workflow-catalog'],
    queryFn: async () => (await api.get<WorkflowCatalog>('/workflow-catalog')).data,
    staleTime: Infinity,
  })
}

export function useOrgWorkflows(orgId?: string) {
  return useQuery({
    queryKey: ['org-workflows', orgId],
    queryFn: async () => (await api.get<WorkflowDefinition[]>(`/organizations/${orgId}/workflows`)).data,
    enabled: !!orgId,
  })
}

export function useProjectWorkflows(projectId?: string) {
  return useQuery({
    queryKey: ['project-workflows', projectId],
    queryFn: async () => (await api.get<WorkflowDefinition[]>(`/projects/${projectId}/workflows`)).data,
    enabled: !!projectId,
  })
}

export interface WorkflowSpecInput {
  template?: string
  name?: string
  states?: unknown[]
  transitions?: unknown[]
  settings?: Record<string, unknown>
}

export function useSaveWorkflow() {
  const invalidate = useInvalidate(['org-workflows', 'project-workflows', 'item-types', 'workflow', ...ITEM_KEYS])
  return useMutation({
    mutationFn: async ({
      itemTypeId,
      projectId,
      spec,
    }: {
      itemTypeId: string
      projectId?: string
      spec: WorkflowSpecInput
    }) =>
      (
        await api.put<WorkflowDefinition>(
          projectId ? `/projects/${projectId}/item-types/${itemTypeId}/workflow` : `/item-types/${itemTypeId}/workflow`,
          spec,
        )
      ).data,
    onSuccess: invalidate,
  })
}

export function useDeleteProjectWorkflow() {
  const invalidate = useInvalidate(['org-workflows', 'project-workflows', 'item-types', 'workflow'])
  return useMutation({
    mutationFn: async ({ itemTypeId, projectId }: { itemTypeId: string; projectId: string }) =>
      api.delete(`/projects/${projectId}/item-types/${itemTypeId}/workflow`),
    onSuccess: invalidate,
  })
}

// ---- change management ---------------------------------------------------------------

export function useChangeRequests(projectId?: string, params: { status?: string; item_id?: string } = {}) {
  return useQuery({
    queryKey: ['change-requests', projectId, params],
    queryFn: async () => (await api.get<ChangeRequest[]>(`/projects/${projectId}/change-requests`, { params })).data,
    enabled: !!projectId,
  })
}

export function useSuspectLinks(projectId?: string, itemId?: string) {
  return useQuery({
    queryKey: ['suspect-links', projectId, itemId ?? null],
    queryFn: async () =>
      (
        await api.get<SuspectLink[]>(`/projects/${projectId}/suspect-links`, {
          params: itemId ? { item_id: itemId } : {},
        })
      ).data,
    enabled: !!projectId,
  })
}

export function useClearSuspect() {
  const invalidate = useInvalidate(['suspect-links', 'document-tree', 'project-items', 'item'])
  return useMutation({
    mutationFn: async ({ linkId, comment }: { linkId: string; comment?: string }) =>
      (await api.post<SuspectLink>(`/links/${linkId}/clear-suspect`, { comment })).data,
    onSuccess: invalidate,
  })
}

// ---- notifications & watching ----------------------------------------------------------

export function useNotifications(enabled: boolean) {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: async () => (await api.get<NotificationPage>('/me/notifications')).data,
    enabled,
    refetchInterval: 120_000,
  })
}

export function useMarkNotificationRead() {
  const invalidate = useInvalidate(['notifications'])
  return useMutation({
    mutationFn: async (n: AppNotification) => api.post(`/me/notifications/${n.id}/read`),
    onSuccess: invalidate,
  })
}

export function useMarkAllNotificationsRead() {
  const invalidate = useInvalidate(['notifications'])
  return useMutation({
    mutationFn: async () => api.post('/me/notifications/read-all'),
    onSuccess: invalidate,
  })
}

export function useWatch(subjectType: string, subjectId?: string) {
  return useQuery({
    queryKey: ['watch', subjectType, subjectId],
    queryFn: async () => (await api.get<WatchState>(`/watch/${subjectType}/${subjectId}`)).data,
    enabled: !!subjectId,
  })
}

export function useToggleWatch(subjectType: string, subjectId: string) {
  const invalidate = useInvalidate(['watch'])
  return useMutation({
    mutationFn: async (watching: boolean) =>
      watching
        ? (await api.delete<WatchState>(`/watch/${subjectType}/${subjectId}`)).data
        : (await api.post<WatchState>('/watch', { subject_type: subjectType, subject_id: subjectId })).data,
    onSuccess: invalidate,
  })
}

// ---- reviews ------------------------------------------------------------------------------

export function useReviews(projectId?: string, params: { status?: string; item_id?: string } = {}) {
  return useQuery({
    queryKey: ['reviews', projectId, params],
    queryFn: async () => (await api.get<ReviewSummary[]>(`/projects/${projectId}/reviews`, { params })).data,
    enabled: !!projectId,
  })
}

export function useReview(reviewId?: string) {
  return useQuery({
    queryKey: ['review', reviewId],
    queryFn: async () => (await api.get<ReviewDetail>(`/reviews/${reviewId}`)).data,
    enabled: !!reviewId,
  })
}

export function useCreateReview(projectId: string) {
  const invalidate = useInvalidate(['reviews'])
  return useMutation({
    mutationFn: async (payload: {
      title: string
      description?: string
      item_ids: string[]
      participants: { user_id: string; required: boolean }[]
      close_requires_resolved: 'none' | 'major' | 'all'
      require_all_votes: boolean
      due_date?: string | null
    }) => (await api.post<ReviewDetail>(`/projects/${projectId}/reviews`, payload)).data,
    onSuccess: invalidate,
  })
}

export function useReviewAction(reviewId: string) {
  const qc = useQueryClient()
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['review', reviewId] })
    qc.invalidateQueries({ queryKey: ['reviews'] })
    ITEM_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
  }
  return useMutation({
    mutationFn: async ({
      path,
      method = 'post',
      body,
    }: {
      path: string
      method?: 'post' | 'delete' | 'patch'
      body?: unknown
    }) =>
      (
        await api.request<ReviewDetail | { review: ReviewDetail; applied: string[]; skipped: string[] }>({
          url: `/reviews/${reviewId}${path}`,
          method,
          data: body,
        })
      ).data,
    onSuccess: refresh,
  })
}

// ---- suggestions ---------------------------------------------------------------------------

export function useItemSuggestions(itemId?: string) {
  return useQuery({
    queryKey: ['item-suggestions', itemId],
    queryFn: async () => (await api.get<Suggestion[]>(`/items/${itemId}/suggestions`)).data,
    enabled: !!itemId,
  })
}

export function useSuggestion(id?: string) {
  return useQuery({
    queryKey: ['suggestion', id],
    queryFn: async () => (await api.get<Suggestion>(`/suggestions/${id}`)).data,
    enabled: !!id,
  })
}

export interface SuggestionFilters {
  review_id?: string
  item_id?: string
  author_id?: string
  status?: string
  kind?: string
  severity?: string
}

export function useProjectSuggestions(projectId?: string, filters: SuggestionFilters = {}) {
  return useQuery({
    queryKey: ['suggestions', projectId, filters],
    queryFn: async () =>
      (await api.get<Suggestion[]>(`/projects/${projectId}/suggestions`, { params: clean(filters) })).data,
    enabled: !!projectId,
  })
}

function clean<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as Partial<T>
}

export function suggestionsExportUrl(projectId: string, filters: SuggestionFilters = {}): string {
  const qs = new URLSearchParams(clean(filters) as Record<string, string>).toString()
  return `/api/v1/projects/${projectId}/suggestions/export.xlsx${qs ? `?${qs}` : ''}`
}

export interface SuggestionInput {
  target_field: string
  proposed_value: unknown
  rationale: string
  kind: 'editorial' | 'technical'
  severity: 'major' | 'minor'
  review_id?: string | null
}

export function useCreateSuggestion(itemId: string) {
  const invalidate = useInvalidate(['item-suggestions', 'suggestions', 'review', 'notifications'])
  return useMutation({
    mutationFn: async (payload: SuggestionInput) =>
      (await api.post<Suggestion>(`/items/${itemId}/suggestions`, payload)).data,
    onSuccess: invalidate,
  })
}

export function useConvertComment() {
  const invalidate = useInvalidate(['item-suggestions', 'suggestions', 'item-comments'])
  return useMutation({
    mutationFn: async ({ commentId, payload }: { commentId: string; payload: Partial<SuggestionInput> }) =>
      (await api.post<Suggestion>(`/comments/${commentId}/convert-to-suggestion`, payload)).data,
    onSuccess: invalidate,
  })
}

export function useUpdateSuggestion() {
  const invalidate = useInvalidate(['item-suggestions', 'suggestions', 'suggestion'])
  return useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: Partial<SuggestionInput> }) =>
      (await api.patch<Suggestion>(`/suggestions/${id}`, payload)).data,
    onSuccess: invalidate,
  })
}

export function useSuggestionComments(id?: string) {
  return useQuery({
    queryKey: ['suggestion-comments', id],
    queryFn: async () => (await api.get<import('./types').ItemComment[]>(`/suggestions/${id}/comments`)).data,
    enabled: !!id,
  })
}
