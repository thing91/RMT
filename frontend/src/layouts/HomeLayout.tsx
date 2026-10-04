import { Outlet } from 'react-router-dom'
import TopBar from '../components/TopBar'

/** Outside a project: just the top bar and the page. Organization
 * administration lives behind the ⚙ button, personal things in the account
 * menu — no permanent sidebar. */
export default function HomeLayout() {
  return (
    <div className="flex h-screen flex-col bg-slate-50 text-slate-900">
      <TopBar />
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
