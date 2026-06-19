import { useState, useEffect } from 'react'
import { Outlet, NavLink, useLocation } from 'react-router-dom'
import { auth } from '../lib/firebase'
import { Briefcase, Building2, TrendingUp, ChevronLeft, ChevronRight, LogOut, LayoutDashboard, Users, CheckSquare, Calendar } from 'lucide-react'
import { signOut } from '../lib/auth'
import PortalSwitcher from '../components/PortalSwitcher'
import '../styles/ceo.css'

// CRM portal. Reads from the same `clients` collection as /ceo/clients —
// single source of truth — but exposed to the `business` and `sales` roles
// (plus CEO) with a sales-funnel slant: pipeline view, per-client detail,
// interaction notes.

const navItems = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/crm/dashboard' },
  { icon: Building2,   label: 'Clients',  path: '/crm/clients' },
  { icon: TrendingUp,  label: 'Pipeline', path: '/crm/pipeline' },
  { icon: Users,       label: 'Contacts', path: '/crm/contacts' },
  { icon: CheckSquare, label: 'Tasks',    path: '/crm/tasks' },
  { icon: Calendar,    label: 'Timesheets', path: '/crm/timesheets' },
]

export default function CRMLayout() {
  const [collapsed, setCollapsed] = useState(false)
  const [email, setEmail] = useState('')
  const location = useLocation()

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(u => setEmail(u?.email || ''))
    return () => unsub()
  }, [])

  return (
    <div className="app-layout" data-portal="crm">
      <aside className={`ceo-sidebar ${collapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          <img src="/images/icon.svg" alt="Datalake" style={{ width: 32, height: 32, flexShrink: 0 }} />
          <div className="sidebar-logo-text">
            <span>DATALAKE</span>
            <span>CRM</span>
          </div>
        </div>

        <PortalSwitcher collapsed={collapsed} />

        <nav className="sidebar-nav">
          {navItems.map(item => {
            const Icon = item.icon
            const isActive = location.pathname.startsWith(item.path)
            return (
              <NavLink key={item.path} to={item.path} className={`nav-item ${isActive ? 'active' : ''}`}>
                <span className="nav-icon"><Icon size={20} /></span>
                <span className="nav-label">{item.label}</span>
              </NavLink>
            )
          })}
        </nav>

        <div className="sidebar-footer">
          <button onClick={() => signOut().catch(()=>{})} className="sidebar-collapse-btn" title={email}>
            <LogOut size={16} /> {!collapsed && <span>Sign out</span>}
          </button>
          <button className="sidebar-collapse-btn" onClick={() => setCollapsed(!collapsed)}>
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>

      <main className={`main-area ${collapsed ? 'collapsed' : ''}`}>
        <Outlet />
      </main>
    </div>
  )
}
