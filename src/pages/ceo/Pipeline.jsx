import { useState } from 'react'
import { pipelineData } from '../../data/mockCEO'
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { GripVertical, ExternalLink, Clock, DollarSign, AlertCircle, CheckCircle } from 'lucide-react'

const statusColors = { Registered: 'badge-success', Pending: 'badge-warning', 'Not Started': 'badge-neutral' }

export default function Pipeline() {
  const [columns, setColumns] = useState(pipelineData.columns)
  const [showWonModal, setShowWonModal] = useState(null)

  const totalPipelineValue = columns.flatMap(c => c.cards).reduce((sum, card) => sum + card.value, 0)

  return (
    <div>
      <div className="flex-between" style={{ marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Revenue Pipeline</h1>
          <p style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem', marginTop: 4 }}>
            Total pipeline value: <strong style={{ color: 'var(--sky-blue)' }}>SAR {totalPipelineValue.toLocaleString()}</strong>
          </p>
        </div>
      </div>

      {/* Kanban Board */}
      <div className="kanban-board" style={{ marginBottom: 32 }}>
        {columns.map(col => (
          <div key={col.id} className="kanban-column">
            <div className="kanban-column-header">
              <span className="kanban-column-title">{col.title}</span>
              <span className="kanban-count">{col.cards.length}</span>
            </div>
            <div className="kanban-cards">
              {col.cards.map(card => (
                <div key={card.id} className="kanban-card" id={`rfp-${card.id}`}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                    <div className="kanban-card-title">{card.title}</div>
                  </div>
                  <div className="kanban-card-meta">
                    <span>👤 {card.client}</span>
                    <span>💰 SAR {card.value.toLocaleString()}</span>
                    <span>📅 {new Date(card.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                    <span>🔗 {card.source}</span>
                  </div>
                  <div className="kanban-card-footer">
                    <span className="badge badge-info">{card.score}% match</span>
                    {col.id !== 'won' && col.id !== 'lost' && (
                      <button className="btn btn-sm btn-ghost" onClick={() => {
                        if (col.id === 'submitted') setShowWonModal(card)
                      }}>
                        Move →
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {col.cards.length === 0 && (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.8rem' }}>No items</div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Pipeline Analytics */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 28 }}>
        <div className="chart-card">
          <div className="chart-card-header">
            <h3 className="chart-card-title">Win Rate (Last 12 Months)</h3>
          </div>
          <div style={{ height: 250 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={pipelineData.analytics.winRate}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" />
                <XAxis dataKey="month" tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} />
                <YAxis tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} tickFormatter={v => `${v}%`} />
                <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-card)', borderRadius: 10, color: 'var(--text-primary)' }} formatter={v => `${v}%`} />
                <Line type="monotone" dataKey="rate" stroke="var(--sky-blue)" strokeWidth={2} dot={{ r: 4, fill: 'var(--sky-blue)' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="chart-card">
          <div className="chart-card-header">
            <h3 className="chart-card-title">Revenue by Client</h3>
          </div>
          <div style={{ height: 250 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={pipelineData.analytics.revenueByClient} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" />
                <XAxis type="number" tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} tickFormatter={v => `${(v / 1000).toFixed(0)}K`} />
                <YAxis type="category" dataKey="client" tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} width={60} />
                <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-card)', borderRadius: 10, color: 'var(--text-primary)' }} formatter={v => `SAR ${v.toLocaleString()}`} />
                <Bar dataKey="revenue" fill="var(--sky-blue)" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Vendor Registration Tracker */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-primary)' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>Vendor Registration Tracker</h3>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: 4 }}>Target: expand from 6 to 200+ portals</p>
        </div>
        <table className="data-table">
          <thead><tr><th>Portal</th><th>Status</th><th>Registration Date</th><th>Expiry Date</th><th>Alert</th></tr></thead>
          <tbody>
            {pipelineData.vendors.map(v => (
              <tr key={v.portal}>
                <td style={{ fontWeight: 600 }}>{v.portal}</td>
                <td><span className={`badge ${statusColors[v.status]}`}>{v.status}</span></td>
                <td>{v.date || '—'}</td>
                <td>{v.expiry || '—'}</td>
                <td>{v.alert ? <AlertCircle size={16} style={{ color: 'var(--red)' }} /> : <CheckCircle size={16} style={{ color: 'var(--green)' }} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Won Confirmation Modal */}
      {showWonModal && (
        <div className="modal-overlay" onClick={() => setShowWonModal(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3 style={{ marginBottom: 16 }}>🎉 Mark as WON?</h3>
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 24 }}>
              Mark <strong>{showWonModal.title}</strong> as WON?<br />
              This will trigger automated talent sourcing via Gatekeeper AI.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setShowWonModal(null)}>Cancel</button>
              <button className="btn btn-success" onClick={() => setShowWonModal(null)}>Confirm WON</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
