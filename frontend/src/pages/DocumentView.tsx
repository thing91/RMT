import { useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useDocuments, useOrg } from '../api/hooks'
import DocumentReviewView from '../components/DocumentReviewView'
import { LinkCreationProvider } from '../linking/LinkCreationContext'
import LinkCreationPopup from '../linking/LinkCreationPopup'

/** The document's main view. With "Split view" on (sidebar → Views) a
 * second pane shows any document of the project side by side — e.g. system
 * requirements next to the verification plan, with point-and-click linking
 * across the two panes. */
export default function DocumentView() {
  const { projectId, documentId } = useParams<{ projectId: string; documentId: string }>()
  const { org } = useOrg()
  const { data: documents } = useDocuments(projectId)
  const [searchParams] = useSearchParams()
  const splitOpen = searchParams.get('split') === '1'
  const [secondDocumentId, setSecondDocumentId] = useState<string | undefined>(undefined)

  if (!projectId || !documentId || !org) return null
  const rightDocId = secondDocumentId ?? documentId

  return (
    <LinkCreationProvider>
      <div className="flex h-full overflow-hidden">
        <div className={splitOpen ? 'w-1/2 overflow-hidden border-r border-slate-200' : 'flex-1 overflow-hidden'}>
          <DocumentReviewView documentId={documentId} projectId={projectId} orgId={org.id} compact={splitOpen} />
        </div>
        {splitOpen && (
          <div className="flex w-1/2 flex-col overflow-hidden">
            <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Second pane:</span>
              <select
                className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                value={rightDocId}
                onChange={(e) => setSecondDocumentId(e.target.value)}
              >
                {(documents ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1 overflow-hidden">
              <DocumentReviewView key={rightDocId} documentId={rightDocId} projectId={projectId} orgId={org.id} compact />
            </div>
          </div>
        )}
      </div>
      <LinkCreationPopup orgId={org.id} />
    </LinkCreationProvider>
  )
}
