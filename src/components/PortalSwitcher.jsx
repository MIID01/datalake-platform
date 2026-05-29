import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { auth } from '../lib/firebase'
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

  // The auth listener handles the case where the layout renders before
  // currentUser is populated (sign-in just completed).
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(u => setEmail(u?.email || null))
    return () => unsub()
  }, [])

  if (email !== CEO_EMAIL) return null
  if (collapsed) return null

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
        id="ceo-switch-portal"
        style={selectStyle}
      >
        {PORTAL_VIEWS.map(v => (
          <option key={v.path} value={v.path} style={optionStyle}>{v.label}</option>
        ))}
      </select>
    </div>
  )
}
