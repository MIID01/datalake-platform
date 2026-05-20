import { useState, useEffect } from 'react'
import { auth, db } from '../../lib/firebase'
import { doc, onSnapshot, query, collection, where } from 'firebase/firestore'
import { CheckCircle, Circle, AlertCircle, FileText, Shield, GraduationCap, User, Briefcase } from 'lucide-react'

export default function OnboardingGate() {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsubAuth = auth.onAuthStateChanged(user => {
      if (user) {
        const q = query(collection(db, 'onboarding_tasks'), where('email', '==', user.email))
        const unsubDoc = onSnapshot(q, snap => {
          setTasks(snap.docs.map(d => ({ id: d.id, ...d.data() })))
          setLoading(false)
        })
        return () => unsubDoc()
      } else {
        setLoading(false)
      }
    })
    return () => unsubAuth()
  }, [])

  if (loading) return <div style={{ color: '#fff', textAlign: 'center', padding: 40 }}>Loading status...</div>

  const checks = [
    { id: 'pdpl', label: 'PDPL Consent Given', icon: Shield, done: tasks.some(t => t.task_type === 'PDPL_CONSENT' && t.status === 'COMPLETED') },
    { id: 'contract', label: 'Contract Signed', icon: FileText, done: tasks.some(t => t.task_type === 'CONTRACT_SIGNATURE' && t.status === 'COMPLETED') },
    { id: 'training', label: 'Mandatory Security Training', icon: GraduationCap, done: tasks.some(t => t.task_type === 'MANDATORY_TRAINING' && t.status === 'COMPLETED') },
    { id: 'profile', label: 'Profile Complete', icon: User, done: tasks.some(t => t.task_type === 'PROFILE_COMPLETION' && t.status === 'COMPLETED') },
    { id: 'project', label: 'Assigned to a Project', icon: Briefcase, done: tasks.some(t => t.task_type === 'PROJECT_ASSIGNMENT' && t.status === 'COMPLETED') },
  ]

  const allDone = checks.every(c => c.done)

  return (
    <div style={{ padding: '40px 24px', maxWidth: 600, margin: '40px auto', background: '#111e33', border: '1px solid #1e3050', borderRadius: 16 }}>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{ width: 64, height: 64, borderRadius: '50%', background: allDone ? 'rgba(52,191,58,0.15)' : 'rgba(239,88,41,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
          {allDone ? <CheckCircle size={32} color="#4ade80" /> : <AlertCircle size={32} color="#fb923c" />}
        </div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#e2e8f0', margin: 0 }}>Onboarding Status</h1>
        <p style={{ fontSize: '0.9rem', color: '#94a3b8', marginTop: 8 }}>
          {allDone ? 'You are fully onboarded and ready to go.' : 'You must complete the following steps before accessing timesheets and expenses.'}
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {checks.map(c => (
          <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px', background: 'rgba(255,255,255,0.02)', border: '1px solid #1e3050', borderRadius: 12 }}>
            {c.done ? <CheckCircle size={24} color="#4ade80" /> : <Circle size={24} color="#475569" />}
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, color: c.done ? '#e2e8f0' : '#94a3b8', display: 'flex', alignItems: 'center', gap: 8 }}>
                <c.icon size={16} /> {c.label}
              </div>
            </div>
            {!c.done && <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '4px 10px', background: 'rgba(239,88,41,0.15)', color: '#fb923c', borderRadius: 12 }}>PENDING</span>}
          </div>
        ))}
      </div>
    </div>
  )
}
