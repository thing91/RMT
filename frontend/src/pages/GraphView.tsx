import { useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useItemGraph, useItemTypes, useLinkTypes, useOrg, useProjectItems } from '../api/hooks'
import type { GraphNode } from '../api/types'
import ItemDetailPanel from '../components/ItemDetailPanel'
import { useT } from '../i18n'

const NODE_W = 180
const NODE_H_COLLAPSED = 56
const NODE_H_EXPANDED = 130
const COL_GAP = 260
const ROW_GAP_COLLAPSED = 76
const ROW_GAP_EXPANDED = 150

const STATUS_COLOR: Record<string, string> = {
  approved: '#16a34a',
  review: '#d97706',
  draft: '#94a3b8',
  pass: '#16a34a',
  fail: '#dc2626',
  pending: '#d97706',
}

const DEPTH_OPTIONS: { label: string; value: number | 'all' }[] = [
  { label: '0', value: 0 },
  { label: '1', value: 1 },
  { label: '2', value: 2 },
  { label: '3', value: 3 },
  { label: '5', value: 5 },
  { label: 'All', value: 'all' },
]

function stripMarkdown(md: string | null): string {
  if (!md) return ''
  return md.replace(/[#*_`>-]/g, '').replace(/\s+/g, ' ').trim()
}

/** Word-wraps text into at most `maxLines` tspans of roughly `maxChars`
 * characters each — enough for a graph-node description snippet without
 * pulling in a text-layout library. */
function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    if ((current + ' ' + word).trim().length > maxChars) {
      lines.push(current.trim())
      current = word
      if (lines.length === maxLines - 1) break
    } else {
      current = (current + ' ' + word).trim()
    }
  }
  if (current) lines.push(current.trim())
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = lines[maxLines - 1].slice(0, maxChars - 1) + '…'
  }
  return lines.slice(0, maxLines)
}

export default function GraphView() {
  const t = useT()
  const { projectId } = useParams<{ projectId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const centerId = searchParams.get('center') ?? undefined
  const { org } = useOrg()
  const orgId = org?.id

  const [depthUp, setDepthUp] = useState<number | 'all'>(3)
  const [depthDown, setDepthDown] = useState<number | 'all'>(3)
  const [showDescriptions, setShowDescriptions] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const { data: graph, isLoading } = useItemGraph(centerId, depthUp, depthDown)
  const { data: itemTypes } = useItemTypes(orgId)
  const { data: linkTypes } = useLinkTypes(orgId)
  const { data: projectItems } = useProjectItems(projectId)

  const nodeH = showDescriptions ? NODE_H_EXPANDED : NODE_H_COLLAPSED
  const rowGap = showDescriptions ? ROW_GAP_EXPANDED : ROW_GAP_COLLAPSED

  const layout = useMemo(() => {
    if (!graph) return null
    const byDepth = new Map<number, GraphNode[]>()
    for (const node of graph.nodes) {
      if (!byDepth.has(node.depth)) byDepth.set(node.depth, [])
      byDepth.get(node.depth)!.push(node)
    }
    const depths = Array.from(byDepth.keys()).sort((a, b) => a - b)
    const positions = new Map<string, { x: number; y: number }>()
    let maxRows = 1
    for (const depth of depths) {
      const nodes = byDepth.get(depth)!
      maxRows = Math.max(maxRows, nodes.length)
      const x = depth * COL_GAP
      const totalHeight = (nodes.length - 1) * rowGap
      nodes.forEach((node, i) => {
        positions.set(node.id, { x, y: i * rowGap - totalHeight / 2 })
      })
    }
    const minX = Math.min(...depths) * COL_GAP
    const maxX = Math.max(...depths) * COL_GAP
    const height = maxRows * rowGap + nodeH
    return { positions, minX, maxX, height }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, rowGap, nodeH])

  if (!projectId || !orgId) return null

  const selectedItem = projectItems?.find((i) => i.id === selectedId) ?? null
  const selectedType = itemTypes?.find((t) => t.id === selectedItem?.item_type_id)
  const itemById = new Map((projectItems ?? []).map((i) => [i.id, i]))

  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-auto p-6">
        <h1 className="mb-4 text-lg font-semibold text-slate-800">{t('Traceability Graph')}</h1>

        {!centerId ? (
          <p className="text-sm text-slate-400">
            {t("Open a requirement's details and choose “Graph” from the ⋯ menu to center the graph on it.")}
          </p>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-end gap-4 rounded-lg border border-slate-200 bg-white p-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">{t('Up levels')}</label>
                <select
                  className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  value={depthUp}
                  onChange={(e) =>
                    setDepthUp(e.target.value === 'all' ? 'all' : Number(e.target.value))
                  }
                >
                  {DEPTH_OPTIONS.map((o) => (
                    <option key={o.label} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">{t('Down levels')}</label>
                <select
                  className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  value={depthDown}
                  onChange={(e) =>
                    setDepthDown(e.target.value === 'all' ? 'all' : Number(e.target.value))
                  }
                >
                  {DEPTH_OPTIONS.map((o) => (
                    <option key={o.label} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-1.5 pb-1.5 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={showDescriptions}
                  onChange={(e) => setShowDescriptions(e.target.checked)}
                />
                {t('Show description in nodes')}
              </label>
              <p className="text-xs text-slate-400">
                {t('Click a node to see its details · double-click to re-center the graph on it')}
              </p>
            </div>

            {isLoading || !graph || !layout ? (
              <p className="text-sm text-slate-400">{t('Loading graph…')}</p>
            ) : (
              <div className="overflow-auto rounded-lg border border-slate-200 bg-white p-8">
                <svg
                  width={layout.maxX - layout.minX + NODE_W + 16}
                  height={layout.height}
                  viewBox={`${layout.minX - NODE_W / 2 - 8} ${-layout.height / 2} ${
                    layout.maxX - layout.minX + NODE_W + 16
                  } ${layout.height}`}
                >
                  <defs>
                    <marker
                      id="arrow"
                      viewBox="0 0 10 10"
                      refX="9"
                      refY="5"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto-start-reverse"
                    >
                      <path d="M0,0 L10,5 L0,10 z" fill="#94a3b8" />
                    </marker>
                  </defs>

                  {graph.edges.map((edge, i) => {
                    const from = layout.positions.get(edge.source)
                    const to = layout.positions.get(edge.target)
                    if (!from || !to) return null
                    const x1 = from.x + (from.x < to.x ? NODE_W / 2 : -NODE_W / 2)
                    const x2 = to.x + (to.x < from.x ? NODE_W / 2 : -NODE_W / 2)
                    const midX = (x1 + x2) / 2
                    const midY = (from.y + to.y) / 2
                    return (
                      <g key={i}>
                        <path
                          d={`M${x1},${from.y} C${midX},${from.y} ${midX},${to.y} ${x2},${to.y}`}
                          fill="none"
                          stroke="#cbd5e1"
                          strokeWidth={1.5}
                          markerEnd="url(#arrow)"
                        />
                        <rect
                          x={midX - edge.label.length * 3 - 4}
                          y={midY - 8}
                          width={edge.label.length * 6 + 8}
                          height={16}
                          fill="white"
                        />
                        <text
                          x={midX}
                          y={midY + 3}
                          fontSize={10}
                          fill="#64748b"
                          textAnchor="middle"
                        >
                          {edge.label}
                        </text>
                      </g>
                    )
                  })}

                  {graph.nodes.map((node) => {
                    const pos = layout.positions.get(node.id)
                    if (!pos) return null
                    const itemType = itemTypes?.find((t) => t.id === node.item_type_id)
                    const isCenter = node.id === graph.center_id
                    const statusColor = node.status ? STATUS_COLOR[node.status] : undefined
                    const description = showDescriptions
                      ? stripMarkdown(itemById.get(node.id)?.description_md ?? null)
                      : ''
                    return (
                      <g
                        key={node.id}
                        transform={`translate(${pos.x - NODE_W / 2}, ${pos.y - nodeH / 2})`}
                        className="cursor-pointer"
                        onClick={() => setSelectedId(node.id)}
                        onDoubleClick={() => {
                          setSearchParams({ center: node.id })
                          setSelectedId(null)
                        }}
                      >
                        <rect
                          width={NODE_W}
                          height={nodeH}
                          rx={8}
                          fill={isCenter ? '#eff6ff' : 'white'}
                          stroke={isCenter ? '#2563eb' : itemType?.color || '#cbd5e1'}
                          strokeWidth={isCenter ? 2 : 1.5}
                        />
                        {statusColor && (
                          <rect x={0} y={0} width={4} height={nodeH} rx={2} fill={statusColor} />
                        )}
                        <text x={10} y={20} fontSize={10} fill="#64748b" fontFamily="ui-monospace, monospace">
                          {node.key ?? itemType?.name}
                        </text>
                        <text x={10} y={38} fontSize={12} fill="#1e293b" fontWeight={500}>
                          {node.title.length > 24 ? node.title.slice(0, 24) + '…' : node.title}
                        </text>
                        {showDescriptions &&
                          description &&
                          wrapText(description, 30, 4).map((line, i) => (
                            <text key={i} x={10} y={56 + i * 14} fontSize={10} fill="#64748b">
                              {line}
                            </text>
                          ))}
                      </g>
                    )
                  })}
                </svg>
              </div>
            )}
          </>
        )}
      </div>

      {selectedItem && selectedType && itemTypes && linkTypes && (
        <ItemDetailPanel
          item={selectedItem}
          itemType={selectedType}
          itemTypes={itemTypes}
          linkTypes={linkTypes}
          allItems={projectItems ?? []}
          onClose={() => setSelectedId(null)}
          orgId={orgId}
        />
      )}
    </div>
  )
}
