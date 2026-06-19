import { useEffect, useMemo, useState } from 'react'
import { collection, onSnapshot, query, orderBy, addDoc, updateDoc, doc, serverTimestamp } from 'firebase/firestore'
import { auth, db } from '../../lib/firebase'
import { CheckSquare, Square, Plus, Loader, AlertTriangle, X, Calendar } from 'lucide-react'

// CRM tasks — `crm_tasks` is the canonical store (tasks had no actionable home;
// deal_activities only LOGGED them). Client CRUD gated by firestore.rules (CRM roles).
const NAVY = '#022873'
const today = () => new Date().toISOString().slice(0, 10)

export default function CRMTasks() {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('open') // open | mine | overdue | done | all
  const [showAdd, setShowAdd] = useState(false)
  const me = auth.currentUser?.email || ''

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, 'crm_tasks'), orderBy('due_date', 'asc')),
      snap => { setTasks(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false) },
      err => { setError(err.message); setLoading(false) })
    return () => unsub()
  }, [])

  const t0 = today()
  const filtered = useMemo(() => {
    return tasks.filter(t => {
      if (filter === 'done') return t.status === 'DONE'
      if (filter === 'all') return true
      if (t.status === 'DONE') return false
      if (filter === 'mine') return (t.assignee_email || '').toLowerCase() === me.toLowerCase()
      if (filter === 'overdue') return t.due_date && t.due_date < t0
      return true // open
    })
  }, [tasks, filter, me, t0])

  const openCount = tasks.filter(t => t.status !== 'DONE').length
  const overdueCount = tasks.filter(t => t.status !== 'DONE' && t.due_date && t.due_date < t0).length

  const toggle = async (task) => {
    try {
      await updateDoc(doc(db, 'crm_tasks', task.id), {
        status: task.status === 'DONE' ? 'OPEN' : 'DONE',
        done_at: task.status === 'DONE' ? null : serverTimestamp(),
        updated_at: serverTimestamp(),
      })
    } catch (e) { window.alert(e.message) }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}><Loader size={26} className="spin" /><div>Loading tasks…</div><style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{100%{transform:rotate(360deg)}}`}</style></div>
  if (error) return <div style={{ padding: 32, color: '#C0392B' }}><AlertTriangle size={16} /> Could not load: {error}</div>

  const tabs = [['open', `Open (${openCount})`], ['mine', 'Mine'], ['overdue', `Overdue (${overdueCount})`], ['done', 'Done'], ['all', 'All']]

  return (
    <div style={{ padding: '28px 24px', maxWidth: 900, margin: '0 auto', fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: NAVY, display: 'flex', alignItems: 'center', gap: 10, margin: 0 }}>
          <CheckSquare size={22} color="#1598CC" /> Tasks
        </h1>
        <button onClick={() => setShowAdd(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px', background: NAVY, color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>
          <Plus size={15} /> Add task
        </button>
      </div>

      <div style={{ display: 'flex', gap: 6, margin: '16px 0', flexWrap: 'wrap' }}>
        {tabs.map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)} style={{ padding: '6px 12px', borderRadius: 8, border: `1px solid ${filter === k ? NAVY : '#E5E7EB'}`, background: filter === k ? NAVY : '#fff', color: filter === k ? '#fff' : '#475569', fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer' }}>{label}</button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={{ padding: 44, textAlign: 'center', color: '#94a3b8', background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12 }}>No tasks here.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map(t => {
            const overdue = t.status !== 'DONE' && t.due_date && t.due_date < t0
            return (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: '#fff', border: `1px solid ${overdue ? '#FCA5A5' : '#E5E7EB'}`, borderRadius: 10 }}>
                <button onClick={() => toggle(t)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.status === 'DONE' ? '#34BF3A' : '#94a3b8', padding: 0, display: 'flex' }}>
                  {t.status === 'DONE' ? <CheckSquare size={20} /> : <Square size={20} />}
                </button>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: '#0F172A', textDecoration: t.status === 'DONE' ? 'line-through' : 'none', opacity: t.status === 'DONE' ? 0.6 : 1 }}>{t.title}</div>
                  <div style={{ fontSize: '0.74rem', color: '#94a3b8', display: 'flex', gap: 10, marginTop: 2 }}>
                    {t.due_date && <span style={{ color: overdue ? '#C0392B' : '#94a3b8', fontWeight: overdue ? 700 : 400 }}><Calendar size={11} style={{ verticalAlign: -1 }} /> {t.due_date}{overdue ? ' · overdue' : ''}</span>}
                    {t.assignee_email && <span>{t.assignee_email}</span>}
                    {t.deal_title && <span>· {t.deal_title}</span>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showAdd && <AddTaskModal me={me} onClose={() => setShowAdd(false)} />}
    </div>
  )
}

function AddTaskModal({ me, onClose }) {
  const [title, setTitle] = useState('')
  const [due_date, setDue] = useState(today())
  const [assignee_email, setAssignee] = useState(me)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async () => {
    if (!title.trim()) { setErr('Title required'); return }
    setBusy(true); setErr('')
    try {
      await addDoc(collection(db, 'crm_tasks'), {
        title: title.trim(),
        due_date: due_date || null,
        assignee_email: assignee_email.trim() || me,
        status: 'OPEN',
        created_by: me,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      })
      onClose()
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  const inp = { width: '100%', padding: '9px 12px', border: '1px solid #E5E7EB', borderRadius: 8, fontSize: '0.88rem', boxSizing: 'border-box', marginTop: 4 }
  return (
    <div onClick={() => !busy && onClose()} style={{ position: 'fixed', inset: 0, background: 'rgba(2,8,23,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 22, width: 420, maxWidth: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: NAVY }}>Add task</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}><X size={19} /></button>
        </div>
        <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#475569' }}>Task</label>
        <input style={inp} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Follow up on Emkan proposal" autoFocus />
        <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#475569', marginTop: 12, display: 'block' }}>Due date</label>
        <input type="date" style={inp} value={due_date} onChange={e => setDue(e.target.value)} />
        <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#475569', marginTop: 12, display: 'block' }}>Assignee</label>
        <input style={inp} value={assignee_email} onChange={e => setAssignee(e.target.value)} placeholder="email" />
        {err && <div style={{ color: '#C0392B', fontSize: '0.8rem', marginTop: 10 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', borderRadius: 8, border: '1px solid #E5E7EB', background: '#fff', color: '#475569', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          <button onClick={submit} disabled={busy || !title.trim()} style={{ flex: 1, padding: '10px', borderRadius: 8, border: 'none', background: busy || !title.trim() ? '#94a3b8' : NAVY, color: '#fff', fontWeight: 700, cursor: busy ? 'wait' : 'pointer' }}>{busy ? 'Saving…' : 'Add'}</button>
        </div>
      </div>
    </div>
  )
}
