import { useState, useEffect } from 'react'
import { useCountUp } from '../../hooks/useUtils'
import { collection, query, where, onSnapshot, getDocs } from 'firebase/firestore'
import { db, auth, GET_ENGINEER_PROJECT_VIEW_URL } from '../../lib/firebase'
import { LineChart, Line, ResponsiveContainer } from 'recharts'
import { Calendar, Clock, Ticket, Palmtree, FileText, CreditCard, LifeBuoy, AlertTriangle, ChevronRight, Loader } from 'lucide-react'
import { Link } from 'react-router-dom'

const statConfig = [
  { key: 'contractDaysRemaining', label: 'Contract Days Left', icon: Calendar, getColor: v => v < 7 ? 'var(--red)' : v < 30 ? 'var(--amber)' : 'var(--green)', sub: d => d.endDate },
  { key: 'leaveBalance', label: 'Leave Balance', icon: Palmtree, getColor: () => 'var(--steel-blue)', sub: d => `${d.total} total annual` },
  { key: 'pendingTimesheets', label: 'Pending Timesheets', icon: Clock, getColor: v => v > 0 ? 'var(--amber)' : 'var(--green)', sub: d => d.period },
  { key: 'openTickets', label: 'Open Tickets', icon: Ticket, getColor: v => v > 0 ? 'var(--red)' : 'var(--green)', sub: () => 'All resolved' },
]

function StatCard({ config, data, delay }) {
  const val = data.value || 0
  const displayVal = useCountUp(val, 600)
  const color = config.getColor(val)
  const Icon = config.icon

  return (
    <div className={`eng-stat-card animate-fade-in-up stagger-${delay}`} style={{ '--stat-color': color, '--stat-bg': `${color}15` }}>
      <div className="stat-icon"><Icon size={22} /></div>
      <div className="stat-value" style={{ color }}>{displayVal}</div>
      <div className="stat-label">{config.label}</div>
      <div className="stat-sub">{config.sub(data)}</div>
    </div>
  )
}

export default function Dashboard() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [userName, setUserName] = useState('')
  const [employee, setEmployee] = useState(null)  // employees/{*} for title + contract dates + leave entitlement
  const [dashboardStats, setDashboardStats] = useState({
    contractDaysRemaining: { value: 0, endDate: '—' },
    leaveBalance: { value: 0, total: 0 },
    pendingTimesheets: { value: 0, period: '—' },
    openTickets: { value: 0 },
  })
  const [upcomingActions] = useState([])
  const [contract, setContract] = useState(null) // real active-assignment summary (PO/rates stripped server-side)

  useEffect(() => {
    let unsubs = []
    const unsubAuth = auth.onAuthStateChanged(async user => {
      if (user) {
        setUserName(user.displayName || user.email.split('@')[0])
        
        // Fetch real stats
        try {
          const timesheetsQ = query(collection(db, 'timesheets'), where('engineer_email', '==', user.email), where('status', '==', 'SUBMITTED'))
          unsubs.push(onSnapshot(timesheetsQ, snap => {
            setDashboardStats(prev => ({ ...prev, pendingTimesheets: { value: snap.size, period: 'Pending Approval' } }))
          }))
          
          const ticketsQ = query(collection(db, 'support_tickets'), where('created_by', '==', user.email), where('status', 'in', ['OPEN', 'IN_PROGRESS']))
          unsubs.push(onSnapshot(ticketsQ, snap => {
            setDashboardStats(prev => ({ ...prev, openTickets: { value: snap.size } }))
          }))

          // For leave balances, ideally read from leave_balances collection
          const leaveQ = query(collection(db, 'leave_balances'), where('email', '==', user.email))
          unsubs.push(onSnapshot(leaveQ, snap => {
            if (!snap.empty) {
              const data = snap.docs[0].data()
              setDashboardStats(prev => ({ ...prev, leaveBalance: { value: data.annual_remaining || 0, total: data.annual_total || 21 } }))
            }
          }))

          // employees/{*} is the source of truth for title + contract dates +
          // statutory leave entitlement. The engineer is logged in with their
          // @datalake.sa email so we look up by email (employees rows aren't
          // necessarily keyed by uid).
          const empQ = query(collection(db, 'employees'), where('email', '==', user.email))
          unsubs.push(onSnapshot(empQ, snap => {
            if (snap.empty) return
            const e = { id: snap.docs[0].id, ...snap.docs[0].data() }
            setEmployee(e)

            // Contract days remaining — only meaningful when a Qiwa contract has
            // been uploaded and contract_end is populated.
            if (e.contract_end) {
              const end = e.contract_end?.toDate ? e.contract_end.toDate() : new Date(e.contract_end)
              if (!Number.isNaN(end.getTime())) {
                const days = Math.max(0, Math.ceil((end - new Date()) / 86400000))
                setDashboardStats(prev => ({
                  ...prev,
                  contractDaysRemaining: {
                    value: days,
                    endDate: end.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
                  },
                }))
              }
            } else {
              setDashboardStats(prev => ({
                ...prev,
                contractDaysRemaining: { value: 0, endDate: 'No contract uploaded' },
              }))
            }

            // Leave entitlement — same precedence as the leave page (Saudi
            // Labour Law default 21 days). Only override when leave_balances
            // didn't already populate.
            setDashboardStats(prev => {
              if (prev.leaveBalance.total && prev.leaveBalance.total !== 21) return prev
              const total = Number(e.annual_leave_days) || 21
              return { ...prev, leaveBalance: { value: total, total } }
            })
          }))

          // Active project assignment for the Contract Summary (financials/PO
          // stripped server-side by getEngineerProjectView).
          try {
            const idToken = await user.getIdToken()
            const res = await fetch(GET_ENGINEER_PROJECT_VIEW_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
            })
            const text = await res.text()
            let data = null
            try { data = JSON.parse(text) } catch { data = null }
            const projs = data?.projects || []
            const proj = projs.find(p => p.status === 'ACTIVE') || projs[0]
            if (proj) {
              const start = proj.start_date?._seconds ? new Date(proj.start_date._seconds * 1000) : null
              const end = proj.end_date?._seconds ? new Date(proj.end_date._seconds * 1000) : null
              setContract({
                client: proj.client_name || '—',
                role: proj.my_assignment?.role_on_project || '—',
                period: (start && end)
                  ? `${start.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })} — ${end.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`
                  : '—',
                daysLeft: end ? Math.max(0, Math.ceil((end - new Date()) / (1000 * 60 * 60 * 24))) : null,
              })
            }
          } catch (e) { console.warn('Assignment fetch failed:', e.message) }

          setLoading(false)
        } catch (e) {
          console.error(e)
          setError(e)
          setLoading(false)
        }
      } else {
        setLoading(false)
      }
    })
    return () => {
      unsubAuth()
      unsubs.forEach(u => u())
    }
  }, [])

  if (loading) return <div style={{display:'flex',justifyContent:'center',alignItems:'center',minHeight:'400px'}}><Loader className="spin" size={32} style={{color:'var(--accent-primary)'}} /></div>
  if (error) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <h3 style={{ fontSize: '1.2rem', marginBottom: 8, color: 'var(--red)' }}>Unable to load page</h3>
        <p style={{ color: 'var(--text-secondary)' }}>{error.message || 'A network error occurred.'}</p>
        <button className="btn btn-primary" style={{ marginTop: 24 }} onClick={() => window.location.reload()}>Retry</button>
      </div>
    )
  }

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Good morning, {employee?.full_name || userName} 👋</h1>
        <p style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem', marginTop: 4 }}>
          {employee?.job_title ? <strong style={{ color: 'var(--text-secondary)' }}>{employee.job_title}</strong> : null}
          {employee?.job_title ? ' · ' : ''}
          {contract?.client
            ? <>Deployed at <strong style={{ color: 'var(--text-secondary)' }}>{contract.client}</strong></>
            : 'No active project assignment yet.'}
          <span style={{ marginLeft: 10 }}>{new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid-4" style={{ marginBottom: 28 }}>
        {statConfig.map((cfg, i) => (
          <StatCard key={cfg.key} config={cfg} data={dashboardStats[cfg.key]} delay={i + 1} />
        ))}
      </div>

      {/* Main Content: Actions + Quick Links */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24 }}>
        {/* Upcoming Actions */}
        <div className="card animate-fade-in-up stagger-3" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-primary)' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>Upcoming Actions</h3>
          </div>
          <div className="action-list">
            {upcomingActions.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-tertiary)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <Ticket size={32} style={{ marginBottom: 12, opacity: 0.5 }} />
                <div style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>You're all caught up!</div>
                <div style={{ fontSize: '0.85rem' }}>No pending actions required.</div>
              </div>
            ) : upcomingActions.map(action => (
              <div key={action.id} className="action-item">
                <div className={`action-icon ${action.urgency}`}>{action.icon}</div>
                <div className="action-info">
                  <div className="action-title">{action.title}</div>
                  <div className="action-due">Due: {new Date(action.due).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                </div>
                <span className={`badge ${action.urgency === 'urgent' ? 'badge-critical' : action.urgency === 'warning' ? 'badge-warning' : 'badge-info'}`}>
                  {action.urgency === 'urgent' ? 'URGENT' : action.urgency === 'warning' ? 'DUE SOON' : 'UPCOMING'}
                </span>
                <ChevronRight size={16} style={{ color: 'var(--text-tertiary)' }} />
              </div>
            ))}
          </div>
        </div>

        {/* Right Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Quick Links */}
          <div className="card animate-fade-in-up stagger-4">
            <div className="card-header"><h3>Quick Links</h3></div>
            <div className="quick-links">
              {[
                { icon: '⏱️', label: 'Submit Timesheet', to: '/employee/timesheets' },
                { icon: '🏖️', label: 'Request Leave', to: '/employee/leave' },
                { icon: '💳', label: 'Submit Expense', to: '/employee/expenses' },
                { icon: '📄', label: 'View Documents', to: '/employee/documents' },
                { icon: '🎟️', label: 'Contact HR', to: '/employee/support' },
              ].map((link, i) => (
                <Link key={i} to={link.to} className="quick-link-btn">
                  <span className="ql-icon">{link.icon}</span>
                  {link.label}
                </Link>
              ))}
            </div>
          </div>

          {/* Contract Summary — real active assignment (PO/rates not shown) */}
          <div className="card animate-fade-in-up stagger-5">
            <div className="card-header"><h3>Contract Summary</h3></div>
            {contract ? (
              (() => {
                const fields = [
                  { label: 'Client', value: contract.client },
                  { label: 'Role', value: contract.role },
                  { label: 'Contract Period', value: contract.period },
                  ...(contract.daysLeft != null ? [{ label: 'Days Remaining', value: String(contract.daysLeft), color: contract.daysLeft < 30 ? 'var(--amber)' : 'var(--green)' }] : []),
                ]
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {fields.map((field, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: i < fields.length - 1 ? '1px solid var(--border-primary)' : 'none' }}>
                        <span style={{ fontSize: '0.82rem', color: 'var(--text-tertiary)' }}>{field.label}</span>
                        <span style={{ fontSize: '0.875rem', fontWeight: 600, color: field.color || 'var(--text-primary)' }}>{field.value}</span>
                      </div>
                    ))}
                  </div>
                )
              })()
            ) : (
              <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>
                No active project assignment.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
