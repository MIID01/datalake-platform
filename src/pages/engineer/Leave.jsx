import { useState } from 'react'
import { leaveData } from '../../data/mockEngineer'
import { Plus, Calendar, CheckCircle } from 'lucide-react'

const statusColors = { Approved: 'badge-success', Pending: 'badge-warning', Rejected: 'badge-critical' }

export default function Leave() {
  const [showForm, setShowForm] = useState(false)

  return (
    <div>
      <div className="flex-between" style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Leave & Holidays</h1>
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
          <Plus size={16} /> Request Leave
        </button>
      </div>

      {/* Balance Cards */}
      <div className="grid-4" style={{ marginBottom: 28 }}>
        {leaveData.balances.map((b, i) => (
          <div key={b.type} className={`eng-stat-card animate-fade-in-up stagger-${i + 1}`} style={{ '--stat-color': b.color, '--stat-bg': `${b.color}15` }}>
            <div className="stat-value" style={{ color: b.color, fontSize: '2rem' }}>{b.remaining}</div>
            <div className="stat-label">{b.type}</div>
            <div style={{ marginTop: 8, height: 4, borderRadius: 2, background: 'var(--border-primary)' }}>
              <div style={{ width: `${(b.remaining / b.total) * 100}%`, height: '100%', borderRadius: 2, background: b.color, transition: 'width 0.5s ease' }} />
            </div>
            <div className="stat-sub">{b.remaining} of {b.total} days remaining</div>
          </div>
        ))}
      </div>

      {/* Request Form */}
      {showForm && (
        <div className="card animate-fade-in-up" style={{ marginBottom: 24 }}>
          <h3 style={{ marginBottom: 20, fontSize: '1.1rem', fontWeight: 700 }}>New Leave Request</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div className="form-group">
              <label className="form-label">Leave Type</label>
              <select className="form-input">
                <option>Annual Leave</option><option>Sick Leave</option>
                <option>Unpaid Leave</option><option>Emergency Leave</option>
                <option>Bereavement Leave</option><option>Marriage Leave</option>
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label className="form-label">Start Date</label>
                <input className="form-input" type="date" />
              </div>
              <div className="form-group">
                <label className="form-label">End Date</label>
                <input className="form-input" type="date" />
              </div>
            </div>
          </div>
          <div className="form-group" style={{ marginBottom: 16 }}>
            <label className="form-label">Reason</label>
            <textarea className="form-input" rows={3} placeholder="Please provide a reason for your leave request (min 10 characters)..." />
          </div>
          <div className="form-group" style={{ marginBottom: 16 }}>
            <label className="form-label">Medical Certificate (required for sick leave &gt; 2 days)</label>
            <input className="form-input" type="file" accept=".pdf,.jpg,.png" />
          </div>
          <div className="form-group" style={{ marginBottom: 20 }}>
            <label className="form-label">Handover Notes (optional)</label>
            <textarea className="form-input" rows={2} placeholder="Who covers your responsibilities during absence?" />
          </div>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button className="btn btn-primary"><CheckCircle size={16} /> Submit Request</button>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {/* Leave Requests */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-primary)' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>Leave Requests</h3>
          </div>
          <table className="data-table">
            <thead><tr><th>Type</th><th>Dates</th><th>Days</th><th>Status</th></tr></thead>
            <tbody>
              {leaveData.requests.map(r => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600 }}>{r.type}</td>
                  <td>{new Date(r.start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — {new Date(r.end).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{r.days}</td>
                  <td><span className={`badge ${statusColors[r.status]}`}>{r.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Upcoming Holidays */}
        <div className="card">
          <div className="card-header"><h3>Saudi Public Holidays 2026</h3></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {leaveData.holidays.map((h, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: i < leaveData.holidays.length - 1 ? '1px solid var(--border-primary)' : 'none' }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--steel-blue-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem' }}>🇸🇦</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{h.name}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
                    {h.date || `${new Date(h.start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — ${new Date(h.end).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                  </div>
                </div>
                <span className="badge badge-info">Holiday</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
