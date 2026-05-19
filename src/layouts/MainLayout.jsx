import { useState, useEffect } from 'react'
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { auth, db } from '../lib/firebase'
import { collection, query, where, getDocs, doc, onSnapshot } from 'firebase/firestore'
import { useRiyadhTime } from '../hooks/useUtils'
import { 
  BarChart3, Users, DollarSign, FileText, CheckSquare, 
  Shield, Bell, Settings, ChevronLeft, ChevronRight,
  Search, Menu, FolderKanban, LogOut, FileSearch, HelpCircle, GraduationCap 
} from 'lucide-react'
import '../styles/ceo.css' // We can reuse the ceo.css for the main layout theme
import OnboardingFlow from '../components/OnboardingFlow'

const SIDEBAR_CONFIG = [
  { path: '/dashboard', label: 'Dashboard', icon: BarChart3, roles: ['ceo', 'cto', 'hr', 'pm', 'engineer', 'finance', 'sales', 'client', 'auditor'] },
  { path: '/timesheets', label: 'Timesheets', icon: CheckSquare, roles: ['engineer', 'pm', 'cto', 'ceo', 'finance', 'client'] },
  { path: '/leave', label: 'Leave & Holidays', icon: FileText, roles: ['engineer', 'pm', 'hr', 'cto', 'ceo'] },
  { path: '/projects', label: 'Projects', icon: FolderKanban, roles: ['pm', 'cto', 'ceo', 'sales', 'client', 'finance'] },
  { path: '/talent', label: 'Talent & HR', icon: Users, roles: ['hr', 'ceo', 'cto'] },
  { path: '/expenses', label: 'Expenses', icon: DollarSign, roles: ['engineer', 'pm', 'cto', 'ceo', 'finance'] },
  { path: '/documents', label: 'Documents', icon: FileSearch, roles: ['ceo', 'cto', 'hr', 'pm', 'engineer', 'finance', 'sales', 'client', 'auditor'] },
  { path: '/training', label: 'Training', icon: GraduationCap, roles: ['ceo', 'cto', 'hr', 'pm', 'engineer', 'finance', 'sales', 'client', 'auditor'] },
  { path: '/support', label: 'Support', icon: HelpCircle, roles: ['ceo', 'cto', 'hr', 'pm', 'engineer', 'finance', 'sales', 'client', 'auditor'] },
  { path: '/finance', label: 'Finance', icon: DollarSign, roles: ['finance', 'ceo'] },
  { path: '/compliance', label: 'Compliance', icon: Shield, roles: ['ceo', 'auditor', 'cto'] },
  { path: '/users', label: 'Users & Access', icon: Users, roles: ['ceo', 'hr'] },
  { path: '/settings', label: 'Settings', icon: Settings, roles: ['ceo', 'cto', 'hr', 'pm', 'engineer', 'finance', 'sales', 'client', 'auditor'] },
]

export default function MainLayout() {
  const [collapsed, setCollapsed] = useState(false)
  const [userRole, setUserRole] = useState(null)
  const [loading, setLoading] = useState(true)
  const time = useRiyadhTime()
  const location = useLocation()
  const navigate = useNavigate()
  
  useEffect(() => {
    const unsubAuth = auth.onAuthStateChanged(async (user) => {
      if (user) {
        // Quick CEO check
        if (user.email === 'm.alqumri@datalake.sa') {
          setUserRole({ role_id: 'ceo', display_name: 'Management', email: user.email })
          setLoading(false)
          return
        }

        try {
          const uidDoc = await new Promise((resolve) => {
            const unsub = onSnapshot(doc(db, 'users', user.uid), (snap) => {
              unsub()
              resolve(snap)
            })
          })

          if (uidDoc.exists()) {
            setUserRole(uidDoc.data())
          } else {
            const q = query(collection(db, 'users'), where('email', '==', user.email))
            const snap = await getDocs(q)
            if (!snap.empty) setUserRole(snap.docs[0].data())
          }
        } catch (err) {
          console.warn('Layout role fetch error:', err.message)
        }
      }
      setLoading(false)
    })
    return () => unsubAuth()
  }, [])

  const handleSignOut = async () => {
    await auth.signOut()
    navigate('/')
  }

  const handleOnboardingComplete = () => {
    setUserRole(prev => ({ ...prev, onboarding_completed: true }))
  }

  if (loading) return null // Handled by AuthGate

  const role = userRole?.role_id || 'engineer' // Fallback
  const allowedItems = SIDEBAR_CONFIG.filter(item => item.roles.includes(role))
  const needsOnboarding = userRole && !userRole.NOT_FOUND && !userRole.onboarding_completed && role !== 'ceo'

  return (
    <div className="app-layout">
      {needsOnboarding && <OnboardingFlow userRole={userRole} onComplete={handleOnboardingComplete} />}
      
      {/* Sidebar */}
      <aside className={`ceo-sidebar ${collapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          <img src="/images/icon.svg" alt="Datalake" style={{ width: 32, height: 32, flexShrink: 0 }} />
          <div className="sidebar-logo-text">
            <span>DATALAKE</span>
            <span style={{ textTransform: 'capitalize' }}>{role === 'ceo' ? 'Management Center' : `${role} Portal`}</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          {allowedItems.map((item) => {
            const Icon = item.icon
            const isActive = location.pathname.startsWith(item.path)
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={`nav-item ${isActive ? 'active' : ''}`}
              >
                <span className="nav-icon"><Icon size={20} /></span>
                <span className="nav-label">{item.label}</span>
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
        <div className="topbar-left" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="topbar-search" style={{ margin: 0 }}>
            <Search className="search-icon" size={18} />
            <input 
              type="text" 
              placeholder="Global search..." 
              id="global-search"
            />
          </div>
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.85rem', display: 'flex', gap: 8, alignItems: 'center' }}>
            <span>Dashboard</span>
            {location.pathname !== '/dashboard' && location.pathname !== '/' && (
              <>
                <ChevronRight size={14} />
                <span style={{ color: '#fff', textTransform: 'capitalize' }}>
                  {location.pathname.split('/')[1].replace('-', ' ')}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="topbar-right">
          <span className="topbar-time">{time} AST</span>
          <div className="topbar-notification" id="notification-bell">
            <Bell size={20} />
            <span className="notif-badge">0</span>
          </div>
          {auth.currentUser?.photoURL && <img src={auth.currentUser.photoURL} alt="" style={{ width: 32, height: 32, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.2)' }} />}
          <div className="topbar-avatar" title={auth.currentUser?.email}>{userRole?.display_name?.slice(0, 2).toUpperCase() || 'DL'}</div>
          <button onClick={handleSignOut} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', fontFamily: 'inherit' }} title="Sign out">
            <LogOut size={16} />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className={`main-area ${collapsed ? 'collapsed' : ''}`}>
        <div className="page-content page-enter">
          <Outlet />
        </div>
        
        {/* Compliance Footer Badge */}
        <div style={{ position: 'absolute', bottom: 12, right: 24, fontSize: '0.65rem', color: 'rgba(255,255,255,0.3)', display: 'flex', alignItems: 'center', gap: 6, zIndex: 10 }}>
          🛡️ PDPL · NCA · SAMA Compliant | Data hosted in KSA (me-central2)
        </div>
      </main>

      {/* Mobile Bottom Tab Bar (visible only on small screens via CSS media queries in ceo.css) */}
      <div className="mobile-tab-bar" style={{ display: 'none' /* Will be toggled via CSS */ }}>
        {/* 5 Icons: Dashboard, Timesheets, Leave, Documents, Menu */}
      </div>
    </div>
  )
}
