import { NavLink, useParams } from 'react-router-dom'
import { useDocumentTree, useItemTypes } from '../api/hooks'
import type { Item } from '../api/types'

/** Walks the nested tree keeping only structural items (sections), with
 * `depth` counting ancestor *sections* only — a content item in between
 * doesn't add a level, matching how Document View sizes its headings. */
function flattenSections(
  items: Item[],
  isStructural: (itemTypeId: string) => boolean,
  depth = 0,
): (Item & { depth: number })[] {
  return items.flatMap((item) => {
    const structural = isStructural(item.item_type_id)
    const self = structural ? [{ ...item, depth }] : []
    return [...self, ...flattenSections(item.children, isStructural, structural ? depth + 1 : depth)]
  })
}

export default function DocumentToc({ documentId, orgId }: { documentId: string; orgId: string }) {
  const { projectId } = useParams<{ projectId: string }>()
  const { data: tree, isLoading } = useDocumentTree(documentId)
  const { data: itemTypes } = useItemTypes(orgId)

  if (isLoading || !itemTypes) {
    return <p className="px-3 py-2 text-xs text-slate-400">Loading…</p>
  }

  const structuralTypeIds = new Set(itemTypes.filter((t) => t.behavior === 'structural').map((t) => t.id))
  const sections = tree ? flattenSections(tree, (id) => structuralTypeIds.has(id)) : []

  if (sections.length === 0) {
    return <p className="px-3 py-2 text-xs text-slate-400">No sections yet.</p>
  }

  // Always the Document View (it scrolls to and highlights the section) —
  // Table View has no anchor support for a specific item.
  const base = `/projects/${projectId}/documents/${documentId}`

  return (
    <nav className="flex flex-col gap-0.5">
      {sections.map((s) => (
        <NavLink
          key={s.id}
          to={`${base}?item=${s.id}`}
          style={{ paddingLeft: 12 + s.depth * 14 }}
          className="truncate rounded-md py-1 pr-2 text-sm text-slate-600 hover:bg-slate-100"
        >
          {s.number ? <span className="mr-1.5 text-slate-400">{s.number}</span> : null}
          {s.title}
        </NavLink>
      ))}
    </nav>
  )
}
