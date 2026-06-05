import { useState } from 'react'
import { KeyRound, Loader, LogOut, ShieldCheck } from 'lucide-react'
import { auth, CHANGE_MY_PASSWORD_URL } from '../lib/firebase'
import { evaluatePassword } from '../lib/password-policy'
import PasswordChecklist from './PasswordChecklist'

/**
 * ForcePasswordChange — the blocking first-login gate.
 *
 * Rendered by AuthGate when getmypasswordstatus reports must_change (the account
 * is on a temp password an IT admin set with force_reset). It cannot be navigated
 * away from: the only exits are a successful change (onDone) or sign-out. The new
 * password is set + the flag cleared server-side (changemypassword), so the gate
 * lifts only after a real, policy-compliant change — there is no client-side skip.
 */
export default function ForcePasswordChange({ email, onDone }) {
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const { allMet } = evaluatePassword(pw)
  const canSubmit = allMet && pw === confirm && !submitting

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (!allMet) { setError('Password does not meet the requirements below.'); return }
    if (pw !== confirm) { setError('Passwords do not match.'); return }
    setSubmitting(true)
    try {
      const idToken = await auth.currentUser.getIdToken()
      const res = await fetch(CHANGE_MY_PASSWORD_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ new_password: pw }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not change password. Please try again.')
      onDone()
    } catch (err) {
      setError(err.message || 'Could not change password. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a1628', padding: '24px' }}>
      <div style={{ width: '100%', maxWidth: 440, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 16, padding: '32px 28px', color: '#e2e8f0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <KeyRound color="#1598CC" size={26} />
          <h1 style={{ fontSize: '1.3rem', fontWeight: 700, margin: 0 }}>Set a new password</h1>
        </div>
        <p style={{ fontSize: '0.86rem', color: '#94a3b8', lineHeight: 1.55, margin: '0 0 20px' }}>
          Your account (<strong style={{ color: '#e2e8f0' }}>{email}</strong>) is using a temporary
          password. For your security you must set a new, private password before continuing.
        </p>

        <form onSubmit={submit}>
          <label style={{ fontSize: '0.78rem', color: '#cbd5e1', display: 'block', marginBottom: 6 }}>New password</label>
          <input
            type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus autoComplete="new-password"
            style={inputStyle}
          />
          <label style={{ fontSize: '0.78rem', color: '#cbd5e1', display: 'block', margin: '14px 0 6px' }}>Confirm new password</label>
          <input
            type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password"
            style={inputStyle}
          />

          <PasswordChecklist password={pw} confirm={confirm} dark />

          {error && (
            <div style={{ marginTop: 14, padding: '9px 12px', borderRadius: 8, background: 'rgba(192,57,43,0.15)', border: '1px solid rgba(192,57,43,0.4)', color: '#fca5a5', fontSize: '0.8rem' }}>
              {error}
            </div>
          )}

          <button
            type="submit" disabled={!canSubmit}
            style={{
              marginTop: 18, width: '100%', padding: '12px', borderRadius: 10, border: 'none',
              background: canSubmit ? '#1598CC' : 'rgba(255,255,255,0.12)',
              color: canSubmit ? '#fff' : 'rgba(255,255,255,0.4)',
              fontWeight: 700, fontSize: '0.92rem', cursor: canSubmit ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            {submitting ? <><Loader size={16} className="spin" /> Updating…</> : <><ShieldCheck size={16} /> Set password & continue</>}
          </button>
        </form>

        <button
          onClick={() => auth.signOut()}
          style={{ marginTop: 14, width: '100%', padding: '10px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.14)', background: 'transparent', color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: '0.84rem' }}
        >
          <LogOut size={15} /> Sign out
        </button>
        <style>{`.spin { animation: spin 1s linear infinite; } @keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  )
}

const inputStyle = {
  width: '100%', padding: '11px 13px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.16)',
  background: 'rgba(255,255,255,0.06)', color: '#e2e8f0', fontSize: '0.92rem', boxSizing: 'border-box',
}
