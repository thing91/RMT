import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useBaseline, useDocumentTree, useGlossary, useOrg, useParameters, useReferenceDocuments, useStandards } from '../api/hooks'
import type { BaselineDetail, BaselineSnapshotItem, Item, ItemTypeAttribute } from '../api/types'
import { attrDisplay } from '../components/attrDisplay'
import StatusBadge from '../components/collab/StatusBadge'
import DescriptionPreview from '../components/DescriptionPreview'
import DocumentToolbar from '../components/DocumentToolbar'
import { useI18n } from '../i18n'

type Row = BaselineSnapshotItem & { depth: number; number: string | null }
type Diff = 'changed' | 'removed' | null

/** Rebuilds the frozen document in reading order with outline numbers —
 * computed the same way as the live document (sections numbered, content
 * items keep their keys). */
function orderedRows(snapshot: BaselineDetail['snapshot']): Row[] {
  const byParent = new Map<string | null, BaselineSnapshotItem[]>()
  for (const i of snapshot.items) {
    const list = byParent.get(i.parent_id) ?? []
    list.push(i)
    byParent.set(i.parent_id, list)
  }
  const structural = (i: BaselineSnapshotItem) => snapshot.item_types?.[i.item_type_id]?.behavior === 'structural'
  const rows: Row[] = []
  const walk = (parent: string | null, depth: number, prefix: string) => {
    const children = (byParent.get(parent) ?? []).sort((a, b) => a.order - b.order)
    let n = 0
    for (const child of children) {
      let number: string | null = null
      if (structural(child)) {
        n += 1
        number = `${prefix}${n}`
      }
      rows.push({ ...child, depth, number })
      walk(child.id, depth + 1, number ? `${number}.` : prefix)
    }
  }
  walk(null, 0, '')
  return rows
}

function flatten(items: Item[]): Item[] {
  return items.flatMap((i) => [i, ...flatten(i.children)])
}

/** A document baseline: the document exactly as it was frozen (e.g. for a
 * System Requirements Review). Read-only — nothing here can be edited,
 * commented or moved. "Compare with now" marks what changed since. */
export default function DocumentBaselineView() {
  const { projectId, documentId, baselineId } = useParams<{ projectId: string; documentId: string; baselineId: string }>()
  const { t, lang } = useI18n()
  const { org } = useOrg()
  const { data: baseline, isLoading, isError } = useBaseline(baselineId)
  const [compare, setCompare] = useState(false)
  const { data: liveTree } = useDocumentTree(compare ? documentId : undefined, true)
  const { data: glossaryTerms } = useGlossary(org?.id)
  const { data: standards } = useStandards(org?.id)
  const { data: referenceDocuments } = useReferenceDocuments(projectId)
  const { data: parameters } = useParameters(projectId)

  const rows = useMemo(() => (baseline ? orderedRows(baseline.snapshot) : []), [baseline])
  const live = useMemo(() => new Map(flatten(liveTree ?? []).map((i) => [i.id, i])), [liveTree])

  if (isLoading || !org) return <div className="p-6 text-slate-500">{t('Loading…')}</div>
  if (isError || !baseline || !projectId || !documentId) {
    return <div className="p-6 text-slate-500">{t('Baseline not found.')}</div>
  }

  const snap = baseline.snapshot
  const itemTypes = snap.item_types ?? {}
  const linkTypes = snap.link_types ?? {}
  const keyOf = (id: string) => {
    const inDoc = snap.items.find((i) => i.id === id)
    if (inDoc) return inDoc.key ?? inDoc.title
    const ext = snap.external_items?.[id]
    return ext ? (ext.key ?? ext.title) : '…'
  }
  const contentTypeCount = new Set(rows.filter((r) => itemTypes[r.item_type_id]?.behavior !== 'structural').map((r) => r.item_type_id)).size
  const when = new Date(baseline.created_at).toLocaleString(lang === 'pl' ? 'pl-PL' : 'en-GB')

  function diffOf(r: Row): Diff {
    if (!compare || !liveTree) return null
    const now = live.get(r.id)
    if (!now || now.obsolete) return 'removed'
    const same =
      now.title === r.title &&
      (now.description_md ?? '') === (r.description_md ?? '') &&
      JSON.stringify(now.attributes ?? {}) === JSON.stringify(r.attributes ?? {})
    return same ? null : 'changed'
  }
  const addedSince = compare && liveTree ? [...live.values()].filter((i) => !snap.items.some((s) => s.id === i.id) && !i.obsolete) : []
  const changedCount = compare ? rows.filter((r) => diffOf(r) !== null).length : 0

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <DocumentToolbar orgId={org.id} view="document" />
      <div className="flex flex-wrap items-center gap-3 border-b border-indigo-200 bg-indigo-50 px-4 py-2 text-sm text-indigo-900">
        <span>
          🔒 <b>{t('Baseline “{name}”', { name: baseline.name })}</b> ·{' '}
          {t('frozen {when} by {who}', { when, who: baseline.created_by ?? '—' })} · {t('read-only')}
        </span>
        {baseline.description && <span className="text-indigo-700">— {baseline.description}</span>}
        <span className="flex-1" />
        <label className="flex items-center gap-1.5 text-xs">
          <input id="baseline-compare" type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
          {t('Compare with the current version')}
        </label>
        <Link
          to={`/projects/${projectId}/documents/${documentId}`}
          className="rounded-md border border-indigo-300 bg-white px-2.5 py-1 text-xs font-medium text-indigo-800 hover:bg-indigo-100"
        >
          {t('Back to the current version')}
        </Link>
      </div>
      {compare && liveTree && (
        <div className="border-b border-slate-200 bg-white px-4 py-1.5 text-xs text-slate-600">
          {t('Since this baseline: {changed} changed or retired, {added} added.', {
            changed: changedCount,
            added: addedSince.length,
          })}
          {addedSince.length > 0 && (
            <span className="text-slate-400"> ({addedSince.map((i) => i.key ?? i.title).join(', ')})</span>
          )}
        </div>
      )}

      <div className="flex-1 overflow-auto px-6 py-4">
        <div className="mx-auto max-w-4xl rounded-lg border border-slate-200 bg-white pb-2">
          {rows.map((r) => {
            const type = itemTypes[r.item_type_id]
            const diff = diffOf(r)
            const mark =
              diff === 'changed'
                ? 'border-l-4 border-amber-400 bg-amber-50/40'
                : diff === 'removed'
                  ? 'border-l-4 border-red-300 bg-red-50/40'
                  : 'border-l-4 border-transparent'
            if (type?.behavior === 'structural') {
              const size = r.depth === 0 ? 'text-xl font-semibold' : r.depth === 1 ? 'text-lg font-medium' : 'text-base font-medium'
              return (
                <div key={r.id} className={`px-6 ${r.depth === 0 ? 'pb-1 pt-6' : 'pb-1 pt-4'} ${mark}`}>
                  <span className={`${size} text-slate-800`}>
                    {r.number && <span className="mr-2 text-slate-400">{r.number}</span>}
                    {r.title}
                  </span>
                </div>
              )
            }
            const meta: string[] = []
            if (contentTypeCount > 1 && type) meta.push(type.name)
            for (const a of type?.attributes ?? []) {
              if (a.key === 'status' || a.data_type === 'text' || a.data_type === 'rich_text') continue
              const v = attrDisplay(a as unknown as ItemTypeAttribute, r.attributes[a.key], t('Yes'))
              if (v) meta.push(`${a.label}: ${v}`)
            }
            const links = snap.links
              .filter((l) => l.source_item_id === r.id || l.target_item_id === r.id)
              .map((l) => {
                const out = l.source_item_id === r.id
                const lt = linkTypes[l.link_type_id]
                return `${out ? lt?.name : lt?.inverse_name} ${keyOf(out ? l.target_item_id : l.source_item_id)}`
              })
            const statusOption = type?.attributes.find((a) => a.key === 'status')?.enum_options?.find(
              (o) => o.value === r.attributes.status,
            )
            return (
              <div key={r.id} className={`px-6 py-2.5 ${mark}`}>
                <div className={`flex items-start gap-2 ${r.obsolete ? 'opacity-60' : ''}`}>
                  {r.key && <span className="mt-0.5 shrink-0 font-mono text-xs font-medium text-slate-500">{r.key}</span>}
                  <div className={`min-w-0 flex-1 text-[15px] font-medium text-slate-800 ${r.obsolete ? 'line-through' : ''}`}>
                    {r.title}
                  </div>
                  {diff === 'changed' && <span className="text-[11px] font-medium text-amber-700">{t('changed since')}</span>}
                  {diff === 'removed' && <span className="text-[11px] font-medium text-red-700">{t('retired or removed since')}</span>}
                  <StatusBadge
                    value={r.attributes.status}
                    label={statusOption?.label}
                    color={statusOption?.color}
                    small
                  />
                  <span className="shrink-0 font-mono text-[11px] text-slate-400">v{r.version}</span>
                </div>
                <div className={`mt-0.5 ${r.key ? 'pl-[4.5rem]' : ''}`}>
                  {r.description_md && (
                    <DescriptionPreview
                      text={r.description_md}
                      glossaryTerms={glossaryTerms ?? []}
                      referenceSources={[...(standards ?? []), ...(referenceDocuments ?? [])]}
                      parameters={parameters ?? []}
                    />
                  )}
                  {(type?.attributes ?? [])
                    .filter((a) => a.data_type === 'text' || a.data_type === 'rich_text')
                    .map((a) => {
                      const v = r.attributes[a.key]
                      if (!v) return null
                      return (
                        <p key={a.key} className="mt-1 whitespace-pre-wrap text-sm text-slate-600">
                          <span className="text-slate-400">{a.label}: </span>
                          {String(v)}
                        </p>
                      )
                    })}
                  {(meta.length > 0 || links.length > 0) && (
                    <p className="mt-1 text-xs text-slate-400">
                      {meta.join(' · ')}
                      {meta.length > 0 && links.length > 0 && ' · '}
                      {links.length > 0 && <span className="text-slate-500">{links.join(', ')}</span>}
                    </p>
                  )}
                </div>
              </div>
            )
          })}
          {rows.length === 0 && <p className="px-6 py-8 text-center text-sm text-slate-400">{t('No items yet.')}</p>}
        </div>
      </div>
    </div>
  )
}
