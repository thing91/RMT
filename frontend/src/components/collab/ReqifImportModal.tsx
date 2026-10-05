import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, apiErrorMessage } from '../../api/client'
import { useItemTypes, useOrg } from '../../api/hooks'
import Modal, { btn, input } from './Modal'
import { useT } from '../../i18n'

/** Append a ReqIF specification to the open document. */
export default function ReqifImportModal({ documentId, onClose }: { documentId: string; onClose: () => void }) {
  const t = useT()
  const { org } = useOrg()
  const { data: itemTypes } = useItemTypes(org?.id)
  const qc = useQueryClient()
  const contentTypes = (itemTypes ?? []).filter((t) => t.behavior === 'content')
  const [file, setFile] = useState<File | null>(null)
  const [typeId, setTypeId] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const chosenType = typeId || contentTypes[0]?.id || ''

  async function submit() {
    if (!file || !chosenType) return
    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('item_type_id', chosenType)
      const { data } = await api.post<{ sections: number; items: number }>(`/documents/${documentId}/import.reqif`, form)
      setResult(`Imported ${data.items} requirement(s) in ${data.sections} section(s).`)
      qc.invalidateQueries({ queryKey: ['document-tree'] })
      qc.invalidateQueries({ queryKey: ['project-items'] })
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not import this file.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={t('Import ReqIF into this document')}
      onClose={onClose}
      footer={
        result ? (
          <button className={btn.primary} onClick={onClose}>
            {t('Done')}
          </button>
        ) : (
          <>
            <button className={btn.secondary} onClick={onClose}>
              {t('Cancel')}
            </button>
            <button className={btn.primary} disabled={!file || !chosenType || busy} onClick={submit}>
              {t('Import')}
            </button>
          </>
        )
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-xs text-slate-500">
          {t("The specification's hierarchy is appended at the end of the document: entries with children become sections, the rest become requirements of the chosen type. Attributes are matched by name; new keys are assigned and every imported item starts in the workflow's initial state.")}
        </p>
        <input type="file" accept=".reqif,.xml" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">{t('Requirements become')}</span>
          <select className={input} value={chosenType} onChange={(e) => setTypeId(e.target.value)}>
            {contentTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        {result && <p className="rounded-md bg-green-50 px-2 py-1.5 text-xs text-green-800">{result}</p>}
        {error && <p className="rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-700">⚠ {error}</p>}
      </div>
    </Modal>
  )
}
