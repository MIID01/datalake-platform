import { useState } from 'react'
import { Plus, Send } from 'lucide-react'

export default function ClientSupport() {
  const [showForm, setShowForm] = useState(false)

  return (
    <div>
      <div className="flex-between" style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Support</h1>
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
          <Plus size={16} /> New Request
        </button>
      </div>

      {showForm && (
        <div className="card animate-fade-in-up" style={{ marginBottom: 24 }}>
          <h3 style={{ marginBottom: 20 }}>Submit a Request</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div className="form-group">
              <label className="form-label">Category</label>
              <select className="form-input">
                <option>Engineer Performance Issue</option>
                <option>Request Replacement Engineer</option>
                <option>Contract Extension</option>
                <option>PO Modification</option>
                <option>Invoice Dispute</option>
                <option>Other</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Related Engineer (if applicable)</label>
              <select className="form-input">
                <option>— Select —</option>
                <option>Mohammed Al-Fahad — Senior Java Engineer</option>
                <option>Fatimah Al-Harbi — DevOps Engineer</option>
              </select>
            </div>
          </div>
          <div className="form-group" style={{ marginBottom: 16 }}>
            <label className="form-label">Subject</label>
            <input className="form-input" type="text" placeholder="Brief summary" />
          </div>
          <div className="form-group" style={{ marginBottom: 20 }}>
            <label className="form-label">Details</label>
            <textarea className="form-input" rows={4} placeholder="Describe your request in detail..." />
          </div>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button className="btn btn-primary"><Send size={16} /> Submit Request</button>
          </div>
        </div>
      )}

      {/* Existing requests */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="data-table">
          <thead><tr><th>ID</th><th>Category</th><th>Subject</th><th>Date</th><th>Status</th></tr></thead>
          <tbody>
            <tr>
              <td style={{ fontFamily: 'var(--font-mono)' }}>CR-2026-003</td>
              <td><span className="badge badge-info">Contract Extension</span></td>
              <td style={{ fontWeight: 600 }}>Extend Mohammed Al-Fahad contract by 6 months</td>
              <td>Apr 10, 2026</td>
              <td><span className="badge badge-warning">In Review</span></td>
            </tr>
            <tr>
              <td style={{ fontFamily: 'var(--font-mono)' }}>CR-2026-001</td>
              <td><span className="badge badge-info">PO Modification</span></td>
              <td style={{ fontWeight: 600 }}>Increase PO-2024-018 by 500 hours</td>
              <td>Feb 15, 2026</td>
              <td><span className="badge badge-success">Completed</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
