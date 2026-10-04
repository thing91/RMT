import { NavLink, Outlet } from 'react-router-dom'
import TopBar from '../components/TopBar'

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `block rounded-md px-3 py-2 text-sm font-medium ${
    isActive ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
  }`

export default function HomeLayout() {
  return (
    <div className="flex h-screen flex-col bg-slate-50 text-slate-900">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <aside className="flex w-56 shrink-0 flex-col border-r border-slate-200 bg-white p-3">
          <nav className="flex flex-1 flex-col gap-1">
            <NavLink to="/" end className={navLinkClass}>
              Projects
            </NavLink>
            <div className="my-2 border-t border-slate-200" />
            <NavLink to="/admin/item-types" className={navLinkClass}>
              Item Types
            </NavLink>
            <NavLink to="/admin/link-types" className={navLinkClass}>
              Link Types
            </NavLink>
            <NavLink to="/standards" className={navLinkClass}>
              Standards Library
            </NavLink>
          </nav>
        </aside>
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
