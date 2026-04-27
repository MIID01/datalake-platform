import { useState } from 'react'
import { Outlet, NavLink, useLocation } from 'react-router-dom'
import { useRiyadhTime } from '../hooks/useUtils'
import {
  LayoutDashboard, Clock, Palmtree, CreditCard, FileText,
  Plane, GraduationCap, LifeBuoy, User, Settings,
  Search, Bell, ChevronLeft, ChevronRight, Sun, Moon
} from 'lucide-react'
import '../styles/engineer.css'

const navItems = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/portal', badge: null, end: true },
  { icon: Clock, label: 'Timesheets', path: '/portal/timesheets', badge: 1 },
  { icon: Palmtree, label: 'Leave & Holidays', path: '/portal/leave', badge: 1 },
  { icon: CreditCard, label: 'Expenses', path: '/portal/expenses', badge: 1 },
  { icon: FileText, label: 'Documents', path: '/portal/documents', badge: 1 },
  { icon: Plane, label: 'Travel & Logistics', path: '/portal/travel' },
  { icon: GraduationCap, label: 'Training', path: '/portal/training', badge: 3 },
  { icon: LifeBuoy, label: 'Support Tickets', path: '/portal/support' },
  { icon: User, label: 'My Profile', path: '/portal/profile' },
]

export default function EngineerLayout() {
  const [collapsed, setCollapsed] = useState(false)
  const [darkMode, setDarkMode] = useState(false)
  const time = useRiyadhTime()
  const location = useLocation()

  return (
    <div className="app-layout" data-portal="engineer" data-theme={darkMode ? 'dark' : 'light'}>
      {/* Sidebar */}
      <aside className={`ceo-sidebar ${collapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          <img src="/images/icon.svg" alt="Datalake" style={{ width: 32, height: 32, flexShrink: 0 }} />
          <div className="sidebar-logo-text">
            <span>DATALAKE</span>
            <span>Engineer Portal</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = item.end
              ? location.pathname === item.path
              : location.pathname.startsWith(item.path) && item.path !== '/portal'
            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.end}
                className={`nav-item ${isActive ? 'active' : ''}`}
                id={`nav-eng-${item.path.replace(/\//g, '-')}`}
              >
                <span className="nav-icon"><Icon size={20} /></span>
                <span className="nav-label">{item.label}</span>
                {item.badge && <span className="nav-badge">{item.badge}</span>}
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

      {/* Top Bar */}
      <header className={`ceo-topbar ${collapsed ? 'collapsed' : ''}`}>
        <div className="topbar-search">
          <Search className="search-icon" size={18} />
          <input type="text" placeholder="Search timesheets, documents, tickets..." id="eng-global-search" />
        </div>
        <div className="topbar-right">
          <span className="topbar-time">{time} AST</span>
          <button
            className="btn-icon"
            onClick={() => setDarkMode(!darkMode)}
            style={{ color: 'var(--text-secondary)' }}
            id="theme-toggle"
          >
            {darkMode ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <div className="topbar-notification" id="eng-notification-bell">
            <Bell size={20} />
            <span className="notif-badge">2</span>
          </div>
          <div className="topbar-avatar" id="eng-avatar">MA</div>
        </div>
      </header>

      {/* Main Content */}
      <main className={`main-area ${collapsed ? 'collapsed' : ''}`}>
        <div className="page-content page-enter">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
