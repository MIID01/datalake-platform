import { useState, useEffect } from 'react'
import { Outlet, NavLink, useLocation } from 'react-router-dom'
import { useRiyadhTime } from '../hooks/useUtils'
import {
  LayoutDashboard, ClipboardCheck, FolderKanban, Users, BarChart3,
  ChevronLeft, ChevronRight, Search, Bell, LogOut
} from 'lucide-react'
import { signIn, signOut, onAuthChange } from '../lib/auth'
import '../styles/ceo.css'

const CTO_EMAIL = 'cto@datalake.sa'

const navItems = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/cto', end: true },
  { icon: ClipboardCheck, label: 'Timesheet Approvals', path: '/cto/approvals', glow: true },
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
      if (result.email !== CTO_EMAIL && result.email !== 'm.alqumri@datalake.sa') {
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

  if (!user || (user.email !== CTO_EMAIL && user.email !== 'm.alqumri@datalake.sa')) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'linear-gradient(135deg, #0a1628 0%, #1a3a2a 100%)', fontFamily: "'DM Sans', sans-serif" }}>
        <div style={{ background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, padding: '48px 40px', maxWidth: 420, width: '90%', textAlign: 'center' }}>
          <img src="/images/icon.svg" alt="Datalake" style={{ width: 48, height: 48, marginBottom: 20 }} />
          <h1 style={{ color: '#fff', fontSize: '1.5rem', fontWeight: 700, marginBottom: 8 }}>CTO — Project Director</h1>
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.85rem', marginBottom: 32 }}>Sign in with your Datalake account</p>
          <button onClick={handleSignIn} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, width: '100%', padding: '14px 24px', border: 'none', borderRadius: 12, background: '#fff', color: '#1A1A2E', fontWeight: 600, fontSize: '0.95rem', fontFamily: 'inherit', cursor: 'pointer', boxShadow: '0 4px 14px rgba(0,0,0,0.2)' }}>
            <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
            Sign in with Google
          </button>
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
