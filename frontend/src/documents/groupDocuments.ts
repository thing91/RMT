import type { Document, DocumentGroup } from '../api/types'

export interface DocumentBucket {
  group: DocumentGroup | null
  documents: Document[]
}

/** Buckets a project's documents by their (flat, one-level) group — used by
 * both the project page's group manager and the sidebar's Documents tab so
 * the two stay in sync without duplicating the grouping logic. Ungrouped
 * documents get their own bucket (`group: null`), shown whenever any exist
 * or no real groups have been created yet. */
export function groupDocuments(documents: Document[], groups: DocumentGroup[]): DocumentBucket[] {
  const sortedGroups = [...groups].sort((a, b) => a.order - b.order)
  const buckets: DocumentBucket[] = sortedGroups.map((g) => ({ group: g, documents: [] }))
  const byGroupId = new Map(buckets.map((b) => [b.group!.id, b]))
  const ungrouped: DocumentBucket = { group: null, documents: [] }

  for (const doc of documents) {
    const bucket = doc.group_id ? byGroupId.get(doc.group_id) : undefined
    ;(bucket ?? ungrouped).documents.push(doc)
  }

  if (ungrouped.documents.length > 0 || sortedGroups.length === 0) buckets.push(ungrouped)
  return buckets
}
