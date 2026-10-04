import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type {
  Baseline,
  Document,
  DocumentGroup,
  GitCommit,
  GlossaryConsistencyReport,
  GlossaryTerm,
  ItemComment,
  ItemGraph,
  Item,
  ItemType,
  ItemTypeAttribute,
  Link,
  LinkType,
  MatrixView,
  Organization,
  OrgUser,
  Parameter,
  ParameterUsage,
  Project,
  ReferenceConsistencyReport,
  ReferenceLocator,
  ReferenceSource,
  TableView,
  TableViewColumn,
  TraceabilityMatrix,
  WorkflowRole,
} from './types'

export function useOrganizations() {
  return useQuery({
    queryKey: ['organizations'],
    queryFn: async () => (await api.get<Organization[]>('/organizations')).data,
  })
}

/** MVP has exactly one org and no org-switcher UI yet — this is the single
 * place that assumption lives, so pages don't each re-derive "org[0]". */
export function useOrg() {
  const { data, isLoading } = useOrganizations()
  return { org: data?.[0], isLoading }
}

export function useProjects(orgId?: string) {
  return useQuery({
    queryKey: ['projects', orgId],
    queryFn: async () => (await api.get<Project[]>(`/organizations/${orgId}/projects`)).data,
    enabled: !!orgId,
  })
}

export function useProject(projectId?: string) {
  return useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => (await api.get<Project>(`/projects/${projectId}`)).data,
    enabled: !!projectId,
  })
}

export function useDocuments(projectId?: string) {
  return useQuery({
    queryKey: ['documents', projectId],
    queryFn: async () => (await api.get<Document[]>(`/projects/${projectId}/documents`)).data,
    enabled: !!projectId,
  })
}

/** No single-document GET endpoint exists — documents are cheap and always
 * fetched as a project's full list already, so this just finds one in it
 * rather than adding a redundant backend route. */
export function useDocument(projectId?: string, documentId?: string) {
  const { data: documents, isLoading } = useDocuments(projectId)
  return { document: documents?.find((d) => d.id === documentId), isLoading }
}

export function useCreateProject(orgId: string) {
  const invalidate = useInvalidate(['projects'])
  return useMutation({
    mutationFn: async (payload: { name: string; visibility: 'public' | 'private'; kind?: 'project' | 'library' }) =>
      (await api.post<Project>(`/organizations/${orgId}/projects`, payload)).data,
    onSuccess: invalidate,
  })
}

export function useCreateDocument(projectId: string) {
  const invalidate = useInvalidate(['documents'])
  return useMutation({
    mutationFn: async (payload: { name: string; group_id?: string | null }) =>
      (await api.post<Document>(`/projects/${projectId}/documents`, payload)).data,
    onSuccess: invalidate,
  })
}

export function useUpdateDocument() {
  const invalidate = useInvalidate(['documents'])
  return useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: string
      payload: { name?: string; order?: number; group_id?: string | null }
    }) => (await api.patch<Document>(`/documents/${id}`, payload)).data,
    onSuccess: invalidate,
  })
}

// § document grouping — not in the original brief
export function useDocumentGroups(projectId?: string) {
  return useQuery({
    queryKey: ['document-groups', projectId],
    queryFn: async () => (await api.get<DocumentGroup[]>(`/projects/${projectId}/document-groups`)).data,
    enabled: !!projectId,
  })
}

export function useCreateDocumentGroup(projectId: string) {
  const invalidate = useInvalidate(['document-groups'])
  return useMutation({
    mutationFn: async (payload: { name: string }) =>
      (await api.post<DocumentGroup>(`/projects/${projectId}/document-groups`, payload)).data,
    onSuccess: invalidate,
  })
}

export function useUpdateDocumentGroup() {
  const invalidate = useInvalidate(['document-groups'])
  return useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: { name?: string; order?: number } }) =>
      (await api.patch<DocumentGroup>(`/document-groups/${id}`, payload)).data,
    onSuccess: invalidate,
  })
}

export function useDeleteDocumentGroup() {
  const invalidate = useInvalidate(['document-groups', 'documents'])
  return useMutation({
    mutationFn: async (id: string) => api.delete(`/document-groups/${id}`),
    onSuccess: invalidate,
  })
}

export function useItemTypes(orgId?: string) {
  return useQuery({
    queryKey: ['item-types', orgId],
    queryFn: async () => (await api.get<ItemType[]>(`/organizations/${orgId}/item-types`)).data,
    enabled: !!orgId,
  })
}

export function useLinkTypes(orgId?: string) {
  return useQuery({
    queryKey: ['link-types', orgId],
    queryFn: async () => (await api.get<LinkType[]>(`/organizations/${orgId}/link-types`)).data,
    enabled: !!orgId,
  })
}

export function useDocumentTree(documentId?: string, includeObsolete = false) {
  return useQuery({
    queryKey: ['document-tree', documentId, includeObsolete],
    // Picks up other users' edit locks and status changes without a reload.
    refetchInterval: 20_000,
    queryFn: async () =>
      (await api.get<Item[]>(`/documents/${documentId}/items`, { params: { include_obsolete: includeObsolete } }))
        .data,
    enabled: !!documentId,
  })
}

export function useProjectItems(projectId?: string) {
  return useQuery({
    queryKey: ['project-items', projectId],
    queryFn: async () => (await api.get<Item[]>(`/projects/${projectId}/items`)).data,
    enabled: !!projectId,
  })
}

export function useProjectLinks(projectId?: string) {
  return useQuery({
    queryKey: ['project-links', projectId],
    queryFn: async () => (await api.get<Link[]>(`/projects/${projectId}/links`)).data,
    enabled: !!projectId,
  })
}

export function useItemLinks(itemId?: string) {
  return useQuery({
    queryKey: ['item-links', itemId],
    queryFn: async () => (await api.get<Link[]>(`/items/${itemId}/links`)).data,
    enabled: !!itemId,
  })
}

// § comments/discussion — not in the original brief
export function useItemComments(itemId?: string) {
  return useQuery({
    queryKey: ['item-comments', itemId],
    queryFn: async () => (await api.get<ItemComment[]>(`/items/${itemId}/comments`)).data,
    enabled: !!itemId,
  })
}

/** Every comment thread in a document, in one request — backs Document
 * View's per-item comment indicators, which would otherwise mean one
 * /items/{id}/comments call per visible item. */
export function useDocumentComments(documentId?: string) {
  return useQuery({
    queryKey: ['document-comments', documentId],
    queryFn: async () => (await api.get<ItemComment[]>(`/documents/${documentId}/comments`)).data,
    enabled: !!documentId,
  })
}

export function useCreateComment(itemId: string) {
  const invalidate = useInvalidate(['item-comments', 'document-comments', 'suggestion-comments', 'watch'])
  return useMutation({
    mutationFn: async (payload: { body: string; parent_comment_id?: string; suggestion_id?: string }) =>
      (await api.post<ItemComment>(`/items/${itemId}/comments`, payload)).data,
    onSuccess: invalidate,
  })
}

export function useUpdateComment() {
  const invalidate = useInvalidate(['item-comments', 'document-comments'])
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: string }) =>
      (await api.patch<ItemComment>(`/comments/${id}`, { body })).data,
    onSuccess: invalidate,
  })
}

export function useDeleteComment() {
  const invalidate = useInvalidate(['item-comments', 'document-comments'])
  return useMutation({
    mutationFn: async (id: string) => api.delete(`/comments/${id}`),
    onSuccess: invalidate,
  })
}

export function useResolveComment() {
  const invalidate = useInvalidate(['item-comments', 'document-comments'])
  return useMutation({
    mutationFn: async (id: string) => (await api.post<ItemComment>(`/comments/${id}/resolve`)).data,
    onSuccess: invalidate,
  })
}

export function useReopenComment() {
  const invalidate = useInvalidate(['item-comments', 'document-comments'])
  return useMutation({
    mutationFn: async (id: string) => (await api.post<ItemComment>(`/comments/${id}/reopen`)).data,
    onSuccess: invalidate,
  })
}

function useInvalidate(keys: string[]) {
  const qc = useQueryClient()
  return () => keys.forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
}

export function useCreateItem(documentId: string) {
  const invalidate = useInvalidate(['document-tree', 'project-items'])
  return useMutation({
    mutationFn: async (payload: {
      item_type_id: string
      parent_id: string | null
      title: string
      description_md?: string
      attributes?: Record<string, unknown>
      order?: number
    }) => (await api.post<Item>(`/documents/${documentId}/items`, payload)).data,
    onSuccess: invalidate,
  })
}

/** PATCH an item. Structure-only changes (parent_id/order) need no ETag;
 * any content change must pass the `etag` it was based on (If-Match) —
 * the server answers 412 with a diff if someone else changed it first. */
export function useUpdateItem() {
  const invalidate = useInvalidate([
    'document-tree', 'project-items', 'item-links', 'item', 'item-versions', 'item-suggestions', 'structure-lock',
  ])
  return useMutation({
    mutationFn: async ({ id, payload, etag }: { id: string; payload: Partial<Item>; etag?: string | null }) =>
      (await api.patch<Item>(`/items/${id}`, payload, etag ? { headers: { 'If-Match': etag } } : undefined)).data,
    onSuccess: invalidate,
  })
}

export function useDeleteItem() {
  const invalidate = useInvalidate(['document-tree', 'project-items'])
  return useMutation({
    mutationFn: async (id: string) => api.delete(`/items/${id}`),
    onSuccess: invalidate,
  })
}

export function useCreateItemType(orgId: string) {
  const invalidate = useInvalidate(['item-types'])
  return useMutation({
    mutationFn: async (payload: {
      key: string
      name: string
      prefix: string
      behavior: 'structural' | 'content'
      icon?: string
      color?: string
    }) => (await api.post<ItemType>(`/organizations/${orgId}/item-types`, payload)).data,
    onSuccess: invalidate,
  })
}

export function useCreateAttribute() {
  const invalidate = useInvalidate(['item-types'])
  return useMutation({
    mutationFn: async ({
      itemTypeId,
      payload,
    }: {
      itemTypeId: string
      payload: Partial<ItemTypeAttribute> & { key: string; label: string; data_type: string }
    }) =>
      (await api.post<ItemTypeAttribute>(`/item-types/${itemTypeId}/attributes`, payload)).data,
    onSuccess: invalidate,
  })
}

export function useDeprecateAttribute() {
  const invalidate = useInvalidate(['item-types'])
  return useMutation({
    mutationFn: async ({
      itemTypeId,
      attributeId,
      deprecated,
    }: {
      itemTypeId: string
      attributeId: string
      deprecated: boolean
    }) =>
      (
        await api.patch<ItemTypeAttribute>(
          `/item-types/${itemTypeId}/attributes/${attributeId}`,
          { deprecated },
        )
      ).data,
    onSuccess: invalidate,
  })
}

export function useUpdateAttribute() {
  const invalidate = useInvalidate(['item-types'])
  return useMutation({
    mutationFn: async ({
      itemTypeId,
      attributeId,
      payload,
    }: {
      itemTypeId: string
      attributeId: string
      payload: Partial<Pick<ItemTypeAttribute, 'enum_options' | 'label' | 'required' | 'unit' | 'min' | 'max' | 'order'>>
    }) => (await api.patch<ItemTypeAttribute>(`/item-types/${itemTypeId}/attributes/${attributeId}`, payload)).data,
    onSuccess: invalidate,
  })
}

export function useCreateLinkType(orgId: string) {
  const invalidate = useInvalidate(['link-types'])
  return useMutation({
    mutationFn: async (payload: {
      key: string
      name: string
      inverse_name: string
      allowed_source_types: string[]
      allowed_target_types: string[]
    }) => (await api.post<LinkType>(`/organizations/${orgId}/link-types`, payload)).data,
    onSuccess: invalidate,
  })
}

export function useCreateLink() {
  const invalidate = useInvalidate(['item-links', 'project-links'])
  return useMutation({
    mutationFn: async (payload: {
      source_item_id: string
      target_item_id: string
      link_type_id: string
    }) => (await api.post<Link>('/links', payload)).data,
    onSuccess: invalidate,
  })
}

export function useDeleteLink() {
  const invalidate = useInvalidate(['item-links', 'project-links'])
  return useMutation({
    mutationFn: async (id: string) => api.delete(`/links/${id}`),
    onSuccess: invalidate,
  })
}

export function useTableViews(projectId?: string) {
  return useQuery({
    queryKey: ['table-views', projectId],
    queryFn: async () => (await api.get<TableView[]>(`/projects/${projectId}/table-views`)).data,
    enabled: !!projectId,
  })
}

export function useCreateTableView(projectId: string) {
  const invalidate = useInvalidate(['table-views'])
  return useMutation({
    mutationFn: async (payload: {
      name: string
      scope: 'personal' | 'shared'
      item_type_id: string | null
      columns: TableViewColumn[]
      is_default?: boolean
    }) => (await api.post<TableView>(`/projects/${projectId}/table-views`, payload)).data,
    onSuccess: invalidate,
  })
}

export function useUpdateTableView() {
  const invalidate = useInvalidate(['table-views'])
  return useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: Partial<TableView> }) =>
      (await api.patch<TableView>(`/table-views/${id}`, payload)).data,
    onSuccess: invalidate,
  })
}

export function useDeleteTableView() {
  const invalidate = useInvalidate(['table-views'])
  return useMutation({
    mutationFn: async (id: string) => api.delete(`/table-views/${id}`),
    onSuccess: invalidate,
  })
}

export function useGitLog(projectId?: string) {
  return useQuery({
    queryKey: ['git-log', projectId],
    queryFn: async () => (await api.get<GitCommit[]>(`/projects/${projectId}/git-log`)).data,
    enabled: !!projectId,
  })
}

export function useBaselines(projectId?: string) {
  return useQuery({
    queryKey: ['baselines', projectId],
    queryFn: async () => (await api.get<Baseline[]>(`/projects/${projectId}/baselines`)).data,
    enabled: !!projectId,
  })
}

export function useCreateBaseline(projectId: string) {
  const invalidate = useInvalidate(['baselines', 'document-tree', 'project-items'])
  return useMutation({
    mutationFn: async (payload: { name: string; description?: string; locks_items?: boolean }) =>
      (await api.post<Baseline>(`/projects/${projectId}/baselines`, payload)).data,
    onSuccess: invalidate,
  })
}

export function useDeleteBaseline() {
  const invalidate = useInvalidate(['baselines'])
  return useMutation({
    mutationFn: async (id: string) => api.delete(`/baselines/${id}`),
    onSuccess: invalidate,
  })
}

export function useItemGraph(
  itemId?: string,
  depthUp: number | 'all' = 3,
  depthDown: number | 'all' = 3,
) {
  return useQuery({
    queryKey: ['item-graph', itemId, depthUp, depthDown],
    queryFn: async () =>
      (
        await api.get<ItemGraph>(`/items/${itemId}/graph`, {
          params: { direction: 'both', depth_up: String(depthUp), depth_down: String(depthDown) },
        })
      ).data,
    enabled: !!itemId,
  })
}

export function useImportGlossary(orgId: string) {
  const invalidate = useInvalidate(['glossary', 'glossary-consistency'])
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append('file', file)
      return (
        await api.post<{ created: number; updated: number; errors: string[] }>(
          `/organizations/${orgId}/glossary/import`,
          formData,
          { headers: { 'Content-Type': 'multipart/form-data' } },
        )
      ).data
    },
    onSuccess: invalidate,
  })
}

export function useGlossary(orgId?: string) {
  return useQuery({
    queryKey: ['glossary', orgId],
    queryFn: async () => (await api.get<GlossaryTerm[]>(`/organizations/${orgId}/glossary`)).data,
    enabled: !!orgId,
  })
}

export function useGlossaryConsistency(orgId?: string) {
  return useQuery({
    queryKey: ['glossary-consistency', orgId],
    queryFn: async () =>
      (
        await api.get<GlossaryConsistencyReport>(
          `/organizations/${orgId}/glossary/consistency-report`,
        )
      ).data,
    enabled: !!orgId,
  })
}

export function useCreateGlossaryTerm(orgId: string) {
  const invalidate = useInvalidate(['glossary', 'glossary-consistency'])
  return useMutation({
    mutationFn: async (payload: {
      abbreviation: string
      term: string
      definition: string
      category?: string
    }) => (await api.post<GlossaryTerm>(`/organizations/${orgId}/glossary`, payload)).data,
    onSuccess: invalidate,
  })
}

export function useUpdateGlossaryTerm() {
  const invalidate = useInvalidate(['glossary', 'glossary-consistency'])
  return useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: Partial<GlossaryTerm> }) =>
      (await api.patch<GlossaryTerm>(`/glossary/${id}`, payload)).data,
    onSuccess: invalidate,
  })
}

export function useDeleteGlossaryTerm() {
  const invalidate = useInvalidate(['glossary', 'glossary-consistency'])
  return useMutation({
    mutationFn: async (id: string) => api.delete(`/glossary/${id}`),
    onSuccess: invalidate,
  })
}

export function useMatrixViews(projectId?: string) {
  return useQuery({
    queryKey: ['matrix-views', projectId],
    queryFn: async () => (await api.get<MatrixView[]>(`/projects/${projectId}/matrix-views`)).data,
    enabled: !!projectId,
  })
}

export function useCreateMatrixView(projectId: string) {
  const invalidate = useInvalidate(['matrix-views'])
  return useMutation({
    mutationFn: async (payload: {
      name: string
      scope: 'personal' | 'shared'
      row_type_id: string
      col_type_id: string
      link_type_id: string
      is_default?: boolean
    }) => (await api.post<MatrixView>(`/projects/${projectId}/matrix-views`, payload)).data,
    onSuccess: invalidate,
  })
}

export function useDeleteMatrixView() {
  const invalidate = useInvalidate(['matrix-views'])
  return useMutation({
    mutationFn: async (id: string) => api.delete(`/matrix-views/${id}`),
    onSuccess: invalidate,
  })
}

export function useOrgUsers(orgId?: string) {
  return useQuery({
    queryKey: ['org-users', orgId],
    queryFn: async () => (await api.get<OrgUser[]>(`/organizations/${orgId}/users`)).data,
    enabled: !!orgId,
  })
}

export function useWorkflowRoles(documentId?: string) {
  return useQuery({
    queryKey: ['workflow-roles', documentId],
    queryFn: async () => (await api.get<WorkflowRole[]>(`/documents/${documentId}/workflow-roles`)).data,
    enabled: !!documentId,
  })
}

export function useAssignWorkflowRole(documentId: string) {
  const invalidate = useInvalidate(['workflow-roles'])
  return useMutation({
    mutationFn: async (payload: { user_id: string; role: 'reviewer' | 'approver' }) =>
      (await api.post<WorkflowRole>(`/documents/${documentId}/workflow-roles`, payload)).data,
    onSuccess: invalidate,
  })
}

export function useRevokeWorkflowRole() {
  const invalidate = useInvalidate(['workflow-roles'])
  return useMutation({
    mutationFn: async (id: string) => api.delete(`/workflow-roles/${id}`),
    onSuccess: invalidate,
  })
}

// §5.4 standards library + per-project reference documents
export function useStandards(orgId?: string) {
  return useQuery({
    queryKey: ['standards', orgId],
    queryFn: async () => (await api.get<ReferenceSource[]>(`/organizations/${orgId}/standards`)).data,
    enabled: !!orgId,
  })
}

export function useStandardsConsistency(orgId?: string) {
  return useQuery({
    queryKey: ['standards-consistency', orgId],
    queryFn: async () =>
      (await api.get<ReferenceConsistencyReport>(`/organizations/${orgId}/standards/consistency-report`)).data,
    enabled: !!orgId,
  })
}

export function useCreateStandard(orgId: string) {
  const invalidate = useInvalidate(['standards', 'standards-consistency'])
  return useMutation({
    mutationFn: async (form: FormData) =>
      (
        await api.post<ReferenceSource>(`/organizations/${orgId}/standards`, form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
      ).data,
    onSuccess: invalidate,
  })
}

export function useReferenceDocuments(projectId?: string) {
  return useQuery({
    queryKey: ['reference-documents', projectId],
    queryFn: async () =>
      (await api.get<ReferenceSource[]>(`/projects/${projectId}/reference-documents`)).data,
    enabled: !!projectId,
  })
}

export function useCreateReferenceDocument(projectId: string) {
  const invalidate = useInvalidate(['reference-documents'])
  return useMutation({
    mutationFn: async (form: FormData) =>
      (
        await api.post<ReferenceSource>(`/projects/${projectId}/reference-documents`, form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
      ).data,
    onSuccess: invalidate,
  })
}

export function useUpdateReferenceSource() {
  const invalidate = useInvalidate(['standards', 'reference-documents', 'standards-consistency'])
  return useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: Partial<ReferenceSource> }) =>
      (await api.patch<ReferenceSource>(`/reference-sources/${id}`, payload)).data,
    onSuccess: invalidate,
  })
}

export function useDeleteReferenceSource() {
  const invalidate = useInvalidate(['standards', 'reference-documents', 'standards-consistency'])
  return useMutation({
    mutationFn: async (id: string) => api.delete(`/reference-sources/${id}`),
    onSuccess: invalidate,
  })
}

export function useCreateLocator() {
  const invalidate = useInvalidate(['standards', 'reference-documents'])
  return useMutation({
    mutationFn: async ({
      sourceId,
      payload,
    }: {
      sourceId: string
      payload: { label: string; page_number?: number; locator_type?: string }
    }) => (await api.post<ReferenceLocator>(`/reference-sources/${sourceId}/locators`, payload)).data,
    onSuccess: invalidate,
  })
}

export function useDeleteLocator() {
  const invalidate = useInvalidate(['standards', 'reference-documents'])
  return useMutation({
    mutationFn: async (id: string) => api.delete(`/reference-locators/${id}`),
    onSuccess: invalidate,
  })
}

// §5.3 numeric parameters
export function useParameters(projectId?: string) {
  return useQuery({
    queryKey: ['parameters', projectId],
    queryFn: async () => (await api.get<Parameter[]>(`/projects/${projectId}/parameters`)).data,
    enabled: !!projectId,
  })
}

export function useCreateParameter(projectId: string) {
  const invalidate = useInvalidate(['parameters'])
  return useMutation({
    mutationFn: async (payload: {
      key: string
      name: string
      value?: number
      unit?: string
      data_type: 'constant' | 'derived'
      formula?: string
      source: string
      min?: number
      max?: number
      tolerance?: number
      description?: string
    }) => (await api.post<Parameter>(`/projects/${projectId}/parameters`, payload)).data,
    onSuccess: invalidate,
  })
}

export function useUpdateParameter() {
  const invalidate = useInvalidate(['parameters'])
  return useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: Partial<Parameter> }) =>
      (await api.patch<Parameter>(`/parameters/${id}`, payload)).data,
    onSuccess: invalidate,
  })
}

export function useDeleteParameter() {
  const invalidate = useInvalidate(['parameters'])
  return useMutation({
    mutationFn: async (id: string) => api.delete(`/parameters/${id}`),
    onSuccess: invalidate,
  })
}

export function useParameterUsages(parameterId?: string) {
  return useQuery({
    queryKey: ['parameter-usages', parameterId],
    queryFn: async () => (await api.get<ParameterUsage[]>(`/parameters/${parameterId}/usages`)).data,
    enabled: !!parameterId,
  })
}

export function useTraceabilityMatrix(
  projectId?: string,
  rowTypeId?: string,
  colTypeId?: string,
  linkTypeId?: string,
) {
  return useQuery({
    queryKey: ['traceability-matrix', projectId, rowTypeId, colTypeId, linkTypeId],
    queryFn: async () =>
      (
        await api.get<TraceabilityMatrix>(`/projects/${projectId}/traceability-matrix`, {
          params: { row_type_id: rowTypeId, col_type_id: colTypeId, link_type_id: linkTypeId },
        })
      ).data,
    enabled: !!(projectId && rowTypeId && colTypeId && linkTypeId),
  })
}
