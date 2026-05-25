import { useState, useEffect } from 'react'
import { db } from '../../lib/firebase'
import { collection, onSnapshot } from 'firebase/firestore'
import { KeyRound, RefreshCw, Clock, Layers, Lock } from 'lucide-react'
import { s, fmtTime } from './adminStyles'

export default function Credentials() {
  const [users, setUsers] = useState([])
  const [policies, setPolicies] = useState({})
  const [loading, setLoading] = useState(true)
  const [usersError, setUsersError] = useState('')
  const [policyError, setPolicyError] = useState('')

  useEffect(() => {
    const unsubUsers = onSnapshot(collection(db, 'users'),
      snap => { setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false) },
      err => { setUsersError(err.message); setLoading(false) }
    )
    // password_policies is it_admin-only; a non-IT viewer (e.g. CEO) will get permission-denied — handled gracefully.
    const unsubPol = onSnapshot(collection(db, 'password_policies'),
      snap => { setPolicies(snap.docs.reduce((a, d) => { a[d.id] = d.data(); return a }, {})) },
      err => setPolicyError(err.code === 'permission-denied' ? 'Credential policy data is restricted to IT Administrators.' : err.message)
    )
    return () => { unsubUsers(); unsubPol() }
  }, [])

  return (
    <div style={s.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={s.h1}>Credentials</h1>
          <p style={s.sub}>Password lifecycle — generate, reset, force expiry, bulk operations. IT Administrators only.</p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={s.btnDisabled} disabled title="Pending adminsetpassword"><Layers size={13} /> Bulk Reset</button>
          <button style={s.btnDisabled} disabled title="Pending adminsetpassword"><Clock size={13} /> Force Expiry</button>
        </div>
      </div>

      <div style={s.notice}><Lock size={16} /><span>Passwords are never displayed or stored — Firebase Auth only allows <em>setting</em> a new one. Generate / reset / force-expiry run through the <strong>adminsetpassword</strong> Cloud Function (it_admin-gated, logs every action to BigQuery <code>admin_audit_log</code>), staged for a coordinated deploy. Actions are disabled until then; the account list below is read-only.</span></div>

      {usersError && <div style={s.error}>Could not load accounts: {usersError}</div>}
      {policyError && <div style={{ ...s.error, background: 'rgba(21,152,204,0.1)', border: '1px solid rgba(21,152,204,0.25)', color: '#7dd3fc' }}>{policyError}</div>}

      <div style={s.card}>
        {loading ? <div style={s.loading}>Loading credential status…</div>
          : users.length === 0 ? <div style={s.empty}>No user accounts found.</div>
          : (
            <div style={{ overflowX: 'auto' }}>
              <table style={s.table}>
                <thead><tr>
                  <th style={s.th}>Email</th><th style={s.th}>Last Password Change</th>
                  <th style={s.th}>Expiry Status</th><th style={s.th}>Actions</th>
                </tr></thead>
                <tbody>
                  {users.map(u => {
                    const pol = policies[u.id] || policies[u.emp_id] || {}
                    const expired = pol.force_reset === true || (pol.expires_at && (pol.expires_at._seconds * 1000 < Date.now()))
                    return (
                      <tr key={u.id}>
                        <td style={{ ...s.td, ...s.mono }}>{u.email}</td>
                        <td style={s.td}>{fmtTime(pol.last_changed_at)}</td>
                        <td style={s.td}>{pol.expires_at || pol.force_reset != null
                          ? <span style={{ color: expired ? '#fca5a5' : '#4ade80', fontWeight: 600, fontSize: '0.78rem' }}>{expired ? 'Reset required' : 'Active'}</span>
                          : <span style={{ color: 'rgba(255,255,255,0.4)' }}>—</span>}</td>
                        <td style={s.td}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button style={s.btnDisabled} disabled title="Pending adminsetpassword"><RefreshCw size={13} /> Reset</button>
                            <button style={s.btnDisabled} disabled title="Pending adminsetpassword"><KeyRound size={13} /> Generate</button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
      </div>
    </div>
  )
}
