import { useState } from 'react'
import { auth, AUDIT_AUTH_ACCOUNTS_URL, PROVISION_MISSING_AUTH_ACCOUNT_URL } from '../lib/firebase'
import { ShieldAlert, UserPlus, RefreshCw, Loader, CheckCircle2, AlertCircle, KeyRound } from 'lucide-react'

// Drop-in panel — used from /ceo/admin and /hr/employees. Calls the
// auditAuthAccounts Cloud Function which walks the users collection and
// diffs each row against Firebase Auth via admin.auth().getUserByEmail.
// One-click "Provision" creates the missing Auth account with a generated
// temp password and emails the user via our Gmail-DWD path.

export default function AuthAccountAudit() {
  const [running, setRunning] = useState(false)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [provisioning, setProvisioning] = useState(null)
  const [provisionLog, setProvisionLog] = useState([])

  const run = async () => {
    setRunning(true); setError('')
    try {
      const me = auth.currentUser
      if (!me) throw new Error('Not signed in.')
      const idToken = await me.getIdToken()
      const res = await fetch(AUDIT_AUTH_ACCOUNTS_URL, { headers: { Authorization: 'Bearer ' + idToken } })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || `Audit failed (${res.status})`)
      setData(json)
    } catch (err) {
      setError(err.message)
    } finally {
      setRunning(false)
    }
  }

  const provision = async (email, sendWelcome = true) => {
    setProvisioning(email); setError('')
    try {
      const me = auth.currentUser
      const idToken = await me.getIdToken()
      const res = await fetch(PROVISION_MISSING_AUTH_ACCOUNT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
        body: JSON.stringify({ email, send_welcome: sendWelcome }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || `Provision failed (${res.status})`)
      setProvisionLog(prev => [{ email, ok: true, uid: json.uid, already: json.already_existed, email_sent: json.email_sent }, ...prev])
      // Refresh the audit so the row moves from missing → present.
      await run()
    } catch (err) {
      setProvisionLog(prev => [{ email, ok: false, error: err.message }, ...prev])
    } finally {
      setProvisioning(null)
    }
  }

  return (
    <div style={{ background: 'var(--bg-surface, #fff)', border: '1px solid var(--border-primary, #E5E7EB)', borderRadius: 12, padding: 18, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            <ShieldAlert size={17} color="#022873" /> Auth account audit
          </h3>
          <p style={{ fontSize: '0.76rem', color: 'var(--text-tertiary)', margin: '4px 0 0' }}>
            Diff users collection against Firebase Auth. Anyone missing has no sign-in path — provision them here.
          </p>
        </div>
        <button onClick={run} disabled={running} className="write-action" style={{ padding: '9px 14px', borderRadius: 6, border: 'none', background: '#022873', color: '#fff', fontWeight: 600, fontSize: '0.84rem', cursor: running ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'inherit' }}>
          {running ? <><Loader size={13} className="spin" /> Running…</> : <><RefreshCw size={13} /> Run audit</>}
        </button>
      </div>

      {error && (
        <div style={{ marginTop: 10, padding: 10, background: 'rgba(192,57,43,0.10)', border: '1px solid rgba(192,57,43,0.3)', borderRadius: 6, color: '#C0392B', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 6 }}>
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginTop: 14 }}>
            <Stat label="Total users" value={data.total} />
            <Stat label="Auth present" value={data.present_count} color="#34BF3A" />
            <Stat label="Missing auth" value={data.missing_count} color="#C0392B" />
            <Stat label="Disabled" value={data.inactive_count} color="#64748b" />
          </div>

          {data.missing.length === 0 ? (
            <div style={{ marginTop: 12, padding: 14, textAlign: 'center', background: 'rgba(52,191,58,0.08)', border: '1px solid rgba(52,191,58,0.3)', borderRadius: 6, color: '#34BF3A', fontSize: '0.86rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <CheckCircle2 size={14} /> Every active user has a Firebase Auth account.
            </div>
          ) : (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#C0392B', marginBottom: 8 }}>
                Missing Firebase Auth accounts — these users CANNOT sign in:
              </div>
              <table className="data-table" style={{ width: '100%', fontSize: '0.84rem' }}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Employee ID</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.missing.map(u => (
                    <tr key={u.email}>
                      <td style={{ fontWeight: 600 }}>{u.display_name || '—'}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>{u.email}</td>
                      <td>{u.role_id || '—'}</td>
                      <td>{u.employee_id || '—'}</td>
                      <td>
                        <button
                          onClick={() => provision(u.email)}
                          disabled={provisioning === u.email}
                          className="write-action"
                          style={{ padding: '6px 12px', borderRadius: 6, border: 'none', background: provisioning === u.email ? '#94a3b8' : '#022873', color: '#fff', fontSize: '0.76rem', fontWeight: 600, cursor: provisioning === u.email ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: 'inherit' }}
                        >
                          {provisioning === u.email ? <Loader size={11} className="spin" /> : <UserPlus size={11} />}
                          Provision + email
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {provisionLog.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>Recent actions</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {provisionLog.slice(0, 10).map((p, i) => (
                  <div key={i} style={{ fontSize: '0.78rem', padding: '6px 10px', borderRadius: 6, background: p.ok ? 'rgba(52,191,58,0.06)' : 'rgba(192,57,43,0.06)', border: '1px solid ' + (p.ok ? 'rgba(52,191,58,0.20)' : 'rgba(192,57,43,0.20)'), color: p.ok ? '#34BF3A' : '#C0392B', display: 'flex', alignItems: 'center', gap: 6 }}>
                    {p.ok
                      ? <><CheckCircle2 size={13} /> {p.email} — {p.already ? 'already existed' : 'provisioned'} (uid {p.uid}) {p.email_sent?.sent ? '· welcome email sent' : ''}</>
                      : <><AlertCircle size={13} /> {p.email} — {p.error}</>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {!data && !running && !error && (
        <div style={{ marginTop: 12, padding: 14, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.84rem' }}>
          Click <strong>Run audit</strong> to scan every user.
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, color }) {
  return (
    <div style={{ padding: '8px 12px', borderRadius: 6, background: 'var(--bg-surface, #f8fafc)', border: '1px solid var(--border-primary, #E5E7EB)' }}>
      <div style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: '1.05rem', fontWeight: 700, color: color || 'var(--text-primary)', marginTop: 2 }}>{value}</div>
    </div>
  )
}
