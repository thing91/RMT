import { useMemo, useState } from 'react'
import { apiErrorMessage } from '../../api/client'
import { useConvertComment, useCreateSuggestion, useReviews } from '../../api/collabHooks'
import type { Item, ItemComment, ItemType, LinkType } from '../../api/types'
import AttributeField from '../AttributeField'
import Modal, { btn, input } from './Modal'

interface Props {
  item: Item
  itemType: ItemType
  linkTypes: LinkType[]
  allItems: Item[]
  projectId: string
  fromComment?: ItemComment
  onClose: () => void
}

type Target = { value: string; label: string }

/** Formal change suggestion on one field of a requirement. Needs no edit
 * rights and no edit lock — any reader can suggest, in parallel. */
export default function SuggestionForm({ item, itemType, linkTypes, allItems, projectId, fromComment, onClose }: Props) {
  const create = useCreateSuggestion(item.id)
  const convert = useConvertComment()
  const { data: reviews } = useReviews(projectId, { status: 'open', item_id: item.id })

  const targets: Target[] = useMemo(
    () => [
      { value: 'title', label: 'Title' },
      { value: 'description_md', label: 'Description' },
      ...itemType.attributes
        .filter((a) => a.key !== 'status' && !a.deprecated)
        .map((a) => ({ value: `attributes.${a.key}`, label: a.label })),
      { value: 'links.add', label: 'Add a link' },
    ],
    [itemType],
  )

  const [target, setTarget] = useState('description_md')
  const current = (field: string): unknown =>
    field === 'title'
      ? item.title
      : field === 'description_md'
        ? (item.description_md ?? '')
        : field.startsWith('attributes.')
          ? item.attributes[field.slice(11)]
          : null
  const [value, setValue] = useState<unknown>(current('description_md'))
  const [linkTypeId, setLinkTypeId] = useState('')
  const [otherId, setOtherId] = useState('')
  const [direction, setDirection] = useState<'out' | 'in'>('out')
  const [rationale, setRationale] = useState(fromComment?.body ?? '')
  const [kind, setKind] = useState<'technical' | 'editorial'>('technical')
  const [severity, setSeverity] = useState<'minor' | 'major'>('minor')
  const [reviewId, setReviewId] = useState('')
  const [error, setError] = useState<string | null>(null)

  function changeTarget(t: string) {
    setTarget(t)
    setValue(current(t))
  }

  const attr = target.startsWith('attributes.') ? itemType.attributes.find((a) => `attributes.${a.key}` === target) : null

  function submit() {
    setError(null)
    const proposed =
      target === 'links.add' ? { link_type_id: linkTypeId, other_item_id: otherId, direction } : value
    const payload = {
      target_field: target,
      proposed_value: proposed,
      rationale: rationale.trim(),
      kind,
      severity,
      review_id: reviewId || null,
    }
    const onError = (err: unknown) => setError(apiErrorMessage(err, 'Could not create the suggestion.'))
    if (fromComment) convert.mutate({ commentId: fromComment.id, payload }, { onSuccess: onClose, onError })
    else create.mutate(payload, { onSuccess: onClose, onError })
  }

  return (
    <Modal
      wide
      title={`Suggest a change to ${item.key ?? item.title}`}
      onClose={onClose}
      footer={
        <>
          <button className={btn.secondary} onClick={onClose}>
            Cancel
          </button>
          <button
            className={btn.primary}
            onClick={submit}
            disabled={!rationale.trim() || create.isPending || convert.isPending}
          >
            Submit suggestion
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">What should change</span>
          <select className={input} value={target} onChange={(e) => changeTarget(e.target.value)}>
            {targets.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        {target === 'title' && (
          <input className={input} value={String(value ?? '')} onChange={(e) => setValue(e.target.value)} />
        )}
        {target === 'description_md' && (
          <textarea
            rows={6}
            className={input}
            value={String(value ?? '')}
            onChange={(e) => setValue(e.target.value)}
          />
        )}
        {attr && <AttributeField attribute={attr} value={value} onChange={setValue} />}
        {target === 'links.add' && (
          <div className="flex flex-wrap gap-2">
            <select className="rounded-md border border-slate-300 px-2 py-1 text-xs" value={linkTypeId} onChange={(e) => setLinkTypeId(e.target.value)}>
              <option value="">Link type…</option>
              {linkTypes.map((lt) => (
                <option key={lt.id} value={lt.id}>
                  {lt.name}
                </option>
              ))}
            </select>
            <select className="rounded-md border border-slate-300 px-2 py-1 text-xs" value={direction} onChange={(e) => setDirection(e.target.value as 'out' | 'in')}>
              <option value="out">this →</option>
              <option value="in">→ this</option>
            </select>
            <select className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs" value={otherId} onChange={(e) => setOtherId(e.target.value)}>
              <option value="">Item…</option>
              {allItems
                .filter((i) => i.id !== item.id && i.key)
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.key} — {i.title}
                  </option>
                ))}
            </select>
          </div>
        )}

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Justification (required)</span>
          <textarea rows={3} className={input} value={rationale} onChange={(e) => setRationale(e.target.value)} />
        </label>

        <div className="flex flex-wrap gap-4 text-xs">
          <fieldset className="flex items-center gap-2">
            <span className="font-medium text-slate-500">Type</span>
            {(['technical', 'editorial'] as const).map((k) => (
              <label key={k} className="flex items-center gap-1">
                <input type="radio" checked={kind === k} onChange={() => setKind(k)} />
                {k === 'technical' ? 'Technical' : 'Editorial'}
              </label>
            ))}
          </fieldset>
          <fieldset className="flex items-center gap-2">
            <span className="font-medium text-slate-500">Severity</span>
            {(['minor', 'major'] as const).map((k) => (
              <label key={k} className="flex items-center gap-1">
                <input type="radio" checked={severity === k} onChange={() => setSeverity(k)} />
                {k === 'major' ? 'Major' : 'Minor'}
              </label>
            ))}
          </fieldset>
          {(reviews ?? []).length > 0 && (
            <label className="flex items-center gap-2">
              <span className="font-medium text-slate-500">Raised in review</span>
              <select className="rounded-md border border-slate-300 px-2 py-0.5" value={reviewId} onChange={(e) => setReviewId(e.target.value)}>
                <option value="">— none —</option>
                {reviews!.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.key} {r.title}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {error && <p className="rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-700">⚠ {error}</p>}
      </div>
    </Modal>
  )
}
