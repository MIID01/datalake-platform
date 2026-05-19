import { useState, useEffect } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { CheckCircle, XCircle, Eye, Calendar } from 'lucide-react'

const statusColors = { 'Pending Approval': 'badge-warning', Approved: 'badge-success', Rejected: 'badge-critical' }

export default function ClientTimesheets() {
  const [items, setItems] = useState([])
  const [filter, setFilter] = useState('All')
  const [detailItem, setDetailItem] = useState(null)

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'client_timesheets'), snap => {
      setItems(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })
    return () => unsub()
  }, [])

  const filtered = filter === 'All' ? items : items.filter(t => t.status === filter)
  const pendingCount = items.filter(t => t.status === 'Pending Approval').length

  const handleApprove = (id) => {
    setItems(prev => prev.map(t => t.id === id ? { ...t, status: 'Approved', approvedDate: new Date().toISOString().split('T')[0] } : t))
    setDetailItem(null)
  }

  const handleReject = (id) => {
    setItems(prev => prev.map(t => t.id === id ? { ...t, status: 'Rejected' } : t))
    setDetailItem(null)
  }

  return (
    <div>
      <div className="flex-between" style={{ marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Timesheet Approvals</h1>
          <p style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem', marginTop: 4 }}>
            {pendingCount > 0 ? <><strong style={{ color: 'var(--amber)' }}>{pendingCount}</strong> timesheets awaiting your approval</> : 'All timesheets are up to date ✓'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {['All', 'Pending Approval', 'Approved', 'Rejected'].map(f => (
            <button key={f} className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFilter(f)}>{f === 'Pending Approval' ? 'Pending' : f}</button>
          ))}
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="data-table">
          <thead>
            <tr><th>Engineer</th><th>Role</th><th>PO</th><th>Period</th><th>Hours</th><th>Amount (SAR)</th><th>Submitted</th><th>Status</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {filtered.map(ts => (
              <tr key={ts.id} style={{ background: ts.status === 'Pending Approval' ? 'var(--warning-dim)' : 'transparent' }}>
                <td style={{ fontWeight: 600 }}>{ts.engineer}</td>
                <td style={{ fontSize: '0.82rem' }}>{ts.role}</td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>{ts.po}</td>
                <td>{ts.period}</td>
                <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{ts.hours}</td>
                <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{ts.amount.toLocaleString()}</td>
                <td>{new Date(ts.submittedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
                <td><span className={`badge ${statusColors[ts.status]}`}>{ts.status === 'Pending Approval' ? 'Pending' : ts.status}</span></td>
                <td>
                  {ts.status === 'Pending Approval' ? (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-success btn-sm" onClick={() => handleApprove(ts.id)}>
                        <CheckCircle size={14} /> Approve
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => handleReject(ts.id)}>
                        <XCircle size={14} /> Reject
                      </button>
                    </div>
                  ) : (
                    <button className="btn btn-ghost btn-sm"><Eye size={14} /> View</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Summary note */}
      <div style={{ marginTop: 16, padding: '12px 20px', background: 'var(--bg-surface)', borderRadius: 'var(--radius-md)', fontSize: '0.78rem', color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
        💡 <strong>SLA Reminder:</strong> Timesheets must be approved within <strong>48 hours</strong> of submission. 
        Approved timesheets will be used by Datalake to generate invoices under your purchase order.
      </div>
    </div>
  )
}
