import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { auth, db } from '../lib/firebase'
import { CEO_EMAIL } from '../lib/auth'

// Shared CEO-only "Switch Portal" dropdown. Renders nothing for non-CEO users
// (everyone else stays inside their own portal). The CEO can jump from any
// layout — CEO, Finance, HR, Admin, Employee — into any other.
//
// Visuals are intentionally dark-theme (white text on the layout's dark
// sidebar). Drop it into a sidebar that has a dark background; for light
// sidebars (e.g. FinanceLayout-styled portals), pass `theme="light"`.

const PORTAL_VIEWS = [
  { label: 'CEO View',      path: '/ceo' },
  { label: 'Finance View',  path: '/finance' },
  { label: 'HR View',       path: '/hr' },
  { label: 'Admin View',    path: '/admin' },
  { label: 'Employee View', path: '/employee/dashboard' },
]

function pickCurrentView(pathname) {
  if (pathname.startsWith('/finance'))  return '/finance'
  if (pathname.startsWith('/hr'))       return '/hr'
  if (pathname.startsWith('/admin'))    return '/admin'
  if (pathname.startsWith('/employee')) return '/employee/dashboard'
  return '/ceo'
}

export default function PortalSwitcher({ collapsed = false, theme = 'dark' }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [email, setEmail] = useState(auth.currentUser?.email || null)
  const [roleId, setRoleId] = useState(null)

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (u) => {
      setEmail(u?.email || null)
      if (u) {
        // Fetch user's role from Firestore to know what portals they have access to
        const { doc, getDoc } = await import('firebase/firestore')
        const userDoc = await getDoc(doc(db, 'users', u.uid))
        if (userDoc.exists()) {
          setRoleId(userDoc.data().role_id)
        } else {
          // fallback query by email
          const { collection, query, where, getDocs } = await import('firebase/firestore')
          const q = query(collection(db, 'users'), where('email', '==', u.email))
          const snap = await getDocs(q)
          if (!snap.empty) setRoleId(snap.docs[0].data().role_id)
        }
      }
    })
    return () => unsub()
  }, [])

  if (!email || collapsed) return null
  
  const isCeo = email === CEO_EMAIL
  
  // If not CEO and role is just 'employee' (or not yet loaded), they don't need a switcher
  if (!isCeo && (!roleId || roleId === 'employee' || roleId === 'client')) return null

  // Build the list of views they are allowed to see
  let allowedViews = []
  if (isCeo) {
    allowedViews = PORTAL_VIEWS
  } else {
    // Non-CEO staff get their primary portal + Employee View
    const primaryView = PORTAL_VIEWS.find(v => v.path === `/${roleId}`) || PORTAL_VIEWS.find(v => v.path === `/admin` && roleId === 'it_admin')
    if (primaryView) allowedViews.push(primaryView)
    allowedViews.push({ label: 'Employee View', path: '/employee/dashboard' })
  }

  const isLight = theme === 'light'
  const labelStyle = {
    display: 'block', fontSize: '0.65rem', textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: isLight ? 'var(--text-tertiary, #8898aa)' : 'rgba(255,255,255,0.4)',
    marginBottom: 6,
  }
  const selectStyle = {
    width: '100%', padding: '8px 10px', borderRadius: 8,
    background: isLight ? 'var(--bg-surface, #f4f6f9)' : 'rgba(255,255,255,0.06)',
    color: isLight ? 'var(--text-primary, #1A1A2E)' : '#fff',
    border: isLight ? '1px solid var(--border-primary, #E5E7EB)' : '1px solid rgba(255,255,255,0.12)',
    fontSize: '0.82rem', fontFamily: 'inherit', cursor: 'pointer',
  }
  const optionStyle = isLight
    ? { background: '#fff', color: '#1A1A2E' }
    : { background: '#0a1628', color: '#fff' }

  return (
    <div style={{ padding: '0 16px 12px' }}>
      <label style={labelStyle}>Switch Portal</label>
      <select
        value={pickCurrentView(location.pathname)}
        onChange={(e) => navigate(e.target.value)}
        id="portal-switcher"
        style={selectStyle}
      >
        {allowedViews.map(v => (
          <option key={v.path} value={v.path} style={optionStyle}>{v.label}</option>
        ))}
      </select>
    </div>
  )
}
