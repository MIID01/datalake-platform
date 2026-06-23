import { useState, useEffect } from 'react'
import { collection, query, onSnapshot, updateDoc, doc, serverTimestamp, arrayUnion } from 'firebase/firestore'
import { db, auth, APPROVE_LEAVE_URL } from '../../lib/firebase'
import { CheckCircle, XCircle, AlertTriangle, Loader } from 'lucide-react'

// Statuses where an internal approver (CEO/HR) can still decide. The backend
// (functions/leave.js) routes internal requests to PENDING_APPROVAL; SUBMITTED
// is the transient pre-routing state and CLIENT_APPROVED hands back to internal.
const ACTIONABLE = ['PENDING_APPROVAL', 'SUBMITTED', 'CLIENT_APPROVED']

// Badge class per canonical leave status (no green/positive default).
const STATUS_BADGE = {
  PENDING_APPROVAL: 'badge-warning',
  SUBMITTED: 'badge-warning',
  CLIENT_PENDING: 'badge-info',
  CLIENT_APPROVED: 'badge-info',
  PM_APPROVED: 'badge-info',
  APPROVED: 'badge-success',
  REJECTED: 'badge-error',
  CLIENT_REJECTED: 'badge-error',
  CANCELLED: 'badge-error',
}

export default function CEOLeave() {
  const [requests, setRequests] = useState([])
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const q = query(collection(db, 'leave_requests'))
    const unsub = onSnapshot(q, snap => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      data.sort((a, b) => (b.created_at?.seconds || 0) - (a.created_at?.seconds || 0))
      setRequests(data)
    })
    return () => unsub()
  }, [])

  const handleAction = async (id, action) => {
    setError('')
    setBusyId(id)
    try {
      if (action === 'approve') {
        // Route through the Cloud Function so payroll deduction (Pub/Sub),
        // notification, and immutable approval_history all fire. A direct
        // client write would flip the status but skip every side effect.
        const token = await auth.currentUser.getIdToken()
        const r = await fetch(APPROVE_LEAVE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ leave_id: id }),
        })
        if (!r.ok) {
          const err = await r.json().catch(() => ({}))
          throw new Error(err.error || `HTTP ${r.status}`)
        }
      } else {
        // No backend reject handler exists; firestore.rules permit CEO/HR to
        // write leave status directly. Stamp an audit row on the request.
        const u = auth.currentUser
        await updateDoc(doc(db, 'leave_requests', id), {
          status: 'REJECTED',
          rejected_by: u?.email || 'ceo',
          rejected_at: serverTimestamp(),
          updated_at: serverTimestamp(),
          approval_history: arrayUnion({
            action: 'INTERNAL_REJECTED',
            by: u?.email || 'ceo',
            timestamp: new Date().toISOString(),
          }),
        })
      }
    } catch (err) {
      console.error(err)
      setError(`Could not ${action} this request: ${err.message}`)
    } finally {
      setBusyId(null)
    }
  }


  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 24 }}>Company Leave Requests</h1>
      {error && (
        <div className="card" style={{ padding: '12px 16px', marginBottom: 16, background: 'rgba(192,57,43,0.08)', border: '1px solid rgba(192,57,43,0.25)', color: '#C0392B', display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertTriangle size={16} /> {error}
        </div>
      )}
      <div className="card" style={{ padding: 0 }}>
        {requests.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-tertiary)' }}>No leave requests</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Type</th>
                <th>Dates</th>
                <th>Days</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {requests.map(req => (
                <tr key={req.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{req.engineer_name}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>{req.engineer_email}</div>
                  </td>
                  <td>{req.leave_type_label || req.leave_type}</td>
                  <td>{req.start_date} to {req.end_date}</td>
                  <td>{req.working_days}</td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[req.status] || 'badge-warning'}`}>
                      {req.status}
                    </span>
                  </td>
                  <td>
                    {ACTIONABLE.includes(req.status) ? (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-success btn-sm" disabled={busyId === req.id} onClick={() => handleAction(req.id, 'approve')}>
                          {busyId === req.id ? <Loader size={14} className="spin" /> : <CheckCircle size={14} />} Approve
                        </button>
                        <button className="btn btn-danger btn-sm" disabled={busyId === req.id} onClick={() => handleAction(req.id, 'reject')}>
                          <XCircle size={14} /> Reject
                        </button>
                      </div>
                    ) : (
                      <span style={{ color: 'var(--text-tertiary)', fontSize: '0.8rem' }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
