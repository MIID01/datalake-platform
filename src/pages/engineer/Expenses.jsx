import { useState } from 'react'
import { expenses } from '../../data/mockEngineer'
import { Plus, Camera, CheckCircle, Receipt } from 'lucide-react'

const statusColors = { Draft: 'badge-neutral', Submitted: 'badge-info', Approved: 'badge-success', Reimbursed: 'badge-success', Rejected: 'badge-critical' }

export default function Expenses() {
  const [showForm, setShowForm] = useState(false)
  const pendingTotal = expenses.filter(e => e.status === 'Submitted' || e.status === 'Approved').reduce((s, e) => s + e.amount, 0)

  return (
    <div>
      <div className="flex-between" style={{ marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Expenses</h1>
          <p style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem', marginTop: 4 }}>
            Pending reimbursement: <strong style={{ color: 'var(--amber)' }}>SAR {pendingTotal}</strong>
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
          <Plus size={16} /> Submit Expense
        </button>
      </div>

      {/* Submission Form */}
      {showForm && (
        <div className="card animate-fade-in-up" style={{ marginBottom: 24 }}>
          <h3 style={{ marginBottom: 20, fontSize: '1.1rem', fontWeight: 700 }}>New Expense</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div className="form-group">
              <label className="form-label">Date</label>
              <input className="form-input" type="date" />
            </div>
            <div className="form-group">
              <label className="form-label">Category</label>
              <select className="form-input">
                <option>Transportation</option><option>Meals</option><option>Accommodation</option>
                <option>Office Supplies</option><option>Communication</option><option>Client Entertainment</option>
                <option>Training</option><option>Other</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Amount (SAR)</label>
              <input className="form-input" type="number" placeholder="0.00" step="0.01" />
            </div>
          </div>
          <div className="form-group" style={{ marginBottom: 16 }}>
            <label className="form-label">Description</label>
            <input className="form-input" type="text" placeholder="Brief description (min 10 characters)" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div className="form-group">
              <label className="form-label">Receipt</label>
              <div style={{ border: '2px dashed var(--border-primary)', borderRadius: 'var(--radius-md)', padding: 24, textAlign: 'center', cursor: 'pointer' }}>
                <Camera size={24} style={{ color: 'var(--text-tertiary)', marginBottom: 8 }} />
                <p style={{ color: 'var(--text-tertiary)', fontSize: '0.82rem' }}>Tap to take photo or upload file</p>
                <input type="file" accept="image/*;capture=camera" style={{ display: 'none' }} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Client Billable?</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.9rem' }}>
                  <input type="checkbox" style={{ accentColor: 'var(--steel-blue)' }} /> Bill to client PO
                </label>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button className="btn btn-primary"><CheckCircle size={16} /> Submit Expense</button>
          </div>
        </div>
      )}

      {/* Expense Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="data-table">
          <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th><th>Status</th><th>Receipt</th></tr></thead>
          <tbody>
            {expenses.map(exp => (
              <tr key={exp.id}>
                <td>{new Date(exp.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
                <td><span className="badge badge-info">{exp.category}</span></td>
                <td>{exp.description}</td>
                <td style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>SAR {exp.amount}</td>
                <td><span className={`badge ${statusColors[exp.status]}`}>{exp.status}</span></td>
                <td>{exp.receipt ? <CheckCircle size={16} style={{ color: 'var(--green)' }} /> : <span style={{ color: 'var(--red)', fontSize: '0.78rem' }}>Missing</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
