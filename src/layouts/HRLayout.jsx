import { useState, useEffect } from 'react'
import { Outlet, NavLink, useLocation } from 'react-router-dom'
import { ClipboardCheck, FileText, LogOut, ChevronLeft, ChevronRight } from 'lucide-react'
import { signIn, signOut, onAuthChange } from '../lib/auth'
import '../styles/ceo.css'

import { Users, Briefcase } from 'lucide-react'

const navItems = [
  { icon: Users, label: 'Talent Pool', path: '/hr', end: true },
  { icon: Users, label: 'Employee Directory', path: '/hr/employees' },
  { icon: ClipboardCheck, label: 'Interview Scoring', path: '/hr/scoring' },
  { icon: FileText, label: 'Interview CV Prep', path: '/hr/interview-cv' },
  { icon: Briefcase, label: 'Job Listings', path: '/hr/jobs' },
]

export default function HRLayout() {
  const [collapsed, setCollapsed] = useState(false)
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authError, setAuthError] = useState('')
  const location = useLocation()

  useEffect(() => {
    const unsub = onAuthChange((firebaseUser) => {
      setUser(firebaseUser)
      setAuthLoading(false)
    })
    return () => unsub()
  }, [])

  const handleSignIn = async () => {
    setAuthError('')
    try { await signIn() } catch (err) { setAuthError(err.message || 'Sign-in failed') }
  }

  if (authLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0a1628', color: '#fff', fontFamily: "'DM Sans', sans-serif" }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 40, height: 40, border: '3px solid rgba(255,255,255,0.2)', borderTopColor: '#1598CC', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
          <div style={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.6)' }}>Verifying identity...</div>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'linear-gradient(135deg, #022873 0%, #0a1628 100%)', fontFamily: "'DM Sans', sans-serif" }}>
        <div style={{ background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, padding: '48px 40px', maxWidth: 420, width: '90%', textAlign: 'center' }}>
          <img src="/images/icon.svg" alt="Datalake" style={{ width: 48, height: 48, marginBottom: 20 }} />
          <h1 style={{ color: '#fff', fontSize: '1.5rem', fontWeight: 700, marginBottom: 8 }}>HR Portal</h1>
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.85rem', marginBottom: 32 }}>Sign in with your Datalake account</p>
          <button onClick={handleSignIn} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, width: '100%', padding: '14px 24px', border: 'none', borderRadius: 12, background: '#fff', color: '#1A1A2E', fontWeight: 600, fontSize: '0.95rem', fontFamily: 'inherit', cursor: 'pointer', boxShadow: '0 4px 14px rgba(0,0,0,0.2)' }}>
            Sign in with Google
          </button>
          {authError && <div style={{ marginTop: 16, padding: '10px 16px', background: 'rgba(192,57,43,0.15)', border: '1px solid rgba(192,57,43,0.3)', borderRadius: 8, color: '#ff6b6b', fontSize: '0.82rem' }}>{authError}</div>}
        </div>
      </div>
    )
  }

  return (
    <div className="app-layout" data-portal="ceo">
      <aside className={`ceo-sidebar ${collapsed ? 'collapsed' : ''}`} style={{ '--sidebar-accent': '#1598CC' }}>
        <div className="sidebar-header">
          <img src="/images/icon.svg" alt="Datalake" style={{ width: 32, height: 32, flexShrink: 0 }} />
          <div className="sidebar-logo-text">
            <span>DATALAKE</span>
            <span>HR Portal</span>
          </div>
        </div>
        <nav className="sidebar-nav">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = item.end
              ? location.pathname === item.path
              : location.pathname.startsWith(item.path)
            return (
              <NavLink key={item.path} to={item.path} end={item.end}
                className={`nav-item ${isActive ? 'active' : ''}`}>
                <span className="nav-icon"><Icon size={20} /></span>
                <span className="nav-label">{item.label}</span>
              </NavLink>
            )
          })}
        </nav>
        <div className="sidebar-footer">
          <div style={{ padding: '8px 16px', fontSize: '0.72rem', color: 'rgba(255,255,255,0.5)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {!collapsed && user.email}
          </div>
          <button style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: '0.78rem', fontFamily: 'inherit', width: '100%' }} onClick={() => signOut()}>
            <LogOut size={16} />
            {!collapsed && <span>Sign Out</span>}
          </button>
          <button className="sidebar-collapse-btn" onClick={() => setCollapsed(!collapsed)}>
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>
      <main className={`main-area ${collapsed ? 'collapsed' : ''}`} style={{ marginTop: 0, background: '#0a1628' }}>
        <div className="page-content page-enter"><Outlet /></div>
      </main>
    </div>
  )
}
