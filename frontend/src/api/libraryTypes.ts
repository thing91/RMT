// Generic requirements library + applicability matrix.
import type { FieldChange } from './collabTypes'

export interface LibraryRelease {
  id: string
  library_id: string
  name: string
  notes: string | null
  item_count: number
  released_by: string | null
  released_at: string
  previous_release_id: string | null
}

export interface LibrarySummary {
  id: string
  name: string
  latest_release: LibraryRelease | null
  requirement_count: number
  mission_attribute_defs: import('./types').MissionAttributeDef[]
}

export interface LibrarySubscription {
  library_id: string
  library_name: string
  release: LibraryRelease
  latest_release: LibraryRelease | null
  update_available: boolean
  declined_release: LibraryRelease | null
  declined_justification: string | null
  target_document_id: string | null
}

export interface ReleaseDiffEntry {
  item_id: string
  key: string | null
  title: string | null
  subsystem: string
  new_version?: number
  old_version?: number
  changes?: FieldChange[]
}

export interface ReleaseDiff {
  added: ReleaseDiffEntry[]
  changed: ReleaseDiffEntry[]
  removed: ReleaseDiffEntry[]
}

export type ApplicabilityStatus =
  | 'to_be_assessed'
  | 'applicable'
  | 'applicable_modified'
  | 'not_applicable_pending'
  | 'not_applicable'

export interface ApplicabilityRecord {
  id: string
  library_id: string
  release_name: string
  source_item_id: string
  source_version: number
  key: string | null
  title: string
  description_md: string | null
  resolved_title: string
  resolved_description: string
  missing_parameters: string[]
  subsystem: string
  status: ApplicabilityStatus
  status_label: string
  rationale: string | null
  modified_item_id: string | null
  modified_item_key: string | null
  modified_document_id: string | null
  decided_by: string | null
  decided_at: string | null
  approved_by: string | null
  approved_at: string | null
  suspect: boolean
  suspect_reason: string | null
  removed_from_library: boolean
  suggested_status: ApplicabilityStatus | null
  suggested_reason: string | null
}

export interface ApplicabilityRecordDetail extends ApplicabilityRecord {
  modification_diff: FieldChange[]
  attributes: Record<string, unknown>
}

export interface ApplicabilitySummary {
  total: number
  totals: Record<ApplicabilityStatus, number>
  by_subsystem: Record<string, Record<ApplicabilityStatus, number>>
  suspect: number
  complete: boolean
}

export interface LibraryRuleSpec {
  attribute: string
  op: 'eq' | 'ne' | 'in' | 'not_in' | 'gt' | 'lt' | 'truthy' | 'falsy'
  value?: unknown
  suggest: 'applicable' | 'not_applicable'
  reason?: string
}
