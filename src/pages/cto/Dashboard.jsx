import { useState, useEffect, useMemo } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { ClipboardCheck, AlertTriangle, CheckCircle, XCircle, Clock, TrendingUp } from 'lucide-react'

export default function CTODashboard() {
  const [timesheets, setTimesheets] = useState([])

  useEffect(() => {
    const q = query(collection(db, 'timesheets'))
    const unsub = onSnapshot(q, snap => setTimesheets(snap.docs.map(d => ({ id: d.id, ...d.data() }))), err => console.warn('Timesheets:', err.message))
    return () => unsub()
  }, [])

  const stats = useMemo(() => {
    const now = new Date()
    const thisMonth = now.getMonth() + 1
    const thisYear = now.getFullYear()
    const monthTs = timesheets.filter(t => t.period_month === thisMonth && t.period_year === thisYear)
    return {
      pending: timesheets.filter(t => t.state === 'SUBMITTED').length,
      escalated: timesheets.filter(t => t.state === 'CEO_ESCALATED').length,
      approved: monthTs.filter(t => t.state === 'CTO_APPROVED' || t.state === 'CLIENT_SIGNED' || t.state === 'ARCHIVED').length,
      rejected: monthTs.filter(t => t.state === 'REJECTED_BY_CTO').length,
    }
  }, [timesheets])

  const kpis = [
    { label: 'Pending Review', value: stats.pending, icon: ClipboardCheck, color: '#EF5829', accent: stats.pending > 0 },
    { label: 'Escalated to CEO', value: stats.escalated, icon: AlertTriangle, color: '#F39C12', accent: stats.escalated > 0 },
    { label: 'Approved This Month', value: stats.approved, icon: CheckCircle, color: '#34BF3A' },
    { label: 'Rejected This Month', value: stats.rejected, icon: XCircle, color: '#C0392B' },
  ]

  // Recent activity
  const recent = useMemo(() => {
    return [...timesheets]
      .sort((a, b) => {
        const aT = a.updated_at?.seconds || a.submitted_at?.seconds || 0
        const bT = b.updated_at?.seconds || b.submitted_at?.seconds || 0
        return bT - aT
      })
      .slice(0, 8)
  }, [timesheets])

  const stateLabel = (s) => {
    const map = {
      SUBMITTED: { label: 'Pending', bg: 'rgba(239,88,41,0.12)', color: '#EF5829' },
      CEO_ESCALATED: { label: 'Escalated', bg: 'rgba(243,156,18,0.12)', color: '#F39C12' },
      CTO_APPROVED: { label: 'Approved', bg: 'rgba(52,191,58,0.12)', color: '#34BF3A' },
      CLIENT_SIGNED: { label: 'Signed', bg: 'rgba(21,152,204,0.12)', color: '#1598CC' },
      REJECTED_BY_CTO: { label: 'Rejected', bg: 'rgba(192,57,43,0.12)', color: '#C0392B' },
      REJECTED_BY_CLIENT: { label: 'Client Rejected', bg: 'rgba(192,57,43,0.12)', color: '#C0392B' },
    }
    const m = map[s] || { label: s, bg: 'rgba(136,152,170,0.12)', color: '#8898aa' }
    return <span style={{ padding: '2px 10px', borderRadius: 12, fontSize: '0.65rem', fontWeight: 600, background: m.bg, color: m.color }}>{m.label}</span>
  }

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>CTO Dashboard</h1>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: 4 }}>Operational overview — timesheets, approvals, and escalations</p>
      </div>

      {/* KPIs */}
      <div className="grid-4" style={{ marginBottom: 28 }}>
        {kpis.map((k, i) => {
          const Icon = k.icon
          return (
            <div key={i} className="stat-card animate-fade-in-up" style={{ '--stat-accent': k.color, animationDelay: `${i * 0.05}s`, border: k.accent ? `1px solid ${k.color}40` : undefined }}>
              <div className="stat-label"><Icon size={14} style={{ verticalAlign: -2, marginRight: 4 }} />{k.label}</div>
              <div className="stat-value" style={{ color: k.color }}>{k.value}</div>
            </div>
          )
        })}
      </div>

      {/* SLA Reminder */}
      {stats.pending > 0 && (
        <div className="animate-fade-in-up" style={{ padding: '14px 20px', background: 'rgba(239,88,41,0.08)', border: '1px solid rgba(239,88,41,0.25)', borderRadius: 'var(--radius-md)', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
          <Clock size={18} color="#EF5829" />
          <div>
            <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#EF5829' }}>{stats.pending} timesheet{stats.pending !== 1 ? 's' : ''} awaiting your review</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginTop: 2 }}>48-hour SLA — timesheets auto-escalate to CEO if not acted on</div>
          </div>
        </div>
      )}

      {/* Recent Activity */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <TrendingUp size={16} color="var(--text-tertiary)" />
          <h3 style={{ fontSize: '0.9rem', fontWeight: 700, margin: 0 }}>Recent Timesheet Activity</h3>
        </div>
        {recent.length === 0 ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>No timesheets yet</div>
        ) : (
          <div>
            {recent.map((t, i) => (
              <div key={t.timesheet_id} className="animate-fade-in-up" style={{ padding: '12px 20px', borderBottom: i < recent.length - 1 ? '1px solid var(--border-primary)' : 'none', display: 'flex', alignItems: 'center', gap: 14, animationDelay: `${i * 0.03}s` }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg, #34BF3A, #1598CC)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: '0.6rem', flexShrink: 0 }}>
                  {t.engineer_name?.split(' ').map(n => n[0]).join('').slice(0, 2)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{t.engineer_name}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>{t.project_name} · {t.period_label} · {t.total_hours}h</div>
                </div>
                {stateLabel(t.state)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
