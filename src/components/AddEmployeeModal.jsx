import { useState } from 'react'
import { X, Loader } from 'lucide-react'
import { doc, setDoc, updateDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'

const s = {
  overlay: { position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',backdropFilter:'blur(4px)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:20 },
  modal: { background:'var(--bg-card,#111e33)',border:'1px solid var(--border-card,#1e3050)',borderRadius:16,width:'100%',maxWidth:600,maxHeight:'90vh',overflow:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.4)',color:'#e2e8f0',fontFamily:"'DM Sans',sans-serif" },
  header: { padding:'20px 28px',borderBottom:'1px solid #1e3050',display:'flex',justifyContent:'space-between',alignItems:'center',position:'sticky',top:0,background:'var(--bg-card,#111e33)',zIndex:2 },
  body: { padding:'24px 28px' },
  label: { fontSize:'0.82rem',fontWeight:600,color:'#94a3b8',marginBottom:6,display:'block' },
  input: { width:'100%',padding:'10px 14px',border:'1px solid #1e3050',borderRadius:8,fontSize:'0.88rem',fontFamily:'inherit',outline:'none',color:'#fff',background:'#0d1829',boxSizing:'border-box' },
  row2: { display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:16 },
  field: { marginBottom:16 }
}

export default function AddEmployeeModal({ onClose, initialData, isEdit }) {
  const [form, setForm] = useState({
    full_name: initialData?.full_name || '',
    email: initialData?.email || '',
    phone: initialData?.phone || '',
    department: initialData?.department || 'Engineering',
    type: initialData?.type || 'deployed',
    job_title: initialData?.job_title || '',
    salary: initialData?.salary || '',
    contract_start_date: initialData?.contract_start_date || new Date().toISOString().split('T')[0],
    assigned_project: initialData?.assigned_project || ''
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const u = (k,v) => setForm(p => ({...p, [k]: v}))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if(!form.full_name || !form.email) { setError('Name and email are required'); return }
    setLoading(true); setError('')
    try {
      const dataToSave = {
        full_name: form.full_name,
        email: form.email,
        phone: form.phone,
        department: form.department,
        type: form.type,
        job_title: form.job_title,
        salary: Number(form.salary),
        contract_start_date: form.contract_start_date,
        assigned_project: form.assigned_project || null,
        updated_at: new Date()
      }

      if (isEdit && initialData?.id) {
        await updateDoc(doc(db, 'employees', initialData.id), dataToSave)
      } else {
        const empId = `DLSA${Math.floor(1000 + Math.random() * 9000)}`
        dataToSave.employee_id = empId
        dataToSave.employment_status = 'PENDING_APPROVAL'
        dataToSave.created_at = new Date()
        await setDoc(doc(db, 'employees', empId), dataToSave)
      }
      onClose(true)
    } catch(err) {
      console.error(err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={s.overlay} onClick={()=>onClose(false)}>
      <div style={s.modal} onClick={e=>e.stopPropagation()}>
        <div style={s.header}>
          <h2 style={{fontSize:'1.1rem',fontWeight:700,margin:0}}>{isEdit ? 'Edit Employee' : 'Add Employee'}</h2>
          <button onClick={()=>onClose(false)} style={{background:'none',border:'none',cursor:'pointer',color:'#94a3b8',display:'flex'}}><X size={20}/></button>
        </div>
        <form style={s.body} onSubmit={handleSubmit}>
          {error && <div style={{padding:'10px',background:'rgba(192,57,43,0.1)',border:'1px solid rgba(192,57,43,0.3)',color:'#e74c3c',borderRadius:8,marginBottom:16,fontSize:'0.85rem'}}>{error}</div>}
          
          <div style={s.row2}>
            <div><label style={s.label}>Full Name *</label><input required style={s.input} value={form.full_name} onChange={e=>u('full_name',e.target.value)} /></div>
            <div><label style={s.label}>Email Address *</label><input required type="email" style={s.input} value={form.email} onChange={e=>u('email',e.target.value)} /></div>
          </div>

          <div style={s.row2}>
            <div><label style={s.label}>Phone Number</label><input style={s.input} value={form.phone} onChange={e=>u('phone',e.target.value)} /></div>
            <div>
              <label style={s.label}>Employee Type</label>
              <select style={s.input} value={form.type} onChange={e=>u('type',e.target.value)}>
                <option value="deployed">Deployed (Billable)</option>
                <option value="internal">Internal (HQ)</option>
                <option value="contractor">Contractor</option>
              </select>
            </div>
          </div>

          <div style={s.row2}>
            <div><label style={s.label}>Department</label><input style={s.input} value={form.department} onChange={e=>u('department',e.target.value)} /></div>
            <div><label style={s.label}>Job Title</label><input style={s.input} value={form.job_title} onChange={e=>u('job_title',e.target.value)} /></div>
          </div>

          <div style={s.row2}>
            <div><label style={s.label}>Monthly Salary (SAR)</label><input type="number" style={s.input} value={form.salary} onChange={e=>u('salary',e.target.value)} /></div>
            <div><label style={s.label}>Contract Start Date</label><input type="date" style={s.input} value={form.contract_start_date} onChange={e=>u('contract_start_date',e.target.value)} /></div>
          </div>

          {form.type === 'deployed' && (
            <div style={s.field}>
              <label style={s.label}>Assigned Project</label>
              <input style={s.input} placeholder="e.g. PRJ-2026-001" value={form.assigned_project} onChange={e=>u('assigned_project',e.target.value)} />
            </div>
          )}

          <div style={{display:'flex',justifyContent:'flex-end',gap:12,marginTop:24}}>
            <button type="button" onClick={()=>onClose(false)} style={{padding:'10px 20px',background:'transparent',border:'1px solid #1e3050',color:'#94a3b8',borderRadius:8,cursor:'pointer'}}>Cancel</button>
            <button type="submit" disabled={loading} style={{display:'flex',alignItems:'center',gap:8,padding:'10px 24px',background:'#1598CC',border:'none',color:'#fff',borderRadius:8,fontWeight:700,cursor:loading?'default':'pointer'}}>
              {loading && <Loader size={16} className="spin" />}
              {loading ? 'Saving...' : (isEdit ? 'Save Changes' : 'Create Employee')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
