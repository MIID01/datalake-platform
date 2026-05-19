import { useState, useEffect } from 'react'
import { collection, onSnapshot, doc, setDoc, query, orderBy } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { Users, Search, Filter, Briefcase, Mail, Phone, ChevronRight, UserPlus, X, Loader } from 'lucide-react'

const STATUS_COLORS = {
  active: { bg: 'rgba(52,191,58,0.12)', color: '#34BF3A' },
  probation: { bg: 'rgba(243,156,18,0.12)', color: '#F39C12' },
  notice_period: { bg: 'rgba(239,88,41,0.12)', color: '#EF5829' },
  terminated: { bg: 'rgba(192,57,43,0.12)', color: '#C0392B' },
  on_leave: { bg: 'rgba(21,152,204,0.12)', color: '#1598CC' },
}

export default function HREmployees() {
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterType, setFilterType] = useState('ALL')
  const [selectedEmp, setSelectedEmp] = useState(null)
  const [showModal, setShowModal] = useState(false)

  useEffect(() => {
    const q = query(collection(db, 'employees'), orderBy('employee_id'))
    const unsub = onSnapshot(q, snap => {
      setEmployees(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoading(false)
    }, err => { console.warn(err); setLoading(false) })
    return () => unsub()
  }, [])

  const filtered = employees.filter(e => {
    if (filterType !== 'ALL' && e.type !== filterType) return false
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
        </select>
      </div>

      <div style={{ background: '#111e33', border: '1px solid #1e3050', borderRadius: 12, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #1e3050' }}>
              <th style={{ padding: '14px 20px', color: '#94a3b8', fontWeight: 600 }}>Employee</th>
              <th style={{ padding: '14px 20px', color: '#94a3b8', fontWeight: 600 }}>Type & Dept</th>
              <th style={{ padding: '14px 20px', color: '#94a3b8', fontWeight: 600 }}>Status</th>
              <th style={{ padding: '14px 20px', color: '#94a3b8', fontWeight: 600 }}>Project</th>
              <th style={{ padding: '14px 20px' }}></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} style={{ textAlign: 'center', padding: 40, color: '#64748b' }}><Loader size={24} className="spin" style={{ margin: '0 auto 12px' }}/>Loading directory...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={5} style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>No employees found.</td></tr>
            ) : filtered.map(e => {
              const st = STATUS_COLORS[e.employment_status] || STATUS_COLORS.active
              return (
                <tr key={e.id} style={{ borderBottom: '1px solid #1e3050', cursor: 'pointer' }} onClick={() => setSelectedEmp(e)} className="table-row-hover">
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
                  <td style={{ padding: '16px 20px', color: '#94a3b8' }}>
                    {e.assigned_project || 'Unassigned'}
                  </td>
                  <td style={{ padding: '16px 20px', textAlign: 'right' }}>
                    <ChevronRight size={18} color="#475569" />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <style>{`.spin { animation: spin 1s linear infinite; } @keyframes spin { 100% { transform: rotate(360deg); } } .table-row-hover:hover { background: rgba(255,255,255,0.02); }`}</style>
    </div>
  )
}
