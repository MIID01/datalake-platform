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
                <option>— Select Project / Engineer —</option>
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 16 }}>
              <label className="form-label">Subject</label>
              <input type="text" className="form-input" placeholder="Brief description of the issue" />
            </div>
            <div className="form-group" style={{ marginBottom: 16 }}>
              <label className="form-label">Details</label>
              <textarea className="form-input" rows={4} placeholder="Full context of the request..."></textarea>
            </div>
            <button className="btn btn-primary"><Send size={16} /> Submit Request</button>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Ticket ID</th>
              <th>Subject</th>
              <th>Submitted</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24, color: 'var(--text-tertiary)' }}>No support requests found.</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
