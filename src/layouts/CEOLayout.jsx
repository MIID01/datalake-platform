import { useState, useEffect } from 'react'
import { Outlet, NavLink, useLocation } from 'react-router-dom'
import { useRiyadhTime } from '../hooks/useUtils'
import {
  Zap, BarChart3, Users, DollarSign, FileText, CheckSquare,
  Shield, TrendingUp, Bell, Settings, ChevronLeft, ChevronRight,
  Search, Bot, Inbox, LogOut, FolderKanban, Lock, Library, Building2, ShieldCheck,
} from 'lucide-react'
import { signIn, signOut, onAuthChange } from '../lib/auth'
import { db } from '../lib/firebase'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import PortalSwitcher from '../components/PortalSwitcher'
import '../styles/ceo.css'

/**
 * useCEOBadges — subscribes to real pending-action counts from Firestore.
 *
 * GUARDRAIL: every badge query must be the SAME source (or an explicit
 * actionable subset) as the page it links to, so badge count ≤ page count
 * and the two never contradict each other.
 *
 * Returns { approvalsCount, talentCount, financeCount, contractsCount, ticketsCount }.
 * All default to 0 — no badge appears when there is nothing to act on.
 */
function useCEOBadges() {
  const [counts, setCounts] = useState({
    approvalsCount: 0,
    talentCount: 0,
    financeCount: 0,
    contractsCount: 0,
    ticketsCount: 0,
  })

  useEffect(() => {
    const unsubs = []

    // ── Approvals (/ceo/approvals) ─────────────────────────────────────────
    // Approvals.jsx aggregates exactly these 4 sources into one list.
    // The badge = their sum, so sidebar count == page "X items awaiting" count.
    let paCount = 0, tsCount = 0, phCount = 0, lrCount = 0
    const updateApprovals = () =>
      setCounts(c => ({ ...c, approvalsCount: paCount + tsCount + phCount + lrCount }))

    unsubs.push(onSnapshot(collection(db, 'pending_approvals'),                                      // SoD-gated invoices
      snap => { paCount = snap.size; updateApprovals() }))
    unsubs.push(onSnapshot(query(collection(db, 'timesheets'), where('state', '==', 'SUBMITTED')),   // same as Approvals.jsx L47
      snap => { tsCount = snap.size; updateApprovals() }))
    unsubs.push(onSnapshot(collection(db, 'pending_hires'),                                          // same as Approvals.jsx L73
      snap => { phCount = snap.size; updateApprovals() }))
    unsubs.push(onSnapshot(                                                                           // same as Approvals.jsx L98-99
      query(collection(db, 'leave_requests'),
        where('status', 'in', ['PENDING_VALIDATION', 'PENDING_CEO', 'PENDING'])),
      snap => { lrCount = snap.size; updateApprovals() }))

    // ── Talent & HR (/ceo/talent) ──────────────────────────────────────────
    // Page shows all talent_pool rows. Badge = OFFER_PENDING only (needs a
    // CEO decision). Badge ≤ page count always.
    unsubs.push(onSnapshot(
      query(collection(db, 'talent_pool'), where('state', '==', 'OFFER_PENDING')),
      snap => setCounts(c => ({ ...c, talentCount: snap.size }))
    ))

    // ── Finance (/ceo/finance) ─────────────────────────────────────────────
    // Page shows all invoices. Badge = those needing CEO sign-off.
    // Badge ≤ page count always.
    unsubs.push(onSnapshot(
      query(collection(db, 'invoices'), where('status', 'in', ['DRAFT', 'PENDING_APPROVAL'])),
      snap => setCounts(c => ({ ...c, financeCount: snap.size }))
    ))

    // ── Contracts (/ceo/contracts) ─────────────────────────────────────────
    // Contracts.jsx reads the 'contracts' collection (not hire_requests).
    // Badge = contracts that are not yet EXECUTED/ARCHIVED/CANCELLED.
    unsubs.push(onSnapshot(collection(db, 'contracts'), snap => {
      const pending = snap.docs.filter(d => {
        const s = (d.data().status || '').toUpperCase()
        return s !== 'EXECUTED' && s !== 'ARCHIVED' && s !== 'CANCELLED'
      }).length
      setCounts(c => ({ ...c, contractsCount: pending }))
    }))

    // Support tickets are an IT function — managed in the IT Admin portal
    // (/admin/tickets), not on the CEO surface. No CEO badge/counter here.

    return () => unsubs.forEach(u => u())
  }, [])

  return counts
}

// navItems no longer carry hardcoded badge numbers.
// Badges are injected dynamically from useCEOBadges() in the component below.
const navItems = [
  { icon: Zap,          label: 'Command Center',    path: '/ceo',              badgeKey: 'approvalsCount', end: true },
  { icon: Inbox,        label: 'Task Inbox',         path: '/ceo/tasks',        badgeKey: 'tasksCount' },
  { icon: BarChart3,    label: 'Revenue Pipeline',   path: '/ceo/pipeline' },
  { icon: FolderKanban, label: 'Projects',            path: '/ceo/projects' },
  { icon: Building2,    label: 'Clients',             path: '/ceo/clients' },
  { icon: Users,        label: 'Employee Directory',  path: '/ceo/employees' },
  { icon: Users,        label: 'Talent & HR',         path: '/ceo/talent',      badgeKey: 'talentCount' },
  { icon: DollarSign,   label: 'Finance',             path: '/ceo/finance',     badgeKey: 'financeCount' },
  { icon: FileText,     label: 'Contracts',           path: '/ceo/contracts',   badgeKey: 'contractsCount' },
  { icon: CheckSquare,  label: 'Approvals',           path: '/ceo/approvals',   badgeKey: 'approvalsCount', glow: true },
  { icon: FileText,     label: 'Leave Requests',      path: '/ceo/leave' },
  { icon: DollarSign,   label: 'Expenses',            path: '/ceo/expenses' },
  { icon: Shield,       label: 'Compliance',          path: '/ceo/compliance' },
  { icon: Users,        label: 'Training Matrix',     path: '/ceo/training' },
  { icon: Library,      label: 'Policy Library',      path: '/ceo/policies' },
  { icon: TrendingUp,   label: 'Analytics',           path: '/ceo/analytics' },
  { icon: BarChart3,    label: 'Monthly Reports',     path: '/ceo/reports' },
  { icon: Bot,          label: 'AI Operations',       path: '/ceo/ai-ops' },
  { icon: Bell,         label: 'Alerts & Logs',       path: '/ceo/alerts' },
  { icon: Settings,     label: 'System Health',       path: '/ceo/system' },
  { icon: Lock,         label: 'Admin Panel',         path: '/ceo/admin' },
  { icon: ShieldCheck,  label: 'Audit Export',        path: '/ceo/audit-export' },
]

export default function CEOLayout() {
  const [collapsed, setCollapsed] = useState(false)
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authError, setAuthError] = useState('')
  const time = useRiyadhTime()
  const location = useLocation()
  const badges = useCEOBadges()

  // Total actionable items for the topbar bell
  const totalPending = badges.approvalsCount + badges.talentCount + badges.financeCount + badges.contractsCount + badges.ticketsCount

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
            const badgeCount = item.badgeKey ? (badges[item.badgeKey] || 0) : 0
            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.end}
                className={`nav-item ${isActive ? 'active' : ''} ${item.glow && badgeCount > 0 ? 'approvals-glow' : ''}`}
                id={`nav-${item.path.replace(/\//g, '-')}`}
              >
                <span className="nav-icon"><Icon size={20} /></span>
                <span className="nav-label">{item.label}</span>
                {badgeCount > 0 && <span className="nav-badge">{badgeCount}</span>}
                {item.info && badgeCount === 0 && <span className="nav-label" style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', textAlign: 'right' }}>{item.info}</span>}
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
            {totalPending > 0 && <span className="notif-badge">{totalPending}</span>}
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
