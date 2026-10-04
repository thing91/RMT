import type { DiffOp } from '../../api/types'

/** Inline word diff: deletions struck through in red, insertions in green. */
export default function DiffText({ ops, className = '' }: { ops: DiffOp[] | null | undefined; className?: string }) {
  if (!ops || ops.length === 0) return <span className="text-slate-400">—</span>
  return (
    <span className={`whitespace-pre-wrap break-words ${className}`}>
      {ops.map((op, i) =>
        op.op === 'equal' ? (
          <span key={i}>{op.text}</span>
        ) : op.op === 'delete' ? (
          <del key={i} className="bg-red-100 text-red-700 decoration-red-400">
            {op.text}
          </del>
        ) : (
          <ins key={i} className="bg-green-100 text-green-800 no-underline">
            {op.text}
          </ins>
        ),
      )}
    </span>
  )
}

export function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (Array.isArray(v)) return v.join(', ')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

const FIELD_LABELS: Record<string, string> = {
  title: 'Title',
  description_md: 'Description',
  parent_id: 'Parent',
  order: 'Position',
  obsolete: 'Obsolete',
}

export function fieldLabel(field: string): string {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field]
  if (field.startsWith('attributes.')) return field.slice('attributes.'.length).replace(/_/g, ' ')
  return field
}
