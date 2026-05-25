import { useState, useEffect } from 'react'
import { db } from '../../lib/firebase'
import { collection, onSnapshot } from 'firebase/firestore'
import { ShieldCheck } from 'lucide-react'
import { s, statusBadge, roleBadge, fmtTime } from './adminStyles'

export default function Access() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'users'),
      snap => { setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false) },
      err => { setError(err.message); setLoading(false) }
    )
    return () => unsub()
  }, [])

  return (
    <div style={s.page}>
      <h1 style={s.h1}>Access Management</h1>
      <p style={s.sub}>Who has access to what, by role — with last sign-in. Read-only.</p>
      <div style={s.notice}><ShieldCheck size={16} /><span>Role assignment is the CEO's responsibility (segregation of duties). IT Administration manages access and credentials, not role grants.</span></div>

      {error && <div style={s.error}>Could not load access data: {error}</div>}
      <div style={s.card}>
        {loading ? <div style={s.loading}>Loading access registry…</div>
          : users.length === 0 ? <div style={s.empty}>No user accounts found.</div>
          : (
            <div style={{ overflowX: 'auto' }}>
              <table style={s.table}>
                <thead><tr>
                  <th style={s.th}>Email</th><th style={s.th}>Name</th><th style={s.th}>Role</th>
                  <th style={s.th}>Status</th><th style={s.th}>Last Sign-In</th><th style={s.th}>Created</th>
                </tr></thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id}>
                      <td style={{ ...s.td, ...s.mono }}>{u.email}</td>
                      <td style={s.td}>{u.display_name || u.full_name || '—'}</td>
                      <td style={s.td}><span style={roleBadge()}>{u.role_id || '—'}</span></td>
                      <td style={s.td}><span style={statusBadge(u.status)}>{u.status || 'unknown'}</span></td>
                      <td style={s.td}>{fmtTime(u.last_login || u.last_sign_in)}</td>
                      <td style={s.td}>{fmtTime(u.created_at)}</td>
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
