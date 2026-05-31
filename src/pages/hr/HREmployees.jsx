import { useState, useEffect } from 'react'
import { collection, onSnapshot, doc, setDoc, deleteDoc, query, orderBy, updateDoc } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { Users, Search, Filter, Briefcase, Mail, Phone, ChevronRight, UserPlus, X, Loader, CheckCircle, Trash2, Edit2, Send, Archive, UserMinus, Eye } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import AddEmployeeModal from '../../components/AddEmployeeModal'
import OnboardingDetailModal from '../../components/OnboardingDetailModal'
import SendEmailModal from '../../components/SendEmailModal'
import { ShieldCheck } from 'lucide-react'

const STATUS_COLORS = {
  ACTIVE: { bg: 'rgba(52,191,58,0.12)', color: '#34BF3A' },
  active: { bg: 'rgba(52,191,58,0.12)', color: '#34BF3A' },
  ONBOARDING: { bg: 'rgba(21,152,204,0.12)', color: '#1598CC' },
  PENDING_APPROVAL: { bg: 'rgba(243,156,18,0.12)', color: '#F39C12' },
  PENDING_OFFBOARDING: { bg: 'rgba(239,88,41,0.12)', color: '#EF5829' },
  TERMINATED: { bg: 'rgba(192,57,43,0.12)', color: '#C0392B' },
  terminated: { bg: 'rgba(192,57,43,0.12)', color: '#C0392B' },
}

export default function HREmployees() {
  const [employees, setEmployees] = useState([])
  // Users-by-uid join lets us show role_id + onboarding_complete next to each
  // employee. employees holds HR data; users holds auth data; same person, two
  // collections — surface both in one row.
  const [usersMap, setUsersMap] = useState({})
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterType, setFilterType] = useState('ALL')
  const [showModal, setShowModal] = useState(false)
  const [editEmployee, setEditEmployee] = useState(null)
  const [viewEmployee, setViewEmployee] = useState(null)
  const [consentEmployee, setConsentEmployee] = useState(null)  // → OnboardingDetailModal
  const [emailEmployee, setEmailEmployee] = useState(null)       // → SendEmailModal
  const [toast, setToast] = useState(null)
  
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    if (location.state?.candidate) {
      setShowModal(true)
    }
  }, [location.state])

  const handleModalClose = (success) => {
    setShowModal(false)
    if (location.state?.candidate) {
      // clear state so it doesn't reopen on refresh
      navigate(location.pathname, { replace: true })
    }
    if (success) {
      setToast('Employee successfully submitted for approval')
      setTimeout(() => setToast(null), 4000)
    }
  }

  useEffect(() => {
    const q = query(collection(db, 'employees'), orderBy('employee_id'))
    const unsub = onSnapshot(q, snap => {
      setEmployees(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoading(false)
    }, err => { console.warn(err); setLoading(false) })
    const unsubUsers = onSnapshot(collection(db, 'users'), snap => {
      const m = {}
      snap.docs.forEach(d => {
        const data = d.data()
        m[d.id] = data
        if (data.email) m[`email:${String(data.email).toLowerCase()}`] = data
      })
      setUsersMap(m)
    })
    return () => { unsub(); unsubUsers() }
  }, [])

  // Pick the matching users row for an employee — try uid, then employee_id (some
  // legacy users docs are keyed by employee id), then email lookup.
  const userFor = (e) =>
    usersMap[e.uid] || usersMap[e.id] || usersMap[e.employee_id]
    || (e.email && usersMap[`email:${String(e.email).toLowerCase()}`])
    || {}

  const handleDelete = async (id) => {
    if(window.confirm('Remove this pending employee completely?')) {
      try {
        await deleteDoc(doc(db, 'employees', id))
      } catch(err) {
        console.error(err)
        alert('Could not remove employee: ' + err.message)
      }
    }
  }

  const handleOffboard = async (id) => {
    if(window.confirm('Initiate offboarding process? (Requires CEO approval)')) {
      await updateDoc(doc(db, 'employees', id), { employment_status: 'PENDING_OFFBOARDING', updated_at: new Date() })
    }
  }

  const handleArchive = async (id) => {
    await updateDoc(doc(db, 'employees', id), { archived: true, updated_at: new Date() })
  }

  const handleSendLink = (email) => {
    alert(`Onboarding link sent to ${email}`)
  }

  const filtered = employees.filter(e => {
    if (e.archived && filterType !== 'ARCHIVED') return false
    if (!e.archived && filterType === 'ARCHIVED') return false
    if (filterType !== 'ALL' && filterType !== 'ARCHIVED' && e.type !== filterType) return false
    if (searchTerm) {
      const q = searchTerm.toLowerCase()
      if (!e.full_name?.toLowerCase().includes(q) && !e.employee_id?.toLowerCase().includes(q)) return false
    }
    return true
  })

  return (
    <div style={{ padding: '32px 24px', maxWidth: 1200, margin: '0 auto', fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, color: '#e2e8f0' }}>Employee Directory</h1>
          <p style={{ fontSize: '0.82rem', color: '#94a3b8', marginTop: 4 }}>Manage all personnel across the organization</p>
        </div>
        <button onClick={() => setShowModal(true)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', background: '#1598CC', border: 'none', borderRadius: 8, color: '#fff', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
          <UserPlus size={16} /> Add Employee
        </button>
      </div>

      {toast && (
        <div className="animate-fade-in-up" style={{ padding: '12px 20px', background: 'rgba(52,191,58,0.12)', border: '1px solid rgba(52,191,58,0.3)', borderRadius: 8, color: '#34BF3A', fontSize: '0.85rem', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
          <CheckCircle size={16} /> {toast}
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <Search size={16} color="#64748b" style={{ position: 'absolute', left: 14, top: 14 }} />
          <input 
            type="text" 
            placeholder="Search by name or DLSA ID..." 
            value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
            style={{ width: '100%', padding: '12px 14px 12px 40px', background: '#0d1829', border: '1px solid #1e3050', borderRadius: 10, color: '#fff', outline: 'none', fontFamily: 'inherit' }}
          />
        </div>
        <select 
          value={filterType} onChange={e => setFilterType(e.target.value)}
          style={{ padding: '0 16px', background: '#0d1829', border: '1px solid #1e3050', borderRadius: 10, color: '#fff', outline: 'none', fontFamily: 'inherit', width: 200 }}
        >
          <option value="ALL">All Types</option>
          <option value="deployed">Deployed</option>
          <option value="internal">Internal</option>
          <option value="contractor">Contractor</option>
          <option value="ARCHIVED">Archived</option>
        </select>
      </div>

      <div style={{ background: '#111e33', border: '1px solid #1e3050', borderRadius: 12, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #1e3050' }}>
              <th style={{ padding: '14px 20px', color: '#94a3b8', fontWeight: 600 }}>Employee</th>
              <th style={{ padding: '14px 20px', color: '#94a3b8', fontWeight: 600 }}>Type & Dept</th>
              <th style={{ padding: '14px 20px', color: '#94a3b8', fontWeight: 600 }}>Status</th>
              <th style={{ padding: '14px 20px', color: '#94a3b8', fontWeight: 600 }}>Role / Onboarding</th>
              <th style={{ padding: '14px 20px', color: '#94a3b8', fontWeight: 600 }}>Project</th>
              <th style={{ padding: '14px 20px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: '#64748b' }}><Loader size={24} className="spin" style={{ margin: '0 auto 12px' }}/>Loading directory...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>No employees found.</td></tr>
            ) : filtered.map(e => {
              const st = STATUS_COLORS[e.employment_status] || STATUS_COLORS.ACTIVE
              const isPending = e.employment_status === 'PENDING_APPROVAL' || e.employment_status === 'ONBOARDING'
              const isTerminated = e.employment_status === 'TERMINATED'
              const isPendingOffboard = e.employment_status === 'PENDING_OFFBOARDING'
              const isActive = !isPending && !isTerminated && !isPendingOffboard
              const u = userFor(e)
              const onboardingDone = e.onboarding_complete === true || u.onboarding_complete === true

              return (
                <tr key={e.id} style={{ borderBottom: '1px solid #1e3050' }} className="table-row-hover">
                  <td style={{ padding: '16px 20px' }}>
                    <div style={{ fontWeight: 600, color: '#e2e8f0', marginBottom: 4 }}>{e.full_name}</div>
                    <div style={{ fontSize: '0.72rem', color: '#64748b', fontFamily: 'monospace' }}>{e.employee_id} · {e.email}</div>
                  </td>
                  <td style={{ padding: '16px 20px' }}>
                    <div style={{ textTransform: 'capitalize', color: '#e2e8f0', marginBottom: 4 }}>{e.job_title}</div>
                    <div style={{ fontSize: '0.72rem', color: '#64748b', textTransform: 'uppercase' }}>{e.type} · {e.department}</div>
                  </td>
                  <td style={{ padding: '16px 20px' }}>
                    <span style={{ padding: '4px 10px', borderRadius: 12, fontSize: '0.7rem', fontWeight: 700, background: st.bg, color: st.color, textTransform: 'uppercase' }}>
                      {e.employment_status?.replace('_', ' ')}
                    </span>
                  </td>
                  <td style={{ padding: '16px 20px' }}>
                    <div style={{ fontSize: '0.78rem', color: '#e2e8f0', textTransform: 'capitalize' }}>{u.role_id || e.role_id || '—'}</div>
                    <div style={{ fontSize: '0.7rem', color: onboardingDone ? '#34BF3A' : '#94a3b8', marginTop: 3 }}>
                      {onboardingDone ? '✓ Onboarded' : 'Not onboarded'}
                    </div>
                  </td>
                  <td style={{ padding: '16px 20px', color: '#94a3b8' }}>
                    {e.assigned_project || 'Unassigned'}
                  </td>
                  <td style={{ padding: '16px 20px', textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap', maxWidth: 340, marginLeft: 'auto' }}>
                      <button onClick={() => setConsentEmployee(e)} className="btn-action" title="Onboarding status + PDPL consent certificate" style={{ background: 'rgba(21,152,204,0.1)', color: '#1598CC', border: '1px solid rgba(21,152,204,0.3)' }}>
                        <ShieldCheck size={12} /> Consent
                      </button>
                      {isActive && (
                        <>
                          <button onClick={() => handleOffboard(e.id)} className="btn-action" style={{ background: 'rgba(239,88,41,0.1)', color: '#EF5829', border: '1px solid rgba(239,88,41,0.3)' }} title="Offboard">
                            <UserMinus size={12} /> Offboard
                          </button>
                          <button onClick={() => setEmailEmployee(e)} className="btn-action" title="Send email">
                            <Mail size={12} /> Email
                          </button>
                          <button onClick={() => setEditEmployee(e)} className="btn-action" title="Edit">
                            <Edit2 size={12} /> Edit
                          </button>
                        </>
                      )}

                      {isPending && (
                        <>
                          <button onClick={() => setEmailEmployee(e)} className="btn-action" title="Send welcome / credentials">
                            <Mail size={12} /> Email
                          </button>
                          <button onClick={() => handleSendLink(e.email)} className="btn-action" title="Send Link">
                            <Send size={12} /> Send Link
                          </button>
                          <button onClick={() => setEditEmployee(e)} className="btn-action" title="Edit">
                            <Edit2 size={12} /> Edit
                          </button>
                          <button onClick={() => handleDelete(e.id)} className="btn-action" style={{ background: 'rgba(192,57,43,0.1)', color: '#ef4444', border: '1px solid rgba(192,57,43,0.3)' }} title="Remove">
                            <Trash2 size={12} /> Remove
                          </button>
                        </>
                      )}

                      {isPendingOffboard && (
                        <>
                          <button onClick={() => setViewEmployee(e)} className="btn-action" title="View">
                            <Eye size={12} /> View
                          </button>
                        </>
                      )}

                      {isTerminated && (
                        <>
                          <button onClick={() => setViewEmployee(e)} className="btn-action" title="View Record">
                            <Eye size={12} /> View Record
                          </button>
                          {!e.archived && (
                            <button onClick={() => handleArchive(e.id)} className="btn-action" title="Archive">
                              <Archive size={12} /> Archive
                            </button>
                          )}
                        </>
                      )}

                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      
      {showModal && <AddEmployeeModal onClose={handleModalClose} initialData={location.state?.candidate} />}
      {editEmployee && <AddEmployeeModal onClose={() => setEditEmployee(null)} initialData={editEmployee} isEdit={true} />}
      {viewEmployee && <AddEmployeeModal onClose={() => setViewEmployee(null)} initialData={viewEmployee} isEdit={true} />}
      {consentEmployee && <OnboardingDetailModal employee={consentEmployee} onClose={() => setConsentEmployee(null)} />}
      {emailEmployee && (
        <SendEmailModal
          employee={emailEmployee}
          onClose={() => setEmailEmployee(null)}
          onSent={() => {
            setToast(`Email sent to ${emailEmployee.email}`)
            setTimeout(() => setToast(null), 4000)
          }}
        />
      )}

      <style>{`
        .spin { animation: spin 1s linear infinite; } 
        @keyframes spin { 100% { transform: rotate(360deg); } } 
        .table-row-hover:hover { background: rgba(255,255,255,0.02); }
        .btn-action { background: transparent; border: 1px solid #1e3050; color: #e2e8f0; padding: 6px 10px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; gap: 6px; font-family: inherit; font-size: 0.75rem; font-weight: 600; transition: all 0.2s; }
        .btn-action:hover { filter: brightness(1.2); }
      `}</style>
    </div>
  )
}
