import { useState, useEffect } from 'react'
import { collection, query, where, onSnapshot, addDoc, updateDoc, doc, serverTimestamp, getDocs } from 'firebase/firestore'
import { db, auth } from '../../lib/firebase'
import { BookOpen, CheckCircle, Clock, AlertTriangle, Loader, Award, ChevronDown, FileText } from 'lucide-react'

const STATUS_CONFIG = {
  NOT_STARTED: { label: 'Not Started', color: '#78909C', bg: 'rgba(120,144,156,0.12)', icon: Clock },
  IN_PROGRESS: { label: 'In Progress', color: '#1598CC', bg: 'rgba(21,152,204,0.12)', icon: BookOpen },
  COMPLETED: { label: 'Completed', color: '#34BF3A', bg: 'rgba(52,191,58,0.12)', icon: CheckCircle },
}

// Default mandatory training modules
const DEFAULT_MODULES = [
  { module_id: 'PDPL-AWARENESS', title: 'PDPL Data Protection Awareness', description: 'Understanding Saudi Arabia\'s Personal Data Protection Law (PDPL) and your obligations as a Datalake employee handling client data.', category: 'Compliance', mandatory: true },
  { module_id: 'CODE-OF-CONDUCT', title: 'Code of Conduct', description: 'Professional standards, ethics guidelines, and expected behavior for all Datalake staff augmentation engineers.', category: 'HR Policy', mandatory: true },
  { module_id: 'INFO-SEC', title: 'Information Security', description: 'Cybersecurity best practices, password policies, data classification, and incident reporting procedures.', category: 'Security', mandatory: true },
  { module_id: 'ANTI-BRIBERY', title: 'Anti-Bribery & Anti-Corruption', description: 'Understanding anti-bribery laws, gift policies, conflict of interest reporting, and whistleblower protections.', category: 'Compliance', mandatory: true },
  { module_id: 'WORKPLACE-SAFETY', title: 'Workplace Health & Safety', description: 'Emergency procedures, first aid, ergonomics, and workplace hazard awareness for client site deployments.', category: 'Safety', mandatory: true },
  { module_id: 'CLIENT-CONDUCT', title: 'Client Site Conduct', description: 'Professional behavior expectations when deployed at client sites, confidentiality protocols, and client communication guidelines.', category: 'Professional', mandatory: true },
]

export default function Training() {
  const [completions, setCompletions] = useState([])
  const [expandedModule, setExpandedModule] = useState(null)
  const [submitting, setSubmitting] = useState(null)
  const [toast, setToast] = useState(null)

  const [userEmail, setUserEmail] = useState(null)
  const [userName, setUserName] = useState('')

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(user => {
      if (user) { setUserEmail(user.email); setUserName(user.displayName || user.email) }
    })
    return () => unsub()
  }, [])

  // Load completions for this user
  useEffect(() => {
    if (!userEmail) return
    const q = query(collection(db, 'training_completions'), where('engineer_email', '==', userEmail))
    const unsub = onSnapshot(q, snap => {
      setCompletions(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    }, err => console.warn('Training listener:', err.message))
    return () => unsub()
  }, [userEmail])

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type }); setTimeout(() => setToast(null), 4000)
  }

  const getModuleStatus = (moduleId) => {
    const comp = completions.find(c => c.module_id === moduleId)
    if (comp?.status === 'COMPLETED') return 'COMPLETED'
    if (comp?.status === 'IN_PROGRESS') return 'IN_PROGRESS'
    return 'NOT_STARTED'
  }

  const handleAcknowledge = async (module) => {
    setSubmitting(module.module_id)
    try {
      // Check if completion record exists
      const existing = completions.find(c => c.module_id === module.module_id)
      if (existing) {
        await updateDoc(doc(db, 'training_completions', existing.id), {
          status: 'COMPLETED',
          completed_at: serverTimestamp(),
          updated_at: serverTimestamp(),
        })
      } else {
        await addDoc(collection(db, 'training_completions'), {
          module_id: module.module_id,
          module_title: module.title,
          engineer_email: userEmail,
          engineer_name: userName,
          status: 'COMPLETED',
          started_at: serverTimestamp(),
          completed_at: serverTimestamp(),
          created_at: serverTimestamp(),
          updated_at: serverTimestamp(),
        })
      }
      showToast(`✅ "${module.title}" marked as complete`)
      setExpandedModule(null)
    } catch (err) {
      showToast(`Failed: ${err.message}`, 'error')
    }
    setSubmitting(null)
  }

  const completedCount = DEFAULT_MODULES.filter(m => getModuleStatus(m.module_id) === 'COMPLETED').length
  const totalCount = DEFAULT_MODULES.length
  const progress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

  return (
    <div>
      {toast && (
        <div className="animate-fade-in-up" style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          padding: '12px 20px', borderRadius: 10, fontSize: '0.85rem', fontWeight: 600,
          background: toast.type === 'error' ? 'rgba(192,57,43,0.95)' : 'rgba(52,191,58,0.95)',
          color: '#fff', boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          {toast.type === 'error' ? <AlertTriangle size={16} /> : <CheckCircle size={16} />} {toast.msg}
        </div>
      )}

      <div className="flex-between" style={{ marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Training & Compliance</h1>
          <p style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem', marginTop: 4 }}>
            Complete all mandatory training modules to maintain compliance
          </p>
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px 20px', borderRadius: 12,
          background: progress === 100 ? 'rgba(52,191,58,0.1)' : 'rgba(243,156,18,0.1)',
          border: `1px solid ${progress === 100 ? 'rgba(52,191,58,0.2)' : 'rgba(243,156,18,0.2)'}`,
        }}>
          <Award size={20} color={progress === 100 ? '#34BF3A' : '#F39C12'} />
          <div>
            <div style={{ fontWeight: 700, fontSize: '1.1rem', color: progress === 100 ? '#34BF3A' : '#F39C12' }}>
              {completedCount}/{totalCount}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>Completed</div>
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Overall Progress</span>
          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: progress === 100 ? '#34BF3A' : '#1598CC' }}>
            {progress}%
          </span>
        </div>
        <div style={{ height: 8, borderRadius: 4, background: 'var(--border-primary)', overflow: 'hidden' }}>
          <div style={{
            width: `${progress}%`, height: '100%', borderRadius: 4,
            background: progress === 100 ? '#34BF3A' : 'linear-gradient(90deg, #1598CC, #34BF3A)',
            transition: 'width 0.5s ease',
          }} />
        </div>
      </div>

      {/* Module List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {DEFAULT_MODULES.map((module, i) => {
          const status = getModuleStatus(module.module_id)
          const sc = STATUS_CONFIG[status]
          const isExpanded = expandedModule === module.module_id
          const StatusIcon = sc.icon

          return (
            <div key={module.module_id}
              className={`card animate-fade-in-up stagger-${i + 1}`}
              style={{
                borderLeft: `4px solid ${sc.color}`,
                cursor: 'pointer', transition: 'all 0.2s',
              }}
              onClick={() => setExpandedModule(isExpanded ? null : module.module_id)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                  background: sc.bg,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <StatusIcon size={18} color={sc.color} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>{module.title}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: 2 }}>
                    {module.category} · {module.mandatory ? 'Mandatory' : 'Optional'}
                  </div>
                </div>
                <span style={{
                  padding: '4px 12px', borderRadius: 12, fontSize: '0.72rem',
                  fontWeight: 600, background: sc.bg, color: sc.color,
                }}>
                  {sc.label}
                </span>
                <ChevronDown size={16} color="var(--text-tertiary)" style={{
                  transition: 'transform 0.2s',
                  transform: isExpanded ? 'rotate(180deg)' : 'none',
                }} />
              </div>

              {/* Expanded Content */}
              {isExpanded && (
                <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border-primary)' }}
                  onClick={e => e.stopPropagation()}>
                  <div style={{
                    padding: '14px 18px', borderRadius: 8,
                    background: 'var(--bg-surface)', border: '1px solid var(--border-primary)',
                    fontSize: '0.85rem', lineHeight: 1.7, color: 'var(--text-secondary)',
                    marginBottom: 16,
                  }}>
                    <FileText size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
                    {module.description}
                  </div>

                  {status === 'COMPLETED' ? (
                    <div style={{
                      padding: '10px 16px', borderRadius: 8,
                      background: 'rgba(52,191,58,0.08)', border: '1px solid rgba(52,191,58,0.2)',
                      display: 'flex', alignItems: 'center', gap: 8,
                      fontSize: '0.85rem', color: '#34BF3A',
                    }}>
                      <CheckCircle size={16} />
                      Completed — You have read and acknowledged this module.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                      <button className="btn btn-primary"
                        onClick={() => handleAcknowledge(module)}
                        disabled={submitting === module.module_id}
                        style={{ padding: '10px 20px' }}
                      >
                        {submitting === module.module_id
                          ? <><Loader size={16} className="spin" /> Processing...</>
                          : <><CheckCircle size={16} /> I have read and understood this</>}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
