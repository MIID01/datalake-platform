import { useState, useEffect } from 'react'
import { db } from '../../lib/firebase'
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore'
import { ScrollText } from 'lucide-react'
import { s, fmtTime } from './adminStyles'

// IT-relevant audit events (account/access/credential lifecycle).
const IT_EVENTS = [
  'USER_CREATED', 'USER_DISABLED', 'USER_ENABLED', 'USER_ROLE_CHANGED',
  'ROLE_CREATED', 'ROLE_DELETED', 'ACCESS_MATRIX_UPDATED',
  'PASSWORD_RESET', 'PASSWORD_GENERATED', 'PASSWORD_EXPIRY_FORCED', 'ACCESS_GRANTED', 'LOGIN_ATTEMPT',
]

export default function AuditLogs() {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const q = query(collection(db, 'task_audit_log'), orderBy('action_at', 'desc'), limit(200))
    const unsub = onSnapshot(q,
      snap => { setLogs(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false) },
      err => { setError(err.message); setLoading(false) }
    )
    return () => unsub()
  }, [])

  const itLogs = logs.filter(l => IT_EVENTS.includes(l.event))

  return (
    <div style={s.page}>
      <h1 style={s.h1}>Audit Logs</h1>
      <p style={s.sub}>IT-specific events: account lifecycle, role/access changes, credential actions.</p>
      <div style={s.notice}><ScrollText size={16} /><span>Credential & role actions are written to the immutable BigQuery <code>admin_audit_log</code> by the it_admin/CEO Cloud Functions. This view shows the Firestore operational trail (<code>task_audit_log</code>).</span></div>

      {error && <div style={s.error}>Could not load audit logs: {error}</div>}
      <div style={s.card}>
        {loading ? <div style={s.loading}>Loading audit trail…</div>
          : itLogs.length === 0 ? <div style={s.empty}>No IT audit events recorded yet.</div>
          : (
            <div style={{ overflowX: 'auto' }}>
              <table style={s.table}>
                <thead><tr>
                  <th style={s.th}>Time</th><th style={s.th}>Event</th><th style={s.th}>Actor</th><th style={s.th}>Details</th>
                </tr></thead>
                <tbody>
                  {itLogs.map(l => (
                    <tr key={l.id}>
                      <td style={{ ...s.td, ...s.mono }}>{fmtTime(l.action_at)}</td>
                      <td style={s.td}>{l.event}</td>
                      <td style={s.td}>{l.action_by || '—'}</td>
                      <td style={{ ...s.td, color: 'rgba(255,255,255,0.55)', fontSize: '0.76rem' }}>{l.details ? JSON.stringify(l.details) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>
    </div>
  )
}
