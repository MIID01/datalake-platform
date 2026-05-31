import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { auth } from '../lib/firebase'
import { signInWithEmail, sendPasswordReset, resolveUserRole, signOut, CEO_EMAIL } from '../lib/auth'
import { homePathForRole } from '../lib/routes'
import { LogIn, Mail, Lock, AlertTriangle, LogOut } from 'lucide-react'
import '../styles/ceo.css'

// Translate Firebase Auth errors into language a non-engineer can read.
// We never expose raw Firebase: codes to end users — they look like bugs.
function friendlyAuthError(err) {
  const c = String(err?.code || '').toLowerCase()
  const m = String(err?.message || '').toLowerCase()
  if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found') || m.includes('invalid-credential')) {
    return 'Incorrect email or password.'
  }
  if (c.includes('invalid-email') || m.includes('invalid-email')) return 'Enter a valid email address.'
  if (c.includes('missing-password') || m.includes('missing-password')) return 'Enter your password.'
  if (c.includes('too-many-requests') || m.includes('too-many-requests')) return 'Too many attempts — please try again in a minute.'
  if (c.includes('user-disabled') || m.includes('user-disabled')) return 'This account has been disabled. Please contact IT.'
  if (c.includes('network-request-failed') || m.includes('network')) return "Couldn't reach the sign-in service. Check your connection and try again."
  if (c.includes('email-already-in-use')) return 'That email is already registered.'
  if (c.includes('weak-password')) return 'Password is too weak — choose a longer one.'
  if (c.includes('auth/')) return 'Sign-in failed — please try again or contact IT.'
  // Never leak "Firebase: ..." strings — that confuses users into thinking the platform is broken.
  return 'Sign-in failed — please try again or contact IT.'
}

export default function LandingPage() {
  const navigate = useNavigate()
  const [authError, setAuthError] = useState('')
  const [notice, setNotice] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [unconfigured, setUnconfigured] = useState(false)
  const [signedInEmail, setSignedInEmail] = useState('')

  // Once signed in (here or already), resolve the role and send the user to
  // their portal home via the shared homePathForRole map.
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (user) => {
      if (!user) { setUnconfigured(false); return }
      const record = await resolveUserRole(user.uid, user.email)
      const role = user.email === CEO_EMAIL ? 'ceo' : record?.role_id
      if (role) { navigate(homePathForRole(role), { replace: true }); return }
      // Signed in but no role mapped — don't hang on the sign-in form.
      setSignedInEmail(user.email || '')
      setSubmitting(false)
      setUnconfigured(true)
    })
    return () => unsub()
  }, [navigate])

  const handleSignOut = async () => {
    try { await signOut() } catch { /* ignore */ }
    setUnconfigured(false)
    setEmail('')
    setPassword('')
  }

  const handleEmailSignIn = async (e) => {
    e.preventDefault()
    if (!email || !password || submitting) return
    setAuthError('')
    setSubmitting(true)
    try {
      await signInWithEmail(email, password)
      // Navigation is handled by the onAuthStateChanged listener above.
    } catch (err) {
      setAuthError(friendlyAuthError(err))
      setSubmitting(false)
    }
  }

  const handleForgotPassword = async () => {
    setAuthError('')
    setNotice('')
    if (!email) { setAuthError('Enter your email above first, then click "Forgot password?".'); return }
    try {
      await sendPasswordReset(email)
      setNotice(`If an account exists for ${email}, a password reset link has been sent. Check your inbox (and spam).`)
    } catch (err) {
      setAuthError(friendlyAuthError(err))
    }
  }

  // Signed in but no role configured — explicit dead-end with a way out (not a hang).
  if (unconfigured) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'linear-gradient(135deg, #0a1628 0%, #022873 100%)', fontFamily: "'DM Sans', sans-serif" }}>
        <div style={{ background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, padding: '48px 40px', maxWidth: 420, width: '90%', textAlign: 'center' }}>
          <AlertTriangle size={44} color="#EF5829" style={{ marginBottom: 16 }} />
          <h1 style={{ color: '#fff', fontSize: '1.4rem', fontWeight: 700, marginBottom: 10 }}>Account not configured</h1>
          <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.9rem', lineHeight: 1.6, marginBottom: 8 }}>
            Account not configured. Contact IT.
          </p>
          {signedInEmail && <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.8rem', marginBottom: 24 }}>Signed in as {signedInEmail}</p>}
          <button
            onClick={handleSignOut}
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 24px', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 12, background: 'transparent', color: '#fff', fontWeight: 600, fontSize: '0.9rem', fontFamily: 'inherit', cursor: 'pointer' }}
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'linear-gradient(135deg, #0a1628 0%, #022873 100%)', fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, padding: '48px 40px', maxWidth: 420, width: '90%', textAlign: 'center' }}>
        <img src="/images/logo-white.svg" alt="Datalake" style={{ height: 48, marginBottom: 20 }} />
        <h1 style={{ color: '#fff', fontSize: '1.5rem', fontWeight: 700, marginBottom: 8 }}>Datalake Platform</h1>
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.85rem', marginBottom: 28 }}>Sign in with your Datalake account to continue</p>

        <form onSubmit={handleEmailSignIn} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 18, textAlign: 'left' }}>
          <div style={{ position: 'relative' }}>
            <Mail size={16} color="rgba(255,255,255,0.4)" style={{ position: 'absolute', left: 14, top: 14 }} />
            <input
              type="email" autoComplete="email" placeholder="name@datalake.sa"
              value={email} onChange={e => setEmail(e.target.value)}
              style={{ width: '100%', padding: '12px 14px 12px 42px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10, color: '#fff', fontSize: '0.92rem', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ position: 'relative' }}>
            <Lock size={16} color="rgba(255,255,255,0.4)" style={{ position: 'absolute', left: 14, top: 14 }} />
            <input
              type="password" autoComplete="current-password" placeholder="Password"
              value={password} onChange={e => setPassword(e.target.value)}
              style={{ width: '100%', padding: '12px 14px 12px 42px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10, color: '#fff', fontSize: '0.92rem', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
          <button
            type="submit" disabled={!email || !password || submitting}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: '13px 24px', border: 'none', borderRadius: 12, background: '#1598CC', color: '#fff', fontWeight: 700, fontSize: '0.95rem', fontFamily: 'inherit', cursor: (!email || !password || submitting) ? 'not-allowed' : 'pointer', opacity: (!email || !password || submitting) ? 0.6 : 1 }}
          >
            <LogIn size={18} /> {submitting ? 'Signing in…' : 'Sign in'}
          </button>
          <button
            type="button" onClick={handleForgotPassword}
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.55)', fontSize: '0.78rem', cursor: 'pointer', alignSelf: 'flex-end', padding: 0, fontFamily: 'inherit', textDecoration: 'underline' }}
          >
            Forgot password?
          </button>
        </form>

        {authError && (
          <div style={{ marginTop: 16, padding: '10px 16px', background: 'rgba(192,57,43,0.15)', border: '1px solid rgba(192,57,43,0.3)', borderRadius: 8, color: '#ff6b6b', fontSize: '0.82rem' }}>
            {authError}
          </div>
        )}
        {notice && (
          <div style={{ marginTop: 16, padding: '10px 16px', background: 'rgba(52,191,58,0.12)', border: '1px solid rgba(52,191,58,0.3)', borderRadius: 8, color: '#86efac', fontSize: '0.82rem' }}>
            {notice}
          </div>
        )}

        <div style={{ marginTop: 32, fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 }}>
          By signing in, you acknowledge Datalake's Privacy Notice and agree to the processing of your personal data in compliance with PDPL.
        </div>
      </div>
    </div>
  )
}
