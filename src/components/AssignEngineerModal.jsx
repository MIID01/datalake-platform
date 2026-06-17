import { useState, useEffect } from 'react'
import { X, Loader, UserPlus } from 'lucide-react'
import { auth, db, ASSIGN_ENGINEER_URL } from '../lib/firebase'
import { collection, query, where, getDocs } from 'firebase/firestore'
import SearchablePicker from './SearchablePicker'

export default function AssignEngineerModal({ project, onClose, onAssigned }) {
  const startDefault = project.start_date?.toDate ? project.start_date.toDate().toISOString().split('T')[0] : ''
  const endDefault = project.end_date?.toDate ? project.end_date.toDate().toISOString().split('T')[0] : ''

  const [engineers, setEngineers] = useState([])
  const [loadingEngs, setLoadingEngs] = useState(true)
  
  useEffect(() => {
    const fetchEngs = async () => {
      try {
        // Canonical employee query — every ACTIVE employee, same source as the HR
        // roster. (Was where('type','==','deployed'), which silently hid the 3
        // contractors + 2 internal staff: they could never be assigned to a
        // project, so their timesheets had no PM to route to.)
        const q = query(collection(db, 'employees'), where('employment_status', '==', 'ACTIVE'))
        const snap = await getDocs(q)
        let emps = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        
        try {
          const aq = query(collection(db, 'engineer_project_assignments'), where('project_id', '==', project.project_id), where('status', '==', 'ACTIVE'))
          const asnap = await getDocs(aq)
          const assignedIds = asnap.docs.map(d => d.data().engineer_id)
          emps = emps.filter(e => !assignedIds.includes(e.id))
        } catch (e) { console.warn("Could not filter assignments", e) }

        setEngineers(emps)
      } catch (err) { console.warn(err) }
      setLoadingEngs(false)
    }
    fetchEngs()
  }, [])

  const [form, setForm] = useState({
    engineer_id:'', assignment_start_date:startDefault,
    assignment_end_date:endDefault, allocation_percentage:'100', notes:'',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const u = (k,v) => setForm(p=>({...p,[k]:v}))

  const selectedEng = engineers.find(e=>e.employee_id===form.engineer_id || e.id === form.engineer_id)
  const canSubmit = form.engineer_id && form.assignment_start_date && form.assignment_end_date && !submitting


  const handleSubmit = async () => {
    if (!canSubmit || !selectedEng) return
    setSubmitting(true); setError('')
    try {
      const user = auth.currentUser
      if (!user) { setError('Please sign in'); setSubmitting(false); return }
      const idToken = await user.getIdToken()
      const res = await fetch(ASSIGN_ENGINEER_URL, {
        method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${idToken}`},
        body: JSON.stringify({
          project_id: project.project_id, engineer_id: selectedEng.id,
          engineer_name: selectedEng.full_name, engineer_email: selectedEng.email,
          role_on_project: selectedEng.job_title || 'Engineer',
          assignment_start_date: new Date(form.assignment_start_date).toISOString(),
          assignment_end_date: new Date(form.assignment_end_date).toISOString(),
          allocation_percentage: Number(form.allocation_percentage)||100,
          notes: form.notes||null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error||'Failed')
      onAssigned?.(data)
      onClose()
    } catch(err) { setError(err.message) } finally { setSubmitting(false) }
  }

  const st = {
    overlay: { position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',backdropFilter:'blur(6px)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:20 },
    modal: { background:'var(--bg-card,#fff)',border:'1px solid var(--border-card,#e0e0e0)',borderRadius:16,width:'100%',maxWidth:520,boxShadow:'0 20px 60px rgba(0,0,0,0.3)' },
    input: { width:'100%',padding:'10px 14px',border:'1px solid var(--border-primary,#E5E7EB)',borderRadius:8,fontSize:'0.88rem',fontFamily:'inherit',outline:'none',color:'var(--text-primary,#1A1A2E)',background:'var(--bg-surface,#f4f6f9)',boxSizing:'border-box' },
    label: { fontSize:'0.82rem',fontWeight:600,color:'var(--text-primary,#1A1A2E)',marginBottom:6,display:'block' },
    field: { marginBottom:14 },
  }

  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} onClick={e=>e.stopPropagation()}>
        <div style={{padding:'20px 28px',borderBottom:'1px solid var(--border-primary,#e5e7eb)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div>
            <h2 style={{fontSize:'1.1rem',fontWeight:700,margin:0,color:'var(--text-primary)'}}>Assign Engineer</h2>
            <div style={{fontSize:'0.72rem',color:'var(--text-tertiary)',marginTop:2}}>{project.project_name} · {project.client_name}</div>
          </div>
          <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-tertiary)',display:'flex'}}><X size={20}/></button>
        </div>
        <div style={{padding:'24px 28px'}}>
          <div style={st.field}>
            <label style={st.label}>Engineer *</label>
            <SearchablePicker
              items={engineers}
              selectedId={form.engineer_id}
              onSelect={(id) => u('engineer_id', id)}
              getLabel={e => e.full_name || e.name || e.id}
              getSubtitle={e => [e.employee_id, e.job_title, e.email].filter(Boolean).join(' · ')}
              searchFields={e => [e.full_name, e.name, e.employee_id, e.email, e.job_title]}
              placeholder={loadingEngs ? 'Loading employees…' : 'Type to search: name, DLSA id, email, job title…'}
              theme="light"
              disabled={loadingEngs}
              emptyText="No engineers available."
            />
          </div>
          <div style={st.field}><label style={st.label}>Role on Project</label><input style={{...st.input, background: 'rgba(255,255,255,0.05)', color: 'var(--text-tertiary)', cursor: 'not-allowed'}} value={selectedEng ? selectedEng.job_title || 'Engineer' : ''} disabled placeholder="Auto-filled from employee profile" /></div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,...st.field}}>
            <div><label style={st.label}>Start Date *</label><input type="date" style={st.input} value={form.assignment_start_date} onChange={e=>u('assignment_start_date',e.target.value)} /></div>
            <div><label style={st.label}>End Date *</label><input type="date" style={st.input} value={form.assignment_end_date} onChange={e=>u('assignment_end_date',e.target.value)} /></div>
          </div>
          <div style={st.field}><label style={st.label}>Allocation %</label><input type="number" min="1" max="100" style={st.input} value={form.allocation_percentage} onChange={e=>u('allocation_percentage',e.target.value)} /></div>
          <div style={st.field}><label style={st.label}>Notes</label><textarea style={{...st.input,minHeight:50,resize:'vertical'}} value={form.notes} onChange={e=>u('notes',e.target.value)} placeholder="Optional notes..." /></div>

          {error && <div style={{padding:'10px 16px',background:'rgba(192,57,43,0.1)',border:'1px solid rgba(192,57,43,0.3)',borderRadius:8,color:'#C0392B',fontSize:'0.82rem',marginBottom:16}}>{error}</div>}

          <div style={{display:'flex',justifyContent:'flex-end',gap:10,paddingTop:8,borderTop:'1px solid var(--border-primary,#e5e7eb)'}}>
            <button onClick={onClose} style={{padding:'10px 20px',border:'1px solid var(--border-primary,#E5E7EB)',borderRadius:8,background:'transparent',color:'var(--text-secondary)',fontWeight:600,fontSize:'0.85rem',cursor:'pointer',fontFamily:'inherit'}}>Cancel</button>
            <button onClick={handleSubmit} disabled={!canSubmit} style={{padding:'10px 24px',border:'none',borderRadius:8,background:canSubmit?'#34BF3A':'#ccc',color:'#fff',fontWeight:700,fontSize:'0.85rem',fontFamily:'inherit',cursor:canSubmit?'pointer':'default',display:'flex',alignItems:'center',gap:8,boxShadow:canSubmit?'0 2px 8px rgba(52,191,58,0.3)':'none'}}>
              {submitting?<><Loader size={16} className="spin"/>Assigning...</>:<><UserPlus size={16}/>Assign</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
