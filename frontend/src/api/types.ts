import type { FieldChange, VersionSnapshot } from './collabTypes'

export type AttributeDataType =
  | 'text'
  | 'rich_text'
  | 'enum'
  | 'multi_enum'
  | 'number'
  | 'date'
  | 'boolean'
  | 'user_ref'
  | 'item_ref'

export type ItemTypeBehavior = 'structural' | 'content'

export interface EnumOption {
  value: string
  label: string
  deprecated: boolean
  // On the workflow-managed "status" attribute: the state's color.
  color?: string | null
}

export interface ItemTypeAttribute {
  id: string
  key: string
  label: string
  data_type: AttributeDataType
  enum_options: EnumOption[] | null
  unit: string | null
  min: number | null
  max: number | null
  required: boolean
  order: number
  is_system: boolean
  deprecated: boolean
}

export interface ItemType {
  id: string
  key: string
  name: string
  prefix: string
  icon: string | null
  color: string | null
  behavior: ItemTypeBehavior
  is_system: boolean
  attributes: ItemTypeAttribute[]
}

export interface LinkType {
  id: string
  key: string
  name: string
  inverse_name: string
  allowed_source_types: string[]
  allowed_target_types: string[]
}

export interface Link {
  id: string
  source_item_id: string
  target_item_id: string
  link_type_id: string
  created_at: string
}

export interface Item {
  id: string
  document_id: string
  parent_id: string | null
  item_type_id: string
  key: string | null
  title: string
  description_md: string | null
  attributes: Record<string, unknown>
  order: number
  created_at: string
  updated_at: string
  updated_by: string | null
  number: string | null
  children: Item[]
  depth: number
  approved_by: string | null
  approved_at: string | null
  approval_stale: boolean
  // Concurrency: content version (ETag = "<id>:<version>") and live lock.
  version: number
  etag: string | null
  lock: EditLock | null
  // Workflow: retired items and why content can't be edited right now.
  obsolete: boolean
  read_only_reason: string | null
  has_workflow: boolean
  suspect_links: number
  source_item_id: string | null
  source_version: number | null
}

export interface EditLock {
  scope: 'item' | 'structure'
  target_id: string
  document_id: string | null
  user_id: string
  user_name: string
  acquired_at: string
  expires_at: string
  implicit: boolean
}

export interface WorkflowRole {
  id: string
  document_id: string
  user_id: string
  role: 'reviewer' | 'approver'
  username: string
  display_name: string
}

export interface OrgUser {
  id: string
  username: string
  display_name: string
  email: string | null
}

export interface Organization {
  id: string
  name: string
}

export interface Project {
  id: string
  org_id: string
  name: string
  visibility: 'public' | 'private'
  gitlab_repo_url: string | null
  default_branch: string
  kind: 'project' | 'library'
  key_prefix: string | null
  mission_attribute_defs: MissionAttributeDef[]
  mission_attributes: Record<string, unknown>
}

export interface MissionAttributeDef {
  key: string
  label?: string
  type: 'boolean' | 'enum' | 'number' | 'text'
  options?: string[]
}

export interface Document {
  id: string
  project_id: string
  name: string
  order: number
  group_id: string | null
}

export interface DocumentGroup {
  id: string
  project_id: string
  name: string
  order: number
}

export interface TableViewColumn {
  attribute_key: string
  width: number | null
}

export interface TableView {
  id: string
  project_id: string
  name: string
  scope: 'personal' | 'shared'
  owner_id: string | null
  item_type_id: string | null
  columns: TableViewColumn[]
  filters: Record<string, unknown> | null
  sort: Record<string, unknown> | null
  is_default: boolean
  created_by: string | null
}

export interface MatrixView {
  id: string
  project_id: string
  name: string
  scope: 'personal' | 'shared'
  owner_id: string | null
  row_type_id: string
  col_type_id: string
  link_type_id: string
  is_default: boolean
}

export interface MatrixAxisItem {
  id: string
  key: string | null
  title: string
}

export interface MatrixCell {
  row_id: string
  col_id: string
  link_ids: string[]
}

export interface TraceabilityMatrix {
  rows: MatrixAxisItem[]
  cols: MatrixAxisItem[]
  cells: MatrixCell[]
  uncovered_row_ids: string[]
}

export interface User {
  id: string
  org_id: string
  username: string
  email: string | null
  display_name: string
}

export interface GlossaryTerm {
  id: string
  org_id: string
  abbreviation: string
  term: string
  definition: string
  category: string | null
  updated_at: string
}

export interface GlossaryConsistencyReport {
  unused_terms: string[]
  undefined_references: string[]
}

export interface GraphNode {
  id: string
  key: string | null
  title: string
  item_type_id: string
  status: string | null
  depth: number
}

export interface GraphEdge {
  source: string
  target: string
  link_type_id: string
  label: string
}

export interface ItemGraph {
  center_id: string
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface Baseline {
  id: string
  project_id: string
  name: string
  git_commit_sha: string | null
  created_by: string | null
  created_at: string
  item_count: number
  description: string | null
  locks_items: boolean
}

export interface GitCommit {
  sha: string
  date: string
  message: string
}

export interface ItemComment {
  id: string
  item_id: string
  parent_comment_id: string | null
  author_id: string
  author_name: string
  body: string
  created_at: string
  updated_at: string
  resolved: boolean
  resolved_by: string | null
  resolved_at: string | null
  suggestion_id: string | null
  replies: ItemComment[]
}

export interface ReferenceLocator {
  id: string
  source_id: string
  label: string
  page_number: number | null
  locator_type: string
}

export interface ReferenceSource {
  id: string
  scope: 'standard' | 'project_reference'
  org_id: string | null
  project_id: string | null
  code: string
  title: string
  version: string | null
  source_type: 'pdf' | 'external_link'
  file_ref: string | null
  external_url: string | null
  superseded_by: string | null
  description: string | null
  created_at: string
  locators: ReferenceLocator[]
}

export interface ReferenceConsistencyReport {
  unused_sources: string[]
  superseded_citations: string[]
}

export interface Parameter {
  id: string
  project_id: string
  key: string
  name: string
  value: number | null
  computed_value: number | null
  unit: string | null
  data_type: 'constant' | 'derived'
  formula: string | null
  source: 'measured' | 'estimated' | 'derived' | 'assumed'
  min: number | null
  max: number | null
  tolerance: number | null
  updated_by: string | null
  description: string | null
  created_at: string
  updated_at: string
  used_in_count: number
}

export interface ParameterUsage {
  item_id: string
  item_key: string | null
  item_title: string
}

/** Structured error detail used by the concurrency/workflow endpoints
 * (423 locked, 412 version conflict, 409 read-only, 422 workflow refusal). */
export interface ApiErrorDetail {
  code?: string
  message?: string
  reasons?: string[]
  lock?: EditLock | null
  current_version?: number
  your_version?: number
  current?: VersionSnapshot
  changes_since_yours?: FieldChange[]
  etag?: string
}

export interface ApiErrorBody {
  detail?: string | ApiErrorDetail | { msg?: string; loc?: (string | number)[]; type?: string }[]
}

export * from './collabTypes'
export * from './libraryTypes'
