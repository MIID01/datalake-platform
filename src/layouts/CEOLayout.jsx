import { useState, useEffect } from 'react'
import { Outlet, NavLink, useLocation } from 'react-router-dom'
import { useRiyadhTime } from '../hooks/useUtils'
import {
  Zap, BarChart3, Users, DollarSign, FileText, CheckSquare,
  Shield, TrendingUp, Bell, Settings, ChevronLeft, ChevronRight,
  Search, Menu, Bot, Inbox, LogOut, FolderKanban, Lock, Library, Building2, ShieldCheck,
} from 'lucide-react'
import { signIn, signOut, onAuthChange } from '../lib/auth'
import PortalSwitcher from '../components/PortalSwitcher'
import '../styles/ceo.css'

const navItems = [
  { icon: Zap, label: 'Command Center', path: '/ceo', badge: 2, end: true },
  { icon: Inbox, label: 'Task Inbox', path: '/ceo/tasks', badge: 10, glow: true },
  { icon: BarChart3, label: 'Revenue Pipeline', path: '/ceo/pipeline', badge: null, info: 'SAR 11.2M' },
  { icon: FolderKanban, label: 'Projects', path: '/ceo/projects' },
  { icon: Building2, label: 'Clients', path: '/ceo/clients' },
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
  { icon: BarChart3, label: 'Monthly Reports', path: '/ceo/reports' },
  { icon: Bot, label: 'AI Operations', path: '/ceo/ai-ops', badge: 6 },
  { icon: Bell, label: 'Alerts & Logs', path: '/ceo/alerts', badge: 3 },
  { icon: Settings, label: 'System Health', path: '/ceo/system' },
  { icon: Lock, label: 'Admin Panel', path: '/ceo/admin' },
  { icon: ShieldCheck, label: 'Audit Export', path: '/ceo/audit-export' },
]

export default function CEOLayout() {
  const [collapsed, setCollapsed] = useState(false)
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authError, setAuthError] = useState('')
  const time = useRiyadhTime()
  const location = useLocation()

  useEffect(() => {
    // Reflect the REAL Firebase Auth session — no demo bypass. AuthGate already
    // gates /ceo/* on the CEO identity, so this layout just mirrors that user.
    // Critically, this keeps auth.currentUser populated for authed backend calls
    // (e.g. the Integrations page reads auth.currentUser for its ID token — the
    // hardcoded plain-object {email} left currentUser null and broke it).
    const unsub = onAuthChange((firebaseUser) => {
      setUser(firebaseUser)
      setAuthLoading(false)
    })
    return () => unsub()
  }, [])

  // Onboarding gate now lives centrally in AuthGate (applies to every role,
  // including the CEO) — no per-layout check here.

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
          <a
            href="/"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, width: '100%', padding: '14px 24px', border: 'none', borderRadius: 12, background: '#1598CC', color: '#fff', fontWeight: 600, fontSize: '0.95rem', fontFamily: 'inherit', cursor: 'pointer', boxShadow: '0 4px 14px rgba(0,0,0,0.2)', textDecoration: 'none' }}
          >
            Sign in
          </a>
          {authError && (
            <div style={{ marginTop: 16, padding: '10px 16px', background: 'rgba(192,57,43,0.15)', border: '1px solid rgba(192,57,43,0.3)', borderRadius: 8, color: '#ff6b6b', fontSize: '0.82rem' }}>
              {authError}
            </div>
          )}
        </div>
      </div>
    )
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

        <PortalSwitcher collapsed={collapsed} theme="dark" />

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
