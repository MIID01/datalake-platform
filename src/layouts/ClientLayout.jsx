import { useState, useEffect } from 'react'
import { Outlet, NavLink, useLocation } from 'react-router-dom'
import { auth } from '../lib/firebase'
import { useRiyadhTime } from '../hooks/useUtils'
import {
  LayoutDashboard, Users, Clock, FileText, CreditCard,
  LifeBuoy, Search, Bell, ChevronLeft, ChevronRight, Calendar,
} from 'lucide-react'
import '../styles/engineer.css'

const navItems = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/client', end: true },
  { icon: Calendar, label: 'Leave Approvals', path: '/client/leave-approvals' },
  { icon: Users, label: 'My Engineers', path: '/client/engineers' },
  { icon: Clock, label: 'Timesheet Approvals', path: '/client/timesheets' },
  { icon: CreditCard, label: 'PO & Budget', path: '/client/pos' },
  { icon: FileText, label: 'Invoices', path: '/client/invoices' },
  { icon: LifeBuoy, label: 'Support', path: '/client/support' },
]

export default function ClientLayout() {
  const [collapsed, setCollapsed] = useState(false)
  const time = useRiyadhTime()
  const location = useLocation()
  const [user, setUser] = useState(null)
  useEffect(() => auth.onAuthStateChanged(u => setUser(u)), [])

  return (
    <div className="app-layout" data-portal="engineer" data-theme="light">
      <aside className={`ceo-sidebar ${collapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          <img src="/images/icon.svg" alt="Datalake" style={{ width: 32, height: 32, flexShrink: 0 }} />
          <div className="sidebar-logo-text">
            <span>DATALAKE</span>
            <span>Client Portal</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = item.end
              ? location.pathname === item.path
              : location.pathname.startsWith(item.path) && item.path !== '/client'
            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.end}
                className={`nav-item ${isActive ? 'active' : ''}`}
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

      <header className={`ceo-topbar ${collapsed ? 'collapsed' : ''}`}>
        <div className="topbar-search">
          <Search className="search-icon" size={18} />
          <input type="text" placeholder="Search engineers, timesheets, invoices..." />
        </div>
        <div className="topbar-right">
          <span className="topbar-time">{time} AST</span>
          <div className="topbar-notification">
            <Bell size={20} />
            <span className="notif-badge">2</span>
          </div>
          <div className="topbar-avatar" title={user?.email}>
            {user?.email ? user.email.substring(0, 2).toUpperCase() : 'C'}
          </div>
        </div>
      </header>

      <main className={`main-area ${collapsed ? 'collapsed' : ''}`}>
        <div className="page-content page-enter">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
