import { useState, useEffect } from 'react'
import { useCountUp } from '../../hooks/useUtils'
import { LineChart, Line, ResponsiveContainer } from 'recharts'
import { TrendingUp, TrendingDown, AlertTriangle, X, ArrowRight, CheckCircle, XCircle } from 'lucide-react'

// TODO: Replace with live Firestore hooks
const liveKPIs = {
  monthlyRevenue: { value: 0, trend: 0 },
  activeEngineers: { value: 0, trend: 0 },
  cashPosition: { value: 0, trend: 0 },
  complianceScore: { value: 0, trend: 0 },
}

function KPICard({ label, value, unit, trend, color, delay, sparkData }) {
  const displayVal = useCountUp(value, 900)
  const isUp = trend > 0

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

function ApprovalItem({ item, onApprove, onReject }) {
  const slaPercent = (item.slaRemaining / item.sla) * 100
  const slaClass = slaPercent < 25 ? 'urgent' : slaPercent < 50 ? 'warning' : 'ok'

  return (
    <div className="approval-item" id={`approval-${item.id}`}>
      <div className="approval-icon">{item.icon}</div>
      <div className="approval-info">
        <div className="approval-title">{item.title}</div>
        <div className="approval-meta">{item.requester} · Submitted {new Date(item.submitted).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
      </div>
      <span className={`approval-sla ${slaClass}`}>
        {item.slaRemaining}h left
      </span>
      <div className="approval-actions">
        <button className="btn btn-success btn-sm" onClick={() => onApprove(item.id)}>
          <CheckCircle size={14} /> {item.actions[0]}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => onReject(item.id)}>
          <XCircle size={14} /> {item.actions[1]}
        </button>
      </div>
    </div>
  )
}

export default function CommandCenter() {
  const [alerts, setAlerts] = useState([])
  const [approvals, setApprovals] = useState([])
  const [activityFeed, setActivityFeed] = useState([])
  const [undoItem, setUndoItem] = useState(null)

  const sparkRevenue = []
  const sparkEngineers = []
  const sparkCash = []
  const sparkCompliance = []

  const handleApprove = (id) => {
    const item = approvals.find(a => a.id === id)
    setApprovals(prev => prev.filter(a => a.id !== id))
    setUndoItem(item)
    setTimeout(() => setUndoItem(null), 5000)
  }

  const handleUndo = () => {
    if (undoItem) {
      setApprovals(prev => [...prev, undoItem].sort((a, b) => a.slaRemaining - b.slaRemaining))
      setUndoItem(null)
    }
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
      <div className="grid-4" style={{ marginBottom: 28 }}>
        <KPICard label="Monthly Revenue" value={liveKPIs.monthlyRevenue.value} unit="SAR" trend={liveKPIs.monthlyRevenue.trend} color="var(--green)" delay={1} sparkData={sparkRevenue} />
        <KPICard label="Active Engineers" value={liveKPIs.activeEngineers.value} unit="" trend={liveKPIs.activeEngineers.trend} color="var(--sky-blue)" delay={2} sparkData={sparkEngineers} />
        <KPICard label="Cash Position" value={liveKPIs.cashPosition.value} unit="SAR" trend={liveKPIs.cashPosition.trend} color="var(--green)" delay={3} sparkData={sparkCash} />
        <KPICard label="Compliance Score" value={liveKPIs.complianceScore.value} unit="%" trend={liveKPIs.complianceScore.trend} color="var(--green)" delay={4} sparkData={sparkCompliance} />
      </div>

      {/* Main Content: Approvals + Activity Feed */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 24 }}>
        {/* Pending Approvals */}
        <div className="card animate-fade-in-up stagger-3" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Pending Approvals <span className="badge badge-orange" style={{ marginLeft: 8 }}>{approvals.length}</span>
            </h3>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>Sorted by urgency</span>
          </div>
          <div style={{ maxHeight: 520, overflowY: 'auto' }}>
            {approvals.sort((a, b) => a.slaRemaining - b.slaRemaining).map(item => (
              <ApprovalItem key={item.id} item={item} onApprove={handleApprove} onReject={handleApprove} />
            ))}
            {approvals.length === 0 && (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>
                <CheckCircle size={32} style={{ marginBottom: 8, opacity: 0.5 }} />
                <div>All clear — no pending approvals</div>
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

      {/* Undo Toast */}
      {undoItem && (
        <div className="undo-toast">
          <span>✓ Action completed on {undoItem.title.substring(0, 40)}...</span>
          <span className="undo-btn" onClick={handleUndo}>Undo</span>
          <span className="undo-timer">5s</span>
        </div>
      )}
    </div>
  )
}
