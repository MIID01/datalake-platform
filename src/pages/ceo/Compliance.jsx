import { useState } from 'react'
import { complianceData } from '../../data/mockCEO'
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
  const [activeRegister, setActiveRegister] = useState('capa')
  const registers = ['Compliance', 'Conflict of Interest', 'Gifts & Entertainment', 'CAPA']

  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 24 }}>Compliance Center</h1>

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
            {[
              { label: 'Contract Renewal: Ahmed Al-Rashidi', due: 'Apr 25, 2026', urgency: 'urgent' },
              { label: 'Contract Renewal: Lina K.', due: 'Apr 30, 2026', urgency: 'urgent' },
              { label: 'NCA Annual Security Review', due: 'Jun 15, 2026', urgency: 'info' },
              { label: 'PDPL Annual Training Due', due: 'May 15, 2026', urgency: 'warning' },
              { label: 'AWS Vendor Contract Renewal', due: 'Expired', urgency: 'urgent' },
            ].map((d, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: i < 4 ? '1px solid var(--border-primary)' : 'none' }}>
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

      {/* Audit Log Viewer (simplified) */}
      <div className="card animate-fade-in-up" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>📋 Audit Log Viewer</h3>
          <button className="btn btn-ghost btn-sm"><Download size={14} /> Export CSV</button>
        </div>
        <table className="data-table">
          <thead><tr><th>Timestamp</th><th>AI Agent</th><th>Action</th><th>Details</th><th>Compliance Rule</th></tr></thead>
          <tbody>
            {[
              { time: '2026-04-20 09:22', agent: 'Auditor', action: 'BLOCKED', details: 'Proposal PROP-2026-018 missing SAMA clause', rule: 'SAMA CSF 4.2.1' },
              { time: '2026-04-20 09:14', agent: 'Gatekeeper', action: 'PARSED', details: 'Resume processed: 87% match for Java Engineer', rule: 'PDPL Art. 5' },
              { time: '2026-04-20 03:00', agent: 'Gatekeeper', action: 'PURGED', details: '3 candidate records deleted (30-day expiry)', rule: 'PDPL Art. 18' },
              { time: '2026-04-19 10:00', agent: 'Controller', action: 'CREATED', details: 'Invoice INV-2026-047 draft — SAR 48,000', rule: 'SAMA Segregation' },
              { time: '2026-04-19 09:00', agent: 'Auditor', action: 'CHECKED', details: 'NDA signatures verified — all current', rule: 'NCA ECC-1:2018' },
            ].map((log, i) => (
              <tr key={i}>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>{log.time}</td>
                <td><span className="feed-agent">{log.agent}</span></td>
                <td style={{ fontWeight: 600 }}>{log.action}</td>
                <td style={{ fontSize: '0.82rem' }}>{log.details}</td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>{log.rule}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
