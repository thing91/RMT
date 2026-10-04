import { useParams, useSearchParams } from 'react-router-dom'
import { useOrg } from '../api/hooks'
import ProjectTableExplorer from '../components/ProjectTableExplorer'
import { LinkCreationProvider } from '../linking/LinkCreationContext'
import LinkCreationPopup from '../linking/LinkCreationPopup'

export default function TableView() {
  const { projectId, documentId } = useParams<{ projectId: string; documentId: string }>()
  const { org } = useOrg()
  const [searchParams] = useSearchParams()
  const splitOpen = searchParams.get('split') === '1'

  if (!projectId || !documentId || !org) return null

  return (
    <LinkCreationProvider>
      <div className="flex h-full flex-col p-6">
        <div className="-m-6 flex flex-1 overflow-hidden">
          <div
            className={
              splitOpen ? 'w-1/2 overflow-auto border-r border-slate-200 p-6' : 'flex-1 overflow-auto p-6'
            }
          >
            <ProjectTableExplorer projectId={projectId} orgId={org.id} />
          </div>

          {splitOpen && (
            <div className="flex w-1/2 flex-col overflow-hidden">
              <div className="border-b border-slate-200 bg-slate-50 px-3 py-2">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  Second pane — same project
                </span>
              </div>
              <div className="flex-1 overflow-auto">
                <ProjectTableExplorer projectId={projectId} orgId={org.id} compact />
              </div>
            </div>
          )}
        </div>

        <LinkCreationPopup orgId={org.id} />
      </div>
    </LinkCreationProvider>
  )
}
