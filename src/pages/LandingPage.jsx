import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { signInWithPopup, GoogleAuthProvider, OAuthProvider } from 'firebase/auth'
import { auth, GENERATE_PASSWORD_RESET_URL } from '../lib/firebase'
import { signInWithEmail, resolveUserRole, signOut, CEO_EMAIL } from '../lib/auth'
import { homePathForRole } from '../lib/routes'
import { LogIn, Mail, Lock, AlertTriangle, LogOut } from 'lucide-react'
import '../styles/ceo.css'

// Microsoft Entra (Azure AD) tenant — restricts Microsoft SSO to the Datalake
// directory. TODO: replace with the real Entra tenant GUID from Azure portal →
// Microsoft Entra ID → Overview → Tenant ID. ('organizations' = any work/school
// account; a GUID locks it to Datalake only.)
const MICROSOFT_TENANT_ID = 'REPLACE_WITH_ENTRA_TENANT_ID'

// SSO buttons render ONLY when this build flag is true. The Firebase
// Google/Microsoft providers must be enabled in the console first — otherwise
// clicking throws "Sign-in failed" for live users. The public landing page
// can't read Firestore (unauthenticated), so this is a build/env flag (set
// VITE_SSO_ENABLED=true at build time), not a platform_settings doc. Default:
// hidden → email/password only.
const SSO_ENABLED = import.meta.env.VITE_SSO_ENABLED === 'true'

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
      // Bypass Firebase's default sender (which gets spam-filtered) — call
      // our own Gmail-DWD endpoint so the reset link arrives from a real
      // @datalake.sa mailbox.
      await fetch(GENERATE_PASSWORD_RESET_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      })
      // Always show a generic success so attackers can't enumerate accounts.
      setNotice(`If an account exists for ${email}, a password reset link has been sent. Check your inbox.`)
    } catch {
      // Generic friendly message — never expose the underlying network error.
      setNotice(`If an account exists for ${email}, a password reset link has been sent. Check your inbox.`)
    }
  }

  // SSO authenticates IDENTITY only — it does NOT grant access. AuthGate still
  // requires a provisioned users/{uid} doc (status=active + role); a valid
  // Google/Microsoft account that isn't a Datalake user lands on Access Denied.
  // Navigation on success is handled by the onAuthStateChanged listener above.
  const handleProviderSignIn = async (provider) => {
    if (submitting) return
    setAuthError('')
    setSubmitting(true)
    try {
      await signInWithPopup(auth, provider)
    } catch (err) {
      const c = String(err?.code || '')
      // User dismissing the popup is not an error worth surfacing.
      if (!c.includes('popup-closed-by-user') && !c.includes('cancelled-popup-request')) {
        setAuthError(friendlyAuthError(err))
      }
      setSubmitting(false)
    }
  }

  const handleGoogleSignIn = () => {
    const provider = new GoogleAuthProvider()
    provider.setCustomParameters({ hd: 'datalake.sa' }) // hint Datalake Workspace accounts
    return handleProviderSignIn(provider)
  }

  const handleMicrosoftSignIn = () => {
    const provider = new OAuthProvider('microsoft.com')
    provider.setCustomParameters({ tenant: MICROSOFT_TENANT_ID })
    return handleProviderSignIn(provider)
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

        {SSO_ENABLED && (<>
        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '4px 0 16px' }}>
          <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.12)' }} />
          <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: 1 }}>or</span>
          <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.12)' }} />
        </div>

        {/* SSO — identity only; AuthGate still enforces provisioned access */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button
            type="button" onClick={handleGoogleSignIn} disabled={submitting}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, width: '100%', padding: '12px 24px', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 12, background: 'rgba(255,255,255,0.95)', color: '#1f2937', fontWeight: 600, fontSize: '0.9rem', fontFamily: 'inherit', cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.6 : 1 }}
          >
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
            Continue with Google
          </button>
          <button
            type="button" onClick={handleMicrosoftSignIn} disabled={submitting}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, width: '100%', padding: '12px 24px', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 12, background: 'rgba(255,255,255,0.95)', color: '#1f2937', fontWeight: 600, fontSize: '0.9rem', fontFamily: 'inherit', cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.6 : 1 }}
          >
            <svg width="16" height="16" viewBox="0 0 23 23" aria-hidden="true"><path fill="#F25022" d="M1 1h10v10H1z"/><path fill="#7FBA00" d="M12 1h10v10H12z"/><path fill="#00A4EF" d="M1 12h10v10H1z"/><path fill="#FFB900" d="M12 12h10v10H12z"/></svg>
            Continue with Microsoft
          </button>
        </div>
        </>)}

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
