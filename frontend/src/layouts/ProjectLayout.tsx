import { useEffect, useState } from 'react'
import { NavLink, Outlet, useParams, useSearchParams } from 'react-router-dom'
import { useDocumentGroups, useDocuments, useItemTypes, useOrg, useProject, useTableViews } from '../api/hooks'
import DocumentToc from '../components/DocumentToc'
import DocumentWorkflowModal from '../components/DocumentWorkflowModal'
import ReqifImportModal from '../components/collab/ReqifImportModal'
import TopBar from '../components/TopBar'
import { groupDocuments } from '../documents/groupDocuments'
import { ItemClipboardProvider } from '../structure/ItemClipboardContext'
import { DocumentPresence } from '../components/collab/PresenceAvatar'

const docLinkClass = ({ isActive }: { isActive: boolean }) =>
  `block truncate rounded-md px-3 py-1.5 text-sm ${
    isActive ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-600 hover:bg-slate-100'
  }`

const sectionLabelClass = 'mb-1 mt-4 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400'

const SIDEBAR_COLLAPSED_KEY = 'rmt_sidebar_collapsed'
const SIDEBAR_TAB_KEY = 'rmt_sidebar_tab'

type SidebarTab = 'toc' | 'documents' | 'views' | 'project'

const SECTIONS: { id: SidebarTab; label: string }[] = [
  { id: 'toc', label: 'Table of contents' },
  { id: 'documents', label: 'Documents' },
  { id: 'views', label: 'Views' },
  { id: 'project', label: 'Project' },
]

function isSidebarTab(value: string | null): value is SidebarTab {
  return value === 'toc' || value === 'documents' || value === 'views' || value === 'project'
}

export default function ProjectLayout() {
  const { projectId, documentId } = useParams<{ projectId: string; documentId?: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: project, isLoading: projectLoading } = useProject(projectId)
  const { data: documents } = useDocuments(projectId)
  const { data: documentGroups } = useDocumentGroups(projectId)
  const { data: tableViews } = useTableViews(projectId)
  const { org } = useOrg()
  const { data: itemTypes } = useItemTypes(org?.id)

  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1',
  )
  const [activeTab, setActiveTab] = useState<SidebarTab>(() => {
    const stored = localStorage.getItem(SIDEBAR_TAB_KEY)
    return isSidebarTab(stored) ? stored : 'documents'
  })
  const [workflowOpen, setWorkflowOpen] = useState(false)
  const [reqifOpen, setReqifOpen] = useState(false)

  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0')
  }, [collapsed])

  useEffect(() => {
    localStorage.setItem(SIDEBAR_TAB_KEY, activeTab)
  }, [activeTab])

  if (projectLoading) {
    return <div className="p-6 text-slate-500">Loading…</div>
  }
  if (!project || !projectId) {
    return <div className="p-6 text-slate-500">Project not found.</div>
  }

  const splitOn = searchParams.get('split') === '1'
  function toggleSplit() {
    const next = new URLSearchParams(searchParams)
    if (splitOn) next.delete('split')
    else next.set('split', '1')
    setSearchParams(next, { replace: true })
  }

  // Saved Table Views aren't document-scoped (a view applies to a whole
  // project + item type), so a sidebar link needs *some* document in the
  // URL purely for the route/export-tab context — the currently open one,
  // or just the first if none is open yet.
  const targetDocId = documentId ?? documents?.[0]?.id
  const buckets = groupDocuments(documents ?? [], documentGroups ?? [])

  return (
    <div className="flex h-screen flex-col bg-slate-50 text-slate-900">
      <TopBar>
        <span className="text-slate-300">/</span>
        <NavLink to={`/projects/${projectId}`} className="hover:text-blue-600">
          {project.name}
        </NavLink>
      </TopBar>
      <div className="flex flex-1 overflow-hidden">
        {!collapsed && (
          <aside className="flex w-72 shrink-0 flex-col overflow-auto border-r border-slate-200 bg-white">
            {/* Vertically stacked, exclusive accordion — opening a section
                collapses whichever other one was open, rather than each
                section having its own independent collapse state. */}
            {SECTIONS.map((section) => {
              const isOpen = activeTab === section.id
              return (
                <div key={section.id} className="border-b border-slate-100">
                  <button
                    onClick={() => setActiveTab(section.id)}
                    className={`flex w-full items-center justify-between px-3 py-2.5 text-left text-sm font-medium ${
                      isOpen ? 'text-blue-700' : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {section.label}
                    <span className={`text-xs text-slate-400 transition-transform ${isOpen ? 'rotate-90' : ''}`}>
                      ▸
                    </span>
                  </button>

                  {isOpen && (
                    <div className="bg-slate-50/60 p-3">
                      {section.id === 'toc' &&
                        (documentId && org ? (
                          <DocumentToc documentId={documentId} orgId={org.id} />
                        ) : (
                          <p className="px-3 py-2 text-xs text-slate-400">
                            Open a document to see its outline.
                          </p>
                        ))}

                      {section.id === 'documents' && (
                        <>
                          {buckets.map((bucket) => (
                            <div key={bucket.group?.id ?? 'ungrouped'}>
                              {bucket.group ? (
                                <div className={sectionLabelClass}>{bucket.group.name}</div>
                              ) : (
                                (documentGroups ?? []).length > 0 && (
                                  <div className={sectionLabelClass}>Ungrouped</div>
                                )
                              )}
                              <nav className="flex flex-col gap-0.5">
                                {bucket.documents.map((doc) => (
                                  <NavLink
                                    key={doc.id}
                                    to={`/projects/${projectId}/documents/${doc.id}`}
                                    className={(s) => `${docLinkClass(s)} flex items-center justify-between gap-2`}
                                  >
                                    <span className="truncate">{doc.name}</span>
                                    <DocumentPresence documentId={doc.id} size={16} max={3} />
                                  </NavLink>
                                ))}
                              </nav>
                            </div>
                          ))}
                          {(documents ?? []).length === 0 && (
                            <p className="px-3 py-2 text-xs text-slate-400">No documents yet.</p>
                          )}
                          <NavLink
                            to={`/projects/${projectId}`}
                            end
                            className="mt-3 block px-3 text-xs font-medium text-blue-600 hover:text-blue-800"
                          >
                            + New document / manage groups →
                          </NavLink>
                        </>
                      )}

                      {section.id === 'views' && (
                        <>
                          {documentId ? (
                            <>
                              <nav className="flex flex-col gap-0.5">
                                <NavLink
                                  to={`/projects/${projectId}/documents/${documentId}`}
                                  end
                                  className={docLinkClass}
                                >
                                  Tree View
                                </NavLink>
                                <NavLink
                                  to={`/projects/${projectId}/documents/${documentId}/table`}
                                  className={docLinkClass}
                                >
                                  Table View
                                </NavLink>
                                <NavLink
                                  to={`/projects/${projectId}/documents/${documentId}/document`}
                                  className={docLinkClass}
                                >
                                  Document View
                                </NavLink>
                              </nav>
                              <div className="mt-1 flex gap-1 px-3">
                                <a
                                  href={`/api/v1/documents/${documentId}/export.xlsx`}
                                  className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100"
                                >
                                  Export XLSX
                                </a>
                                <a
                                  href={`/api/v1/documents/${documentId}/export.html`}
                                  className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100"
                                >
                                  Export HTML
                                </a>
                                <a
                                  href={`/api/v1/documents/${documentId}/export.reqif`}
                                  className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100"
                                >
                                  ReqIF
                                </a>
                                <button
                                  onClick={() => setReqifOpen(true)}
                                  className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100"
                                  title="Import a ReqIF file into this document"
                                >
                                  Import…
                                </button>
                              </div>
                              <label className="mt-1 flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-slate-600">
                                <input type="checkbox" checked={splitOn} onChange={toggleSplit} />
                                Split view
                              </label>
                              <button
                                onClick={() => setWorkflowOpen(true)}
                                className="mt-0.5 block rounded-md px-3 py-1.5 text-left text-sm text-slate-600 hover:bg-slate-100"
                              >
                                ⚖ Review &amp; approval
                              </button>
                            </>
                          ) : (
                            <p className="px-3 py-2 text-xs text-slate-400">Open a document to see its views.</p>
                          )}

                          {tableViews && tableViews.length > 0 && targetDocId && (
                            <>
                              <div className={sectionLabelClass}>Saved Table Views</div>
                              <nav className="flex flex-col gap-0.5">
                                {tableViews.map((v) => {
                                  const typeName = itemTypes?.find((t) => t.id === v.item_type_id)?.name
                                  return (
                                    <NavLink
                                      key={v.id}
                                      to={`/projects/${projectId}/documents/${targetDocId}/table?view=${v.id}`}
                                      className={docLinkClass}
                                      title={typeName ? `${v.name} — ${typeName}` : v.name}
                                    >
                                      {v.name}
                                      {typeName && <span className="text-slate-400"> · {typeName}</span>}
                                    </NavLink>
                                  )
                                })}
                              </nav>
                            </>
                          )}
                        </>
                      )}

                      {section.id === 'project' && (
                        <nav className="flex flex-col gap-0.5">
                          <NavLink to={`/projects/${projectId}/matrix`} className={docLinkClass}>
                            Traceability Matrix
                          </NavLink>
                          <NavLink to={`/projects/${projectId}/parameters`} className={docLinkClass}>
                            Parameters
                          </NavLink>
                          {project.kind === 'library' ? (
                            <NavLink to={`/projects/${projectId}/releases`} className={docLinkClass}>
                              Library releases
                            </NavLink>
                          ) : (
                            <NavLink to={`/projects/${projectId}/applicability`} className={docLinkClass}>
                              Applicability matrix
                            </NavLink>
                          )}
                          <div className={sectionLabelClass}>Review &amp; change</div>
                          <NavLink to={`/projects/${projectId}/reviews`} className={docLinkClass}>
                            Reviews
                          </NavLink>
                          <NavLink to={`/projects/${projectId}/suggestions`} className={docLinkClass}>
                            Change suggestions (RIDs)
                          </NavLink>
                          <NavLink to={`/projects/${projectId}/changes`} className={docLinkClass}>
                            Change requests &amp; suspect links
                          </NavLink>
                          <NavLink to={`/projects/${projectId}/workflows`} className={docLinkClass}>
                            Workflows
                          </NavLink>
                        </nav>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </aside>
        )}

        <button
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="flex w-4 shrink-0 items-center justify-center border-r border-slate-200 bg-white text-slate-300 hover:bg-slate-100 hover:text-slate-500"
        >
          {collapsed ? '›' : '‹'}
        </button>

        <main className="flex-1 overflow-auto">
          <ItemClipboardProvider>
            <Outlet />
          </ItemClipboardProvider>
        </main>
      </div>

      {reqifOpen && documentId && <ReqifImportModal documentId={documentId} onClose={() => setReqifOpen(false)} />}
      {workflowOpen && documentId && org && (
        <DocumentWorkflowModal
          documentId={documentId}
          documentName={documents?.find((d) => d.id === documentId)?.name ?? 'Document'}
          orgId={org.id}
          onClose={() => setWorkflowOpen(false)}
        />
      )}
    </div>
  )
}
