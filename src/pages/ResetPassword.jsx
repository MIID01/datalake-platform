import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { verifyPasswordResetCode, confirmPasswordReset } from 'firebase/auth'
import { auth } from '../lib/firebase'
import { evaluatePassword } from '../lib/password-policy'
import PasswordChecklist from '../components/PasswordChecklist'
import { Lock, Eye, EyeOff, ShieldCheck, AlertTriangle, Loader, LogIn } from 'lucide-react'
import '../styles/ceo.css'

// Custom in-app password-reset handler. Firebase's email link is configured
// (Console → Authentication → Templates → custom action URL) to land here at
// /reset-password?mode=resetPassword&oobCode=<code>. We verify the code, show a
// branded form with LIVE requirement checkmarks, then confirmPasswordReset().
// The server-side password policy is the real boundary — confirmPasswordReset
// rejects a weak password even if the client checklist were bypassed.

function friendlyResetError(err) {
  const c = String(err?.code || '').toLowerCase()
  if (c.includes('expired-action-code')) return 'This reset link has expired. Request a new one from the sign-in page.'
  if (c.includes('invalid-action-code')) return 'This reset link is invalid or has already been used. Request a new one from the sign-in page.'
  if (c.includes('user-disabled')) return 'This account has been disabled. Please contact IT.'
  if (c.includes('user-not-found')) return 'We could not find this account. Please contact IT.'
  if (c.includes('weak-password') || c.includes('password-does-not-meet-requirements')) {
    return 'That password does not meet the security requirements. Please satisfy every item below.'
  }
  return 'Something went wrong resetting your password. Request a new link from the sign-in page.'
}

const cardWrap = { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: 20, background: 'linear-gradient(135deg, #0a1628 0%, #022873 100%)', fontFamily: "'DM Sans', sans-serif" }
const card = { background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, padding: '44px 40px', maxWidth: 440, width: '100%', textAlign: 'center' }
const inputBox = { width: '100%', padding: '12px 42px 12px 42px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10, color: '#fff', fontSize: '0.92rem', outline: 'none', boxSizing: 'border-box' }

export default function ResetPassword() {
  const navigate = useNavigate()

  // Parse the URL exactly once (lazy init) — avoids synchronous setState in the
  // effect. A missing/wrong-mode link starts straight in the "invalid" phase.
  const [{ oobCode, initialPhase, initialError }] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('mode') !== 'resetPassword' || !params.get('oobCode')) {
      return { oobCode: '', initialPhase: 'invalid', initialError: 'This link is missing or not a password-reset link. Open the link from your reset email, or request a new one from the sign-in page.' }
    }
    return { oobCode: params.get('oobCode'), initialPhase: 'verifying', initialError: '' }
  })

  const [phase, setPhase] = useState(initialPhase) // verifying | form | done | invalid
  const [accountEmail, setAccountEmail] = useState('')
  const [linkError, setLinkError] = useState(initialError)

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const { allMet } = evaluatePassword(password)
  const canSubmit = allMet && password === confirm && !submitting

  // Verify the oobCode with Firebase on mount (async — setState lands in the
  // promise callbacks, not synchronously in the effect body).
  useEffect(() => {
    if (!oobCode) return
    verifyPasswordResetCode(auth, oobCode)
      .then((email) => { setAccountEmail(email); setPhase('form') })
      .catch((err) => { setLinkError(friendlyResetError(err)); setPhase('invalid') })
  }, [oobCode])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitError('')
    setSubmitting(true)
    try {
      await confirmPasswordReset(auth, oobCode, password)
      setPhase('done')
    } catch (err) {
      setSubmitError(friendlyResetError(err))
      setSubmitting(false)
    }
  }

  // ── Verifying ──
  if (phase === 'verifying') {
    return (
      <div style={cardWrap}>
        <div style={{ ...card, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          <Loader className="spin" color="#1598CC" size={28} />
          <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.9rem' }}>Checking your reset link…</p>
          <style>{`.spin { animation: spin 1s linear infinite; } @keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    )
  }

  // ── Invalid / expired link ──
  if (phase === 'invalid') {
    return (
      <div style={cardWrap}>
        <div style={card}>
          <AlertTriangle size={44} color="#EF5829" style={{ marginBottom: 16 }} />
          <h1 style={{ color: '#fff', fontSize: '1.35rem', fontWeight: 700, marginBottom: 10 }}>Link not valid</h1>
          <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.88rem', lineHeight: 1.6, marginBottom: 24 }}>{linkError}</p>
          <button onClick={() => navigate('/', { replace: true })}
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 24px', border: 'none', borderRadius: 12, background: '#1598CC', color: '#fff', fontWeight: 700, fontSize: '0.9rem', fontFamily: 'inherit', cursor: 'pointer' }}>
            <LogIn size={16} /> Back to sign in
          </button>
        </div>
      </div>
    )
  }

  // ── Success ──
  if (phase === 'done') {
    return (
      <div style={cardWrap}>
        <div style={card}>
          <ShieldCheck size={44} color="#34BF3A" style={{ marginBottom: 16 }} />
          <h1 style={{ color: '#fff', fontSize: '1.35rem', fontWeight: 700, marginBottom: 10 }}>Password updated</h1>
          <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.88rem', lineHeight: 1.6, marginBottom: 24 }}>
            Your password for <strong style={{ color: '#fff' }}>{accountEmail}</strong> has been changed. You can now sign in with your new password.
          </p>
          <button onClick={() => navigate('/', { replace: true })}
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 24px', border: 'none', borderRadius: 12, background: '#1598CC', color: '#fff', fontWeight: 700, fontSize: '0.9rem', fontFamily: 'inherit', cursor: 'pointer' }}>
            <LogIn size={16} /> Go to sign in
          </button>
        </div>
      </div>
    )
  }

  // ── Reset form ──
  return (
    <div style={cardWrap}>
      <div style={card}>
        <img src="/images/logo-white.svg" alt="Datalake" style={{ height: 44, marginBottom: 18 }} />
        <h1 style={{ color: '#fff', fontSize: '1.4rem', fontWeight: 700, marginBottom: 6 }}>Set a new password</h1>
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.84rem', marginBottom: 24 }}>
          For <strong style={{ color: 'rgba(255,255,255,0.8)' }}>{accountEmail}</strong>
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'left' }}>
          <div style={{ position: 'relative' }}>
            <Lock size={16} color="rgba(255,255,255,0.4)" style={{ position: 'absolute', left: 14, top: 14 }} />
            <input
              type={showPw ? 'text' : 'password'} autoComplete="new-password" placeholder="New password"
              value={password} onChange={(e) => setPassword(e.target.value)} style={inputBox}
            />
            <button type="button" onClick={() => setShowPw((s) => !s)} aria-label={showPw ? 'Hide password' : 'Show password'}
              style={{ position: 'absolute', right: 12, top: 11, background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.5)', padding: 4 }}>
              {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <div style={{ position: 'relative' }}>
            <Lock size={16} color="rgba(255,255,255,0.4)" style={{ position: 'absolute', left: 14, top: 14 }} />
            <input
              type={showPw ? 'text' : 'password'} autoComplete="new-password" placeholder="Confirm new password"
              value={confirm} onChange={(e) => setConfirm(e.target.value)} style={inputBox}
            />
          </div>

          <PasswordChecklist password={password} confirm={confirm} dark />

          <button type="submit" disabled={!canSubmit}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: '13px 24px', border: 'none', borderRadius: 12, background: '#1598CC', color: '#fff', fontWeight: 700, fontSize: '0.95rem', fontFamily: 'inherit', marginTop: 6, cursor: canSubmit ? 'pointer' : 'not-allowed', opacity: canSubmit ? 1 : 0.6 }}>
            {submitting ? <Loader size={16} className="spin" /> : <ShieldCheck size={18} />}
            {submitting ? 'Updating…' : 'Update password'}
          </button>
        </form>

        {submitError && (
          <div style={{ marginTop: 16, padding: '10px 16px', background: 'rgba(192,57,43,0.15)', border: '1px solid rgba(192,57,43,0.3)', borderRadius: 8, color: '#ff6b6b', fontSize: '0.82rem', textAlign: 'left' }}>
            {submitError}
          </div>
        )}
        <style>{`.spin { animation: spin 1s linear infinite; } @keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  )
}
