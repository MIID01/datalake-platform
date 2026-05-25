import { useState, useEffect } from 'react'
import { Outlet, NavLink, useLocation, Navigate } from 'react-router-dom'
import { useRiyadhTime } from '../hooks/useUtils'
import { auth, db } from '../lib/firebase'
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore'
import {
  Zap, BarChart3, Users, DollarSign, FileText, CheckSquare,
  Shield, TrendingUp, Bell, Settings, ChevronLeft, ChevronRight,
  Search, Menu, Bot, Inbox, LogOut, FolderKanban, Lock, Library
} from 'lucide-react'
import { signIn, signOut, onAuthChange } from '../lib/auth'
import '../styles/ceo.css'

const navItems = [
  { icon: Zap, label: 'Command Center', path: '/ceo', badge: 2, end: true },
  { icon: Inbox, label: 'Task Inbox', path: '/ceo/tasks', badge: 10, glow: true },
  { icon: BarChart3, label: 'Revenue Pipeline', path: '/ceo/pipeline', badge: null, info: 'SAR 11.2M' },
  { icon: FolderKanban, label: 'Projects', path: '/ceo/projects' },
  { icon: Users, label: 'Employee Directory', path: '/ceo/employees' },
  { icon: Users, label: 'Talent & HR', path: '/ceo/talent', badge: 3 },
  { icon: DollarSign, label: 'Finance', path: '/ceo/finance', badge: 2 },
  { icon: FileText, label: 'Contracts', path: '/ceo/contracts', badge: 2 },
  { icon: CheckSquare, label: 'Approvals', path: '/ceo/approvals', badge: 8, glow: true },
  { icon: FileText, label: 'Leave Requests', path: '/ceo/leave' },
  { icon: Inbox, label: 'Support Tickets', path: '/ceo/tickets' },
  { icon: DollarSign, label: 'Expenses', path: '/ceo/expenses' },
  { icon: Shield, label: 'Compliance', path: '/ceo/compliance', badge: 3 },
  { icon: Users, label: 'Training Matrix', path: '/ceo/training' },
  { icon: Library, label: 'Policy Library', path: '/ceo/policies' },
  { icon: TrendingUp, label: 'Analytics', path: '/ceo/analytics' },
  { icon: Bot, label: 'AI Operations', path: '/ceo/ai-ops', badge: 6 },
  { icon: Bell, label: 'Alerts & Logs', path: '/ceo/alerts', badge: 3 },
  { icon: Settings, label: 'System Health', path: '/ceo/system' },
  { icon: Lock, label: 'Admin Panel', path: '/ceo/admin' },
]

export default function CEOLayout() {
  const [collapsed, setCollapsed] = useState(false)
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authError, setAuthError] = useState('')
  const time = useRiyadhTime()
  const location = useLocation()

  useEffect(() => {
    // Temporary bypass for demo
    setUser({ email: 'm.alqumri@datalake.sa' })
    setAuthLoading(false)
    /*
    const unsub = onAuthChange((firebaseUser) => {
      setUser(firebaseUser)
      setAuthLoading(false)
    })
    return () => unsub()
    */
  }, [])

  // Onboarding gate — applies to EVERY role. A signed-in user whose record
  // exists but isn't onboarded is sent to the full-screen onboarding flow.
  // (No record → AuthGate handles "not configured"; don't trap them here.)
  const [onbChecked, setOnbChecked] = useState(false)
  const [needsOnboarding, setNeedsOnboarding] = useState(false)

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (u) => {
      if (!u) { setNeedsOnboarding(false); setOnbChecked(true); return }
      try {
        let data = null
        const byUid = await getDoc(doc(db, 'users', u.uid))
        if (byUid.exists()) data = byUid.data()
        else {
          const q = await getDocs(query(collection(db, 'users'), where('email', '==', (u.email || '').toLowerCase())))
          if (!q.empty) data = q.docs[0].data()
        }
        setNeedsOnboarding(!!data && data.onboarding_complete !== true)
      } catch {
        setNeedsOnboarding(false)
      }
      setOnbChecked(true)
    })
    return () => unsub()
  }, [])

  const handleSignIn = async () => {
    setAuthError('')
    try {
      const result = await signIn()
      if (result.email !== 'm.alqumri@datalake.sa') {
        setAuthError(`Access denied. ${result.email} is not authorized for the CEO Command Center.`)
        await signOut()
      }
    } catch (err) {
      setAuthError(err.message || 'Sign-in failed')
    }
  }

  const handleSignOut = async () => {
    await signOut()
    setUser(null)
  }

  // Auth loading state
  if (authLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0a1628', color: '#fff', fontFamily: "'DM Sans', sans-serif" }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 40, height: 40, border: '3px solid rgba(255,255,255,0.2)', borderTopColor: '#1598CC', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
          <div style={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.6)' }}>Verifying identity...</div>
        </div>
      </div>
    )
  }

  // Auth gate — require Google SSO
  if (!user || user.email !== 'm.alqumri@datalake.sa') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'linear-gradient(135deg, #0a1628 0%, #022873 100%)', fontFamily: "'DM Sans', sans-serif" }}>
        <div style={{ background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, padding: '48px 40px', maxWidth: 420, width: '90%', textAlign: 'center' }}>
          <img src="/images/icon.svg" alt="Datalake" style={{ width: 48, height: 48, marginBottom: 20 }} />
          <h1 style={{ color: '#fff', fontSize: '1.5rem', fontWeight: 700, marginBottom: 8 }}>CEO Command Center</h1>
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.85rem', marginBottom: 32 }}>Sign in with your Datalake account to continue</p>
          <button
            onClick={handleSignIn}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, width: '100%', padding: '14px 24px', border: 'none', borderRadius: 12, background: '#fff', color: '#1A1A2E', fontWeight: 600, fontSize: '0.95rem', fontFamily: 'inherit', cursor: 'pointer', boxShadow: '0 4px 14px rgba(0,0,0,0.2)', transition: 'transform 0.15s' }}
          >
            <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
            Sign in with Google
          </button>
          {authError && (
            <div style={{ marginTop: 16, padding: '10px 16px', background: 'rgba(192,57,43,0.15)', border: '1px solid rgba(192,57,43,0.3)', borderRadius: 8, color: '#ff6b6b', fontSize: '0.82rem' }}>
              {authError}
            </div>
          )}
        </div>
      </div>
    )
  }

  // Onboarding gate (every role) — wait for the check, then redirect if needed.
  if (!onbChecked) {
    return <div style={{ height: '100vh', background: '#0a1628' }} />
  }
  if (needsOnboarding) {
    return <Navigate to="/employee/onboarding" replace />
  }

  return (
    <div className="app-layout" data-portal="ceo">
      {/* Sidebar */}
      <aside className={`ceo-sidebar ${collapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          <img src="/images/icon.svg" alt="Datalake" style={{ width: 32, height: 32, flexShrink: 0 }} />
          <div className="sidebar-logo-text">
            <span>DATALAKE</span>
            <span>CEO Command Center</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = item.end 
              ? location.pathname === item.path
              : location.pathname.startsWith(item.path) && item.path !== '/ceo'
            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.end}
                className={`nav-item ${isActive ? 'active' : ''} ${item.glow && item.badge ? 'approvals-glow' : ''}`}
                id={`nav-${item.path.replace(/\//g, '-')}`}
              >
                <span className="nav-icon"><Icon size={20} /></span>
                <span className="nav-label">{item.label}</span>
                {item.badge && <span className="nav-badge">{item.badge}</span>}
                {item.info && !item.badge && <span className="nav-label" style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', textAlign: 'right' }}>{item.info}</span>}
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
          <input 
            type="text" 
            placeholder="Search contracts, engineers, invoices, RFPs..." 
            id="global-search"
          />
        </div>
        <div className="topbar-right">
          <span className="topbar-time">{time} AST</span>
          <div className="topbar-notification" id="notification-bell">
            <Bell size={20} />
            <span className="notif-badge">3</span>
          </div>
          {user?.photoURL && <img src={user.photoURL} alt="" style={{ width: 32, height: 32, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.2)' }} />}
          <div className="topbar-avatar" id="ceo-avatar" title={user?.email}>CEO</div>
          <button onClick={handleSignOut} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', fontFamily: 'inherit' }} title="Sign out">
            <LogOut size={16} />
          </button>
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
