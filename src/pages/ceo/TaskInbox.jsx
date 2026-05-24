import { useState, useMemo, useEffect } from 'react'
import {
  Inbox, AlertTriangle, CheckCircle, Clock, Filter, ChevronDown, Bot,
  ArrowRight, XCircle, Eye, Zap, Shield, FileSignature, Bell,
  ExternalLink, Plus, ClipboardCheck, Lock
} from 'lucide-react'
import { collection, onSnapshot, query, orderBy, doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db, auth } from '../../lib/firebase'
import { onAuthStateChanged } from 'firebase/auth'
import { taskCategories, taskPriorities } from '../../data/constants'
import TaskCreationModal from '../../components/TaskCreationModal'

const PORTAL_COLORS = {
  CEO: '#022873', HR: '#1598CC', ENGINEER: '#34BF3A', CLIENT: '#EF5829',
}

const STATUS_DISPLAY = {
  OPEN: { label: 'Open', color: '#1598CC', bg: 'rgba(21,152,204,0.12)' },
  IN_PROGRESS: { label: 'In Progress', color: '#F39C12', bg: 'rgba(243,156,18,0.12)' },
  OVERDUE: { label: 'Overdue', color: '#C0392B', bg: 'rgba(192,57,43,0.12)' },
  COMPLETED: { label: 'Completed', color: '#34BF3A', bg: 'rgba(52,191,58,0.12)' },
}

const PRIORITY_DISPLAY = {
  CRITICAL: { label: 'Critical', color: '#C0392B' },
  HIGH: { label: 'High', color: '#EF5829' },
  NORMAL: { label: 'Normal', color: '#1598CC' },
  MEDIUM: { label: 'Medium', color: '#F39C12' },
  LOW: { label: 'Low', color: '#34BF3A' },
  INFO: { label: 'Info', color: '#bbb' },
}

// Map Firestore task_type to visual category
const TYPE_TO_CATEGORY = {
  APPROVE_REJECT: 'APPROVAL',
  SUBMIT_EVIDENCE: 'ACTION',
  ACKNOWLEDGE: 'NOTIFICATION',
  SIGN: 'SIGNATURE',
  COMPLETE_FORM: 'ACTION',
  ESCALATION: 'COMPLIANCE',
  INFORMATION: 'NOTIFICATION',
}

// Map assigned_to_type to portal
function resolvePortal(task) {
  if (task.portal) return task.portal
  const role = task.assigned_to_role || task.assigned_to_type
  if (!role) return 'CEO'
  if (role === 'ENGINEER' || role === 'ALL_ENGINEERS') return 'ENGINEER'
  if (role === 'HR_AGENT') return 'HR'
  if (role === 'CLIENT' || role === 'SALES' || role === 'PM') return 'CLIENT'
  return 'CEO'
}

function timeAgo(dateInput) {
  if (!dateInput) return ''
  const date = dateInput?.toDate ? dateInput.toDate() : new Date(dateInput)
  const diff = Date.now() - date.getTime()
  const hours = Math.floor(diff / 3600000)
  if (hours < 1) return 'Just now'
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function timeUntil(dateInput) {
  if (!dateInput) return ''
  const date = dateInput?.toDate ? dateInput.toDate() : new Date(dateInput)
  const diff = date.getTime() - Date.now()
  if (diff < 0) {
    const hours = Math.floor(Math.abs(diff) / 3600000)
    return `${hours}h overdue`
  }
  const hours = Math.floor(diff / 3600000)
  if (hours < 24) return `${hours}h left`
  const days = Math.floor(hours / 24)
  return `${days}d left`
}

function CategoryIcon({ category }) {
  const map = {
    APPROVAL: CheckCircle, REVIEW: Eye, ACTION: Zap,
    COMPLIANCE: Shield, SIGNATURE: FileSignature, NOTIFICATION: Bell,
  }
  const Icon = map[category] || Bell
  const color = taskCategories[category]?.color || '#8898aa'
  return <Icon size={16} color={color} />
}

// Normalize a Firestore task to the shape used by the UI
function normalizeTask(task) {
  if (!task.task_id && task.id) return { ...task, fsId: task.fsId || task.id } // already normalized

  const rawDue = task.due_at?.toDate ? task.due_at.toDate() : task.due_at ? new Date(task.due_at) : null
  const dueDate = rawDue && !isNaN(rawDue.getTime()) ? rawDue : null
  const isOverdue = task.state === 'OPEN' && dueDate && dueDate < new Date()

  const safeISO = (val) => {
    if (!val) return null
    const d = val?.toDate ? val.toDate() : new Date(val)
    return d && !isNaN(d.getTime()) ? d.toISOString() : null
  }

  return {
    id: task.task_id,
    fsId: task.id, // Firestore document id — differs from task_id for .add()-created tasks
    title: task.title,
    description: task.description,
    category: TYPE_TO_CATEGORY[task.task_type] || 'NOTIFICATION',
    priority: task.priority || 'NORMAL',
    portal: resolvePortal(task),
    source_agent: task.creation_method === 'MANUAL' ? 'CEO (Manual)' : 'System',
    source_module: task.task_type?.replace(/_/g, ' ') || 'Task',
    assigned_to: task.assigned_to_id || task.assigned_to_role?.replace(/_/g, ' ') || task.assigned_to_type?.replace(/_/g, ' ') || 'Unassigned',
    created_at: safeISO(task.created_at),
    due_at: dueDate ? dueDate.toISOString() : null,
    status: task.state === 'COMPLETED' ? 'COMPLETED' : isOverdue ? 'OVERDUE' : task.state || 'OPEN',
    completed_at: safeISO(task.completed_at),
    actions: task.state === 'COMPLETED' ? [] : ['Acknowledge', 'Escalate'],
    reference_id: task.task_id,
    _live: true,
  }
}

export default function TaskInbox() {
  const [filterPortal, setFilterPortal] = useState('ALL')
  const [filterStatus, setFilterStatus] = useState('ACTIVE')
  const [expandedTask, setExpandedTask] = useState(null)
  const [completedIds, setCompletedIds] = useState(new Set())
  const [fadingId, setFadingId] = useState(null)
  const [actionToast, setActionToast] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [liveTasks, setLiveTasks] = useState([])
  const [authReady, setAuthReady] = useState(false)
  const [authError, setAuthError] = useState(null)

  // Gate the Firestore listener on confirmed auth state.
  // Attaching the snapshot before auth is resolved causes Firestore to
  // evaluate security rules with no token → silent permission-denied error.
  useEffect(() => {
    let unsubSnapshot = null

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      // Tear down any previous snapshot if user changed
      if (unsubSnapshot) { unsubSnapshot(); unsubSnapshot = null }

      if (!user) {
        setAuthReady(true)
        setLiveTasks([])
        setAuthError('Not signed in — please refresh and sign in.')
        return
      }

      setAuthError(null)
      setAuthReady(true)

      try {
        const q = query(collection(db, 'tasks'), orderBy('created_at', 'desc'))
        unsubSnapshot = onSnapshot(
          q,
          (snapshot) => {
            const taskList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
            setLiveTasks(taskList)
            setAuthError(null)
          },
          (err) => {
            console.error('Tasks listener error:', err.code, err.message)
            if (err.code === 'permission-denied') {
              setAuthError('Permission denied — your account may not have CEO or CTO access.')
            } else {
              setAuthError(`Failed to load tasks: ${err.message}`)
            }
          }
        )
      } catch (err) {
        console.error('Tasks listener setup error:', err.message)
        setAuthError(`Failed to start tasks listener: ${err.message}`)
      }
    })

    return () => {
      unsubAuth()
      if (unsubSnapshot) unsubSnapshot()
    }
  }, [])

  const handleAction = async (task, action) => {
    const fsId = task.fsId || task.id
    setFadingId(fsId)
    setActionToast({ id: task.id, action })
    try {
      await updateDoc(doc(db, 'tasks', fsId), {
        state: 'COMPLETED',
        completed_at: serverTimestamp(),
      });
      setTimeout(() => {
        setCompletedIds(prev => new Set([...prev, fsId]))
        setFadingId(null)
        setExpandedTask(null)
      }, 600)
    } catch (err) {
      console.error('Failed to update task:', err)
      setFadingId(null)
      setActionToast({ id: task.id, action, error: err.message || 'Write failed' })
    }
    setTimeout(() => setActionToast(null), 4000)
  }

  const handleCreated = (data) => {
    setActionToast({ id: data.task_id, action: 'Created' })
    setTimeout(() => setActionToast(null), 4000)
  }

  const allTasks = useMemo(() => {
    // Live Firestore tasks only — no mock fallback
    const normalizedLive = liveTasks.map(normalizeTask)
    return normalizedLive.map(t => ({
      ...t,
      status: completedIds.has(t.fsId) ? 'COMPLETED' : t.status,
      completed_at: completedIds.has(t.fsId) ? new Date().toISOString() : t.completed_at,
    }))
  }, [completedIds, liveTasks])

  const filteredTasks = useMemo(() => {
    return allTasks.filter(t => {
      if (filterPortal !== 'ALL' && t.portal !== filterPortal) return false
      if (filterStatus === 'ACTIVE' && t.status === 'COMPLETED') return false
      if (filterStatus === 'COMPLETED' && t.status !== 'COMPLETED') return false
      if (filterStatus === 'OVERDUE' && t.status !== 'OVERDUE') return false
      return true
    })
  }, [filterPortal, filterStatus, allTasks])

  const portalCounts = useMemo(() => {
    const counts = { ALL: 0, CEO: 0, HR: 0, ENGINEER: 0, CLIENT: 0 }
    allTasks.filter(t => t.status !== 'COMPLETED').forEach(t => {
      if (counts[t.portal] !== undefined) counts[t.portal]++
      counts.ALL++
    })
    return counts
  }, [allTasks])

  const liveStats = useMemo(() => ({
    openTasks: allTasks.filter(t => t.status !== 'COMPLETED').length,
    criticalTasks: allTasks.filter(t => t.priority === 'CRITICAL' && t.status !== 'COMPLETED').length,
    overdueTasks: allTasks.filter(t => t.status === 'OVERDUE').length,
    completedToday: allTasks.filter(t => t.status === 'COMPLETED').length,
  }), [allTasks])

  return (
    <div>
      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Task Inbox</h1>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: 4 }}>
            DTLK-OPS-TSK-001 · Cross-portal unified task management
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="btn btn-primary"
          style={{
            background: '#EF5829', display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 20px', border: 'none', borderRadius: 8, color: '#fff',
            fontWeight: 700, fontSize: '0.85rem', fontFamily: 'inherit', cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(239,88,41,0.3)', transition: 'all 0.2s',
          }}
        >
          <Plus size={18} /> New Task
        </button>
      </div>

      {/* Action Toast */}
      {actionToast && (
        actionToast.error ? (
          <div className="animate-fade-in-up" style={{ padding: '12px 20px', background: 'rgba(192,57,43,0.12)', border: '1px solid rgba(192,57,43,0.3)', borderRadius: 'var(--radius-md)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.82rem', color: '#C0392B' }}>
            <XCircle size={16} /> Task {actionToast.id} — "{actionToast.action}" failed to save: {actionToast.error}
          </div>
        ) : (
          <div className="animate-fade-in-up" style={{ padding: '12px 20px', background: 'rgba(52,191,58,0.12)', border: '1px solid rgba(52,191,58,0.3)', borderRadius: 'var(--radius-md)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.82rem', color: '#34BF3A' }}>
            <CheckCircle size={16} /> Task {actionToast.id} — "{actionToast.action}" executed successfully
          </div>
        )
      )}

      {/* Auth / Permission Error Banner */}
      {authError && (
        <div className="animate-fade-in-up" style={{ padding: '12px 20px', background: 'rgba(192,57,43,0.1)', border: '1px solid rgba(192,57,43,0.3)', borderRadius: 'var(--radius-md)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.82rem', color: '#C0392B' }}>
          <Lock size={16} /> {authError}
        </div>
      )}

      {/* Auth initialising notice */}
      {!authReady && !authError && (
        <div style={{ padding: '10px 16px', background: 'rgba(21,152,204,0.08)', border: '1px solid rgba(21,152,204,0.2)', borderRadius: 'var(--radius-md)', marginBottom: 16, fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
          Connecting to live task stream…
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid-4" style={{ marginBottom: 24 }}>
        {[
          { value: liveStats.openTasks, label: 'Open Tasks', color: '#1598CC', icon: Inbox },
          { value: liveStats.criticalTasks, label: 'Critical', color: '#C0392B', icon: AlertTriangle },
          { value: liveStats.overdueTasks, label: 'Overdue', color: '#EF5829', icon: Clock },
          { value: liveStats.completedToday, label: 'Completed Today', color: '#34BF3A', icon: CheckCircle },
        ].map((stat, i) => {
          const Icon = stat.icon
          return (
            <div key={i} className={`stat-card animate-fade-in-up`} style={{ '--stat-accent': stat.color, animationDelay: `${i * 0.05}s` }}>
              <div className="stat-label"><Icon size={14} style={{ verticalAlign: -2, marginRight: 4 }} />{stat.label}</div>
              <div className="stat-value" style={{ color: stat.color }}>{stat.value}</div>
            </div>
          )
        })}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        {/* Portal filter pills */}
        <div style={{ display: 'flex', gap: 6 }}>
          {['ALL', 'CEO', 'HR', 'ENGINEER', 'CLIENT'].map(portal => (
            <button
              key={portal}
              className={`btn btn-sm ${filterPortal === portal ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setFilterPortal(portal)}
              style={filterPortal === portal ? { background: portal === 'ALL' ? '#022873' : PORTAL_COLORS[portal] } : {}}
            >
              {portal === 'ALL' ? 'All Portals' : portal}
              <span style={{
                marginLeft: 6, padding: '1px 6px', borderRadius: 8, fontSize: '0.65rem', fontWeight: 700,
                background: filterPortal === portal ? 'rgba(255,255,255,0.2)' : 'var(--bg-surface)',
              }}>{portalCounts[portal]}</span>
            </button>
          ))}
        </div>

        {/* Status filter */}
        <div style={{ display: 'flex', gap: 6 }}>
          {[
            { id: 'ACTIVE', label: 'Active' },
            { id: 'OVERDUE', label: 'Overdue' },
            { id: 'COMPLETED', label: 'Completed' },
          ].map(f => (
            <button
              key={f.id}
              className={`btn btn-sm ${filterStatus === f.id ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setFilterStatus(f.id)}
            >{f.label}</button>
          ))}
        </div>
      </div>

      {/* Task List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filteredTasks.length === 0 && (
          <div className="card" style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--text-tertiary)' }}>
            {authError
              ? <><Lock size={40} style={{ marginBottom: 12, opacity: 0.4, color: '#C0392B' }} />
                  <div style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 6, color: '#C0392B' }}>Access error</div>
                  <div style={{ fontSize: '0.82rem' }}>{authError}</div></>
              : !authReady
                ? <><ClipboardCheck size={40} style={{ marginBottom: 12, opacity: 0.3 }} />
                    <div style={{ fontSize: '0.82rem' }}>Connecting…</div></>
                : <><ClipboardCheck size={40} style={{ marginBottom: 12, opacity: 0.3 }} />
                    <div style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 6, color: 'var(--text-secondary)' }}>No tasks yet</div>
                    <div style={{ fontSize: '0.82rem' }}>Create your first task using the "New Task" button above</div></>
            }
          </div>
        )}

        {filteredTasks.map((task, i) => {
          const isExpanded = expandedTask === task.fsId
          const statusStyle = STATUS_DISPLAY[task.status] || STATUS_DISPLAY.OPEN
          const priorityStyle = PRIORITY_DISPLAY[task.priority] || PRIORITY_DISPLAY.NORMAL
          const catInfo = taskCategories[task.category] || { color: '#8898aa' }

          return (
            <div
              key={task.fsId}
              className="animate-fade-in-up"
              style={{
                animationDelay: `${i * 0.03}s`,
                background: 'var(--bg-card)', border: '1px solid var(--border-card)',
                borderRadius: 'var(--radius-lg)',
                borderLeft: `4px solid ${task.status === 'OVERDUE' ? '#C0392B' : task.status === 'COMPLETED' ? '#34BF3A' : priorityStyle.color}`,
                boxShadow: 'var(--shadow-card)',
                transition: 'all 0.5s ease',
                opacity: fadingId === task.fsId ? 0.3 : 1,
                transform: fadingId === task.fsId ? 'translateX(40px)' : 'none',
              }}
            >
              {/* Task Row */}
              <div
                style={{ padding: '16px 20px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14 }}
                onClick={() => setExpandedTask(isExpanded ? null : task.fsId)}
              >
                {/* Category Icon */}
                <div style={{
                  width: 36, height: 36, borderRadius: 'var(--radius-md)',
                  background: `${catInfo.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <CategoryIcon category={task.category} />
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--text-tertiary)' }}>{task.id}</span>
                    <span style={{ padding: '1px 8px', borderRadius: 4, fontSize: '0.62rem', fontWeight: 700, color: '#fff', background: PORTAL_COLORS[task.portal] || '#8898aa', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{task.portal}</span>
                    <span style={{ padding: '1px 8px', borderRadius: 12, fontSize: '0.62rem', fontWeight: 600, background: `${priorityStyle.color}18`, color: priorityStyle.color }}>{priorityStyle.label}</span>
                    {task._live && <span style={{ padding: '1px 6px', borderRadius: 4, fontSize: '0.58rem', fontWeight: 700, color: '#34BF3A', background: 'rgba(52,191,58,0.1)', border: '1px solid rgba(52,191,58,0.2)' }}>LIVE</span>}
                  </div>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{task.title}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginTop: 2 }}>
                    <Bot size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
                    {task.source_agent} · {task.source_module}
                  </div>
                </div>

                {/* Right side: status + timing */}
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <span style={{
                    padding: '3px 10px', borderRadius: 12, fontSize: '0.68rem', fontWeight: 600,
                    background: statusStyle.bg, color: statusStyle.color,
                  }}>{statusStyle.label}</span>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
                    {task.status === 'COMPLETED'
                      ? <>Completed {timeAgo(task.completed_at)}</>
                      : <>Due: {timeUntil(task.due_at)}</>
                    }
                  </div>
                </div>

                {/* Expand chevron */}
                <ChevronDown
                  size={16}
                  color="var(--text-tertiary)"
                  style={{ flexShrink: 0, transition: 'transform 0.2s', transform: isExpanded ? 'rotate(180deg)' : 'none' }}
                />
              </div>

              {/* Expanded Detail */}
              {isExpanded && (
                <div style={{
                  padding: '0 20px 16px 70px',
                  borderTop: '1px solid var(--border-primary)',
                  paddingTop: 14,
                  animation: 'fadeIn 0.2s ease',
                }}>
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 12 }}>
                    {task.description}
                  </p>

                  <div style={{ display: 'flex', gap: 20, fontSize: '0.72rem', color: 'var(--text-tertiary)', marginBottom: 14 }}>
                    <span>Assigned to: <strong style={{ color: 'var(--text-primary)' }}>{task.assigned_to}</strong></span>
                    <span>Created: {timeAgo(task.created_at)}</span>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>Ref: {task.reference_id}</span>
                  </div>

                  {/* Actions */}
                  {task.status !== 'COMPLETED' && task.actions && task.actions.length > 0 && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      {task.actions.map((action, ai) => (
                        <button
                          key={action}
                          className={`btn btn-sm ${ai === 0 ? 'btn-primary' : 'btn-ghost'}`}
                          style={ai === 0 ? { background: catInfo.color } : {}}
                          onClick={(e) => { e.stopPropagation(); handleAction(task, action) }}
                        >
                          {action}
                        </button>
                      ))}
                    </div>
                  )}
                  {task.status === 'COMPLETED' && (
                    <div style={{ fontSize: '0.78rem', color: '#34BF3A', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <CheckCircle size={14} /> Completed
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Task Creation Modal */}
      {showModal && (
        <TaskCreationModal onClose={() => setShowModal(false)} onCreated={handleCreated} />
      )}
    </div>
  )
}
