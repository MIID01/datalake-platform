import { useState, useEffect } from 'react'
import { db } from '../../lib/firebase'
import { collection, onSnapshot } from 'firebase/firestore'
import { UserCog, UserPlus, UserX, LogOut, Lock } from 'lucide-react'
import { s, statusBadge, roleBadge, fmtTime } from './adminStyles'

export default function Users() {
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={s.h1}>User Accounts</h1>
          <p style={s.sub}>Account lifecycle — create, disable, offboard.</p>
        </div>
        <button style={s.btnDisabled} disabled title="Pending the IT user-management Cloud Function (coordinated deploy)"><Lock size={13} /> New Account</button>
      </div>

      <div style={s.notice}><UserCog size={16} /><span>Create / disable / offboard run through an <strong>it_admin</strong>-gated Cloud Function that writes the BigQuery audit trail. That function is staged for a coordinated deploy (it shares <code>functions/</code> with in-progress backend work), so these actions are disabled here for now — the live registry below is read from Firestore.</span></div>

      {error && <div style={s.error}>Could not load accounts: {error}</div>}
      <div style={s.card}>
        {loading ? <div style={s.loading}>Loading accounts…</div>
          : users.length === 0 ? <div style={s.empty}>No user accounts found.</div>
          : (
            <div style={{ overflowX: 'auto' }}>
              <table style={s.table}>
                <thead><tr>
                  <th style={s.th}>Email</th><th style={s.th}>Name</th><th style={s.th}>Emp ID</th>
                  <th style={s.th}>Role</th><th style={s.th}>Status</th><th style={s.th}>Created</th><th style={s.th}>Actions</th>
                </tr></thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id}>
                      <td style={{ ...s.td, ...s.mono }}>{u.email}</td>
                      <td style={s.td}>{u.display_name || u.full_name || '—'}</td>
                      <td style={{ ...s.td, ...s.mono }}>{u.emp_id || u.employee_id || '—'}</td>
                      <td style={s.td}><span style={roleBadge()}>{u.role_id || '—'}</span></td>
                      <td style={s.td}><span style={statusBadge(u.status)}>{u.status || 'unknown'}</span></td>
                      <td style={s.td}>{fmtTime(u.created_at)}</td>
                      <td style={s.td}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button style={s.btnDisabled} disabled title="Pending coordinated deploy"><UserX size={13} /> Disable</button>
                          <button style={s.btnDisabled} disabled title="Pending coordinated deploy"><LogOut size={13} /> Offboard</button>
                        </div>
                      </td>
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
