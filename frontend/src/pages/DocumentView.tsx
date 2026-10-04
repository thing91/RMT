import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { can, usePermissions } from '../api/collabHooks'
import { useDocuments, useOrg } from '../api/hooks'
import DocumentReviewView from '../components/DocumentReviewView'
import DocumentToc from '../components/DocumentToc'
import DocumentToolbar, { ModeToggle } from '../components/DocumentToolbar'
import { useT } from '../i18n'
import { LinkCreationProvider } from '../linking/LinkCreationContext'
import LinkCreationPopup from '../linking/LinkCreationPopup'
import { useStatusPalette } from '../status/palette'

const TOC_KEY = 'rmt_toc_open'

function readToc() {
  try {
    return localStorage.getItem(TOC_KEY) !== '0'
  } catch {
    return true
  }
}

const menuItem = 'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100'

/** A document: toolbar on top, the outline on the left (collapsible), the
 * text in the middle, details on the right. Readers get Review only;
 * editors switch to Edit. With Split on, a second document sits alongside
 * for side-by-side reading and point-and-click linking. */
export default function DocumentView() {
  const { projectId, documentId } = useParams<{ projectId: string; documentId: string }>()
  const t = useT()
  const { org } = useOrg()
  const { data: documents } = useDocuments(projectId)
  const { data: perms } = usePermissions(projectId)
  const palette = useStatusPalette()
  const [searchParams] = useSearchParams()
  const splitOpen = searchParams.get('split') === '1'
  const [secondDocumentId, setSecondDocumentId] = useState<string | undefined>(undefined)
  const [edit, setEdit] = useState(false)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [showRetired, setShowRetired] = useState(false)
  const [resolvedOpen, setResolvedOpen] = useState(false)
  const [tocOpen, setTocOpen] = useState(readToc)

  const canEdit = can(perms, 'item.edit')
  const editMode = canEdit && edit

  useEffect(() => {
    try {
      localStorage.setItem(TOC_KEY, tocOpen ? '1' : '0')
    } catch {
      // not persisted
    }
  }, [tocOpen])

  // A new document starts unfiltered.
  useEffect(() => {
    setQuery('')
    setStatus('')
  }, [documentId])

  if (!projectId || !documentId || !org) return null
  const rightDocId = secondDocumentId ?? documents?.find((d) => d.id !== documentId)?.id ?? documentId

  return (
    <LinkCreationProvider>
      <div className="flex h-full flex-col overflow-hidden">
        <DocumentToolbar
          orgId={org.id}
          view="document"
          left={
            <button
              onClick={() => setTocOpen((v) => !v)}
              title={tocOpen ? t('Hide contents') : t('Show contents')}
              aria-label={tocOpen ? t('Hide contents') : t('Show contents')}
              className={`rounded-md p-1 ${tocOpen ? 'text-blue-600' : 'text-slate-400'} hover:bg-slate-100`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M3 6h18M3 12h12M3 18h15" />
              </svg>
            </button>
          }
          menuExtras={(close) => (
            <>
              <label className={menuItem}>
                <input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} />
                {t('Show retired requirements')}
              </label>
              <button
                className={menuItem}
                onClick={() => {
                  close()
                  setResolvedOpen((v) => !v)
                }}
              >
                {t('Resolved comments')}
              </button>
            </>
          )}
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('Search in document')}
            aria-label={t('Search in document')}
            className="w-44 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs focus:border-blue-400 focus:bg-white focus:outline-none"
          />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label={t('All statuses')}
            className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-1 text-xs text-slate-600"
          >
            <option value="">{t('All statuses')}</option>
            {palette.all().map((s) => (
              <option key={s.value} value={s.value}>
                {t(s.label)}
              </option>
            ))}
          </select>
          {canEdit && <ModeToggle edit={edit} onChange={setEdit} />}
        </DocumentToolbar>

        <div className="flex flex-1 overflow-hidden">
          {tocOpen && !splitOpen && (
            <aside className="w-60 shrink-0 overflow-auto border-r border-slate-200 bg-white py-3">
              <div className="mb-1 px-4 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{t('Contents')}</div>
              <DocumentToc documentId={documentId} orgId={org.id} />
            </aside>
          )}
          <div className={splitOpen ? 'w-1/2 overflow-hidden border-r border-slate-200' : 'flex-1 overflow-hidden'}>
            <DocumentReviewView
              documentId={documentId}
              projectId={projectId}
              orgId={org.id}
              compact={splitOpen}
              editMode={editMode}
              query={query}
              statusFilter={status}
              showObsolete={showRetired}
              resolvedOpen={resolvedOpen}
              onCloseResolved={() => setResolvedOpen(false)}
            />
          </div>
          {splitOpen && (
            <div className="flex w-1/2 flex-col overflow-hidden">
              <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5">
                <span className="text-xs text-slate-500">{t('Second document:')}</span>
                <select
                  className="rounded-md border border-slate-300 px-2 py-0.5 text-sm"
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
                <DocumentReviewView
                  key={rightDocId}
                  documentId={rightDocId}
                  projectId={projectId}
                  orgId={org.id}
                  compact
                  editMode={editMode}
                />
              </div>
            </div>
          )}
        </div>
      </div>
      <LinkCreationPopup orgId={org.id} />
    </LinkCreationProvider>
  )
}
