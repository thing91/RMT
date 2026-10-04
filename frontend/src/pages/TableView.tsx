import { useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { can, usePermissions } from '../api/collabHooks'
import { useOrg } from '../api/hooks'
import DocumentToolbar, { ModeToggle } from '../components/DocumentToolbar'
import ProjectTableExplorer from '../components/ProjectTableExplorer'
import { useT } from '../i18n'
import { LinkCreationProvider } from '../linking/LinkCreationContext'
import LinkCreationPopup from '../linking/LinkCreationPopup'

export default function TableView() {
  const { projectId, documentId } = useParams<{ projectId: string; documentId: string }>()
  const t = useT()
  const { org } = useOrg()
  const { data: perms } = usePermissions(projectId)
  const [searchParams] = useSearchParams()
  const splitOpen = searchParams.get('split') === '1'
  const [edit, setEdit] = useState(false)
  const canEdit = can(perms, 'item.edit')
  const editMode = canEdit && edit

  if (!projectId || !documentId || !org) return null

  return (
    <LinkCreationProvider>
      <div className="flex h-full flex-col overflow-hidden">
        <DocumentToolbar orgId={org.id} view="table">
          {canEdit && <ModeToggle edit={edit} onChange={setEdit} />}
        </DocumentToolbar>
        <div className="flex flex-1 overflow-hidden">
          <div className={splitOpen ? 'w-1/2 overflow-auto border-r border-slate-200 p-4' : 'flex-1 overflow-auto p-4'}>
            <ProjectTableExplorer projectId={projectId} orgId={org.id} editMode={editMode} />
          </div>
          {splitOpen && (
            <div className="flex w-1/2 flex-col overflow-hidden">
              <div className="border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-500">
                {t('Second pane — same project')}
              </div>
              <div className="flex-1 overflow-auto">
                <ProjectTableExplorer projectId={projectId} orgId={org.id} compact editMode={editMode} />
              </div>
            </div>
          )}
        </div>
        <LinkCreationPopup orgId={org.id} />
      </div>
    </LinkCreationProvider>
  )
}
