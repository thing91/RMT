import { useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useDocuments, useOrg } from '../api/hooks'
import DocumentExplorer from '../components/DocumentExplorer'
import { LinkCreationProvider } from '../linking/LinkCreationContext'
import LinkCreationPopup from '../linking/LinkCreationPopup'

export default function TreeView() {
  const { projectId, documentId } = useParams<{ projectId: string; documentId: string }>()
  const { org } = useOrg()
  const { data: documents } = useDocuments(projectId)
  const [searchParams] = useSearchParams()
  const splitOpen = searchParams.get('split') === '1'
  const [splitDocumentId, setSplitDocumentId] = useState<string | undefined>(undefined)

  if (!projectId || !documentId || !org) return null

  const rightDocId = splitDocumentId ?? documentId

  return (
    <LinkCreationProvider>
      <div className="flex h-full flex-col p-6">
        <div className="-m-6 flex flex-1 overflow-hidden">
          <div
            className={splitOpen ? 'w-1/2 overflow-auto border-r border-slate-200' : 'flex-1 overflow-auto'}
          >
            <DocumentExplorer documentId={documentId} orgId={org.id} compact={splitOpen} />
          </div>

          {splitOpen && (
            <div className="flex w-1/2 flex-col overflow-hidden">
              <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  Second pane:
                </span>
                <select
                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                  value={rightDocId}
                  onChange={(e) => setSplitDocumentId(e.target.value)}
                >
                  {(documents ?? []).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1 overflow-auto">
                <DocumentExplorer documentId={rightDocId} orgId={org.id} compact />
              </div>
            </div>
          )}
        </div>

        <LinkCreationPopup orgId={org.id} />
      </div>
    </LinkCreationProvider>
  )
}
