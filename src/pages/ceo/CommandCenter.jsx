import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCountUp } from '../../hooks/useUtils'
import { LineChart, Line, ResponsiveContainer } from 'recharts'
import { TrendingUp, TrendingDown, AlertTriangle, X, ArrowRight, CheckCircle, FileText, DollarSign, UserPlus, LifeBuoy, Calendar, Briefcase } from 'lucide-react'
import { HireBudgetBreakdown } from './HireRequest'
import { db } from '../../lib/firebase'
import { collection, onSnapshot, query, where } from 'firebase/firestore'

function KPICard({ label, value, unit, trend, color, delay, sparkData }) {
  const displayVal = useCountUp(value, 900)
  const isUp = trend >= 0

  const formatValue = (v) => {
    if (unit === 'SAR') return `SAR ${v.toLocaleString()}`
    if (unit === '%') return `${v}%`
    return v.toLocaleString()
  }

  return (
    <div className={`stat-card animate-fade-in-up stagger-${delay}`} style={{ '--stat-accent': color }}>
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ color }}>{formatValue(displayVal)}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
        <span className={`stat-trend ${isUp ? 'up' : 'down'}`}>
          {isUp ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
          {Math.abs(trend)}%
        </span>
        {sparkData && sparkData.length > 0 && (
          <div style={{ width: 100, height: 32 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparkData}>
                <Line type="monotone" dataKey="v" stroke={color} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  )
}

// Items the CEO must personally decide on, by category.
// Routine leave / routine expenses / IT tickets are intentionally excluded —
// those route through PM/Finance/HR/IT respectively (see approval-routing.js).
const CATEGORY_META = {
  invoice:  { Icon: FileText,  color: '#1598CC', label: 'Invoice',  cta: 'Review',   href: '/ceo/finance' },
  payroll:  { Icon: DollarSign, color: '#34BF3A', label: 'Payroll',  cta: 'Review',   href: '/ceo/payroll' },
  hiring:   { Icon: UserPlus,  color: '#9C27B0', label: 'Hiring',   cta: 'Decide',   href: '/ceo/pipeline' },
  hire_req: { Icon: Briefcase, color: '#EF5829', label: 'Hire Request', cta: 'Review Budget', href: '/ceo/talent' },
  ticket:   { Icon: LifeBuoy,  color: '#C0392B', label: 'Critical Ticket', cta: 'Open', href: '/ceo/tickets' },
  leave:    { Icon: Calendar,  color: '#F39C12', label: 'Leave',    cta: 'Review',   href: '/ceo/leave' },
  quote:    { Icon: FileText,  color: '#1598CC', label: 'Quote',    cta: 'Review',   href: '/ceo/approvals' },
}

function DecisionItem({ item, onOpen }) {
  const meta = CATEGORY_META[item.category] || {}
  const Icon = meta.Icon
  return (
    <div id={`decision-${item.id}`} style={{ borderBottom: '1px solid var(--border-primary)' }}>
      <div className="approval-item" style={{ cursor: 'pointer' }} onClick={() => onOpen(item)}>
        <div className="approval-icon" style={{ color: meta.color, background: `${meta.color}15` }}>
          {Icon && <Icon size={18} />}
        </div>
        <div className="approval-info">
          <div className="approval-title">{item.title}</div>
          <div className="approval-meta">
            {meta.label} · {item.subtitle}
          </div>
        </div>
        <div className="approval-actions">
          <button className="btn btn-primary btn-sm" onClick={(e) => { e.stopPropagation(); onOpen(item) }}>
            {meta.cta || 'Open'} <ArrowRight size={13} />
          </button>
        </div>
      </div>
      {item.budget && (
        <div style={{ padding: '0 18px 14px 18px' }}>
          <HireBudgetBreakdown budget={item.budget} compact={true} />
        </div>
      )}
    </div>
  )
}

export default function CommandCenter() {
  const navigate = useNavigate()
  const [alerts, setAlerts] = useState([])
  const [decisions, setDecisions] = useState({ invoices: [], payroll: [], hiring: [], hireRequests: [], tickets: [], leave: [], quotes: [] })
  const [activityFeed] = useState([])
  const [undoItem, setUndoItem] = useState(null)

  const [liveKPIs, setLiveKPIs] = useState({
    monthlyRevenue: { value: 0, trend: 0 },
    activeEngineers: { value: 0, trend: 0 },
    activeProjects: { value: 0, trend: 0 },
    pendingTimesheets: { value: 0, trend: 0 },
    pendingInvoices: { value: 0, trend: 0 },
  })

  useEffect(() => {
    let unsubs = []

    // 1. Invoices (sum where status=PAID, count DRAFT)
    unsubs.push(onSnapshot(collection(db, 'invoices'), snap => {
      let revenue = 0
      let drafts = 0
      const currentMonthStr = new Date().toISOString().substring(0, 7) // "YYYY-MM"
      snap.forEach(d => {
        const data = d.data()
        if (data.status === 'PAID' && data.date && data.date.startsWith(currentMonthStr)) {
          revenue += (Number(data.total) || 0)
        }
        if (data.status === 'DRAFT') {
          drafts++
        }
      })
      setLiveKPIs(p => ({ ...p, monthlyRevenue: { value: revenue, trend: 0 }, pendingInvoices: { value: drafts, trend: 0 } }))
    }, e => console.warn(e)))

    // 2. Active employees — CANONICAL: employees.employment_status == 'ACTIVE' (UPPERCASE).
    //    Requires the data migration backfilling employment_status on the 11 records that
    //    still carry the legacy status:'active' (see status-vocabulary handoff in report).
    unsubs.push(onSnapshot(query(collection(db, 'employees'), where('employment_status', '==', 'ACTIVE')), snap => {
      setLiveKPIs(p => ({ ...p, activeEngineers: { value: snap.size, trend: 0 } }))
    }, e => console.warn('activeEngineers:', e.message)))

    // 3. Active projects — canonical value is 'ACTIVE' (matches the Projects page;
    //    excludes TEST_DO_NOT_BILL fixtures). Was querying 'active'/'Active' → always 0.
    unsubs.push(onSnapshot(query(collection(db, 'projects'), where('status', '==', 'ACTIVE')), snap => {
      setLiveKPIs(p => ({ ...p, activeProjects: { value: snap.size, trend: 0 } }))
    }, e => console.warn('activeProjects:', e.message)))

    // 4. Timesheets (count where status=SUBMITTED)
    unsubs.push(onSnapshot(query(collection(db, 'timesheets'), where('state', '==', 'SUBMITTED')), snap => {
      setLiveKPIs(p => ({ ...p, pendingTimesheets: { value: snap.size, trend: 0 } }))
    }, e => console.warn(e)))

    // 5. CEO decisions — ONLY the 5 categories that must reach the CEO.
    //    Routine leave / expenses / IT tickets are filtered out by design.

    // 5a. Invoices awaiting CEO sign-off (SoD gate — generateInvoice writes PENDING_CEO_APPROVAL)
    unsubs.push(onSnapshot(query(collection(db, 'invoices'), where('status', '==', 'PENDING_CEO_APPROVAL')), snap => {
      const items = snap.docs.map(d => {
        const data = d.data()
        return {
          id: `inv-${d.id}`, category: 'invoice',
          title: `Invoice ${data.invoice_id || data.invoice_number || d.id}`,
          subtitle: `${data.client_name || 'Unknown client'} · SAR ${Number(data.total || 0).toLocaleString()}`,
          href: `/finance/invoices/${data.invoice_id || d.id}`,
          created_at: data.created_at,
        }
      })
      setDecisions(p => ({ ...p, invoices: items }))
    }, () => {}))

    // 5b. Draft payroll runs awaiting CEO approval
    unsubs.push(onSnapshot(query(collection(db, 'payroll_runs'), where('status', '==', 'DRAFT')), snap => {
      const items = snap.docs.map(d => {
        const data = d.data()
        return {
          id: `pay-${d.id}`, category: 'payroll',
          title: `Payroll — ${data.period || data.month || d.id}`,
          subtitle: `${data.employee_count || '?'} employees · SAR ${Number(data.total_gross || data.total || 0).toLocaleString()}`,
          href: '/ceo/payroll',
          created_at: data.created_at,
        }
      })
      setDecisions(p => ({ ...p, payroll: items }))
    }, () => {}))

    // 5c. Candidates in OFFER_PENDING (CEO must approve every hire)
    unsubs.push(onSnapshot(query(collection(db, 'talent_pool'), where('state', '==', 'OFFER_PENDING')), snap => {
      const items = snap.docs.map(d => {
        const data = d.data()
        return {
          id: `cand-${d.id}`, category: 'hiring',
          title: data.full_name || data.name || 'Candidate',
          subtitle: `${data.role_applied || data.role || 'Role'} · offer pending CEO approval`,
          href: '/ceo/pipeline',
          created_at: data.created_at,
        }
      })
      setDecisions(p => ({ ...p, hiring: items }))
    }, () => {}))

    // 5c-bis. Hire requests in BUDGET_CHECKED — Finance has validated the math, CEO decides
    unsubs.push(onSnapshot(query(collection(db, 'hire_requests'), where('status', '==', 'BUDGET_CHECKED')), snap => {
      const items = snap.docs.map(d => {
        const data = d.data()
        return {
          id: `hire-${d.id}`, category: 'hire_req',
          title: `${data.role_title || 'Role'} for ${data.client_name || 'client'}`,
          subtitle: `${data.project_name || data.project_id || 'project'} · ${data.po_number || 'no PO'}`,
          href: '/ceo/talent',
          created_at: data.created_at,
          budget: data.budget || null,
        }
      })
      setDecisions(p => ({ ...p, hireRequests: items }))
    }, () => {}))

    // Support tickets (incl. critical) are an IT function handled in the IT Admin
    // portal (/admin/tickets) — they no longer surface on the CEO Command Center.

    // 5e. Leave requests where the type is UNPAID or HAJJ — only these reach the CEO
    unsubs.push(onSnapshot(query(collection(db, 'leave_requests'), where('status', 'in', ['SUBMITTED', 'PENDING', 'PM_APPROVED'])), snap => {
      const items = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(l => {
          const t = String(l.leave_type || '').toLowerCase()
          return t === 'unpaid' || t === 'hajj'
        })
        .map(l => ({
          id: `leave-${l.id}`, category: 'leave',
          title: `${l.engineer_name || l.engineer_email || 'Engineer'} — ${l.leave_type_label || l.leave_type}`,
          subtitle: `${l.start_date} → ${l.end_date} · ${l.working_days || '?'} days`,
          href: '/ceo/leave',
          created_at: l.created_at,
        }))
      setDecisions(p => ({ ...p, leave: items }))
    }, () => {}))

    // 5f. CRM deal quotes that finance forwarded — awaiting CEO approval (PENDING_CEO)
    unsubs.push(onSnapshot(query(collection(db, 'deal_quotes'), where('status', '==', 'PENDING_CEO')), snap => {
      const items = snap.docs.map(d => {
        const data = d.data()
        return {
          id: `quote-${d.id}`, category: 'quote',
          title: `Quote — ${data.deal_title || data.title || d.id}`,
          subtitle: `${data.client_name || 'Unknown client'} · SAR ${Number(data.total_sar || 0).toLocaleString()}${data.discount_pct ? ` · ${data.discount_pct}% off` : ''}`,
          href: '/ceo/approvals',
          created_at: data.created_at,
        }
      })
      setDecisions(p => ({ ...p, quotes: items }))
    }, () => {}))

    return () => unsubs.forEach(u => u && u())
  }, [])

  // Roll up every category that reaches the CEO into a single decisions list.
  const ceoDecisions = [
    ...decisions.invoices, ...decisions.payroll, ...decisions.hiring, ...decisions.hireRequests, ...decisions.tickets, ...decisions.leave, ...decisions.quotes,
  ].sort((a, b) => (b.created_at?.seconds || 0) - (a.created_at?.seconds || 0))
  // Pending Approvals KPI now reflects ONLY what the CEO must personally decide. Derived, not stored.
  const pendingApprovalsCount = ceoDecisions.length

  const handleOpenDecision = (item) => {
    if (item.href) navigate(item.href)
  }

  const handleUndo = () => {
    if (undoItem) setUndoItem(null)
  }

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Command Center</h1>
        <p style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem', marginTop: 4 }}>
          {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* Critical Alerts */}
      {alerts.map(alert => (
        <div key={alert.id} className="critical-banner" id={`alert-${alert.id}`}>
          <div className="banner-icon"><AlertTriangle size={20} /></div>
          <div className="banner-text">
            <div className="banner-title">{alert.type === 'contract_expiry' ? '⚠️ Contract Expiry' : '🛡️ CAPA Overdue'}</div>
            <div className="banner-desc">{alert.message}</div>
          </div>
          <button className="btn btn-sm">{alert.action} <ArrowRight size={14} /></button>
          <button className="btn-icon" style={{ color: 'white' }} onClick={() => setAlerts(prev => prev.filter(a => a.id !== alert.id))}>
            <X size={16} />
          </button>
        </div>
      ))}

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20, marginBottom: 28 }}>
        <KPICard label="Revenue (MTD)" value={liveKPIs.monthlyRevenue.value} unit="SAR" trend={0} color="var(--green)" delay={1} />
        <KPICard label="Active Employees" value={liveKPIs.activeEngineers.value} unit="" trend={0} color="var(--sky-blue)" delay={2} />
        <KPICard label="Active Projects" value={liveKPIs.activeProjects.value} unit="" trend={0} color="var(--amber)" delay={3} />
        <KPICard label="Pending Timesheets" value={liveKPIs.pendingTimesheets.value} unit="" trend={0} color="var(--orange)" delay={4} />
        <KPICard label="Pending Invoices" value={liveKPIs.pendingInvoices.value} unit="" trend={0} color="var(--amber)" delay={5} />
        <KPICard label="Pending Approvals" value={pendingApprovalsCount} unit="" trend={0} color="var(--red)" delay={6} />
      </div>

      {/* Main Content: Approvals + Activity Feed */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 24 }}>
        {/* Items Needing Your Decision — only the 5 CEO-required categories */}
        <div className="card animate-fade-in-up stagger-3" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Items Needing Your Decision <span className="badge badge-orange" style={{ marginLeft: 8 }}>{ceoDecisions.length}</span>
            </h3>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
              Invoices · Payroll · Hires · Critical · Unpaid/Hajj leave
            </span>
          </div>
          <div style={{ maxHeight: 520, overflowY: 'auto' }}>
            {ceoDecisions.map(item => (
              <DecisionItem key={item.id} item={item} onOpen={handleOpenDecision} />
            ))}
            {ceoDecisions.length === 0 && (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>
                <CheckCircle size={32} style={{ marginBottom: 8, opacity: 0.5 }} />
                <div>All clear — no decisions waiting on you</div>
                <div style={{ fontSize: '0.78rem', marginTop: 6 }}>
                  Routine leave / expenses / IT tickets are routed to PM, Finance, HR, IT
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Live Activity Feed */}
        <div className="card animate-fade-in-up stagger-4" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-primary)' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--green)', display: 'inline-block', animation: 'pulse 2s infinite' }}></span>
              Live Activity Feed
            </h3>
          </div>
          <div className="activity-feed" style={{ padding: '8px 20px' }}>
            {activityFeed.length === 0 && (
               <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>
                 No recent activity
               </div>
            )}
            {activityFeed.map(item => (
              <div key={item.id} className="feed-item">
                <span className={`feed-dot ${item.status}`}></span>
                <div className="feed-content">
                  <div className="feed-text">{item.text}</div>
                  <div className="feed-meta">
                    <span className="feed-agent">{item.agent}</span>
                    <span>{item.time}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Undo Toast (legacy) */}
      {undoItem && (
        <div className="undo-toast">
          <span>✓ Action completed on {(undoItem.title || '').substring(0, 40)}...</span>
          <span className="undo-btn" onClick={handleUndo}>Dismiss</span>
        </div>
      )}
    </div>
  )
}
