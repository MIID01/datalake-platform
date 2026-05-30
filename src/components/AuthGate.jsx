import { useState, useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { auth, db } from '../lib/firebase'
import { CEO_EMAIL } from '../lib/auth'
import { homePathForRole, portalPrefixForRole } from '../lib/routes'
import { collection, query, where, getDocs, doc, onSnapshot } from 'firebase/firestore'
import { ShieldAlert, Loader, LogOut } from 'lucide-react'

/**
 * AuthGate — Multi-role authentication and routing
 * 
 * 1. Any Google account can sign in
 * 2. System checks `users` collection by email (not UID) for role
 * 3. If found → grant access to their role's portal
 * 4. If not found → "Access Denied" for protected routes, allow public routes
 * 5. CEO bypass: m.alqumri@datalake.sa always has full access
 */

const PUBLIC_PATHS = ['/', '/careers', '/consent/', '/client/scorecard/', '/contract/', '/legal/review/']

function isPublicPath(path) {
  if (path === '/' || path === '/careers') return true
  return PUBLIC_PATHS.some(p => p !== '/' && path.startsWith(p))
}

export default function AuthGate({ children }) {
  const [loading, setLoading] = useState(true)
  const [userRole, setUserRole] = useState(null) // { role_id, status, display_name, ... }
  const [uid, setUid] = useState(null)
  const [email, setEmail] = useState(null)

  // Step 1: Listen to Firebase Auth state
  useEffect(() => {
    const unsubAuth = auth.onAuthStateChanged((user) => {
      if (user) {
        setUid(user.uid)
        setEmail(user.email)
      } else {
        setUid(null)
        setEmail(null)
        setUserRole(null)
        setLoading(false)
      }
    })
    return () => unsubAuth()
  }, [])

  // Step 2: When email is known, look up user record by email
  useEffect(() => {
    if (!email) return

    const isCeo = email === 'm.alqumri@datalake.sa'

    // Try to find user doc by email
    let unsubUser = () => {}

    const lookupUser = async () => {
      try {
        // First try: doc keyed by UID
        const uidRef = doc(db, 'users', uid)
        const { getDoc } = await import('firebase/firestore')
        const uidSnap = await getDoc(uidRef)
        
        if (uidSnap.exists()) {
          unsubUser = onSnapshot(uidRef, (snap) => {
            if (snap.exists()) {
              setUserRole(snap.data())
              setLoading(false)
            } else {
              setUserRole({ NOT_FOUND: true })
              setLoading(false)
            }
          })
          return
        }

        // Second try: query by email field
        const q = query(collection(db, 'users'), where('email', '==', email))
        const qSnap = await getDocs(q)
        if (!qSnap.empty) {
          const matchedDocRef = doc(db, 'users', qSnap.docs[0].id)
          unsubUser = onSnapshot(matchedDocRef, (snap) => {
            if (snap.exists()) {
              setUserRole(snap.data())
              setLoading(false)
            }
          })
          return
        }

        if (isCeo) {
          setUserRole({ role_id: 'ceo', status: 'active', display_name: 'CEO', email })
          setLoading(false)
          return
        }

        if (email.toLowerCase() === 'hr@datalake.sa') {
          setUserRole({ role_id: 'hr', status: 'active', display_name: 'HR Admin', email })
          setLoading(false)
          return
        }

        // No user record found
        setUserRole({ NOT_FOUND: true })
        setLoading(false)
      } catch (err) {
        console.warn('AuthGate lookup error:', err.message)
        if (isCeo) {
          setUserRole({ role_id: 'ceo', status: 'active', display_name: 'CEO', email })
        } else {
          setUserRole({ NOT_FOUND: true })
        }
        setLoading(false)
      }
    }

    lookupUser()
    
    return () => unsubUser()
  }, [email, uid])

  // Loading spinner
  if (loading) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a1628' }}>
        <Loader className="spin" color="#1598CC" />
        <style>{`.spin { animation: spin 1s linear infinite; } @keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  const currentPath = window.location.pathname
  const isCeo = email === CEO_EMAIL

  // Always allow public/token-gated routes. Post-login routing from the landing
  // page ("/") is owned by LandingPage, which navigates via homePathForRole.
  if (isPublicPath(currentPath)) return children

  // Not logged in -> redirect to public landing page
  if (!uid) return <Navigate to="/" replace />

  // ── Onboarding gate ── EVERY role (including the CEO) must complete the
  // policy onboarding before accessing ANY portal. Only the onboarding page
  // itself is exempt (public/token paths already returned above). NOT_FOUND /
  // disabled accounts keep their own screens below rather than being trapped.
  const onOnboardingPage = currentPath === '/employee/onboarding'
  const blockedAccount = userRole?.NOT_FOUND || userRole?.status === 'disabled'
  if (!blockedAccount && userRole?.onboarding_complete !== true && !onOnboardingPage) {
    return <Navigate to="/employee/onboarding" replace />
  }
  // Let any authenticated user render the onboarding page (bypass role/prefix routing).
  if (onOnboardingPage) return children

  // CEO bypass — full access to everything (after onboarding)
  if (isCeo) return children

  // User not found in system
  if (userRole?.NOT_FOUND) {
    return (
      <div style={{ padding: '40px 24px', maxWidth: 600, margin: '100px auto', minHeight: '100vh', background: '#0a1628', color: '#e2e8f0', textAlign: 'center' }}>
        <ShieldAlert color="#EF5829" size={64} style={{ marginBottom: 24 }} />
        <h1 style={{ fontSize: '1.8rem', fontWeight: 700, color: '#e2e8f0', marginBottom: 16 }}>Access Denied</h1>
        <p style={{ fontSize: '1rem', color: '#94a3b8', lineHeight: 1.6, marginBottom: 24 }}>
          Your account (<strong style={{ color: '#e2e8f0' }}>{email}</strong>) is not registered in the Datalake platform. Please contact IT to request access.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', marginBottom: 32 }}>
          <a href="mailto:it@datalake.sa" style={{ color: '#1598CC', textDecoration: 'none', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: 6 }}>🖥️ IT Support — <strong>it@datalake.sa</strong></a>
          <a href="mailto:hr@datalake.sa" style={{ color: '#1598CC', textDecoration: 'none', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: 6 }}>👤 HR — <strong>hr@datalake.sa</strong></a>
          <a href="mailto:dpo@datalake.sa" style={{ color: '#64748b', textDecoration: 'none', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 6 }}>🔒 Data Privacy (PDPL) — dpo@datalake.sa</a>
        </div>
        <button
          onClick={() => auth.signOut()}
          style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid #1e3050', background: 'transparent', color: '#e2e8f0', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}
        >
          <LogOut size={16} /> Sign Out
        </button>
        <style>{`.spin { animation: spin 1s linear infinite; } @keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  // User disabled
  if (userRole?.status === 'disabled') {
    return (
      <div style={{ padding: '40px 24px', maxWidth: 600, margin: '100px auto', minHeight: '100vh', background: '#0a1628', color: '#e2e8f0', textAlign: 'center' }}>
        <ShieldAlert color="#C0392B" size={64} style={{ marginBottom: 24 }} />
        <h1 style={{ fontSize: '1.8rem', fontWeight: 700, color: '#e2e8f0', marginBottom: 16 }}>Account Disabled</h1>
        <p style={{ fontSize: '1rem', color: '#94a3b8', lineHeight: 1.6, marginBottom: 24 }}>
          Your account has been disabled. Please contact IT or HR for assistance.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', marginBottom: 32 }}>
          <a href="mailto:it@datalake.sa" style={{ color: '#1598CC', textDecoration: 'none', fontSize: '0.9rem' }}>🖥️ IT Support — <strong>it@datalake.sa</strong></a>
          <a href="mailto:hr@datalake.sa" style={{ color: '#1598CC', textDecoration: 'none', fontSize: '0.9rem' }}>👤 HR — <strong>hr@datalake.sa</strong></a>
        </div>
        <button onClick={() => auth.signOut()} style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid #1e3050', background: 'transparent', color: '#e2e8f0', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <LogOut size={16} /> Sign Out
        </button>
      </div>
    )
  }

  if (userRole?.role_id) {
    const role = userRole.role_id;

    // /employee/* is shared — every authenticated role is also an employee.
    if (currentPath.startsWith('/employee')) return children

    // /ceo/* is CEO-ONLY (the CEO already returned above). Any other role here
    // is bounced to their own home: finance → /finance, employee →
    // /employee/dashboard, hr → /hr, it_admin → /admin, etc.
    if (currentPath.startsWith('/ceo')) {
      return <Navigate to={homePathForRole(role)} replace />
    }

    // Otherwise keep the user within their own portal prefix.
    const prefix = portalPrefixForRole(role)
    if (prefix && !currentPath.startsWith(prefix)) {
      return <Navigate to={homePathForRole(role)} replace />
    }

    return children
  }

  // Fallback: consent pending or unknown state
  if (userRole?.pdpl_consent_state === 'GRANTED') return children

  return (
    <div style={{ padding: '40px 24px', maxWidth: 600, margin: '100px auto', minHeight: '100vh', background: '#0a1628', color: '#e2e8f0', textAlign: 'center' }}>
      <ShieldAlert color="#EF5829" size={64} style={{ marginBottom: 24 }} />
      <h1 style={{ fontSize: '1.8rem', fontWeight: 700, color: '#e2e8f0', marginBottom: 16 }}>Action Required</h1>
      <p style={{ fontSize: '1rem', color: '#94a3b8', lineHeight: 1.6, marginBottom: 24 }}>
        Your account is being set up. Please check your email for a consent form link to confirm your details and acknowledge Datalake's data processing terms.
      </p>
      <p style={{ fontSize: '0.9rem', color: '#64748b', marginBottom: 32 }}>
        If you haven't received it within 5 minutes, check your spam folder or contact <a href="mailto:m.alqumri@datalake.sa" style={{ color: '#1598CC', textDecoration: 'none' }}>m.alqumri@datalake.sa</a>.
      </p>
      <button
        onClick={() => auth.signOut()}
        style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid #1e3050', background: 'transparent', color: '#e2e8f0', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}
      >
        <LogOut size={16} /> Sign Out
      </button>
      <style>{`.spin { animation: spin 1s linear infinite; } @keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
