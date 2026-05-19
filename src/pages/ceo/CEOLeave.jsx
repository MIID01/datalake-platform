import { useState, useEffect } from 'react'
import { collection, query, onSnapshot, updateDoc, doc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { CheckCircle, XCircle, Clock, AlertTriangle } from 'lucide-react'

export default function CEOLeave() {
  const [requests, setRequests] = useState([])

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
    try {
      await updateDoc(doc(db, 'leave_requests', id), {
        status: action === 'approve' ? 'APPROVED' : 'REJECTED',
        approved_by: 'ceo',
        approved_at: serverTimestamp(),
        updated_at: serverTimestamp()
      })
    } catch (err) {
      console.error(err)
    }
  }

  const fmtDate = (ts) => {
    if (!ts) return '—'
    const d = ts.toDate ? ts.toDate() : new Date(ts)
    return d.toLocaleDateString()
  }

  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 24 }}>Company Leave Requests</h1>
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
                    <span className={`badge ${req.status === 'PENDING' ? 'badge-warning' : req.status === 'APPROVED' ? 'badge-success' : 'badge-error'}`}>
                      {req.status}
                    </span>
                  </td>
                  <td>
                    {req.status === 'PENDING' && (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-success btn-sm" onClick={() => handleAction(req.id, 'approve')}>
                          <CheckCircle size={14} /> Approve
                        </button>
                        <button className="btn btn-danger btn-sm" onClick={() => handleAction(req.id, 'reject')}>
                          <XCircle size={14} /> Reject
                        </button>
                      </div>
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
