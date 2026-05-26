import { useState, useEffect } from 'react'
import { Outlet, NavLink, useLocation, useOutletContext } from 'react-router-dom'
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore'
import { db, auth } from '../lib/firebase'
import {
  LayoutDashboard, FileText, Banknote, CreditCard, BarChart3,
  LogOut, ChevronLeft, ChevronRight,
} from 'lucide-react'
import '../styles/ceo.css'

// Reuse the existing CEO finance components inside the Finance portal.
import FinanceDashboard from '../pages/ceo/finance/FinanceDashboard'
import FinanceInvoices from '../pages/ceo/finance/FinanceInvoices'
import FinanceCashFlow from '../pages/ceo/finance/FinanceCashFlow'
import FinanceExpenses from '../pages/ceo/finance/FinanceExpenses'
import CEOPayroll from '../pages/ceo/CEOPayroll'

const navItems = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/finance', end: true },
  { icon: FileText, label: 'Invoices', path: '/finance/invoices' },
  { icon: Banknote, label: 'Payroll', path: '/finance/payroll' },
  { icon: CreditCard, label: 'Expenses', path: '/finance/expenses' },
  { icon: BarChart3, label: 'Reports', path: '/finance/reports' },
]

export default function FinanceLayout() {
  const [collapsed, setCollapsed] = useState(false)
  const [email, setEmail] = useState('')
  const location = useLocation()

  // Shared finance dataset — loaded once, passed to child routes via context.
  const [invoices, setInvoices] = useState([])
  const [projects, setProjects] = useState([])
  const [timesheets, setTimesheets] = useState([])
  const [expenses, setExpenses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const unsubAuth = auth.onAuthStateChanged(u => setEmail(u?.email || ''))
    let loaded = 0
    const tick = () => { loaded++; if (loaded >= 3) setLoading(false) }
    const onErr = (e) => { console.warn('Finance data listener:', e.message); setError(e); setLoading(false) }

    const unsubInv = onSnapshot(query(collection(db, 'invoices'), orderBy('created_at', 'desc')),
      snap => { setInvoices(snap.docs.map(d => ({ id: d.id, ...d.data() }))); tick() }, onErr)
    const unsubProj = onSnapshot(collection(db, 'projects'),
      snap => { setProjects(snap.docs.map(d => ({ id: d.id, ...d.data() }))); tick() }, onErr)
    const unsubTs = onSnapshot(collection(db, 'timesheets'),
      snap => { setTimesheets(snap.docs.map(d => ({ id: d.id, ...d.data() }))); tick() }, onErr)
    const unsubExp = onSnapshot(collection(db, 'expenses'),
      snap => setExpenses(snap.docs.map(d => ({ id: d.id, ...d.data() }))), () => {})

    return () => { unsubAuth(); unsubInv(); unsubProj(); unsubTs(); unsubExp() }
  }, [])

  return (
    <div className="app-layout" data-portal="ceo">
      <aside className={`ceo-sidebar ${collapsed ? 'collapsed' : ''}`} style={{ '--sidebar-accent': '#34BF3A' }}>
        <div className="sidebar-header">
          <img src="/images/icon.svg" alt="Datalake" style={{ width: 32, height: 32, flexShrink: 0 }} />
          <div className="sidebar-logo-text">
            <span>DATALAKE</span>
            <span>Finance Portal</span>
          </div>
        </div>
        <nav className="sidebar-nav">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = item.end ? location.pathname === item.path : location.pathname.startsWith(item.path)
            return (
              <NavLink key={item.path} to={item.path} end={item.end}
                className={`nav-item ${isActive ? 'active' : ''}`}
                id={`nav-fin-${item.path.replace(/\//g, '-')}`}>
                <span className="nav-icon"><Icon size={20} /></span>
                <span className="nav-label">{item.label}</span>
              </NavLink>
            )
          })}
        </nav>
        <div className="sidebar-footer">
          <div style={{ padding: '8px 16px', fontSize: '0.72rem', color: 'rgba(255,255,255,0.5)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {!collapsed && email}
          </div>
          <button style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: '0.78rem', fontFamily: 'inherit', width: '100%' }} onClick={() => auth.signOut()}>
            <LogOut size={16} />{!collapsed && <span>Sign Out</span>}
          </button>
          <button className="sidebar-collapse-btn" onClick={() => setCollapsed(!collapsed)}>
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>
      <main className={`main-area ${collapsed ? 'collapsed' : ''}`} style={{ marginTop: 0, background: '#0a1628' }}>
        <div className="page-content page-enter">
          <Outlet context={{ invoices, projects, timesheets, expenses, loading, error }} />
        </div>
      </main>
    </div>
  )
}

// ── Route pages (reuse CEO finance components with the layout's shared data) ──
function FinanceLoading() {
  return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>Loading financial data…</div>
}
function FinanceError({ error }) {
  return (
    <div style={{ padding: 40, textAlign: 'center' }}>
      <h3 style={{ fontSize: '1.2rem', marginBottom: 8, color: 'var(--red)' }}>Unable to load finance data</h3>
      <p style={{ color: 'var(--text-secondary)' }}>{error?.message || 'A network error occurred.'}</p>
      <button className="btn btn-primary" style={{ marginTop: 24 }} onClick={() => window.location.reload()}>Retry</button>
    </div>
  )
}

export function FinanceDashboardPage() {
  const { invoices, timesheets, projects, expenses, loading, error } = useOutletContext()
  if (error) return <FinanceError error={error} />
  if (loading) return <FinanceLoading />
  return <FinanceDashboard invoices={invoices} timesheets={timesheets} projects={projects} expenses={expenses} />
}
export function FinanceInvoicesPage() {
  const { invoices, timesheets, projects, loading, error } = useOutletContext()
  if (error) return <FinanceError error={error} />
  if (loading) return <FinanceLoading />
  return <FinanceInvoices invoices={invoices} timesheets={timesheets} projects={projects} />
}
export function FinanceExpensesPage() {
  const { expenses, loading, error } = useOutletContext()
  if (error) return <FinanceError error={error} />
  if (loading) return <FinanceLoading />
  return <FinanceExpenses expenses={expenses} />
}
export function FinanceReportsPage() {
  const { invoices, timesheets, projects, expenses, loading, error } = useOutletContext()
  if (error) return <FinanceError error={error} />
  if (loading) return <FinanceLoading />
  return <FinanceCashFlow invoices={invoices} timesheets={timesheets} projects={projects} expenses={expenses} />
}
export function FinancePayrollPage() {
  // CEOPayroll loads its own data — render directly.
  return <CEOPayroll />
}
