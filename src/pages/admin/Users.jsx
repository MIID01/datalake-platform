import { useState, useEffect } from 'react'
import { db, auth, ADD_USER_URL, DISABLE_USER_URL, OFFBOARD_ENGINEER_URL } from '../../lib/firebase'
import { collection, onSnapshot } from 'firebase/firestore'
import { UserCog, UserPlus, UserX, UserCheck, LogOut, X, Loader, CheckCircle, XCircle, AlertTriangle } from 'lucide-react'
import { s, statusBadge, roleBadge, fmtTime } from './adminStyles'

const btnPrimary = { padding: '8px 16px', borderRadius: 8, border: 'none', background: '#1598CC', color: '#fff', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }
const btnRow = { padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.18)', background: 'transparent', color: 'rgba(255,255,255,0.85)', fontSize: '0.74rem', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }
const btnDanger = { ...btnRow, border: '1px solid rgba(192,57,43,0.4)', color: '#fca5a5' }
const btnBusy = { ...btnRow, opacity: 0.5, cursor: 'wait' }

// Roles offered in the create form; the backend re-validates against the roles collection.
const ASSIGNABLE_ROLES = ['employee', 'hr', 'finance', 'it_admin', 'cto', 'pm', 'client']

export default function Users() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [toast, setToast] = useState(null)
  const [rowBusy, setRowBusy] = useState(null)        // `${action}:${uid}`
  const [showNew, setShowNew] = useState(false)
  const [confirm, setConfirm] = useState(null)         // { kind:'offboard'|'disable', u }

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'users'),
      snap => { setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false) },
      err => { setError(err.message); setLoading(false) }
    )
    return () => unsub()
  }, [])

  const flash = (type, msg) => { setToast({ type, msg }); setTimeout(() => setToast(null), 6000) }

  const post = async (url, body) => {
    const idToken = await auth.currentUser.getIdToken()
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    return data
  }

  const doToggleDisable = async (u) => {
    setRowBusy(`disable:${u.id}`); setConfirm(null)
    try {
      const data = await post(DISABLE_USER_URL, { uid: u.id })
      flash('success', `${u.email} is now ${data.new_status}.`)
    } catch (err) { flash('error', err.message) } finally { setRowBusy(null) }
  }

  const doOffboard = async (u) => {
    setRowBusy(`offboard:${u.id}`); setConfirm(null)
    try {
      await post(OFFBOARD_ENGINEER_URL, { engineer_id: u.engineer_id })
      flash('success', `${u.display_name || u.email} offboarded (auth disabled, Workspace de-provisioned, certificate generated).`)
    } catch (err) { flash('error', err.message) } finally { setRowBusy(null) }
  }

  return (
    <div style={s.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={s.h1}>User Accounts</h1>
          <p style={s.sub}>Account lifecycle — create, disable/enable, offboard. Actions are CEO-authorized and written to the audit trail.</p>
        </div>
        <button style={btnPrimary} onClick={() => setShowNew(true)}><UserPlus size={14} /> New Account</button>
      </div>

      <div style={s.notice}><UserCog size={16} /><span>Create / disable / offboard run through CEO-gated Cloud Functions that write the access audit trail (<code>USER_CREATED</code> / <code>USER_DISABLED</code> / offboarding certificate). New accounts are emailed a set-password link. Offboard fully de-provisions (Auth + Google Workspace) and is irreversible.</span></div>

      {toast && (
        <div style={{ ...(toast.type === 'error' ? s.error : { ...s.notice, background: 'rgba(52,191,58,0.1)', border: '1px solid rgba(52,191,58,0.3)', color: '#86efac' }), display: 'flex', alignItems: 'center', gap: 8 }}>
          {toast.type === 'error' ? <XCircle size={16} /> : <CheckCircle size={16} />} {toast.msg}
        </div>
      )}
      {error && <div style={s.error}>Could not load accounts: {error}</div>}

      <div style={s.card}>
        {loading ? <div style={s.loading}>Loading accounts…</div>
          : users.length === 0 ? <div style={s.empty}>No user accounts found.</div>
          : (
            <div style={{ overflowX: 'auto' }}>
              <table style={s.table}>
                <thead><tr>
                  <th style={s.th}>Email</th><th style={s.th}>Name</th><th style={s.th}>Emp / Eng ID</th>
                  <th style={s.th}>Role</th><th style={s.th}>Status</th><th style={s.th}>Created</th><th style={s.th}>Actions</th>
                </tr></thead>
                <tbody>
                  {users.map(u => {
                    const disabled = u.status === 'disabled'
                    const offboarded = u.status === 'offboarded'
                    const canOffboard = !!u.engineer_id && !offboarded
                    const isSelf = auth.currentUser && u.id === auth.currentUser.uid
                    return (
                      <tr key={u.id}>
                        <td style={{ ...s.td, ...s.mono }}>{u.email}</td>
                        <td style={s.td}>{u.display_name || u.full_name || '—'}</td>
                        <td style={{ ...s.td, ...s.mono }}>{u.engineer_id || u.emp_id || u.employee_id || '—'}</td>
                        <td style={s.td}><span style={roleBadge()}>{u.role_id || '—'}</span></td>
                        <td style={s.td}><span style={statusBadge(u.status)}>{u.status || 'unknown'}</span></td>
                        <td style={s.td}>{fmtTime(u.created_at)}</td>
                        <td style={s.td}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              style={rowBusy === `disable:${u.id}` ? btnBusy : btnRow}
                              disabled={rowBusy === `disable:${u.id}` || offboarded || isSelf}
                              title={isSelf ? 'You cannot disable your own account' : offboarded ? 'Account is offboarded' : ''}
                              onClick={() => setConfirm({ kind: 'disable', u })}>
                              {rowBusy === `disable:${u.id}` ? <Loader size={13} className="spin" /> : disabled ? <UserCheck size={13} /> : <UserX size={13} />}
                              {disabled ? 'Enable' : 'Disable'}
                            </button>
                            <button
                              style={rowBusy === `offboard:${u.id}` ? btnBusy : btnDanger}
                              disabled={rowBusy === `offboard:${u.id}` || !canOffboard}
                              title={!u.engineer_id ? 'No engineer record (offboard applies to hired engineers)' : offboarded ? 'Already offboarded' : ''}
                              onClick={() => setConfirm({ kind: 'offboard', u })}>
                              {rowBusy === `offboard:${u.id}` ? <Loader size={13} className="spin" /> : <LogOut size={13} />} Offboard
                            </button>
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

      {showNew && <NewAccountModal onClose={() => setShowNew(false)} post={post} flash={flash} />}

      {confirm && (
        <Modal onClose={() => setConfirm(null)}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <AlertTriangle size={22} color={confirm.kind === 'offboard' ? '#fca5a5' : '#F39C12'} />
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#fff' }}>
              {confirm.kind === 'offboard' ? 'Offboard engineer' : (confirm.u.status === 'disabled' ? 'Enable account' : 'Disable account')}
            </h3>
          </div>
          <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.85rem', lineHeight: 1.6, marginBottom: 20 }}>
            {confirm.kind === 'offboard'
              ? <>This <strong>irreversibly</strong> offboards <strong>{confirm.u.display_name || confirm.u.email}</strong>: disables their Auth login, de-provisions their Google Workspace account, and generates a de-provisioning certificate. Continue?</>
              : confirm.u.status === 'disabled'
                ? <>Re-enable login for <strong>{confirm.u.email}</strong>?</>
                : <>Disable login for <strong>{confirm.u.email}</strong>? They keep their record but cannot sign in until re-enabled.</>}
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button style={btnRow} onClick={() => setConfirm(null)}>Cancel</button>
            <button
              style={{ ...(confirm.kind === 'offboard' ? { ...btnPrimary, background: '#C0392B' } : btnPrimary) }}
              onClick={() => confirm.kind === 'offboard' ? doOffboard(confirm.u) : doToggleDisable(confirm.u)}>
              {confirm.kind === 'offboard' ? 'Offboard' : (confirm.u.status === 'disabled' ? 'Enable' : 'Disable')}
            </button>
          </div>
        </Modal>
      )}
      <style>{`.spin { animation: spin 1s linear infinite; } @keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

function Modal({ children, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(3px)' }} onClick={onClose} />
      <div style={{ position: 'relative', background: '#0B3D4A', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 14, padding: 26, width: '90%', maxWidth: 460, boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
        {children}
      </div>
    </div>
  )
}

function NewAccountModal({ onClose, post, flash }) {
  const [form, setForm] = useState({ email: '', display_name: '', role_id: 'employee', client_id: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setErr('') }

  const submit = async () => {
    if (!form.email || !form.display_name || !form.role_id) { setErr('Email, name and role are required.'); return }
    if (form.role_id === 'client' && !form.client_id) { setErr('client_id is required for a client account.'); return }
    setBusy(true)
    try {
      const body = { email: form.email.trim(), display_name: form.display_name.trim(), role_id: form.role_id }
      if (form.role_id === 'client') body.client_id = form.client_id.trim()
      const data = await post(ADD_USER_URL, body)
      flash('success', `Account ${form.email} created${data.setup_email?.sent ? ' — set-password email sent' : ''}.`)
      onClose()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const inp = { width: '100%', padding: '9px 11px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.16)', background: 'rgba(0,0,0,0.25)', color: '#fff', fontSize: '0.85rem', boxSizing: 'border-box', fontFamily: 'inherit' }
  const lbl = { fontSize: '0.72rem', fontWeight: 600, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.03em', display: 'block', margin: '12px 0 5px' }

  return (
    <Modal onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}><UserPlus size={18} /> New Account</h3>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer' }}><X size={18} /></button>
      </div>
      <p style={{ fontSize: '0.76rem', color: 'rgba(255,255,255,0.5)', margin: '0 0 6px' }}>Creates the Auth account + user record and emails a set-password link. CEO-authorized.</p>

      <label style={lbl}>Email</label>
      <input style={inp} type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="name@datalake.sa" autoFocus />
      <label style={lbl}>Display name</label>
      <input style={inp} value={form.display_name} onChange={e => set('display_name', e.target.value)} placeholder="Full name" />
      <label style={lbl}>Role</label>
      <select style={inp} value={form.role_id} onChange={e => set('role_id', e.target.value)}>
        {ASSIGNABLE_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
      </select>
      {form.role_id === 'client' && (
        <>
          <label style={lbl}>Client ID</label>
          <input style={inp} value={form.client_id} onChange={e => set('client_id', e.target.value)} placeholder="clients/{id}" />
        </>
      )}

      {err && <div style={{ ...s.error, marginTop: 14, marginBottom: 0 }}>{err}</div>}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
        <button style={btnRow} onClick={onClose} disabled={busy}>Cancel</button>
        <button style={busy ? { ...btnPrimary, opacity: 0.6, cursor: 'wait' } : btnPrimary} onClick={submit} disabled={busy}>
          {busy ? <><Loader size={13} className="spin" /> Creating…</> : <><UserPlus size={13} /> Create account</>}
        </button>
      </div>
    </Modal>
  )
}
