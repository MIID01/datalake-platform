import { useState, useEffect } from 'react'
import { auth, db } from '../lib/firebase'
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

const PUBLIC_PATHS = ['/', '/careers', '/consent/', '/client/scorecard/', '/contract/']

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
    const lookupUser = async () => {
      try {
        // First try: doc keyed by UID (legacy)
        const uidDoc = await new Promise((resolve) => {
          const unsub = onSnapshot(doc(db, 'users', uid), (snap) => {
            unsub()
            resolve(snap)
          })
        })

        if (uidDoc.exists()) {
          setUserRole(uidDoc.data())
          setLoading(false)
          return
        }

        // Second try: query by email field
        const q = query(collection(db, 'users'), where('email', '==', email))
        const snap = await getDocs(q)
        if (!snap.empty) {
          setUserRole(snap.docs[0].data())
          setLoading(false)
          return
        }

        // CEO always gets access even without a user doc
        if (isCeo) {
          setUserRole({ role_id: 'ceo', status: 'active', display_name: 'CEO', email })
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

  // Not logged in → render children (public routes)
  if (!uid) return children

  // Always allow public/token-gated routes
  if (isPublicPath(currentPath)) return children

  // CEO bypass — full access to everything
  const isCeo = email === 'm.alqumri@datalake.sa'
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

  // User has consent pending — show action required page
  // But allow access if they have an active user record with a role
  if (userRole?.role_id) {
    // Active user with role — allow access
    // Optionally could enforce route matching (e.g., engineer can only access /engineer/*)
    // For now, allow access to let the platform work during initial setup
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
