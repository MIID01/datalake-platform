import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { auth } from '../lib/firebase'
import { signIn, signInWithEmail, sendPasswordReset, resolveUserRole, CEO_EMAIL } from '../lib/auth'
import { homePathForRole } from '../lib/routes'
import { LogIn, Mail, Lock } from 'lucide-react'
import '../styles/ceo.css'

function friendlyAuthError(err) {
  const c = err?.code || ''
  if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found')) return 'Incorrect email or password.'
  if (c.includes('invalid-email')) return 'Enter a valid email address.'
  if (c.includes('too-many-requests')) return 'Too many attempts — please try again later.'
  if (c.includes('user-disabled')) return 'This account has been disabled. Contact IT.'
  return err?.message || 'Sign-in failed'
}

export default function LandingPage() {
  const navigate = useNavigate()
  const [authError, setAuthError] = useState('')
  const [notice, setNotice] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Once signed in (here or already), resolve the role and send the user to
  // their portal home via the shared homePathForRole map.
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (user) => {
      if (!user) return
      const record = await resolveUserRole(user.uid, user.email)
      const role = user.email === CEO_EMAIL ? 'ceo' : record?.role_id
      if (role) navigate(homePathForRole(role), { replace: true })
    })
    return () => unsub()
  }, [navigate])

  const handleSignIn = async () => {
    setAuthError('')
    try {
      await signIn()
      // Navigation is handled by the onAuthStateChanged listener above.
    } catch (err) {
      setAuthError(friendlyAuthError(err))
    }
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

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '0 0 18px', color: 'rgba(255,255,255,0.35)', fontSize: '0.75rem' }}>
          <span style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.12)' }} /> or <span style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.12)' }} />
        </div>

        <button
          onClick={handleSignIn}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, width: '100%', padding: '14px 24px', border: 'none', borderRadius: 12, background: '#fff', color: '#1A1A2E', fontWeight: 600, fontSize: '0.95rem', fontFamily: 'inherit', cursor: 'pointer', boxShadow: '0 4px 14px rgba(0,0,0,0.2)', transition: 'transform 0.15s' }}
        >
          <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
          Sign in with Google
        </button>
        
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
