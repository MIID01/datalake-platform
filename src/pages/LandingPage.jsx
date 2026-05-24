import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { auth } from '../lib/firebase'
import { signIn, resolveUserRole, CEO_EMAIL } from '../lib/auth'
import { homePathForRole } from '../lib/routes'
import { LogIn } from 'lucide-react'
import '../styles/ceo.css'

export default function LandingPage() {
  const navigate = useNavigate()
  const [authError, setAuthError] = useState('')

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
      setAuthError(err.message || 'Sign-in failed')
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'linear-gradient(135deg, #0a1628 0%, #022873 100%)', fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, padding: '48px 40px', maxWidth: 420, width: '90%', textAlign: 'center' }}>
        <img src="/images/logo-white.svg" alt="Datalake" style={{ height: 48, marginBottom: 20 }} />
        <h1 style={{ color: '#fff', fontSize: '1.5rem', fontWeight: 700, marginBottom: 8 }}>Datalake Platform</h1>
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.85rem', marginBottom: 32 }}>Sign in with your Datalake account to continue</p>
        
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

        <div style={{ marginTop: 32, fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 }}>
          By signing in, you acknowledge Datalake's Privacy Notice and agree to the processing of your personal data in compliance with PDPL.
        </div>
      </div>
    </div>
  )
}
