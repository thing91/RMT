import { useState, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { can, usePermissions } from '../api/collabHooks'
import { useDocuments } from '../api/hooks'
import { useT } from '../i18n'
import { DocumentPresence } from './collab/PresenceAvatar'
import ReqifImportModal from './collab/ReqifImportModal'
import DocumentWorkflowModal from './DocumentWorkflowModal'

const segment = (active: boolean) =>
  `px-2.5 py-1 text-xs font-medium ${active ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`

const menuItem = 'block w-full rounded-md px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100'

/** The bar above a document: its name and who is in it, the view-specific
 * controls (search, filters, Review/Edit), Document/Table, Split, and a ⋯
 * menu for everything used now and then (export, import, approval roles). */
export default function DocumentToolbar({
  orgId,
  view,
  children,
  menuExtras,
  left,
}: {
  orgId: string
  view: 'document' | 'table'
  children?: ReactNode
  menuExtras?: (close: () => void) => ReactNode
  left?: ReactNode
}) {
  const { projectId, documentId } = useParams<{ projectId: string; documentId: string }>()
  const t = useT()
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: documents } = useDocuments(projectId)
  const { data: perms } = usePermissions(projectId)
  const [menuOpen, setMenuOpen] = useState(false)
  const [reqifOpen, setReqifOpen] = useState(false)
  const [rolesOpen, setRolesOpen] = useState(false)
  if (!projectId || !documentId) return null

  const doc = documents?.find((d) => d.id === documentId)
  const splitOn = searchParams.get('split') === '1'
  const base = `/projects/${projectId}/documents/${documentId}`
  const keep = splitOn ? '?split=1' : ''

  function toggleSplit() {
    const next = new URLSearchParams(searchParams)
    if (splitOn) next.delete('split')
    else next.set('split', '1')
    setSearchParams(next, { replace: true })
  }
  const close = () => setMenuOpen(false)

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2">
      {left}
      <h1 className="min-w-0 truncate text-sm font-semibold text-slate-800">{doc?.name ?? ''}</h1>
      <DocumentPresence documentId={documentId} size={20} />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>

      <div className="flex overflow-hidden rounded-md border border-slate-200">
        <Link to={`${base}${keep}`} className={segment(view === 'document')}>
          {t('Document')}
        </Link>
        <Link to={`${base}/table${keep}`} className={segment(view === 'table')}>
          {t('Table')}
        </Link>
      </div>
      <button
        onClick={toggleSplit}
        title={t('Side by side with another document')}
        className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
          splitOn ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-100'
        }`}
      >
        {t('Split')}
      </button>
      <div className="relative">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          aria-label={t('More')}
          className="rounded-md border border-slate-200 px-2 py-0.5 text-base leading-none text-slate-500 hover:bg-slate-100"
        >
          ⋯
        </button>
        {menuOpen && (
          <>
            <button aria-label={t('Close')} className="fixed inset-0 z-30 cursor-default" onClick={close} />
            <div className="absolute right-0 z-40 mt-1 w-60 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
              {menuExtras && (
                <div className="border-b border-slate-100 pb-1">{menuExtras(close)}</div>
              )}
              <div className="pt-1">
                <a href={`/api/v1/documents/${documentId}/export.xlsx`} className={menuItem} onClick={close}>
                  {t('Export to Excel')}
                </a>
                <a href={`/api/v1/documents/${documentId}/export.html`} className={menuItem} onClick={close}>
                  {t('Export to HTML')}
                </a>
                <a href={`/api/v1/documents/${documentId}/export.reqif`} className={menuItem} onClick={close}>
                  {t('Export to ReqIF')}
                </a>
                {can(perms, 'item.edit') ? (
                  <button
                    className={menuItem}
                    onClick={() => {
                      close()
                      setReqifOpen(true)
                    }}
                  >
                    {t('Import ReqIF…')}
                  </button>
                ) : null}
              </div>
              <div className="mt-1 border-t border-slate-100 pt-1">
                <button
                  className={menuItem}
                  onClick={() => {
                    close()
                    setRolesOpen(true)
                  }}
                >
                  {t('Review & approval roles…')}
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {reqifOpen && <ReqifImportModal documentId={documentId} onClose={() => setReqifOpen(false)} />}
      {rolesOpen && (
        <DocumentWorkflowModal
          documentId={documentId}
          documentName={doc?.name ?? ''}
          orgId={orgId}
          onClose={() => setRolesOpen(false)}
        />
      )}
    </div>
  )
}

/** "Review | Edit" — only rendered for people who may edit. */
export function ModeToggle({ edit, onChange }: { edit: boolean; onChange: (edit: boolean) => void }) {
  const t = useT()
  return (
    <div className="flex overflow-hidden rounded-md border border-slate-200">
      <button onClick={() => onChange(false)} className={segment(!edit)}>
        {t('Review')}
      </button>
      <button onClick={() => onChange(true)} className={segment(edit)}>
        ✎ {t('Edit')}
      </button>
    </div>
  )
}
