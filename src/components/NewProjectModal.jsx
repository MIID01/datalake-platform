import { useEffect, useState } from 'react'
import { X, ChevronDown, Loader, Plus, Building2 } from 'lucide-react'
import { auth, CREATE_PROJECT_URL } from '../lib/firebase'
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore'
import SearchablePicker from './SearchablePicker'
import SamaMaterialityAssessment, { deriveDetermination } from './SamaMaterialityAssessment'

const LOCATIONS = ['CLIENT_OFFICE','DATALAKE_OFFICE','HYBRID','REMOTE_KSA','REMOTE_INTL']
const RATES = ['HOURLY','MONTHLY','FIXED']
const TIMESHEET_TYPES = ['CONSOLIDATED','PER_ENGINEER']

const s = {
  overlay: { position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',backdropFilter:'blur(6px)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:20 },
  modal: { background:'var(--bg-card,#fff)',border:'1px solid var(--border-card,#e0e0e0)',borderRadius:16,width:'100%',maxWidth:720,maxHeight:'90vh',overflow:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.3)' },
  header: { padding:'20px 28px',borderBottom:'1px solid var(--border-primary,#e5e7eb)',display:'flex',justifyContent:'space-between',alignItems:'center',position:'sticky',top:0,background:'var(--bg-card,#fff)',zIndex:2,borderRadius:'16px 16px 0 0' },
  body: { padding:'24px 28px' },
  section: { marginBottom:24 },
  secTitle: { fontSize:'0.75rem',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'var(--text-tertiary,#8898aa)',marginBottom:12 },
  label: { fontSize:'0.82rem',fontWeight:600,color:'var(--text-primary,#1A1A2E)',marginBottom:6,display:'block' },
  input: { width:'100%',padding:'10px 14px',border:'1px solid var(--border-primary,#E5E7EB)',borderRadius:8,fontSize:'0.88rem',fontFamily:'inherit',outline:'none',color:'var(--text-primary,#1A1A2E)',background:'var(--bg-surface,#f4f6f9)',boxSizing:'border-box' },
  select: { width:'100%',padding:'10px 14px',border:'1px solid var(--border-primary,#E5E7EB)',borderRadius:8,fontSize:'0.88rem',fontFamily:'inherit',outline:'none',color:'var(--text-primary,#1A1A2E)',background:'var(--bg-surface,#f4f6f9)',appearance:'none',cursor:'pointer',boxSizing:'border-box' },
  row2: { display:'grid',gridTemplateColumns:'1fr 1fr',gap:16 },
  field: { marginBottom:14 },
}

import { doc, updateDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'

export default function NewProjectModal({ onClose, onCreated, editProject }) {
  const [form, setForm] = useState({
    project_name: editProject?.project_name || '',
    client_id: editProject?.client_id || '',
    client_name: editProject?.client_name || '',
    po_number: editProject?.po_number || '',
    po_value_sar: editProject?.po_value_sar || '',
    start_date: editProject?.start_date ? new Date(editProject.start_date.seconds ? editProject.start_date.seconds * 1000 : editProject.start_date).toISOString().split('T')[0] : '',
    end_date: editProject?.end_date ? new Date(editProject.end_date.seconds ? editProject.end_date.seconds * 1000 : editProject.end_date).toISOString().split('T')[0] : '',
    client_approver_name: editProject?.client_approver_name || '',
    client_approver_email: editProject?.client_approver_email || '',
    work_location_type: editProject?.work_location_type || 'CLIENT_OFFICE',
    work_location_address: editProject?.work_location_address || '',
    rate_structure: editProject?.rate_structure || 'MONTHLY',
    rate_amount_sar: editProject?.rate_amount_sar || '',
    timesheet_type: editProject?.timesheet_type || 'CONSOLIDATED',
    notes: editProject?.notes || '',
  })
  // SAMA Materiality Assessment — managed by SamaMaterialityAssessment child
  // component via onChange. We keep its snapshot in form state and persist it
  // on submit.
  const [materiality, setMateriality] = useState(editProject?.sama_materiality || null)
  // Live clients list — the project must reference a client_id from this
  // collection so /ceo/clients edits cascade into invoices + timesheets.
  const [clients, setClients] = useState([])
  const [submitting,setSubmitting] = useState(false)
  const [error,setError] = useState('')
  const u = (k,v) => setForm(p=>({...p,[k]:v}))

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, 'clients'), orderBy('client_name')),
      snap => setClients(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      () => {},
    )
    return () => unsub()
  }, [])

  const canSubmit = form.project_name && form.client_id && form.client_name && form.po_number && form.po_value_sar &&
    form.start_date && form.end_date && form.client_approver_name && form.client_approver_email &&
    form.work_location_type && form.rate_structure && !submitting

  const handleSubmit = async () => {
    if (!canSubmit) return
    if (new Date(form.end_date) <= new Date(form.start_date)) { setError('End date must be after start date'); return }
    if (!/^\S+@\S+\.\S+$/.test(form.client_approver_email)) { setError('Invalid approver email'); return }
    setSubmitting(true); setError('')
    try {
      const user = auth.currentUser
      if (!user) { setError('Please sign in'); setSubmitting(false); return }

      const payload = {
        ...form,
        po_value_sar: Number(form.po_value_sar),
        rate_amount_sar: Number(form.rate_amount_sar) || null,
      }

      // Stamp the materiality assessment if any answer has been recorded.
      // The CEO signature is captured separately via ApprovalButton inside
      // the assessment section once the engagement has an id.
      if (materiality) {
        const det = deriveDetermination(materiality.answers)
        payload.sama_materiality = {
          ...materiality,
          determination: det.determination,
          noc_required: det.noc_required,
          noc_status: materiality.noc_status || (det.noc_required ? 'REQUESTED' : 'NONE'),
        }
      }

      if (editProject) {
        await updateDoc(doc(db, 'projects', editProject.id), payload)
        onCreated?.({ message: 'Project updated successfully' })
        onClose()
      } else {
        const idToken = await user.getIdToken()
        const res = await fetch(CREATE_PROJECT_URL, {
          method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${idToken}`},
          body: JSON.stringify(payload),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error||'Failed')
        onCreated?.(data)
        onClose()
      }
    } catch(err) { setError(err.message) } finally { setSubmitting(false) }
  }

  const Sel = ({value,onChange,options}) => (
    <div style={{position:'relative'}}>
      <select style={s.select} value={value} onChange={e=>onChange(e.target.value)}>
        {options.map(o=><option key={o} value={o}>{o.replace(/_/g,' ')}</option>)}
      </select>
      <ChevronDown size={16} style={{position:'absolute',right:12,top:'50%',transform:'translateY(-50%)',color:'#8898aa',pointerEvents:'none'}} />
    </div>
  )

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={e=>e.stopPropagation()}>
        <div style={s.header}>
          <div>
            <h2 style={{fontSize:'1.1rem',fontWeight:700,margin:0,color:'var(--text-primary,#1A1A2E)'}}>{editProject ? 'Edit Project' : 'New Project'}</h2>
            <div style={{fontSize:'0.68rem',color:'var(--text-tertiary,#8898aa)',marginTop:2}}>{editProject ? 'Update engagement details' : 'Create engagement when deal is won'}</div>
          </div>
          <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-tertiary)',display:'flex'}}><X size={20}/></button>
        </div>
        <div style={s.body}>
          {/* Project Identity */}
          <div style={s.section}>
            <div style={s.secTitle}>📋 Project Identity</div>
            <div style={s.field}><label style={s.label}>Project Name *</label><input style={s.input} value={form.project_name} onChange={e=>u('project_name',e.target.value)} placeholder="e.g. Data Platform Q2" /></div>
            <div style={{...s.row2,...s.field}}>
              <div>
                <label style={s.label}>Client * <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}>(from /ceo/clients)</span></label>
                {clients.length === 0 ? (
                  <div style={{ ...s.input, color: 'var(--text-tertiary)', cursor: 'default', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Building2 size={13} /> No clients yet — create one at /ceo/clients first.
                  </div>
                ) : (
                  <SearchablePicker
                    items={clients}
                    selectedId={form.client_id}
                    onSelect={(id, item) => {
                      // Stamp BOTH client_id and client_name so /ceo/clients edits cascade
                      // and historical rows that match by name still resolve.
                      setForm(p => ({ ...p, client_id: id, client_name: item?.client_name || '' }))
                    }}
                    getLabel={c => c.client_name || c.id}
                    getSubtitle={c => [c.industry, c.contact_email, c.vat_number].filter(Boolean).join(' · ')}
                    searchFields={c => [c.client_name, c.client_name_ar, c.contact_email, c.industry, c.vat_number]}
                    placeholder="Type to search clients…"
                    theme="light"
                    emptyText="No clients match."
                  />
                )}
              </div>
              <div><label style={s.label}>PO Number *</label><input style={s.input} value={form.po_number} onChange={e=>u('po_number',e.target.value)} placeholder="e.g. PO-2026-001" /></div>
            </div>
          </div>
          {/* PO Details */}
          <div style={s.section}>
            <div style={s.secTitle}>💰 PO & Schedule</div>
            <div style={{...s.row2,...s.field}}>
              <div><label style={s.label}>PO Value (SAR) *</label><input type="number" style={s.input} value={form.po_value_sar} onChange={e=>u('po_value_sar',e.target.value)} placeholder="e.g. 480000" /></div>
              <div><label style={s.label}>Rate Amount (SAR)</label><input type="number" style={s.input} value={form.rate_amount_sar} onChange={e=>u('rate_amount_sar',e.target.value)} placeholder="160000" /></div>
            </div>
            <div style={{...s.row2,...s.field}}>
              <div><label style={s.label}>Start Date *</label><input type="date" style={s.input} value={form.start_date} onChange={e=>u('start_date',e.target.value)} /></div>
              <div><label style={s.label}>End Date *</label><input type="date" style={s.input} value={form.end_date} onChange={e=>u('end_date',e.target.value)} /></div>
            </div>
            <div style={{...s.row2,...s.field}}>
              <div><label style={s.label}>Rate Structure *</label><Sel value={form.rate_structure} onChange={v=>u('rate_structure',v)} options={RATES}/></div>
              <div><label style={s.label}>Timesheet Type</label><Sel value={form.timesheet_type} onChange={v=>u('timesheet_type',v)} options={TIMESHEET_TYPES}/></div>
            </div>
          </div>
          {/* Approver */}
          <div style={s.section}>
            <div style={s.secTitle}>👤 Client Approver</div>
            <div style={{...s.row2,...s.field}}>
              <div><label style={s.label}>Approver Name *</label><input style={s.input} value={form.client_approver_name} onChange={e=>u('client_approver_name',e.target.value)} placeholder="Full name" /></div>
              <div><label style={s.label}>Approver Email *</label><input type="email" style={s.input} value={form.client_approver_email} onChange={e=>u('client_approver_email',e.target.value)} placeholder="approver@client.com" /></div>
            </div>
          </div>
          {/* Location */}
          <div style={s.section}>
            <div style={s.secTitle}>📍 Work Location</div>
            <div style={{...s.row2,...s.field}}>
              <div><label style={s.label}>Location Type *</label><Sel value={form.work_location_type} onChange={v=>u('work_location_type',v)} options={LOCATIONS}/></div>
              <div><label style={s.label}>Address (optional)</label><input style={s.input} value={form.work_location_address} onChange={e=>u('work_location_address',e.target.value)} placeholder="Client site, City" /></div>
            </div>
          </div>
          {/* Notes */}
          <div style={s.field}><label style={s.label}>Notes</label><textarea style={{...s.input,minHeight:60,resize:'vertical'}} value={form.notes} onChange={e=>u('notes',e.target.value)} placeholder="Additional context..." /></div>

          {/* SAMA Materiality Assessment — required for every engagement
              before it can go ACTIVE. CEO signature is captured here once
              the project has been saved (editProject.id) so the
              approval_evidence subcollection has somewhere to live. */}
          <SamaMaterialityAssessment
            engagementId={editProject?.id || null}
            engagementCollection="projects"
            initial={editProject?.sama_materiality}
            onChange={setMateriality}
          />

          {error && <div style={{padding:'10px 16px',background:'rgba(192,57,43,0.1)',border:'1px solid rgba(192,57,43,0.3)',borderRadius:8,color:'#C0392B',fontSize:'0.82rem',marginBottom:16,marginTop:16}}>{error}</div>}

          <div style={{display:'flex',justifyContent:'flex-end',gap:10,paddingTop:8,borderTop:'1px solid var(--border-primary,#e5e7eb)'}}>
            <button onClick={onClose} style={{padding:'10px 20px',border:'1px solid var(--border-primary,#E5E7EB)',borderRadius:8,background:'transparent',color:'var(--text-secondary)',fontWeight:600,fontSize:'0.85rem',cursor:'pointer',fontFamily:'inherit'}}>Cancel</button>
            <button onClick={handleSubmit} disabled={!canSubmit} style={{padding:'10px 24px',border:'none',borderRadius:8,background:canSubmit?'#EF5829':'#ccc',color:'#fff',fontWeight:700,fontSize:'0.85rem',fontFamily:'inherit',cursor:canSubmit?'pointer':'default',display:'flex',alignItems:'center',gap:8,boxShadow:canSubmit?'0 2px 8px rgba(239,88,41,0.3)':'none'}}>
              {submitting?<><Loader size={16} className="spin"/>{editProject ? 'Saving...' : 'Creating...'}</>:<><Plus size={16}/>{editProject ? 'Save Changes' : 'Create Project'}</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
