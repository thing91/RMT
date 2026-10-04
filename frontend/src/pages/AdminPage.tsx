import { NavLink, useParams } from 'react-router-dom'
import { useIsOrgAdmin } from '../api/collabHooks'
import { useT } from '../i18n'
import GlossaryAdmin from './GlossaryAdmin'
import ItemTypesAdmin from './ItemTypesAdmin'
import LinkTypesAdmin from './LinkTypesAdmin'
import OrganizationSettings from './OrganizationSettings'
import StandardsAdmin from './StandardsAdmin'
import WorkflowsAdmin from './WorkflowsAdmin'

const TABS = [
  { id: 'item-types', pl: 'Typy elementów', en: 'Item types', el: <ItemTypesAdmin /> },
  { id: 'link-types', pl: 'Typy powiązań', en: 'Link types', el: <LinkTypesAdmin /> },
  { id: 'workflows', pl: 'Workflow', en: 'Workflows', el: <WorkflowsAdmin /> },
  { id: 'organization', pl: 'Uprawnienia i ustawienia', en: 'Permissions & settings', el: <OrganizationSettings /> },
  { id: 'standards', pl: 'Normy', en: 'Standards', el: <StandardsAdmin /> },
  { id: 'glossary', pl: 'Słownik pojęć', en: 'Glossary', el: <GlossaryAdmin /> },
]

/** Everything that configures the organization, in one place behind the ⚙
 * button — kept out of the way of day-to-day work. */
export default function AdminPage() {
  const { tab } = useParams<{ tab?: string }>()
  const t = useT()
  const isAdmin = useIsOrgAdmin()
  const active = TABS.find((x) => x.id === tab) ?? TABS[0]
  const pl = t('Administration') !== 'Administration'
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 bg-white px-6 pt-5">
        <h1 className="text-lg font-semibold text-slate-800">{t('Organization administration')}</h1>
        {!isAdmin && (
          <p className="mt-1 text-xs text-slate-500">
            {pl ? 'Tylko do odczytu — zmiany może wprowadzać administrator organizacji.' : 'Read-only — only an organization admin can make changes.'}
          </p>
        )}
        <nav className="mt-3 flex gap-1 overflow-x-auto">
          {TABS.map((x) => (
            <NavLink
              key={x.id}
              to={`/admin/${x.id}`}
              className={() =>
                `-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
                  x.id === active.id ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'
                }`
              }
            >
              {pl ? x.pl : x.en}
            </NavLink>
          ))}
        </nav>
      </div>
      <div className="flex-1 overflow-auto">{active.el}</div>
    </div>
  )
}
