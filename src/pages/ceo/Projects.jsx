import { useState, useMemo, useEffect } from 'react'
import { Briefcase, Plus, DollarSign, Users, Clock, ChevronDown, CheckCircle, FolderPlus, UserPlus, MapPin } from 'lucide-react'
import { collection, onSnapshot, query, orderBy, where } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import NewProjectModal from '../../components/NewProjectModal'
import AssignEngineerModal from '../../components/AssignEngineerModal'

const STATUS_COLORS = {
  ACTIVE: { label:'Active', color:'#34BF3A', bg:'rgba(52,191,58,0.12)' },
  PAUSED: { label:'Paused', color:'#F39C12', bg:'rgba(243,156,18,0.12)' },
  COMPLETED: { label:'Completed', color:'#8898aa', bg:'rgba(136,152,170,0.12)' },
  CANCELLED: { label:'Cancelled', color:'#C0392B', bg:'rgba(192,57,43,0.12)' },
}

function fmtDate(d) { if (!d) return '—'; const dt = d?.toDate ? d.toDate() : new Date(d); return dt.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) }
function fmtSAR(n) { return n ? `SAR ${Number(n).toLocaleString()}` : '—' }

export default function Projects() {
  const [projects, setProjects] = useState([])
  const [assignments, setAssignments] = useState([])
  const [showNewModal, setShowNewModal] = useState(false)
  const [editProject, setEditProject] = useState(null)
  const [assignProject, setAssignProject] = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  const [toast, setToast] = useState(null)

  useEffect(() => {
    try {
      const q = query(collection(db,'projects'), orderBy('created_at','desc'))
      const unsub = onSnapshot(q, snap => setProjects(snap.docs.map(d=>({id:d.id,...d.data()}))), err => console.warn('Projects listener:', err.message))
      return () => unsub()
    } catch(e) { console.warn(e) }
  }, [])

  useEffect(() => {
    try {
      const q = query(collection(db,'engineer_project_assignments'), where('status','==','ACTIVE'))
      const unsub = onSnapshot(q, snap => setAssignments(snap.docs.map(d=>({id:d.id,...d.data()}))), err => console.warn('Assignments listener:', err.message))
      return () => unsub()
    } catch(e) { console.warn(e) }
  }, [])

  const getAssignments = (pid) => assignments.filter(a=>a.project_id===pid)

  const stats = useMemo(() => {
    const active = projects.filter(p=>p.status==='ACTIVE')
    const totalPO = active.reduce((s,p)=>s+(p.po_value_sar||0), 0)
    const uniqueEngineers = new Set(assignments.map(a=>a.engineer_id)).size
    const now = Date.now()
    const ending30 = active.filter(p => { const end = p.end_date?.toDate ? p.end_date.toDate() : new Date(p.end_date); return end.getTime() - now < 30*86400000 && end.getTime() > now }).length
    return { active: active.length, totalPO, engineers: uniqueEngineers, ending30 }
  }, [projects, assignments])

  const showToast = (msg) => { setToast(msg); setTimeout(()=>setToast(null), 4000) }

  return (
    <div>
      {/* Header */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:24}}>
        <div>
          <h1 style={{fontSize:'1.5rem',fontWeight:700,margin:0}}>Projects</h1>
          <p style={{fontSize:'0.78rem',color:'var(--text-tertiary)',marginTop:4}}>Manage active engagements, assignments, and approvers</p>
        </div>
        <button onClick={()=>setShowNewModal(true)} style={{background:'#EF5829',display:'flex',alignItems:'center',gap:8,padding:'10px 20px',border:'none',borderRadius:8,color:'#fff',fontWeight:700,fontSize:'0.85rem',fontFamily:'inherit',cursor:'pointer',boxShadow:'0 2px 8px rgba(239,88,41,0.3)'}}>
          <Plus size={18}/> New Project
        </button>
      </div>

      {/* Toast */}
      {toast && <div className="animate-fade-in-up" style={{padding:'12px 20px',background:'rgba(52,191,58,0.12)',border:'1px solid rgba(52,191,58,0.3)',borderRadius:'var(--radius-md)',marginBottom:16,display:'flex',alignItems:'center',gap:10,fontSize:'0.82rem',color:'#34BF3A'}}><CheckCircle size={16}/> {toast}</div>}

      {/* KPIs */}
      <div className="grid-4" style={{marginBottom:24}}>
        {[
          { value:stats.active, label:'Active Projects', color:'#1598CC', icon:Briefcase },
          { value:fmtSAR(stats.totalPO), label:'Total PO Value', color:'#022873', icon:DollarSign },
          { value:stats.engineers, label:'Engineers Deployed', color:'#34BF3A', icon:Users },
          { value:stats.ending30, label:'Ending in 30 Days', color:'#EF5829', icon:Clock },
        ].map((s,i)=>{
          const Icon = s.icon
          return (
            <div key={i} className="stat-card animate-fade-in-up" style={{'--stat-accent':s.color,animationDelay:`${i*0.05}s`}}>
              <div className="stat-label"><Icon size={14} style={{verticalAlign:-2,marginRight:4}}/>{s.label}</div>
              <div className="stat-value" style={{color:s.color,fontSize:typeof s.value==='string'?'1.1rem':undefined}}>{s.value}</div>
            </div>
          )
        })}
      </div>

      {/* Projects List */}
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {projects.length === 0 && (
          <div className="card" style={{textAlign:'center',padding:'48px 20px',color:'var(--text-tertiary)'}}>
            <FolderPlus size={40} style={{marginBottom:12,opacity:0.3}} />
            <div style={{fontSize:'1rem',fontWeight:600,marginBottom:6,color:'var(--text-secondary)'}}>No projects yet</div>
            <div style={{fontSize:'0.82rem'}}>Create your first project when you win a deal</div>
          </div>
        )}

        {projects.map((p,i)=>{
          const isExpanded = expandedId === p.project_id
          const pAssignments = getAssignments(p.project_id)
          const st = STATUS_COLORS[p.status] || STATUS_COLORS.ACTIVE
          return (
            <div key={p.project_id} className="animate-fade-in-up" style={{animationDelay:`${i*0.03}s`,background:'var(--bg-card)',border:'1px solid var(--border-card)',borderRadius:'var(--radius-lg)',borderLeft:`4px solid ${st.color}`,boxShadow:'var(--shadow-card)'}}>
              <div style={{padding:'16px 20px',cursor:'pointer',display:'flex',alignItems:'center',gap:14}} onClick={()=>setExpandedId(isExpanded?null:p.project_id)}>
                <div style={{width:36,height:36,borderRadius:'var(--radius-md)',background:`${st.color}15`,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                  <Briefcase size={16} color={st.color} />
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:3}}>
                    <span style={{fontFamily:'var(--font-mono)',fontSize:'0.68rem',color:'var(--text-tertiary)'}}>{p.project_id}</span>
                    <span style={{padding:'1px 8px',borderRadius:12,fontSize:'0.62rem',fontWeight:600,background:st.bg,color:st.color}}>{st.label}</span>
                    <span style={{fontSize:'0.62rem',color:'var(--text-tertiary)'}}>PO: {p.po_number}</span>
                  </div>
                  <div style={{fontWeight:600,fontSize:'0.9rem',color:'var(--text-primary)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{p.project_name}</div>
                  <div style={{fontSize:'0.72rem',color:'var(--text-tertiary)',marginTop:2}}>{p.client_name} · {fmtSAR(p.po_value_sar)} · {pAssignments.length} engineer{pAssignments.length!==1?'s':''}</div>
                </div>
                <div style={{textAlign:'right',flexShrink:0}}>
                  <div style={{fontSize:'0.72rem',color:'var(--text-tertiary)'}}>{fmtDate(p.start_date)} — {fmtDate(p.end_date)}</div>
                  <div style={{fontSize:'0.68rem',color:'var(--text-tertiary)',marginTop:2}}><MapPin size={11} style={{verticalAlign:-1}}/> {(p.work_location_type||'').replace(/_/g,' ')}</div>
                </div>
                <ChevronDown size={16} color="var(--text-tertiary)" style={{flexShrink:0,transition:'transform 0.2s',transform:isExpanded?'rotate(180deg)':'none'}} />
              </div>

              {isExpanded && (
                <div style={{padding:'0 20px 16px 70px',borderTop:'1px solid var(--border-primary)',paddingTop:14,animation:'fadeIn 0.2s ease'}}>
                  <div style={{display:'flex',gap:20,fontSize:'0.72rem',color:'var(--text-tertiary)',marginBottom:12,flexWrap:'wrap'}}>
                    <span>Approver: <strong style={{color:'var(--text-primary)'}}>{p.client_approver_name}</strong> ({p.client_approver_email})</span>
                    <span>Rate: {p.rate_structure} {p.rate_amount_sar ? `— SAR ${Number(p.rate_amount_sar).toLocaleString()}` : ''}</span>
                    <span>Timesheet: {p.timesheet_type}</span>
                  </div>

                  {pAssignments.length > 0 && (
                    <div style={{marginBottom:12}}>
                      <div style={{fontSize:'0.72rem',fontWeight:700,color:'var(--text-tertiary)',marginBottom:8,textTransform:'uppercase',letterSpacing:'0.06em'}}>Assigned Engineers</div>
                      {pAssignments.map(a=>(
                        <div key={a.assignment_id} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 12px',background:'var(--bg-surface)',borderRadius:8,marginBottom:4,fontSize:'0.82rem'}}>
                          <div style={{width:28,height:28,borderRadius:'50%',background:'linear-gradient(135deg,#1598CC,#022873)',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontWeight:700,fontSize:'0.65rem',flexShrink:0}}>
                            {a.engineer_name?.split(' ').map(n=>n[0]).join('').slice(0,2)}
                          </div>
                          <div style={{flex:1}}>
                            <div style={{fontWeight:600,color:'var(--text-primary)'}}>{a.engineer_name}</div>
                            <div style={{fontSize:'0.68rem',color:'var(--text-tertiary)'}}>{a.role_on_project} · {a.allocation_percentage}% · {fmtDate(a.assignment_start_date)} — {fmtDate(a.assignment_end_date)}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{display:'flex', gap: 12, alignItems: 'center'}}>
                    <button onClick={(e)=>{e.stopPropagation();setAssignProject(p)}} className="btn btn-sm btn-primary" style={{background:'#1598CC',display:'flex',alignItems:'center',gap:6}}>
                      <UserPlus size={14}/> Assign Engineer
                    </button>
                    <button onClick={(e)=>{e.stopPropagation(); setEditProject(p)}} className="btn btn-sm btn-outline">
                      Edit
                    </button>
                    <button onClick={async (e)=>{
                      e.stopPropagation(); 
                      if(window.confirm('Delete this project?')) {
                        try {
                          await import('firebase/firestore').then(m => m.deleteDoc(m.doc(db, 'projects', p.id)))
                          showToast('Project deleted')
                        } catch(err) { console.error(err) }
                      }
                    }} className="btn btn-sm" style={{color: 'var(--red)', border: '1px solid var(--red)'}}>
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {showNewModal && <NewProjectModal onClose={()=>setShowNewModal(false)} onCreated={d=>showToast(`Project ${d.project_id} created successfully`)} />}
      {editProject && <NewProjectModal onClose={()=>setEditProject(null)} editProject={editProject} onCreated={d=>showToast(d.message || 'Project updated')} />}
      {assignProject && <AssignEngineerModal project={assignProject} onClose={()=>setAssignProject(null)} onAssigned={d=>showToast(d.message)} />}
    </div>
  )
}
