import { useState } from 'react'
import { supportTickets } from '../../data/mockEngineer'
import { Plus, Send, CheckCircle, Clock, MessageSquare } from 'lucide-react'

const priorityColors = { Low: 'badge-neutral', Medium: 'badge-info', High: 'badge-warning', Critical: 'badge-critical' }
const statusColors = { Open: 'badge-warning', 'In Progress': 'badge-info', Resolved: 'badge-success', Closed: 'badge-neutral' }

export default function Support() {
  const [showForm, setShowForm] = useState(false)
  const [activeTicket, setActiveTicket] = useState(null)
  const [reply, setReply] = useState('')

  return (
    <div>
      <div className="flex-between" style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Support Tickets</h1>
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
          <Plus size={16} /> New Ticket
        </button>
      </div>

      {/* New Ticket Form */}
      {showForm && (
        <div className="card animate-fade-in-up" style={{ marginBottom: 24 }}>
          <h3 style={{ marginBottom: 20 }}>Create Support Ticket</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div className="form-group">
              <label className="form-label">Category</label>
              <select className="form-input">
                <option>IT / Access Issues</option><option>Payroll / Salary</option>
                <option>Leave / HR</option><option>Client Conflict</option>
                <option>Housing / Travel</option><option>Health & Safety</option>
                <option>Contract / Legal</option><option>Other</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Priority</label>
              <select className="form-input">
                <option>Low</option><option>Medium</option><option>High</option><option>Critical</option>
              </select>
            </div>
          </div>
          <div className="form-group" style={{ marginBottom: 16 }}>
            <label className="form-label">Subject</label>
            <input className="form-input" type="text" placeholder="Brief summary (max 120 characters)" maxLength={120} />
          </div>
          <div className="form-group" style={{ marginBottom: 16 }}>
            <label className="form-label">Description</label>
            <textarea className="form-input" rows={4} placeholder="Full details (min 20 characters)..." />
          </div>
          <div className="form-group" style={{ marginBottom: 20 }}>
            <label className="form-label">Attachments (optional, max 3 files, 10MB each)</label>
            <input className="form-input" type="file" multiple />
          </div>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button className="btn btn-primary"><Send size={16} /> Submit Ticket</button>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: activeTicket ? '400px 1fr' : '1fr', gap: 24 }}>
        {/* Ticket List */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {supportTickets.map(ticket => (
            <div
              key={ticket.id}
              className="approval-item"
              style={{ cursor: 'pointer', background: activeTicket?.id === ticket.id ? 'var(--bg-surface)' : 'transparent' }}
              onClick={() => setActiveTicket(ticket)}
            >
              <div className="approval-icon" style={{ background: ticket.status === 'Resolved' || ticket.status === 'Closed' ? 'var(--green-dim)' : 'var(--amber-dim, var(--warning-dim))' }}>
                {ticket.status === 'Resolved' || ticket.status === 'Closed' ? <CheckCircle size={18} style={{ color: 'var(--green)' }} /> : <Clock size={18} style={{ color: 'var(--amber)' }} />}
              </div>
              <div className="approval-info">
                <div className="approval-title" style={{ fontSize: '0.85rem' }}>{ticket.subject}</div>
                <div className="approval-meta">
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}>{ticket.id}</span> · {ticket.category}
                </div>
              </div>
              <span className={`badge ${priorityColors[ticket.priority]}`}>{ticket.priority}</span>
            </div>
          ))}
        </div>

        {/* Ticket Detail / Thread */}
        {activeTicket && (
          <div className="card animate-fade-in-up" style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--border-primary)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>{activeTicket.subject}</h3>
                  <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
                    <span className="badge badge-info">{activeTicket.category}</span>
                    <span className={`badge ${priorityColors[activeTicket.priority]}`}>{activeTicket.priority}</span>
                    <span className={`badge ${statusColors[activeTicket.status]}`}>{activeTicket.status}</span>
                  </div>
                </div>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>{activeTicket.id}</span>
              </div>
              {/* SLA Bar */}
              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-tertiary)', marginBottom: 4 }}>
                  <span>SLA: {activeTicket.slaHours}h</span>
                  <span>Used: {activeTicket.slaUsed}h</span>
                </div>
                <div className="sla-bar">
                  <div
                    className="sla-fill"
                    style={{
                      width: `${(activeTicket.slaUsed / activeTicket.slaHours) * 100}%`,
                      background: (activeTicket.slaUsed / activeTicket.slaHours) > 0.8 ? 'var(--red)' : (activeTicket.slaUsed / activeTicket.slaHours) > 0.5 ? 'var(--amber)' : 'var(--green)',
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Thread Messages */}
            <div className="ticket-thread" style={{ flex: 1, overflowY: 'auto' }}>
              {activeTicket.thread.map((msg, i) => (
                <div key={i} className={`thread-msg ${msg.sender}`}>
                  <div>
                    <div className="thread-bubble">{msg.text}</div>
                    <div className="thread-time">{msg.time} · {msg.sender === 'user' ? 'You' : 'AI Support'}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Reply */}
            {activeTicket.status !== 'Closed' && (
              <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
                <input className="form-input" style={{ flex: 1 }} placeholder="Type a reply..." value={reply} onChange={e => setReply(e.target.value)} />
                <button className="btn btn-primary"><Send size={16} /></button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
