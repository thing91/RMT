import type { ApiErrorDetail } from '../../api/types'
import DiffText, { fieldLabel, formatValue } from './DiffText'
import Modal, { btn } from './Modal'
import { useT } from '../../i18n'

interface Props {
  conflict: ApiErrorDetail
  mine: Record<string, unknown>
  onReload: () => void
  onOverwrite: () => void
  onClose: () => void
}

/** 412 from a content save: someone saved a newer version first. Shows
 * what they changed since the version this edit started from, and lets
 * the user discard their edit, re-apply it on top, or copy it out. */
export default function ConflictDialog({ conflict, mine, onReload, onOverwrite, onClose }: Props) {
  const t = useT()
  const changes = conflict.changes_since_yours ?? []
  const myText = Object.entries(mine)
    .map(([k, v]) => `${fieldLabel(k)}:\n${formatValue(v)}`)
    .join('\n\n')

  return (
    <Modal
      wide
      title={t('Someone else changed this item while you were editing')}
      onClose={onClose}
      footer={
        <>
          <button className={btn.secondary} onClick={() => navigator.clipboard?.writeText(myText)}>
            {t('Copy my changes')}
          </button>
          <button className={btn.secondary} onClick={onReload}>
            {t('Discard mine, load latest')}
          </button>
          <button className={btn.danger} onClick={onOverwrite}>
            {t('Apply mine on top of v{n}', { n: conflict.current_version })}
          </button>
        </>
      }
    >
      <p className="mb-3 text-sm text-slate-600">
        {t('You started from version {a}; the item is now at version {b}. Changes made in the meantime:', {
          a: conflict.your_version,
          b: conflict.current_version,
        })}
      </p>
      <div className="space-y-3">
        {changes.length === 0 && <p className="text-xs text-slate-400">{t('Only workflow/metadata changes.')}</p>}
        {changes.map((c) => (
          <div key={c.field} className="rounded-md border border-slate-200 p-2">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{t(fieldLabel(c.field))}</div>
            <div className="text-sm">
              {c.ops ? (
                <DiffText ops={c.ops} />
              ) : (
                <>
                  <del className="text-red-600">{formatValue(c.old)}</del> →{' '}
                  <ins className="text-green-700 no-underline">{formatValue(c.new)}</ins>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-md bg-amber-50 p-2 text-xs text-amber-800">
        <b>{t('Your unsaved edit:')}</b>
        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-sans">{myText}</pre>
        t('Apply mine on top') overwrites the fields you edited with your values, keeping their other changes.
      </div>
    </Modal>
  )
}
