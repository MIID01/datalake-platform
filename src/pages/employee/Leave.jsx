import { useState, useEffect, useMemo } from 'react'
import { collection, addDoc, query, where, onSnapshot, serverTimestamp, orderBy } from 'firebase/firestore'
import { db, auth } from '../../lib/firebase'
import { Plus, Calendar, CheckCircle, X, Clock, AlertTriangle, FileText, Loader } from 'lucide-react'

// Saudi Labor Law leave entitlements (defaults)
const LEAVE_TYPES = [
  { id: 'annual', label: 'Annual Leave', days: 21, color: '#1598CC', icon: '🏖️' },
  { id: 'sick', label: 'Sick Leave', days: 30, color: '#F39C12', icon: '🏥', note: '30 days full pay + 60 days 75% pay (Art. 117)' },
  { id: 'marriage', label: 'Marriage Leave', days: 5, color: '#E91E63', icon: '💍' },
  { id: 'bereavement', label: 'Bereavement Leave', days: 5, color: '#607D8B', icon: '🕊️' },
  { id: 'paternity', label: 'Paternity Leave', days: 3, color: '#9C27B0', icon: '👶' },
  { id: 'maternity', label: 'Maternity Leave', days: 70, color: '#FF5722', icon: '🤱', note: '10 weeks (Art. 151)' },
  { id: 'unpaid', label: 'Unpaid Leave', days: 999, color: '#78909C', icon: '📋', note: 'Requires Management approval' },
  { id: 'emergency', label: 'Emergency Leave', days: 5, color: '#C0392B', icon: '🚨', note: 'Auto-approved, Management notified' },
]

// Saudi public holidays 2026
const HOLIDAYS_2026 = [
  { name: 'Founding Day', date: '2026-02-22', days: 1 },
  { name: 'Eid Al-Fitr', start: '2026-03-20', end: '2026-03-25', days: 6 },
  { name: 'Eid Al-Adha', start: '2026-05-27', end: '2026-06-01', days: 6 },
  { name: 'National Day', date: '2026-09-23', days: 1 },
]

function isHoliday(dateStr) {
  for (const h of HOLIDAYS_2026) {
    if (h.date && dateStr === h.date) return true
    if (h.start && h.end && dateStr >= h.start && dateStr <= h.end) return true
  }
  return false
}

function isWeekend(dateStr) {
  const d = new Date(dateStr + 'T12:00:00')
  const dow = d.getDay()
  return dow === 5 || dow === 6 // Fri + Sat
}

function calcWorkingDays(startDate, endDate) {
  if (!startDate || !endDate) return 0
  let count = 0
  let cur = new Date(startDate + 'T12:00:00')
  const end = new Date(endDate + 'T12:00:00')
  while (cur <= end) {
    const ds = cur.toISOString().slice(0, 10)
    if (!isWeekend(ds) && !isHoliday(ds)) count++
    cur.setDate(cur.getDate() + 1)
  }
  return count
}

const STATUS_COLORS = {
  PENDING: { bg: 'rgba(243,156,18,0.12)', color: '#F39C12', label: 'Pending' },
  APPROVED: { bg: 'rgba(52,191,58,0.12)', color: '#34BF3A', label: 'Approved' },
  REJECTED: { bg: 'rgba(192,57,43,0.12)', color: '#C0392B', label: 'Rejected' },
  CANCELLED: { bg: 'rgba(120,144,156,0.12)', color: '#78909C', label: 'Cancelled' },
}

export default function Leave() {
  const [requests, setRequests] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState(null)
  const [userEmail, setUserEmail] = useState(null)
  const [userName, setUserName] = useState('')
  const [form, setForm] = useState({
    type: 'annual', start_date: '', end_date: '', reason: '', handover_notes: '',
  })

  // Wait for auth state
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(user => {
      if (user) { setUserEmail(user.email); setUserName(user.displayName || user.email) }
    })
    return () => unsub()
  }, [])

  // Load leave requests for this user
  useEffect(() => {
    if (!userEmail) return
    const q = query(
      collection(db, 'leave_requests'),
      where('engineer_email', '==', userEmail),
      orderBy('created_at', 'desc')
    )
    const unsub = onSnapshot(q, snap => {
      setRequests(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    }, err => {
      console.warn('Leave requests listener error:', err.message)
      // Fallback: try without orderBy (missing index)
      const q2 = query(collection(db, 'leave_requests'), where('engineer_email', '==', userEmail))
      onSnapshot(q2, snap => setRequests(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
    })
    return () => unsub()
  }, [userEmail])

  // Calculate balances
  const balances = useMemo(() => {
    const year = new Date().getFullYear()
    return LEAVE_TYPES.filter(t => t.id !== 'unpaid').map(lt => {
      const approved = requests.filter(r =>
        r.leave_type === lt.id &&
        r.status === 'APPROVED' &&
        r.start_date?.startsWith?.(String(year))
      )
      const usedDays = approved.reduce((sum, r) => sum + (r.working_days || 0), 0)
      return { ...lt, used: usedDays, remaining: Math.max(0, lt.days - usedDays) }
    })
  }, [requests])

  const workingDays = useMemo(() => calcWorkingDays(form.start_date, form.end_date), [form.start_date, form.end_date])

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4000)
  }

  const handleSubmit = async () => {
    if (!userEmail) {
      alert('Not authenticated. Please sign out and sign in again.')
      return
    }
    if (!form.type || !form.start_date || !form.end_date) {
      showToast('Please fill in all required fields', 'error'); return
    }
    if (form.reason.length < 10) {
      showToast('Reason must be at least 10 characters', 'error'); return
    }
    if (workingDays <= 0) {
      showToast('Selected dates have no working days', 'error'); return
    }

    // Check balance
    const lt = LEAVE_TYPES.find(t => t.id === form.type)
    if (lt && lt.id !== 'unpaid') {
      const bal = balances.find(b => b.id === form.type)
      if (bal && workingDays > bal.remaining) {
        showToast(`Insufficient balance: ${bal.remaining} days remaining, requesting ${workingDays}`, 'error'); return
      }
    }

    // Determine approval flow
    let approvalNote = ''
    if (form.type === 'emergency') approvalNote = 'Auto-approved. Management notified.'
    else if (form.type === 'sick' && workingDays <= 2) approvalNote = 'Sick ≤2 days — auto-approved with medical certificate.'

    setSubmitting(true)
    try {
      const leaveId = `LR-${Date.now()}-${Math.floor(Math.random() * 1000)}`
      const isAutoApproved = form.type === 'emergency' || (form.type === 'sick' && workingDays <= 2)

      await addDoc(collection(db, 'leave_requests'), {
        leave_id: leaveId,
        engineer_email: userEmail,
        engineer_name: userName,
        leave_type: form.type,
        leave_type_label: lt?.label || form.type,
        start_date: form.start_date,
        end_date: form.end_date,
        working_days: workingDays,
        reason: form.reason,
        handover_notes: form.handover_notes || null,
        status: isAutoApproved ? 'APPROVED' : 'PENDING',
        approval_note: approvalNote || null,
        approved_by: isAutoApproved ? 'system:auto' : null,
        approved_at: isAutoApproved ? serverTimestamp() : null,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      })

      showToast(isAutoApproved
        ? `Leave ${leaveId} auto-approved!`
        : `Leave request ${leaveId} submitted. Awaiting approval.`)
      setForm({ type: 'annual', start_date: '', end_date: '', reason: '', handover_notes: '' })
      setShowForm(false)
    } catch (err) {
      console.error('Leave submit error:', err)
      showToast(`Failed: ${err.message}`, 'error')
    }
    setSubmitting(false)
  }

  return (
    <div>
      {/* Toast */}
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
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Leave & Holidays</h1>
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
          <Plus size={16} /> Request Leave
        </button>
      </div>

      {/* Balance Cards */}
      <div className="grid-4" style={{ marginBottom: 28 }}>
        {balances.map((b, i) => (
          <div key={b.id} className={`eng-stat-card animate-fade-in-up stagger-${i + 1}`}
            style={{ '--stat-color': b.color, '--stat-bg': `${b.color}15` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: '1.2rem' }}>{b.icon}</span>
              <span className="stat-label" style={{ fontSize: '0.78rem' }}>{b.label}</span>
            </div>
            <div className="stat-value" style={{ color: b.color, fontSize: '2rem' }}>{b.remaining}</div>
            <div style={{ marginTop: 8, height: 4, borderRadius: 2, background: 'var(--border-primary)' }}>
              <div style={{ width: `${(b.remaining / b.days) * 100}%`, height: '100%', borderRadius: 2, background: b.color, transition: 'width 0.5s ease' }} />
            </div>
            <div className="stat-sub">{b.used} used of {b.days} days</div>
          </div>
        ))}
      </div>

      {/* Request Form */}
      {showForm && (
        <div className="card animate-fade-in-up" style={{ marginBottom: 24 }}>
          <h3 style={{ marginBottom: 20, fontSize: '1.1rem', fontWeight: 700 }}>New Leave Request</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div className="form-group">
              <label className="form-label">Leave Type *</label>
              <select className="form-input" value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))}>
                {LEAVE_TYPES.map(lt => (
                  <option key={lt.id} value={lt.id}>{lt.label} ({lt.days === 999 ? 'Unlimited' : lt.days + ' days'})</option>
                ))}
              </select>
              {LEAVE_TYPES.find(t => t.id === form.type)?.note && (
                <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginTop: 4, fontStyle: 'italic' }}>
                  {LEAVE_TYPES.find(t => t.id === form.type).note}
                </div>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label className="form-label">Start Date *</label>
                <input className="form-input" type="date" value={form.start_date}
                  onChange={e => setForm(p => ({ ...p, start_date: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">End Date *</label>
                <input className="form-input" type="date" value={form.end_date}
                  min={form.start_date}
                  onChange={e => setForm(p => ({ ...p, end_date: e.target.value }))} />
              </div>
            </div>
          </div>

          {/* Working days calculation */}
          {form.start_date && form.end_date && (
            <div style={{
              padding: '10px 16px', borderRadius: 8, marginBottom: 16,
              background: 'rgba(21,152,204,0.08)', border: '1px solid rgba(21,152,204,0.2)',
              fontSize: '0.85rem', color: '#1598CC', display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <Calendar size={16} />
              <strong>{workingDays}</strong> working day{workingDays !== 1 ? 's' : ''} (excluding weekends and public holidays)
            </div>
          )}

          <div className="form-group" style={{ marginBottom: 16 }}>
            <label className="form-label">Reason *</label>
            <textarea className="form-input" rows={3} value={form.reason}
              onChange={e => setForm(p => ({ ...p, reason: e.target.value }))}
              placeholder="Please provide a reason for your leave request (min 10 characters)..." />
          </div>

          {form.type === 'sick' && workingDays > 2 && (
            <div className="form-group" style={{ marginBottom: 16 }}>
              <label className="form-label">
                <FileText size={12} style={{ verticalAlign: -1, marginRight: 4 }} />
                Medical Certificate (required for sick leave &gt; 2 days)
              </label>
              <input className="form-input" type="file" accept=".pdf,.jpg,.png" />
            </div>
          )}

          <div className="form-group" style={{ marginBottom: 20 }}>
            <label className="form-label">Handover Notes (optional)</label>
            <textarea className="form-input" rows={2} value={form.handover_notes}
              onChange={e => setForm(p => ({ ...p, handover_notes: e.target.value }))}
              placeholder="Who covers your responsibilities during absence?" />
          </div>

          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
              {submitting ? <Loader size={16} className="spin" /> : <CheckCircle size={16} />}
              {submitting ? ' Submitting...' : ' Submit Request'}
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {/* Leave Requests */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-primary)' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              My Leave Requests ({requests.length})
            </h3>
          </div>
          {requests.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>
              <Calendar size={32} style={{ marginBottom: 8, opacity: 0.3 }} />
              <div>No leave requests yet</div>
            </div>
          ) : (
            <table className="data-table">
              <thead><tr><th>Type</th><th>Dates</th><th>Days</th><th>Status</th></tr></thead>
              <tbody>
                {requests.map(r => {
                  const sc = STATUS_COLORS[r.status] || STATUS_COLORS.PENDING
                  return (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 600 }}>{r.leave_type_label || r.leave_type}</td>
                      <td style={{ fontSize: '0.82rem' }}>
                        {r.start_date} — {r.end_date}
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{r.working_days}</td>
                      <td>
                        <span style={{
                          padding: '2px 10px', borderRadius: 12, fontSize: '0.72rem',
                          fontWeight: 600, background: sc.bg, color: sc.color,
                        }}>
                          {sc.label}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Upcoming Holidays */}
        <div className="card">
          <div className="card-header"><h3>Saudi Public Holidays 2026</h3></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {HOLIDAYS_2026.map((h, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0',
                borderBottom: i < HOLIDAYS_2026.length - 1 ? '1px solid var(--border-primary)' : 'none'
              }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 10,
                  background: 'var(--steel-blue-dim, rgba(21,152,204,0.1))',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem'
                }}>🇸🇦</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{h.name}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
                    {h.date || `${h.start} — ${h.end}`} · {h.days} day{h.days > 1 ? 's' : ''}
                  </div>
                </div>
                <span className="badge badge-info">Holiday</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
