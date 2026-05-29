import { useState, useEffect } from 'react'
import { Outlet, NavLink, useLocation } from 'react-router-dom'
import ErrorBoundary from '../components/ErrorBoundary'
import { useRiyadhTime } from '../hooks/useUtils'
import { auth, db } from '../lib/firebase'
import { doc, onSnapshot, collection, query, where, getDocs } from 'firebase/firestore'
import {
  LayoutDashboard, Clock, Palmtree, CreditCard, FileText,
  Plane, GraduationCap, LifeBuoy, User, Settings,
  Search, Bell, ChevronLeft, ChevronRight, Sun, Moon, Lock
} from 'lucide-react'
import '../styles/engineer.css'
import PortalSwitcher from '../components/PortalSwitcher'

const navItems = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/employee', badge: null, end: true },
  { icon: Clock, label: 'Timesheets', path: '/employee/timesheets', badge: 1, locked: true },
  { icon: Palmtree, label: 'Leave & Holidays', path: '/employee/leave', badge: 1, locked: true },
  { icon: CreditCard, label: 'Expenses', path: '/employee/expenses', badge: 1, locked: true },
  { icon: FileText, label: 'Documents', path: '/employee/documents', badge: 1, locked: true },
  { icon: Plane, label: 'Travel & Logistics', path: '/employee/travel', locked: true },
  { icon: GraduationCap, label: 'Training', path: '/employee/training', badge: 3 },
  { icon: LifeBuoy, label: 'Support Tickets', path: '/employee/support' },
  { icon: User, label: 'My Profile', path: '/employee/profile' },
]

export default function EmployeeLayout() {
  const [collapsed, setCollapsed] = useState(false)
  const [darkMode, setDarkMode] = useState(false)
  const [userData, setUserData] = useState(null)
  const [loading, setLoading] = useState(true)
  const time = useRiyadhTime()
  const location = useLocation()

  useEffect(() => {
    let unsubUid = () => {}
    let unsubEmail = () => {}

    const unsubAuth = auth.onAuthStateChanged(user => {
      if (user) {
        // Try getting by UID first
        unsubUid = onSnapshot(doc(db, 'users', user.uid), snap => {
          if (snap.exists()) {
            setUserData(snap.data())
            setLoading(false)
          } else {
            // fallback to query by email
            const q = query(collection(db, 'users'), where('email', '==', user.email.toLowerCase()))
            getDocs(q).then(qSnap => {
              if (!qSnap.empty) {
                unsubEmail = onSnapshot(doc(db, 'users', qSnap.docs[0].id), docSnap => {
                  setUserData(docSnap.data())
                  setLoading(false)
                })
              } else {
                // Not found at all (should be blocked by AuthGate anyway)
                setLoading(false)
              }
            }).catch(() => setLoading(false))
          }
        }, () => setLoading(false))
      } else {
        setLoading(false)
      }
    })
    return () => { unsubAuth(); unsubUid(); unsubEmail(); }
  }, [])

  if (loading) return <div style={{ height: '100vh', background: '#0a1628' }}></div>

  // Onboarding gate now lives centrally in AuthGate (applies to every role) —
  // any user reaching this layout has already completed onboarding.
  const isFullyOnboarded = true

  return (
    <div className="app-layout" data-portal="employee" data-theme={darkMode ? 'dark' : 'light'}>
      {/* Sidebar */}
      <aside className={`ceo-sidebar ${collapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          <img src="/images/icon.svg" alt="Datalake" style={{ width: 32, height: 32, flexShrink: 0 }} />
          <div className="sidebar-logo-text">
            <span>DATALAKE</span>
            <span>Employee Portal</span>
          </div>
        </div>

        <PortalSwitcher collapsed={collapsed} theme="light" />

        <nav className="sidebar-nav">
          {!isFullyOnboarded && (
             <NavLink to="/employee/onboarding" className="nav-item" style={{ background: 'rgba(239,88,41,0.1)', color: '#EF5829' }}>
               <span className="nav-icon"><Lock size={20} /></span>
               <span className="nav-label">Onboarding Required</span>
             </NavLink>
          )}
          {navItems.map((item) => {
            const Icon = item.icon
            const isLocked = item.locked && !isFullyOnboarded
            const isActive = item.end
              ? location.pathname === item.path
              : location.pathname.startsWith(item.path) && item.path !== '/employee'
            return (
              <NavLink
                key={item.path}
                to={isLocked ? (!userData?.training_completed ? '/employee/training' : '/employee/onboarding') : item.path}
                end={item.end}
                className={`nav-item ${isActive ? 'active' : ''} ${isLocked ? 'locked' : ''}`}
                style={isLocked ? { opacity: 0.5 } : {}}
                id={`nav-emp-${item.path.replace(/\//g, '-')}`}
              >
                <span className="nav-icon">{isLocked ? <Lock size={20} /> : <Icon size={20} />}</span>
                <span className="nav-label">{item.label}</span>
                {!isLocked && item.badge && <span className="nav-badge">{item.badge}</span>}
              </NavLink>
            )
          })}
        </nav>

        <div className="sidebar-footer">
          <button className="sidebar-collapse-btn" onClick={() => setCollapsed(!collapsed)}>
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>

      {/* Top Bar */}
      <header className={`ceo-topbar ${collapsed ? 'collapsed' : ''}`}>
        <div className="topbar-search">
          <Search className="search-icon" size={18} />
          <input type="text" placeholder="Search timesheets, documents, tickets..." id="eng-global-search" />
        </div>
        <div className="topbar-right">
          <span className="topbar-time">{time} AST</span>
          <button
            className="btn-icon"
            onClick={() => setDarkMode(!darkMode)}
            style={{ color: 'var(--text-secondary)' }}
            id="theme-toggle"
          >
            {darkMode ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <div className="topbar-notification" id="eng-notification-bell">
            <Bell size={20} />
            <span className="notif-badge">2</span>
          </div>
          <div className="topbar-avatar" id="eng-avatar" title={userData?.email || auth.currentUser?.email}>
            {userData?.full_name 
              ? userData.full_name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()
              : userData?.display_name
              ? userData.display_name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()
              : (auth.currentUser?.email || 'U').substring(0, 2).toUpperCase()}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className={`main-area ${collapsed ? 'collapsed' : ''}`}>
        <div className="page-content page-enter">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </div>
      </main>
    </div>
  )
}
