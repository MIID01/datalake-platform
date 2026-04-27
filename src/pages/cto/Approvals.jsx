import { useState, useEffect, useMemo } from 'react'
import { collection, onSnapshot, query, where, orderBy } from 'firebase/firestore'
import { db, CTO_APPROVE_TIMESHEET_URL } from '../../lib/firebase'
import { auth } from '../../lib/firebase'
import { ClipboardCheck, CheckCircle, XCircle, Clock, AlertTriangle, Calendar, ChevronDown, Send, MessageSquare } from 'lucide-react'

const STATE_CONFIG = {
  SUBMITTED: { label: 'Pending', color: '#EF5829', bg: 'rgba(239,88,41,0.12)' },
  CEO_ESCALATED: { label: 'Escalated', color: '#F39C12', bg: 'rgba(243,156,18,0.12)' },
  CTO_APPROVED: { label: 'Approved', color: '#34BF3A', bg: 'rgba(52,191,58,0.12)' },
  REJECTED_BY_CTO: { label: 'Rejected', color: '#C0392B', bg: 'rgba(192,57,43,0.12)' },
  CLIENT_SIGNED: { label: 'Client Signed', color: '#1598CC', bg: 'rgba(21,152,204,0.12)' },
  REJECTED_BY_CLIENT: { label: 'Client Rejected', color: '#C0392B', bg: 'rgba(192,57,43,0.12)' },
}

const TABS = [
  { key: 'pending', label: 'Pending', states: ['SUBMITTED'], icon: Clock },
  { key: 'escalated', label: 'Escalated', states: ['CEO_ESCALATED'], icon: AlertTriangle },
  { key: 'approved', label: 'Approved', states: ['CTO_APPROVED', 'CLIENT_SIGNED'], icon: CheckCircle },
  { key: 'rejected', label: 'Rejected', states: ['REJECTED_BY_CTO', 'REJECTED_BY_CLIENT'], icon: XCircle },
]

const DAY_LABELS = ['', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const getDayOfWeek = (year, month, day) => new Date(year, month - 1, day).getDay()

function fmtTs(ts) {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts._seconds ? ts._seconds * 1000 : ts)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function Approvals() {
  const [timesheets, setTimesheets] = useState([])
  const [activeTab, setActiveTab] = useState('pending')
  const [expandedId, setExpandedId] = useState(null)
  const [actionModal, setActionModal] = useState(null) // { ts, decision }
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState(null)

  useEffect(() => {
    const q = query(collection(db, 'timesheets'), orderBy('submitted_at', 'desc'))
    const unsub = onSnapshot(q, snap => setTimesheets(snap.docs.map(d => ({ id: d.id, ...d.data() }))), err => console.warn('Timesheets listener:', err.message))
    return () => unsub()
  }, [])

  const tabCounts = useMemo(() => {
    const counts = {}
    TABS.forEach(t => { counts[t.key] = timesheets.filter(ts => t.states.includes(ts.state)).length })
    return counts
  }, [timesheets])

  const filtered = useMemo(() => {
    const tab = TABS.find(t => t.key === activeTab)
    return timesheets.filter(ts => tab.states.includes(ts.state))
  }, [timesheets, activeTab])

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 4000) }

  const handleAction = async () => {
    if (!actionModal) return
    const { ts, decision } = actionModal
    if (decision === 'REJECT' && !notes.trim()) { showToast('Rejection notes are required', 'error'); return }
    setSubmitting(true)
    try {
      const user = auth.currentUser
      if (!user) throw new Error('Not signed in')
      const idToken = await user.getIdToken()
      const res = await fetch(CTO_APPROVE_TIMESHEET_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ timesheet_id: ts.timesheet_id, decision, notes: notes.trim() || null }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      showToast(data.message)
      setActionModal(null)
      setNotes('')
    } catch (err) { showToast(err.message, 'error') }
    setSubmitting(false)
  }

  const dayTypeColor = (type) => {
    if (type === 'in_house') return '#34BF3A'
    if (type === 'remote') return '#1598CC'
    if (type?.startsWith('leave')) return '#F39C12'
    if (type === 'weekend' || type === 'holiday') return '#8898aa'
    return 'var(--text-primary)'
  }

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Timesheet Approvals</h1>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: 4 }}>Review, approve, or reject engineer timesheets. 48hr SLA before CEO escalation.</p>
      </div>

      {toast && (
        <div className="animate-fade-in-up" style={{ padding: '12px 20px', background: toast.type === 'error' ? 'rgba(192,57,43,0.12)' : 'rgba(52,191,58,0.12)', border: `1px solid ${toast.type === 'error' ? 'rgba(192,57,43,0.3)' : 'rgba(52,191,58,0.3)'}`, borderRadius: 'var(--radius-md)', marginBottom: 16, fontSize: '0.82rem', color: toast.type === 'error' ? '#C0392B' : '#34BF3A', display: 'flex', alignItems: 'center', gap: 8 }}>
          {toast.type === 'error' ? <XCircle size={16} /> : <CheckCircle size={16} />} {toast.msg}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: 'var(--bg-surface)', borderRadius: 'var(--radius-md)', padding: 4, border: '1px solid var(--border-primary)' }}>
        {TABS.map(tab => {
          const Icon = tab.icon
          const isActive = activeTab === tab.key
          return (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '10px 12px', border: 'none', borderRadius: 8, fontFamily: 'inherit', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
              background: isActive ? 'var(--bg-card)' : 'transparent', color: isActive ? 'var(--text-primary)' : 'var(--text-tertiary)',
              boxShadow: isActive ? 'var(--shadow-card)' : 'none', transition: 'all 0.2s',
            }}>
              <Icon size={14} /> {tab.label}
              {tabCounts[tab.key] > 0 && (
                <span style={{ background: isActive ? (tab.key === 'pending' || tab.key === 'escalated' ? '#EF5829' : 'var(--text-tertiary)') : 'var(--text-tertiary)', color: '#fff', fontSize: '0.6rem', fontWeight: 700, padding: '1px 7px', borderRadius: 10, minWidth: 18, textAlign: 'center' }}>
                  {tabCounts[tab.key]}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--text-tertiary)' }}>
          <ClipboardCheck size={40} style={{ marginBottom: 12, opacity: 0.3 }} />
          <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>No timesheets in this category</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map((ts, i) => {
            const isExpanded = expandedId === ts.timesheet_id
            const sc = STATE_CONFIG[ts.state] || { label: ts.state, color: '#8898aa', bg: 'rgba(136,152,170,0.12)' }
            const daysInMonth = new Date(ts.period_year, ts.period_month, 0).getDate()
            return (
              <div key={ts.timesheet_id} className="animate-fade-in-up" style={{ animationDelay: `${i * 0.03}s`, background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 'var(--radius-lg)', borderLeft: `4px solid ${sc.color}`, boxShadow: 'var(--shadow-card)' }}>
                {/* Header */}
                <div style={{ padding: '16px 20px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14 }} onClick={() => setExpandedId(isExpanded ? null : ts.timesheet_id)}>
                  <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg, #34BF3A, #1598CC)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: '0.7rem', flexShrink: 0 }}>
                    {ts.engineer_name?.split(' ').map(n => n[0]).join('').slice(0, 2)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                      <span style={{ fontWeight: 700, fontSize: '0.92rem' }}>{ts.engineer_name}</span>
                      <span style={{ padding: '2px 10px', borderRadius: 12, fontSize: '0.62rem', fontWeight: 600, background: sc.bg, color: sc.color }}>{sc.label}</span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                      {ts.project_name} · {ts.client_name} · {ts.period_label}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{ts.total_hours}h</div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)' }}>
                      {ts.in_house_hours}h office · {ts.remote_hours}h remote
                    </div>
                  </div>
                  <ChevronDown size={16} color="var(--text-tertiary)" style={{ flexShrink: 0, transition: 'transform 0.2s', transform: isExpanded ? 'rotate(180deg)' : 'none' }} />
                </div>

                {/* Expanded Detail */}
                {isExpanded && (
                  <div style={{ padding: '0 20px 20px', borderTop: '1px solid var(--border-primary)', paddingTop: 16 }}>
                    {/* Hours Breakdown */}
                    <div style={{ display: 'flex', gap: 16, marginBottom: 16, fontSize: '0.78rem' }}>
                      <div style={{ padding: '8px 14px', borderRadius: 8, background: 'rgba(52,191,58,0.08)', border: '1px solid rgba(52,191,58,0.2)' }}>
                        <div style={{ color: '#34BF3A', fontWeight: 700 }}>{ts.in_house_hours}h</div><div style={{ color: 'var(--text-tertiary)', fontSize: '0.68rem' }}>In-House</div>
                      </div>
                      <div style={{ padding: '8px 14px', borderRadius: 8, background: 'rgba(21,152,204,0.08)', border: '1px solid rgba(21,152,204,0.2)' }}>
                        <div style={{ color: '#1598CC', fontWeight: 700 }}>{ts.remote_hours}h</div><div style={{ color: 'var(--text-tertiary)', fontSize: '0.68rem' }}>Remote</div>
                      </div>
                      <div style={{ padding: '8px 14px', borderRadius: 8, background: 'rgba(243,156,18,0.08)', border: '1px solid rgba(243,156,18,0.2)' }}>
                        <div style={{ color: '#F39C12', fontWeight: 700 }}>{ts.leave_hours}h</div><div style={{ color: 'var(--text-tertiary)', fontSize: '0.68rem' }}>Leave</div>
                      </div>
                      <div style={{ padding: '8px 14px', borderRadius: 8, background: 'var(--bg-surface)', border: '1px solid var(--border-primary)' }}>
                        <div style={{ fontWeight: 700 }}>{ts.total_hours}h</div><div style={{ color: 'var(--text-tertiary)', fontSize: '0.68rem' }}>Total</div>
                      </div>
                    </div>

                    {/* Daily Grid Preview */}
                    {ts.days && (
                      <div style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-tertiary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                          <Calendar size={12} style={{ verticalAlign: -1, marginRight: 4 }} /> Daily Breakdown
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(36px, 1fr))', gap: 3 }}>
                          {Array.from({ length: daysInMonth }, (_, i) => {
                            const day = String(i + 1)
                            const entry = ts.days[day] || {}
                            const dow = getDayOfWeek(ts.period_year, ts.period_month, i + 1)
                            const isWknd = dow === 5 || dow === 6
                            return (
                              <div key={day} title={`Day ${day}: ${entry.type || 'none'} — ${entry.hours || 0}h`} style={{
                                textAlign: 'center', padding: '4px 2px', borderRadius: 4, fontSize: '0.6rem',
                                background: isWknd ? 'rgba(136,152,170,0.08)' : entry.hours > 0 ? `${dayTypeColor(entry.type)}15` : 'var(--bg-surface)',
                                border: `1px solid ${entry.hours > 0 ? `${dayTypeColor(entry.type)}30` : 'var(--border-primary)'}`,
                              }}>
                                <div style={{ color: 'var(--text-tertiary)', fontSize: '0.5rem' }}>{day}</div>
                                <div style={{ fontWeight: 700, color: dayTypeColor(entry.type) }}>{entry.hours || '—'}</div>
                              </div>
                            )
                          })}
                        </div>
                        <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: '0.6rem', color: 'var(--text-tertiary)' }}>
                          <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#34BF3A', marginRight: 3, verticalAlign: -1 }} />Office</span>
                          <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#1598CC', marginRight: 3, verticalAlign: -1 }} />Remote</span>
                          <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#F39C12', marginRight: 3, verticalAlign: -1 }} />Leave</span>
                          <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#8898aa', marginRight: 3, verticalAlign: -1 }} />Weekend/Holiday</span>
                        </div>
                      </div>
                    )}

                    {/* Meta */}
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginBottom: 16 }}>
                      <span>Submitted: {fmtTs(ts.submitted_at)}</span>
                      {ts.cto_action_at && <span> · Reviewed: {fmtTs(ts.cto_action_at)} by {ts.cto_action_by}</span>}
                      {ts.rejection_reason && <div style={{ marginTop: 4, color: '#C0392B' }}>Reason: {ts.rejection_reason}</div>}
                    </div>

                    {/* Action Buttons */}
                    {(ts.state === 'SUBMITTED' || ts.state === 'CEO_ESCALATED') && (
                      <div style={{ display: 'flex', gap: 10 }}>
                        <button onClick={(e) => { e.stopPropagation(); setActionModal({ ts, decision: 'APPROVE' }); setNotes('') }} style={{
                          display: 'flex', alignItems: 'center', gap: 6, padding: '10px 20px', border: 'none', borderRadius: 8,
                          background: '#34BF3A', color: '#fff', fontWeight: 700, fontSize: '0.85rem', fontFamily: 'inherit', cursor: 'pointer', boxShadow: '0 2px 8px rgba(52,191,58,0.3)',
                        }}>
                          <CheckCircle size={16} /> Approve
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); setActionModal({ ts, decision: 'REJECT' }); setNotes('') }} style={{
                          display: 'flex', alignItems: 'center', gap: 6, padding: '10px 20px', border: '1px solid rgba(192,57,43,0.3)', borderRadius: 8,
                          background: 'rgba(192,57,43,0.08)', color: '#C0392B', fontWeight: 700, fontSize: '0.85rem', fontFamily: 'inherit', cursor: 'pointer',
                        }}>
                          <XCircle size={16} /> Reject
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Action Modal */}
      {actionModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }} onClick={() => { setActionModal(null); setNotes('') }} />
          <div className="animate-fade-in-up" style={{ position: 'relative', background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 'var(--radius-xl)', padding: 32, width: '90%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: 8 }}>
              {actionModal.decision === 'APPROVE' ? '✅ Approve Timesheet' : '❌ Reject Timesheet'}
            </h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-tertiary)', marginBottom: 20 }}>
              {actionModal.ts.engineer_name} — {actionModal.ts.period_label} — {actionModal.ts.total_hours}h
            </p>

            <div className="form-group" style={{ marginBottom: 20 }}>
              <label className="form-label">
                <MessageSquare size={12} style={{ verticalAlign: -1, marginRight: 4 }} />
                {actionModal.decision === 'REJECT' ? 'Rejection reason (required)' : 'Notes (optional)'}
              </label>
              <textarea className="form-input" rows={3} value={notes} onChange={e => setNotes(e.target.value)}
                placeholder={actionModal.decision === 'REJECT' ? 'Explain why this timesheet is being rejected...' : 'Optional approval notes...'}
                style={{ resize: 'vertical', minHeight: 80 }}
              />
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => { setActionModal(null); setNotes('') }} className="btn btn-ghost" disabled={submitting}>Cancel</button>
              <button onClick={handleAction} disabled={submitting} style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '10px 24px', border: 'none', borderRadius: 8,
                background: actionModal.decision === 'APPROVE' ? '#34BF3A' : '#C0392B', color: '#fff',
                fontWeight: 700, fontSize: '0.85rem', fontFamily: 'inherit', cursor: submitting ? 'wait' : 'pointer', opacity: submitting ? 0.7 : 1,
              }}>
                <Send size={14} /> {submitting ? 'Submitting...' : actionModal.decision === 'APPROVE' ? 'Confirm Approval' : 'Confirm Rejection'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
