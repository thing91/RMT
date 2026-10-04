import { useState } from 'react'
import ItemTypesAdmin from '../pages/ItemTypesAdmin'
import LinkTypesAdmin from '../pages/LinkTypesAdmin'
import ReferenceDocumentsPanel from './ReferenceDocumentsPanel'

const tabClass = (active: boolean) =>
  `rounded-md px-3 py-1.5 text-sm font-medium ${
    active ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
  }`

type Tab = 'item-types' | 'link-types' | 'reference-documents'

/** Item Types / Link Types / Reference Documents management, reachable from
 * a project's sidebar instead of living as permanent top-level nav — the
 * first two are still org-wide resources under the hood (§ known
 * simplification: no project-level schema scoping), this just relocates
 * where you go to edit them. Reference Documents genuinely are
 * project-scoped (§5.4). */
export default function ProjectSettingsModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('item-types')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="flex h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
          <div className="flex gap-1">
            <button onClick={() => setTab('item-types')} className={tabClass(tab === 'item-types')}>
              Item Types
            </button>
            <button onClick={() => setTab('link-types')} className={tabClass(tab === 'link-types')}>
              Link Types
            </button>
            <button onClick={() => setTab('reference-documents')} className={tabClass(tab === 'reference-documents')}>
              Reference Documents
            </button>
          </div>
          <button onClick={onClose} title="Close" className="text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-auto">
          {tab === 'item-types' && <ItemTypesAdmin />}
          {tab === 'link-types' && <LinkTypesAdmin />}
          {tab === 'reference-documents' && <ReferenceDocumentsPanel projectId={projectId} />}
        </div>
      </div>
    </div>
  )
}
