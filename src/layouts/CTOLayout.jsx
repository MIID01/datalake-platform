import { useState, useEffect } from 'react'
import { Outlet, NavLink, useLocation } from 'react-router-dom'
import { useRiyadhTime } from '../hooks/useUtils'
import {
  LayoutDashboard, ClipboardCheck, FolderKanban, Users, BarChart3,
  ChevronLeft, ChevronRight, Search, Bell, LogOut, Calendar
} from 'lucide-react'
import { signIn, signOut, onAuthChange } from '../lib/auth'
import PortalSwitcher from '../components/PortalSwitcher'
import '../styles/ceo.css'

// CTO portal access is CEO-only (CTO role is vacant; the CEO acts as CTO). The
// dormant cto@datalake.sa identity was removed. A real CTO would be gated via RBAC.
const CEO_EMAIL = 'm.alqumri@datalake.sa'

const navItems = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/cto', end: true },
  { icon: ClipboardCheck, label: 'Timesheet Approvals', path: '/cto/approvals', glow: true },
  { icon: Calendar, label: 'Project Timesheets', path: '/cto/timesheets' },
  { icon: FolderKanban, label: 'Projects', path: '/cto/projects' },
  { icon: Users, label: 'Team Utilization', path: '/cto/utilization', disabled: true },
  { icon: BarChart3, label: 'Engineer Roster', path: '/cto/roster', disabled: true },
]

export default function CTOLayout() {
  const [collapsed, setCollapsed] = useState(false)
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authError, setAuthError] = useState('')
  const time = useRiyadhTime()
  const location = useLocation()

  useEffect(() => {
    const unsub = onAuthChange((firebaseUser) => {
      setUser(firebaseUser)
      setAuthLoading(false)
    })
    return () => unsub()
  }, [])

  const handleSignIn = async () => {
    setAuthError('')
    try {
      const result = await signIn()
      if (result.email !== CEO_EMAIL) {
        setAuthError(`Access denied. ${result.email} is not authorized for the CTO portal.`)
        await signOut()
      }
    } catch (err) { setAuthError(err.message || 'Sign-in failed') }
  }

  const handleSignOut = async () => { await signOut(); setUser(null) }

  if (authLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0a1628', color: '#fff', fontFamily: "'DM Sans', sans-serif" }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 40, height: 40, border: '3px solid rgba(255,255,255,0.2)', borderTopColor: '#34BF3A', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
          <div style={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.6)' }}>Verifying identity...</div>
        </div>
      </div>
    )
  }

  if (!user || user.email !== CEO_EMAIL) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'linear-gradient(135deg, #0a1628 0%, #1a3a2a 100%)', fontFamily: "'DM Sans', sans-serif" }}>
        <div style={{ background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, padding: '48px 40px', maxWidth: 420, width: '90%', textAlign: 'center' }}>
          <img src="/images/icon.svg" alt="Datalake" style={{ width: 48, height: 48, marginBottom: 20 }} />
          <h1 style={{ color: '#fff', fontSize: '1.5rem', fontWeight: 700, marginBottom: 8 }}>CTO — Project Director</h1>
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.85rem', marginBottom: 32 }}>Sign in with your Datalake account</p>
          <a href="/" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, width: '100%', padding: '14px 24px', border: 'none', borderRadius: 12, background: '#1598CC', color: '#fff', fontWeight: 600, fontSize: '0.95rem', fontFamily: 'inherit', cursor: 'pointer', boxShadow: '0 4px 14px rgba(0,0,0,0.2)', textDecoration: 'none' }}>
            Sign in
          </a>
          {authError && <div style={{ marginTop: 16, padding: '10px 16px', background: 'rgba(192,57,43,0.15)', border: '1px solid rgba(192,57,43,0.3)', borderRadius: 8, color: '#ff6b6b', fontSize: '0.82rem' }}>{authError}</div>}
        </div>
      </div>
    )
  }

  return (
    <div className="app-layout" data-portal="ceo">
      <aside className={`ceo-sidebar ${collapsed ? 'collapsed' : ''}`} style={{ '--sidebar-accent': '#34BF3A' }}>
        <div className="sidebar-header">
          <img src="/images/icon.svg" alt="Datalake" style={{ width: 32, height: 32, flexShrink: 0 }} />
          <div className="sidebar-logo-text">
            <span>DATALAKE</span>
            <span>CTO Portal</span>
          </div>
        </div>
        <nav className="sidebar-nav">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = item.end
              ? location.pathname === item.path
              : location.pathname.startsWith(item.path) && item.path !== '/cto'
            if (item.disabled) {
              return (
                <div key={item.path} className="nav-item" style={{ opacity: 0.35, cursor: 'default' }}>
                  <span className="nav-icon"><Icon size={20} /></span>
                  <span className="nav-label">{item.label}</span>
                  <span style={{ fontSize: '0.55rem', background: 'rgba(255,255,255,0.1)', padding: '1px 6px', borderRadius: 6, color: 'rgba(255,255,255,0.4)' }}>Soon</span>
                </div>
              )
            }
            return (
              <NavLink key={item.path} to={item.path} end={item.end}
                className={`nav-item ${isActive ? 'active' : ''} ${item.glow ? 'approvals-glow' : ''}`}>
                <span className="nav-icon"><Icon size={20} /></span>
                <span className="nav-label">{item.label}</span>
              </NavLink>
            )
          })}
        </nav>
        {!collapsed && <PortalSwitcher collapsed={collapsed} theme="dark" />}
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
          <input type="text" placeholder="Search timesheets, engineers..." />
        </div>
        <div className="topbar-right">
          <span className="topbar-time">{time} AST</span>
          <div className="topbar-notification"><Bell size={20} /><span className="notif-badge">0</span></div>
          {user?.photoURL && <img src={user.photoURL} alt="" style={{ width: 32, height: 32, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.2)' }} />}
          <div className="topbar-avatar" title={user?.email}>CTO</div>
          <button onClick={handleSignOut} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', fontFamily: 'inherit' }} title="Sign out">
            <LogOut size={16} />
          </button>
        </div>
      </header>
      <main className={`main-area ${collapsed ? 'collapsed' : ''}`}>
        <div className="page-content page-enter"><Outlet /></div>
      </main>
    </div>
  )
}
