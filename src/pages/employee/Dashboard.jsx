import { useState, useEffect } from 'react'
import { useCountUp } from '../../hooks/useUtils'
import { collection, onSnapshot } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { LineChart, Line, ResponsiveContainer } from 'recharts'
import { Calendar, Clock, Ticket, Palmtree, FileText, CreditCard, LifeBuoy, AlertTriangle, ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'

const statConfig = [
  { key: 'contractDaysRemaining', label: 'Contract Days Left', icon: Calendar, getColor: v => v < 7 ? 'var(--red)' : v < 30 ? 'var(--amber)' : 'var(--green)', sub: d => d.endDate },
  { key: 'leaveBalance', label: 'Leave Balance', icon: Palmtree, getColor: () => 'var(--steel-blue)', sub: d => `${d.total} total annual` },
  { key: 'pendingTimesheets', label: 'Pending Timesheets', icon: Clock, getColor: v => v > 0 ? 'var(--amber)' : 'var(--green)', sub: d => d.period },
  { key: 'openTickets', label: 'Open Tickets', icon: Ticket, getColor: v => v > 0 ? 'var(--red)' : 'var(--green)', sub: () => 'All resolved' },
]

function StatCard({ config, data, delay }) {
  const val = data.value
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
  const [dashboardStats, setDashboardStats] = useState({
    contractDaysRemaining: { value: 0, endDate: '—' },
    leaveBalance: { value: 0, total: 0 },
    pendingTimesheets: { value: 0, period: '—' },
    openTickets: { value: 0 },
  })
  const [upcomingActions, setUpcomingActions] = useState([])

  useEffect(() => {
    const unsub1 = onSnapshot(collection(db, 'engineer_dashboard'), snap => {
      if (!snap.empty) setDashboardStats(snap.docs[0].data())
    })
    const unsub2 = onSnapshot(collection(db, 'engineer_actions'), snap => {
      setUpcomingActions(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })
    return () => { unsub1(); unsub2() }
  }, [])

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Good morning, Mohammed 👋</h1>
        <p style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem', marginTop: 4 }}>
          {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
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
            {upcomingActions.map(action => (
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
                { icon: '⏱️', label: 'Submit Timesheet', to: '/portal/timesheets' },
                { icon: '🏖️', label: 'Request Leave', to: '/portal/leave' },
                { icon: '💳', label: 'Submit Expense', to: '/portal/expenses' },
                { icon: '📄', label: 'View Payslips', to: '/portal/documents' },
                { icon: '🎟️', label: 'Contact HR', to: '/portal/support' },
                { icon: '⚠️', label: 'Report Issue', to: '/portal/support' },
              ].map((link, i) => (
                <Link key={i} to={link.to} className="quick-link-btn">
                  <span className="ql-icon">{link.icon}</span>
                  {link.label}
                </Link>
              ))}
            </div>
          </div>

          {/* Contract Summary */}
          <div className="card animate-fade-in-up stagger-5">
            <div className="card-header"><h3>Contract Summary</h3></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                { label: 'Client', value: 'Emkan' },
                { label: 'Role', value: 'Senior Java Engineer' },
                { label: 'PO Number', value: 'PO-2024-018', mono: true },
                { label: 'Contract Period', value: 'Jun 2025 — Jun 2026' },
                { label: 'Days Remaining', value: '42', color: 'var(--green)' },
              ].map((field, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: i < 4 ? '1px solid var(--border-primary)' : 'none' }}>
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-tertiary)' }}>{field.label}</span>
                  <span style={{ fontSize: '0.875rem', fontWeight: 600, color: field.color || 'var(--text-primary)', fontFamily: field.mono ? 'var(--font-mono)' : 'inherit' }}>{field.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
