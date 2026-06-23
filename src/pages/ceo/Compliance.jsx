import { useState, useEffect } from 'react'
import { collection, onSnapshot, query, orderBy, limit, doc } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { useCountUp } from '../../hooks/useUtils'
import { Shield, AlertTriangle, CheckCircle, XCircle, Clock, Eye, FileText, Download } from 'lucide-react'

function ComplianceGauge({ score }) {
  const displayScore = useCountUp(score, 1000)
  const color = score >= 90 ? 'var(--green)' : score >= 70 ? 'var(--amber)' : 'var(--red)'
  const circumference = 2 * Math.PI * 70
  const offset = circumference - (displayScore / 100) * circumference

  return (
    <div className="gauge-container">
      <svg width="180" height="180" viewBox="0 0 180 180">
        <circle cx="90" cy="90" r="70" fill="none" stroke="var(--border-primary)" strokeWidth="10" />
        <circle cx="90" cy="90" r="70" fill="none" stroke={color} strokeWidth="10"
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" transform="rotate(-90 90 90)"
          style={{ transition: 'stroke-dashoffset 1s ease' }}
        />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
        <span className="gauge-value" style={{ color }}>{displayScore}%</span>
        <span className="gauge-label">Compliance</span>
      </div>
    </div>
  )
}

export default function Compliance() {
  const [complianceData, setComplianceData] = useState(null)
  const [activeRegister, setActiveRegister] = useState('capa')
  // Real audit trail (task_audit_log) — replaces the previously hardcoded sample
  // rows. Per the No-Fabricated-Data rule, this shows actual logged events only.
  const [auditLog, setAuditLog] = useState(null) // null=loading, []=none
  // GRC document-review readiness snapshot (written by the GRC agent / sweep). Real
  // counts only — never a green default. null until the first check has been run.
  const [grcReadiness, setGrcReadiness] = useState(null)

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'compliance'), snap => {
      if (snap.empty) {
        setComplianceData(null)
        return
      }
      setComplianceData(snap.docs[0].data())
    }, (err) => {
      console.warn('compliance listener error:', err.message)
      setComplianceData(null)
    })
    return () => unsub()
  }, [])

  useEffect(() => {
    const q = query(collection(db, 'task_audit_log'), orderBy('action_at', 'desc'), limit(25))
    const unsub = onSnapshot(q,
      snap => setAuditLog(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      err => { console.warn('audit log listener error:', err.message); setAuditLog([]) },
    )
    return () => unsub()
  }, [])

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'grc_readiness', 'current'),
      snap => setGrcReadiness(snap.exists() ? snap.data() : null),
      err => { console.warn('grc readiness listener error:', err.message); setGrcReadiness(null) },
    )
    return () => unsub()
  }, [])

  const fmtAuditTs = (t) => {
    const d = t?.toDate ? t.toDate() : (t?._seconds ? new Date(t._seconds * 1000) : null)
    return d ? d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'
  }
  const fmtAuditDetails = (det) => {
    if (!det) return '—'
    if (typeof det === 'string') return det
    const s = Object.entries(det).filter(([, v]) => v != null && typeof v !== 'object').map(([k, v]) => `${k}: ${v}`).join(' · ')
    return s.length > 140 ? s.slice(0, 140) + '…' : (s || '—')
  }

  if (!complianceData) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 24 }}>Compliance Center</h1>
        <p>No data available (Collection empty)</p>
      </div>
    )
  }
  const registers = ['Compliance', 'Conflict of Interest', 'Gifts & Entertainment', 'CAPA']

  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 24 }}>Compliance Center</h1>

      {grcReadiness && (
        <div className="card" style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Shield size={16} style={{ color: 'var(--sky)' }} /> GRC Document Review Readiness
            </h3>
            <a href="/ceo/grc-agent" style={{ fontSize: '0.78rem', color: 'var(--sky)' }}>Open GRC Assistant →</a>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {[
              { label: 'Active documents', value: grcReadiness.total_active, tone: 'var(--text-primary)' },
              { label: 'Overdue review', value: grcReadiness.overdue, tone: grcReadiness.overdue > 0 ? 'var(--red)' : 'var(--green)' },
              { label: 'No review date', value: grcReadiness.missing_review_date, tone: grcReadiness.missing_review_date > 0 ? 'var(--amber)' : 'var(--green)' },
              { label: 'Due ≤30d', value: grcReadiness.due_soon, tone: grcReadiness.due_soon > 0 ? 'var(--amber)' : 'var(--text-primary)' },
              { label: 'With owner', value: `${grcReadiness.pct_with_owner ?? 0}%`, tone: 'var(--text-primary)' },
              { label: 'With approver', value: `${grcReadiness.pct_with_approver ?? 0}%`, tone: 'var(--text-primary)' },
            ].map((m) => (
              <div key={m.label} style={{ flex: 1, minWidth: 110, padding: '10px 14px', background: 'rgba(0,0,0,0.15)', border: '1px solid var(--border-primary)', borderRadius: 8 }}>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: m.tone }}>{m.value}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>{m.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Dashboard — 4 Quadrants */}
      <div className="grid-2" style={{ marginBottom: 28 }}>
        {/* Top-Left: Score Gauge */}
        <div className="card animate-fade-in-up stagger-1">
          <div className="card-header"><h3>Compliance Score</h3></div>
          <ComplianceGauge score={complianceData.score} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 16 }}>
            {Object.entries(complianceData.breakdown).map(([framework, score]) => (
              <div key={framework} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: score >= 90 ? 'var(--green)' : 'var(--amber)' }}>{score}%</div>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{framework}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Top-Right: Open CAPAs */}
        <div className="card animate-fade-in-up stagger-2" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-primary)' }}>
            <h3 style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
              Open CAPAs <span className="badge badge-critical" style={{ marginLeft: 8 }}>{complianceData.capas.length}</span>
            </h3>
          </div>
          {complianceData.capas.map(capa => (
            <div key={capa.id} className="approval-item">
              <div className="approval-icon" style={{ background: capa.daysOverdue > 0 ? 'var(--red-dim)' : 'var(--amber-dim, var(--warning-dim))' }}>
                {capa.daysOverdue > 0 ? '🔴' : '🟡'}
              </div>
              <div className="approval-info">
                <div className="approval-title">{capa.id} — {capa.rootCause}</div>
                <div className="approval-meta">
                  {capa.source} · Due {new Date(capa.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  {capa.daysOverdue > 0 && <span style={{ color: 'var(--red)', fontWeight: 600 }}> · {capa.daysOverdue}d overdue</span>}
                </div>
              </div>
              <span className={`badge ${capa.risk === 'High' ? 'badge-critical' : 'badge-warning'}`}>{capa.risk}</span>
              <button className="btn btn-sm btn-ghost">Close</button>
            </div>
          ))}
        </div>

        {/* Bottom-Left: Recent Events */}
        <div className="card animate-fade-in-up stagger-3" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-primary)' }}>
            <h3 style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Recent Compliance Events</h3>
          </div>
          {complianceData.recentEvents.map((ev, i) => (
            <div key={i} className="feed-item" style={{ padding: '10px 20px' }}>
              <span className={`feed-dot ${ev.status === 'pass' ? 'success' : ev.status === 'warning' ? 'warning' : 'error'}`} />
              <div className="feed-content">
                <div className="feed-text" style={{ fontSize: '0.85rem' }}>{ev.event}</div>
                <div className="feed-meta">
                  <span className="feed-agent">{ev.framework}</span>
                  <span>{ev.date}</span>
                </div>
              </div>
              <span className={`badge ${ev.status === 'pass' ? 'badge-success' : ev.status === 'warning' ? 'badge-warning' : 'badge-critical'}`}>
                {ev.status === 'pass' ? 'PASS' : ev.status === 'warning' ? 'WARN' : 'FAIL'}
              </span>
            </div>
          ))}
        </div>

        {/* Bottom-Right: Upcoming Deadlines */}
        <div className="card animate-fade-in-up stagger-4">
          <div className="card-header"><h3>Upcoming Deadlines</h3></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {(complianceData.deadlines || []).length === 0 ? (
              <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>
                No upcoming deadlines.
              </div>
            ) : (complianceData.deadlines).map((d, i, arr) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: i < arr.length - 1 ? '1px solid var(--border-primary)' : 'none' }}>
                <span className={`badge ${d.urgency === 'urgent' ? 'badge-critical' : d.urgency === 'warning' ? 'badge-warning' : 'badge-info'}`} style={{ width: 60, textAlign: 'center' }}>
                  {d.urgency === 'urgent' ? 'URGENT' : d.urgency === 'warning' ? 'SOON' : 'OK'}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{d.label}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>{d.due}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Whistleblower Reports */}
      <div className="card animate-fade-in-up" style={{ padding: 0, overflow: 'hidden', marginBottom: 28 }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-primary)' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>🔒 Whistleblower Reports</h3>
        </div>
        <table className="data-table">
          <thead><tr><th>Report ID</th><th>Received</th><th>Category</th><th>Severity</th><th>Status</th><th>48hr Ack</th><th>5-Day Triage</th><th>Actions</th></tr></thead>
          <tbody>
            {complianceData.whistleblower.map(w => (
              <tr key={w.id} style={{ background: w.severity === 'Critical' ? 'var(--red-dim)' : 'transparent' }}>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{w.id}</td>
                <td>{new Date(w.receivedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
                <td>{w.category}</td>
                <td><span className={`badge ${w.severity === 'Critical' ? 'badge-critical' : 'badge-warning'}`}>{w.severity}</span></td>
                <td><span className="badge badge-info">{w.status}</span></td>
                <td>{w.ack48hr ? <CheckCircle size={16} style={{ color: 'var(--green)' }} /> : <Clock size={16} style={{ color: 'var(--red)' }} />}</td>
                <td>{w.triage5day ? <CheckCircle size={16} style={{ color: 'var(--green)' }} /> : <Clock size={16} style={{ color: 'var(--red)' }} />}</td>
                <td><button className="btn btn-ghost btn-sm"><Eye size={14} /> Review</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Audit Log Viewer — REAL events from task_audit_log (no sample data) */}
      <div className="card animate-fade-in-up" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>📋 Audit Log Viewer <span style={{ fontSize: '0.72rem', fontWeight: 400, color: 'var(--text-tertiary)' }}>· latest 25 events</span></h3>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>Full immutable trail via Audit Export</span>
        </div>
        <table className="data-table">
          <thead><tr><th>Timestamp</th><th>Actor</th><th>Event</th><th>Details</th></tr></thead>
          <tbody>
            {auditLog === null ? (
              <tr><td colSpan={4} style={{ textAlign: 'center', padding: 24, color: 'var(--text-tertiary)' }}>Loading…</td></tr>
            ) : auditLog.length === 0 ? (
              <tr><td colSpan={4} style={{ textAlign: 'center', padding: 24, color: 'var(--text-tertiary)' }}>No audit events recorded yet.</td></tr>
            ) : auditLog.map(log => (
              <tr key={log.id}>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>{fmtAuditTs(log.action_at)}</td>
                <td style={{ fontSize: '0.82rem' }}>{log.action_by || '—'}</td>
                <td style={{ fontWeight: 600 }}>{log.event || '—'}</td>
                <td style={{ fontSize: '0.82rem' }}>{fmtAuditDetails(log.details)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
