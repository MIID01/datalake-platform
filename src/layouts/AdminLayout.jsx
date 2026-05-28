import { useState } from 'react'
import { Outlet, NavLink, useLocation } from 'react-router-dom'
import ErrorBoundary from '../components/ErrorBoundary'
import { useRiyadhTime } from '../hooks/useUtils'
import { auth } from '../lib/firebase'
import { signOut } from '../lib/auth'
import { KeyRound, ShieldCheck, ScrollText, UserCog, Plug, ChevronLeft, ChevronRight, LogOut, Lock } from 'lucide-react'
import '../styles/ceo.css'

// Distinct from the CEO portal (navy #022873) — IT Administration uses dark teal.
const ADMIN_DARK = '#0B3D4A'

const navItems = [
  { icon: KeyRound, label: 'Credentials', path: '/admin/credentials' },
  { icon: ShieldCheck, label: 'Access Management', path: '/admin/access' },
  { icon: ScrollText, label: 'Audit Logs', path: '/admin/audit' },
  { icon: UserCog, label: 'User Accounts', path: '/admin/users' },
  { icon: Plug, label: 'Integrations', path: '/admin/integrations' },
]

export default function AdminLayout() {
  const [collapsed, setCollapsed] = useState(false)
  const time = useRiyadhTime()
  const location = useLocation()

  const handleSignOut = async () => { await signOut() }

  return (
    <div className="app-layout" data-portal="admin">
      <aside className={`ceo-sidebar ${collapsed ? 'collapsed' : ''}`} style={{ background: ADMIN_DARK }}>
        <div className="sidebar-header">
          <img src="/images/icon.svg" alt="Datalake" style={{ width: 32, height: 32, flexShrink: 0 }} />
          <div className="sidebar-logo-text">
            <span>DATALAKE</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Lock size={11} /> IT Administration</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = location.pathname.startsWith(item.path)
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={`nav-item ${isActive ? 'active' : ''}`}
                id={`nav-admin-${item.path.replace(/\//g, '-')}`}
              >
                <span className="nav-icon"><Icon size={20} /></span>
                <span className="nav-label">{item.label}</span>
              </NavLink>
            )
          })}
        </nav>

        <div className="sidebar-footer">
          <button className="sidebar-collapse-btn" onClick={() => setCollapsed(!collapsed)}>
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>

      <header className={`ceo-topbar ${collapsed ? 'collapsed' : ''}`} style={{ background: ADMIN_DARK }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#fff', fontWeight: 600, fontSize: '0.9rem' }}>
          <ShieldCheck size={18} color="#1598CC" /> IT Administration — Segregated Access
        </div>
        <div className="topbar-right">
          <span className="topbar-time">{time} AST</span>
          <div className="topbar-avatar" title={auth.currentUser?.email}>IT</div>
          <button onClick={handleSignOut} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }} title="Sign out">
            <LogOut size={16} />
          </button>
        </div>
      </header>

      <main className={`main-area ${collapsed ? 'collapsed' : ''}`} style={{ background: '#07313B', minHeight: '100vh' }}>
        <div className="page-content page-enter">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </div>
      </main>
    </div>
  )
}
