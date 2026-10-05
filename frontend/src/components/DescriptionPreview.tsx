import type { GlossaryTerm, Parameter, ReferenceSource } from '../api/types'
import { useT } from '../i18n'

const COMBINED_PATTERN =
  /\[\[(?!ref:)([A-Za-z0-9_.-]+)\]\]|\[\[ref:([A-Za-z0-9_.-]+)#([^\]]+)\]\]|\{\{param:([A-Za-z0-9_]+)\}\}/g

type Part =
  | string
  | { kind: 'glossary'; abbr: string; term: GlossaryTerm | undefined }
  | { kind: 'ref'; code: string; label: string; source: ReferenceSource | undefined }
  | { kind: 'param'; key: string; param: Parameter | undefined }

/** Lightweight, client-side echo of every inline reference kind the backend
 * resolves on export (§5.5's shared mechanism) — glossary `[[abbr]]`,
 * standards `[[ref:CODE#locator]]` (§5.4), and parameters `{{param:KEY}}`
 * (§5.3) — so the detail panel shows live previews, not just exports. Not
 * full Markdown rendering, just refs highlighted with hover tooltips. */
export default function DescriptionPreview({
  text,
  glossaryTerms,
  referenceSources,
  parameters,
}: {
  text: string
  glossaryTerms: GlossaryTerm[]
  referenceSources: ReferenceSource[]
  parameters: Parameter[]
}) {
  const t = useT()
  const byAbbr = new Map(glossaryTerms.map((t) => [t.abbreviation.toLowerCase(), t]))
  const byCode = new Map(referenceSources.map((s) => [s.code.toLowerCase(), s]))
  const byKey = new Map(parameters.map((p) => [p.key, p]))

  const parts: Part[] = []
  let lastIndex = 0
  for (const match of text.matchAll(COMBINED_PATTERN)) {
    const index = match.index ?? 0
    if (index > lastIndex) parts.push(text.slice(lastIndex, index))
    const [full, glossaryAbbr, refCode, refLabel, paramKey] = match
    if (glossaryAbbr) {
      parts.push({ kind: 'glossary', abbr: glossaryAbbr, term: byAbbr.get(glossaryAbbr.toLowerCase()) })
    } else if (refCode) {
      parts.push({ kind: 'ref', code: refCode, label: refLabel, source: byCode.get(refCode.toLowerCase()) })
    } else if (paramKey) {
      parts.push({ kind: 'param', key: paramKey, param: byKey.get(paramKey) })
    }
    lastIndex = index + full.length
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))

  return (
    <div className="whitespace-pre-wrap text-sm text-slate-700">
      {parts.map((part, i) => {
        if (typeof part === 'string') return <span key={i}>{part}</span>
        if (part.kind === 'glossary') {
          return (
            <span
              key={i}
              title={part.term ? part.term.definition : t('Undefined glossary reference')}
              className={
                part.term
                  ? 'cursor-help text-purple-700 underline decoration-dotted'
                  : 'cursor-help text-amber-600 underline decoration-wavy'
              }
            >
              {part.abbr}
            </span>
          )
        }
        if (part.kind === 'ref') {
          const locator = part.source?.locators.find((l) => l.label.toLowerCase() === part.label.toLowerCase())
          const stale = !!part.source?.superseded_by
          return (
            <span
              key={i}
              title={
                part.source
                  ? `${part.source.title}${part.source.version ? ` ${part.source.version}` : ''} — ${part.label}${stale ? ` (${t('superseded — newer version exists')})` : ''}`
                  : t('Undefined reference')
              }
              className={
                part.source
                  ? `cursor-help rounded border px-1 text-xs font-medium ${stale ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-teal-300 bg-teal-50 text-teal-700'}`
                  : 'cursor-help text-amber-600 underline decoration-wavy'
              }
            >
              {part.code}
              {locator ? `, ${locator.label}` : `#${part.label}`}
              {stale && ' ⚠'}
            </span>
          )
        }
        return (
          <span
            key={i}
            title={part.param ? `${part.param.name} (${part.param.data_type}, source: ${part.param.source})` : 'Undefined parameter'}
            className={
              part.param
                ? 'cursor-help rounded bg-blue-50 px-1 text-xs font-semibold text-blue-700'
                : 'cursor-help text-amber-600 underline decoration-wavy'
            }
          >
            {part.param
              ? `${part.param.computed_value ?? '?'}${part.param.unit ? ` ${part.param.unit}` : ''}`
              : `{{param:${part.key}}}`}
          </span>
        )
      })}
    </div>
  )
}
