import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useParams } from 'react-router-dom'
import { useDocumentGroups, useDocuments, useProject } from '../api/hooks'
import { useMyWork } from '../api/workspaceHooks'
import ProjectSettingsModal from '../components/ProjectSettingsModal'
import TopBar from '../components/TopBar'
import { DocumentPresence } from '../components/collab/PresenceAvatar'
import { groupDocuments } from '../documents/groupDocuments'
import { useT } from '../i18n'
import { ItemClipboardProvider } from '../structure/ItemClipboardContext'

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center justify-between gap-2 rounded-md px-3 py-1.5 text-sm ${
    isActive ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-600 hover:bg-slate-100'
  }`

const SIDEBAR_COLLAPSED_KEY = 'rmt_sidebar_collapsed'

function readCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="px-2 pb-2 pt-4">
      <div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <nav className="flex flex-col gap-0.5">{children}</nav>
    </div>
  )
}

function Count({ n }: { n: number }) {
  if (n <= 0) return null
  return <span className="rounded-full bg-amber-100 px-1.5 text-[11px] font-semibold text-amber-800">{n}</span>
}

/** Project frame: three fixed groups — the documents (always visible), the
 * work that flows through review and change, and the project's setup.
 * Everything document-specific (outline, exports, split, approval roles)
 * lives in the document's own toolbar instead. */
export default function ProjectLayout() {
  const { projectId } = useParams<{ projectId: string }>()
  const t = useT()
  const { data: project, isLoading: projectLoading } = useProject(projectId)
  const { data: documents } = useDocuments(projectId)
  const { data: documentGroups } = useDocumentGroups(projectId)
  const { data: work } = useMyWork(projectId)
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0')
    } catch {
      // not persisted
    }
  }, [collapsed])

  if (projectLoading) {
    return <div className="p-6 text-slate-500">{t('Loading…')}</div>
  }
  if (!project || !projectId) {
    return <div className="p-6 text-slate-500">{t('Project not found.')}</div>
  }

  const base = `/projects/${projectId}`
  const buckets = groupDocuments(documents ?? [], documentGroups ?? [])
  const counts = work?.counts
  const myTotal = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0

  return (
    <div className="flex h-screen flex-col bg-slate-50 text-slate-900">
      <TopBar>
        <span className="text-slate-300">/</span>
        <NavLink to={base} end className="truncate hover:text-blue-600">
          {project.name}
        </NavLink>
      </TopBar>
      <div className="flex flex-1 overflow-hidden">
        {!collapsed && (
          <aside className="flex w-64 shrink-0 flex-col overflow-auto border-r border-slate-200 bg-white">
            <Group label={t('Documents')}>
              {buckets.map((bucket) => (
                <div key={bucket.group?.id ?? 'ungrouped'} className="flex flex-col gap-0.5">
                  {bucket.group && (
                    <div className="mt-1 px-3 text-xs text-slate-400">{bucket.group.name}</div>
                  )}
                  {bucket.documents.map((doc) => (
                    <NavLink key={doc.id} to={`${base}/documents/${doc.id}`} className={linkClass}>
                      <span className="truncate">{doc.name}</span>
                      <DocumentPresence documentId={doc.id} size={16} max={3} />
                    </NavLink>
                  ))}
                </div>
              ))}
              {(documents ?? []).length === 0 && (
                <p className="px-3 py-1 text-xs text-slate-400">{t('No documents yet.')}</p>
              )}
            </Group>

            <Group label={t('Work')}>
              <NavLink to={base} end className={linkClass}>
                {t('My work')}
                <Count n={myTotal} />
              </NavLink>
              <NavLink to={`${base}/reviews`} className={linkClass}>
                {t('Reviews')}
                <Count n={counts?.vote ?? 0} />
              </NavLink>
              <NavLink to={`${base}/suggestions`} className={linkClass}>
                {t('Change suggestions')}
                <Count n={counts?.suggestion ?? 0} />
              </NavLink>
              <NavLink to={`${base}/changes`} className={linkClass}>
                {t('Change requests & verification')}
                <Count n={(counts?.reverify ?? 0) + (counts?.change_request ?? 0)} />
              </NavLink>
            </Group>

            <Group label={t('Project')}>
              {project.kind === 'library' ? (
                <NavLink to={`${base}/releases`} className={linkClass}>
                  {t('Library releases')}
                </NavLink>
              ) : (
                <NavLink to={`${base}/applicability`} className={linkClass}>
                  {t('Applicability')}
                </NavLink>
              )}
              <NavLink to={`${base}/matrix`} className={linkClass}>
                {t('Traceability matrix')}
              </NavLink>
              <NavLink to={`${base}/parameters`} className={linkClass}>
                {t('Parameters')}
              </NavLink>
              <NavLink to={`${base}/baselines`} className={linkClass}>
                {t('Baselines')}
              </NavLink>
              <NavLink to={`${base}/workflows`} className={linkClass}>
                {t('Workflows')}
              </NavLink>
              <button onClick={() => setSettingsOpen(true)} className={linkClass({ isActive: false })}>
                {t('Settings')}
              </button>
            </Group>
          </aside>
        )}

        <button
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? t('Expand sidebar') : t('Collapse sidebar')}
          aria-label={collapsed ? t('Expand sidebar') : t('Collapse sidebar')}
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

      {settingsOpen && <ProjectSettingsModal projectId={projectId} onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
