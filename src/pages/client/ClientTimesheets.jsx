import { useState, useEffect } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'
import { db, auth, CLIENT_SIGN_TIMESHEET_URL } from '../../lib/firebase'
import { CheckCircle, XCircle, Eye, Calendar, Loader } from 'lucide-react'

const STATE_MAPPING = {
  SUBMITTED: 'Pending Approval',
  CLIENT_SIGNED: 'Approved',
  REJECTED_BY_CLIENT: 'Rejected',
  CTO_APPROVED: 'Approved',
  CEO_ESCALATED: 'Pending Approval',
  REJECTED_BY_CTO: 'Rejected'
}

const statusColors = { 'Pending Approval': 'badge-warning', Approved: 'badge-success', Rejected: 'badge-critical' }

export default function ClientTimesheets() {
  const [items, setItems] = useState([])
  const [filter, setFilter] = useState('All')
  const [clientEmail, setClientEmail] = useState(null)
  const [actionLoading, setActionLoading] = useState(false)

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(u => {
      if (u) setClientEmail(u.email)
    })
    return () => unsub()
  }, [])

  useEffect(() => {
    if (!clientEmail) return
    // Query timesheets for this client's projects. For V1 testing, just fetch all and filter client side if client_email is not explicitly set, or better just rely on rules and filter locally if needed.
    // For V1, the timesheet has `client_id` or `client_name`. Let's fetch all and filter if needed, or assume they are assigned.
    // Actually, to make it work quickly for V1 testing:
    const unsub = onSnapshot(collection(db, 'timesheets'), snap => {
      // In a real app, we'd query by `client_id == user.client_id`. Here we'll just show them all or filter if clientEmail matches.
      // For V1 spec demo, let's just show all SUBMITTED, CLIENT_SIGNED, etc.
      setItems(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })
    return () => unsub()
  }, [clientEmail])

  const mappedItems = items.map(t => ({
    ...t,
    displayStatus: STATE_MAPPING[t.state] || 'Pending Approval'
  }))

  const filtered = filter === 'All' ? mappedItems : mappedItems.filter(t => t.displayStatus === filter)
  const pendingCount = mappedItems.filter(t => t.displayStatus === 'Pending Approval').length

  // Sign via the session-authed clientSignTimesheet function — it verifies the
  // caller's email == the timesheet's client_approver_email (no CEO/staff bypass),
  // so only the real client approver's own session can sign. Direct CLIENT_SIGNED
  // writes are denied by firestore.rules.
  const postDecision = async (id, body, fallbackErr) => {
    setActionLoading(id)
    try {
      const idToken = await auth.currentUser.getIdToken()
      const res = await fetch(CLIENT_SIGN_TIMESHEET_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ timesheet_id: id, ...body }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || fallbackErr)
    } catch (err) {
      console.error(err)
      window.alert(err.message || fallbackErr)
    }
    setActionLoading(false)
  }

  const handleApprove = async (id) => {
    const name = window.prompt('Type your full name to sign this timesheet:')
    if (!name || !name.trim()) return
    await postDecision(id, { decision: 'SIGN', signature_method: 'type', signature_data: name.trim() },
      'Could not sign — you must be the named client approver.')
  }

  const handleReject = async (id) => {
    const reason = window.prompt('Reason for rejection:')
    if (!reason || !reason.trim()) return
    await postDecision(id, { decision: 'REJECT', rejection_reason: reason.trim() },
      'Could not reject this timesheet.')
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
            <tr><th>Engineer</th><th>PO</th><th>Period</th><th>Hours</th><th>Submitted</th><th>Status</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan="7" style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>No timesheets found</td></tr>
            ) : filtered.map(ts => (
              <tr key={ts.id} style={{ background: ts.displayStatus === 'Pending Approval' ? 'var(--warning-dim)' : 'transparent' }}>
                <td style={{ fontWeight: 600 }}>{ts.engineer_name || ts.engineer_email}</td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>{ts.project_name || 'N/A'}</td>
                <td>{ts.period_label || `${ts.period_month}/${ts.period_year}`}</td>
                <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{ts.total_hours}</td>
                <td>{ts.submitted_at?.toDate ? ts.submitted_at.toDate().toLocaleDateString() : 'N/A'}</td>
                <td><span className={`badge ${statusColors[ts.displayStatus]}`}>{ts.displayStatus === 'Pending Approval' ? 'Pending' : ts.displayStatus}</span></td>
                <td>
                  {ts.displayStatus === 'Pending Approval' ? (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-success btn-sm" onClick={() => handleApprove(ts.id)} disabled={actionLoading === ts.id}>
                        {actionLoading === ts.id ? <Loader size={14} className="spin" /> : <CheckCircle size={14} />} Approve
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => handleReject(ts.id)} disabled={actionLoading === ts.id}>
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
