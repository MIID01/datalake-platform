import { useState, useEffect } from 'react'
import { db, auth, SET_PASSWORD_CHANGE_REQUIRED_URL } from '../../lib/firebase'
import { collection, onSnapshot } from 'firebase/firestore'
import { KeyRound, RefreshCw, Clock, Layers, Lock, ShieldAlert, ShieldCheck, Loader, CheckCircle, XCircle } from 'lucide-react'
import { s, fmtTime } from './adminStyles'

// Active-button styles (adminStyles only ships a disabled variant).
const btnPrimary = { padding: '6px 12px', borderRadius: 8, border: 'none', background: '#1598CC', color: '#fff', fontSize: '0.74rem', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }
const btnGhost = { padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.18)', background: 'transparent', color: 'rgba(255,255,255,0.85)', fontSize: '0.74rem', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }
const btnBusy = { ...btnPrimary, background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.5)', cursor: 'wait' }

export default function Credentials() {
  const [users, setUsers] = useState([])
  const [policies, setPolicies] = useState({})
  const [loading, setLoading] = useState(true)
  const [usersError, setUsersError] = useState('')
  const [policyError, setPolicyError] = useState('')
  const [selected, setSelected] = useState(new Set())
  const [busy, setBusy] = useState(false)        // bulk action in flight
  const [rowBusy, setRowBusy] = useState(null)    // uid of the row action in flight
  const [toast, setToast] = useState(null)

  useEffect(() => {
    const unsubUsers = onSnapshot(collection(db, 'users'),
      snap => { setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false) },
      err => { setUsersError(err.message); setLoading(false) }
    )
    // password_policies is CEO/it_admin-only; any other viewer gets permission-denied — handled gracefully.
    const unsubPol = onSnapshot(collection(db, 'password_policies'),
      snap => { setPolicies(snap.docs.reduce((a, d) => { a[d.id] = d.data(); return a }, {})) },
      err => setPolicyError(err.code === 'permission-denied' ? 'Credential policy data is restricted to IT Administrators / CEO.' : err.message)
    )
    return () => { unsubUsers(); unsubPol() }
  }, [])

  const flash = (type, msg) => { setToast({ type, msg }); setTimeout(() => setToast(null), 5000) }

  // Enable/disable "require password change at next login" for a set of accounts.
  // Goes through the it_admin/CEO Cloud Function, which logs each toggle to
  // admin_audit_log. The live password_policies listener reflects the change.
  const setRequirement = async (uids, required, { row = null } = {}) => {
    if (!uids.length) return
    row ? setRowBusy(row) : setBusy(true)
    try {
      const idToken = await auth.currentUser.getIdToken()
      const res = await fetch(SET_PASSWORD_CHANGE_REQUIRED_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ target_uids: uids, required }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Action failed')
      const failed = (data.results || []).filter(r => r.ok === false)
      flash(failed.length ? 'error' : 'success',
        `${required ? 'Required' : 'Cleared'} password change for ${data.count} account(s)` +
        (failed.length ? ` · ${failed.length} skipped (not a valid Auth account)` : ''))
      setSelected(new Set())
    } catch (err) {
      flash('error', err.message || 'Could not update the requirement.')
    } finally {
      row ? setRowBusy(null) : setBusy(false)
    }
  }

  const toggleSel = (uid) => setSelected(prev => { const n = new Set(prev); n.has(uid) ? n.delete(uid) : n.add(uid); return n })
  const allSelected = users.length > 0 && users.every(u => selected.has(u.id))
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(users.map(u => u.id)))

  return (
    <div style={s.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={s.h1}>Credentials</h1>
          <p style={s.sub}>Password lifecycle — require change at next login, generate, reset. IT Administrators &amp; CEO.</p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={s.btnDisabled} disabled title="Requires it_admin role"><Layers size={13} /> Bulk Reset</button>
        </div>
      </div>

      <div style={s.notice}><Lock size={16} /><span>Passwords are never displayed or stored. <strong>Require change at next login</strong> flags the account so it must set a new private password before reaching any portal (enforced at login) — every toggle is logged to <code>admin_audit_log</code> with who flagged whom. Generate / reset are <strong>it_admin-only</strong> (the <code>adminsetpassword</code> function, deployed) — no it_admin is currently assigned, so they stay disabled here. The require-change control above is CEO-usable and covers the immediate need.</span></div>

      {toast && (
        <div style={{ ...(toast.type === 'error' ? s.error : { ...s.notice, background: 'rgba(52,191,58,0.1)', border: '1px solid rgba(52,191,58,0.3)', color: '#86efac' }), display: 'flex', alignItems: 'center', gap: 8 }}>
          {toast.type === 'error' ? <XCircle size={16} /> : <CheckCircle size={16} />} {toast.msg}
        </div>
      )}
      {usersError && <div style={s.error}>Could not load accounts: {usersError}</div>}
      {policyError && <div style={{ ...s.error, background: 'rgba(21,152,204,0.1)', border: '1px solid rgba(21,152,204,0.25)', color: '#7dd3fc' }}>{policyError}</div>}

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderRadius: 10, background: 'rgba(21,152,204,0.1)', border: '1px solid rgba(21,152,204,0.25)', marginBottom: 14 }}>
          <span style={{ color: '#bae6fd', fontSize: '0.82rem', fontWeight: 600 }}>{selected.size} selected</span>
          <button style={busy ? btnBusy : btnPrimary} disabled={busy} onClick={() => setRequirement([...selected], true)}>
            {busy ? <Loader size={13} className="spin" /> : <ShieldAlert size={13} />} Require change at next login
          </button>
          <button style={busy ? btnBusy : btnGhost} disabled={busy} onClick={() => setRequirement([...selected], false)}>
            <ShieldCheck size={13} /> Clear requirement
          </button>
          <button style={{ ...btnGhost, border: 'none' }} onClick={() => setSelected(new Set())}>Cancel</button>
        </div>
      )}

      <div style={s.card}>
        {loading ? <div style={s.loading}>Loading credential status…</div>
          : users.length === 0 ? <div style={s.empty}>No user accounts found.</div>
          : (
            <div style={{ overflowX: 'auto' }}>
              <table style={s.table}>
                <thead><tr>
                  <th style={{ ...s.th, width: 32 }}><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" /></th>
                  <th style={s.th}>Email</th><th style={s.th}>Last Password Change</th>
                  <th style={s.th}>Change Required</th><th style={s.th}>Actions</th>
                </tr></thead>
                <tbody>
                  {users.map(u => {
                    const pol = policies[u.id] || policies[u.emp_id] || {}
                    const required = pol.force_reset === true
                    const isRowBusy = rowBusy === u.id
                    return (
                      <tr key={u.id}>
                        <td style={s.td}><input type="checkbox" checked={selected.has(u.id)} onChange={() => toggleSel(u.id)} aria-label={`Select ${u.email}`} /></td>
                        <td style={{ ...s.td, ...s.mono }}>{u.email}</td>
                        <td style={s.td}>{pol.changed_self ? fmtTime(pol.last_changed_at) : <span style={{ color: 'rgba(255,255,255,0.4)' }}>never (admin-set)</span>}</td>
                        <td style={s.td}>
                          {required
                            ? <span style={{ color: '#fca5a5', fontWeight: 600, fontSize: '0.78rem' }}>
                                Required{pol.required_by ? <span style={{ color: 'rgba(255,255,255,0.45)', fontWeight: 400 }}> · by {pol.required_by}</span> : ''}
                              </span>
                            : <span style={{ color: '#4ade80', fontSize: '0.78rem' }}>Not required</span>}
                        </td>
                        <td style={s.td}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            {required
                              ? <button style={isRowBusy ? btnBusy : btnGhost} disabled={isRowBusy} onClick={() => setRequirement([u.id], false, { row: u.id })} title="Clear the requirement">
                                  {isRowBusy ? <Loader size={13} className="spin" /> : <ShieldCheck size={13} />} Clear
                                </button>
                              : <button style={isRowBusy ? btnBusy : btnPrimary} disabled={isRowBusy} onClick={() => setRequirement([u.id], true, { row: u.id })} title="Require a password change at next login">
                                  {isRowBusy ? <Loader size={13} className="spin" /> : <Clock size={13} />} Require change
                                </button>}
                            <button style={s.btnDisabled} disabled title="Requires it_admin role"><RefreshCw size={13} /> Reset</button>
                            <button style={s.btnDisabled} disabled title="Requires it_admin role"><KeyRound size={13} /> Generate</button>
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
      <style>{`.spin { animation: spin 1s linear infinite; } @keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
