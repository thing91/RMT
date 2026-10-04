// Types for collaboration features: versions, locks, workflow, reviews,
// change suggestions, notifications and permissions.

export interface DiffOp {
  op: 'equal' | 'insert' | 'delete'
  text: string
}

export interface FieldChange {
  field: string
  old: unknown
  new: unknown
  ops?: DiffOp[]
}

export interface VersionSnapshot {
  key: string | null
  title: string
  description_md: string | null
  attributes: Record<string, unknown>
  item_type_id: string
  parent_id: string | null
  order: number
  obsolete: boolean
}

export interface ItemVersion {
  version: number
  reason: 'create' | 'edit' | 'transition' | 'suggestion' | 'import' | 'migration' | 'revert'
  note: string | null
  source_ref: string | null
  author: string | null
  changed_by: string | null
  created_at: string
  status: string | null
}

export interface ItemVersionDetail extends ItemVersion {
  snapshot: VersionSnapshot
}

export interface VersionDiff {
  from_version: number
  to_version: number
  changes: FieldChange[]
}

export interface LockStatus {
  lock: import('./types').EditLock | null
  mine: boolean
  can_override: boolean
  timeout_minutes: number
}

export interface WorkflowState {
  key: string
  label: string
  category: 'draft' | 'active' | 'done' | 'side'
  read_only: boolean
  is_obsolete: boolean
  initial: boolean
  color: string | null
}

export interface WorkflowRule {
  type: string
  [key: string]: unknown
}

export interface WorkflowTransition {
  key: string
  label: string
  from: string[]
  to: string
  roles: string[]
  conditions: WorkflowRule[]
  actions: WorkflowRule[]
  requires_comment: boolean
}

export interface TransitionOption {
  key: string
  label: string
  to: string
  to_label: string
  requires_comment: boolean
  requires_signature: boolean
  allowed: boolean
  reasons: string[]
}

export interface HistoryEntry {
  id: string
  at: string
  actor: string | null
  transition: string | null
  transition_label: string | null
  from_state: string | null
  from_label: string | null
  to_state: string | null
  to_label: string | null
  comment: string | null
  notes: Record<string, unknown>
  version: number | null
}

export interface SubjectWorkflow {
  state: string | null
  state_label: string
  states: WorkflowState[]
  transitions: TransitionOption[]
  history: HistoryEntry[]
  read_only_reason: string | null
}

export interface WorkflowDefinition {
  id: string
  org_id: string
  project_id: string | null
  item_type_id: string
  item_type_name: string
  name: string
  variant: string
  states: WorkflowState[]
  transitions: WorkflowTransition[]
  settings: Record<string, unknown>
  is_override: boolean
  updated_at: string
}

export interface WorkflowTemplate {
  key: string
  name: string
  variant: string
  states: WorkflowState[]
  transitions: WorkflowTransition[]
}

export interface WorkflowCatalog {
  conditions: string[]
  actions: string[]
  role_tokens: string[]
  notify_targets: string[]
}

export interface BulkTransitionResult {
  applied: string[]
  skipped: { item_id: string; key: string | null; reason: string }[]
}

export interface ImpactEntry {
  item_id: string
  key: string | null
  title: string
  item_type: string
  relation: string
  link_id: string | null
}

export interface ChangeRequest {
  id: string
  key: string
  project_id: string
  item_id: string
  item_key: string | null
  item_title: string
  base_version: number
  implemented_version: number | null
  status: 'open' | 'accepted' | 'rejected' | 'implemented'
  reason: string
  impact: ImpactEntry[]
  requested_by: string | null
  decided_by: string | null
  decided_at: string | null
  created_at: string
}

export interface SuspectLink {
  id: string
  link_type: string
  source_item_id: string
  source_key: string | null
  source_title: string
  target_item_id: string
  target_key: string | null
  target_title: string
  changed_item_id: string | null
  reason: string | null
  since: string | null
}

export interface Signature {
  id: string
  user: string
  meaning: string
  subject_version: number | null
  content_hash: string
  transition_key: string | null
  signed_at: string
}

export interface AuditEvent {
  id: string
  created_at: string
  actor: string | null
  action: string
  subject_type: string
  subject_id: string | null
  summary: string
  payload: Record<string, unknown>
}

export interface AppNotification {
  id: string
  kind: string
  title: string
  body: string | null
  url: string | null
  actor: string | null
  subject_type: string | null
  subject_id: string | null
  read: boolean
  created_at: string
}

export interface NotificationPage {
  unread: number
  items: AppNotification[]
}

export interface WatchState {
  watching: boolean
  watchers: number
}

export interface Permissions {
  role: string | null
  permissions: string[]
  org_admin: boolean
  org_permissions: string[]
}

export type SuggestionStatus = 'open' | 'accepted' | 'accepted_modified' | 'rejected' | 'withdrawn' | 'outdated'

export interface Suggestion {
  id: string
  key: string
  project_id: string
  item_id: string
  item_key: string | null
  item_title: string
  document_id: string
  item_version: number
  item_current_version: number
  target_field: string
  target_label: string
  base_value: unknown
  proposed_value: unknown
  final_value: unknown
  current_value: unknown
  rationale: string
  kind: 'editorial' | 'technical'
  severity: 'major' | 'minor'
  status: SuggestionStatus
  status_label: string
  review_id: string | null
  review_key: string | null
  source_comment_id: string | null
  author_id: string
  author: string
  resolution_text: string | null
  resolved_by: string | null
  resolved_at: string | null
  apply_pending: boolean
  applied_version: number | null
  created_at: string
  updated_at: string
  diff: DiffOp[] | null
  diff_vs_current: DiffOp[] | null
}

export interface ReviewSummary {
  id: string
  key: string
  project_id: string
  title: string
  description: string | null
  status: 'open' | 'closed' | 'cancelled'
  outcome: string | null
  close_requires_resolved: 'none' | 'major' | 'all'
  require_all_votes: boolean
  created_by: string | null
  created_at: string
  closed_by: string | null
  closed_at: string | null
  due_date: string | null
  item_count: number
  votes_in: number
  votes_required: number
}

export interface ReviewItem {
  item_id: string
  document_id: string
  key: string | null
  title: string
  reviewed_version: number
  current_version: number
  changed_since: boolean
  status: string | null
  open_suggestions: number
}

export interface ReviewParticipant {
  user_id: string
  name: string
  required: boolean
  vote: 'approve' | 'approve_with_comments' | 'reject' | null
  vote_comment: string | null
  voted_at: string | null
}

export interface ReviewDetail extends ReviewSummary {
  items: ReviewItem[]
  participants: ReviewParticipant[]
  close_blockers: string[]
  can_manage: boolean
  my_vote: string | null
  i_am_participant: boolean
}
