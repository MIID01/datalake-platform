import { useState, useEffect, useMemo } from 'react'
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore'
import { db, CTO_APPROVE_TIMESHEET_URL } from '../../lib/firebase'
import { auth } from '../../lib/firebase'
import { ClipboardCheck, CheckCircle, XCircle, Clock, AlertTriangle, Calendar, ChevronDown, Send, MessageSquare, Bot, Mail } from 'lucide-react'

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
    TABS.forEach(t => { counts[t.key] = timesheets.filter(ts => t.states.includes(ts.state || ts.status)).length })
    return counts
  }, [timesheets])

  const filtered = useMemo(() => {
    const tab = TABS.find(t => t.key === activeTab)
    return timesheets.filter(ts => tab.states.includes(ts.state || ts.status))
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
      
      const token = await user.getIdToken()
      const res = await fetch(CTO_APPROVE_TIMESHEET_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          timesheet_id: ts.id,
          decision: decision,
          notes: notes.trim()
        })
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to process timesheet')
      
      showToast(`Timesheet ${decision === 'APPROVE' ? 'approved' : 'rejected'} successfully`)
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
        <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: 4 }}>Review, approve, or reject engineer timesheets. 48hr SLA before Management escalation.</p>
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
                      {ts.ai_validation_status && (
                        <div title={ts.ai_validation_reason || 'AI Validation'} style={{
                          display: 'flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 12,
                          fontSize: '0.62rem', fontWeight: 700,
                          background: ts.ai_validation_status === 'PASSED' ? '#eafbe7' : ts.ai_validation_status === 'FAILED' ? '#fdecea' : '#fff3cd',
                          color: ts.ai_validation_status === 'PASSED' ? '#27ae60' : ts.ai_validation_status === 'FAILED' ? '#C0392B' : '#F39C12',
                          border: `1px solid ${ts.ai_validation_status === 'PASSED' ? '#27ae60' : ts.ai_validation_status === 'FAILED' ? '#C0392B' : '#F39C12'}`
                        }}>
                          <Bot size={12} /> {ts.ai_validation_status === 'PASSED' ? 'AI: PASS' : ts.ai_validation_status === 'FAILED' ? 'AI: FAIL' : 'AI: PEND'}
                        </div>
                      )}
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

                    {/* Submitted entries — the engineer's ACTUAL input (primary content) */}
                    {ts.days && (
                      <div style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-tertiary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                          <Calendar size={12} style={{ verticalAlign: -1, marginRight: 4 }} /> Submitted Timesheet — {ts.period_label}
                        </div>
                        <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginBottom: 8 }}>
                          <strong>Project:</strong> {ts.project_name || '—'}{ts.po_number ? <> · <strong>PO:</strong> {ts.po_number}</> : ''} · <strong>Client:</strong> {ts.client_name || '—'}
                        </div>
                        {ts.notes && (
                          <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginBottom: 8, padding: '8px 12px', background: 'var(--bg-surface)', borderRadius: 6 }}>
                            <strong>Notes from engineer:</strong> {ts.notes}
                          </div>
                        )}
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                          <thead>
                            <tr style={{ textAlign: 'left', color: 'var(--text-tertiary)', fontSize: '0.66rem', textTransform: 'uppercase' }}>
                              <th style={{ padding: '6px 10px' }}>Date</th>
                              <th style={{ padding: '6px 10px' }}>Day</th>
                              <th style={{ padding: '6px 10px' }}>Type</th>
                              <th style={{ padding: '6px 10px', textAlign: 'right' }}>Hours</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.keys(ts.days).filter(d => Number(ts.days[d]?.hours) > 0).sort((a, b) => Number(a) - Number(b)).map(d => {
                              const entry = ts.days[d]
                              const dow = getDayOfWeek(ts.period_year, ts.period_month, Number(d))
                              const typeLabel = entry.type === 'in_house' ? 'Office' : entry.type === 'remote' ? 'Remote' : String(entry.type || '').startsWith('leave') ? 'Leave' : (entry.type || '—')
                              return (
                                <tr key={d} style={{ borderTop: '1px solid var(--border-primary)' }}>
                                  <td style={{ padding: '6px 10px' }}>{String(d).padStart(2, '0')} {String(ts.period_label || '').split(' ')[0]}</td>
                                  <td style={{ padding: '6px 10px', color: 'var(--text-tertiary)' }}>{DAY_LABELS[dow + 1]}</td>
                                  <td style={{ padding: '6px 10px', color: dayTypeColor(entry.type), fontWeight: 600 }}>{typeLabel}</td>
                                  <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700 }}>{entry.hours}h</td>
                                </tr>
                              )
                            })}
                          </tbody>
                          <tfoot>
                            <tr style={{ borderTop: '2px solid var(--border-primary)', fontWeight: 700 }}>
                              <td style={{ padding: '8px 10px' }} colSpan={3}>Total</td>
                              <td style={{ padding: '8px 10px', textAlign: 'right' }}>{ts.total_hours}h</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    )}

                    {/* Attribution + AI advisory — submitter and validator are NOT the same actor */}
                    <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div><strong>Submitted by:</strong> {ts.engineer_name}{ts.engineer_email ? ` (${ts.engineer_email})` : ''} · {fmtTs(ts.submitted_at)}</div>
                      {ts.cto_action_at && <div><strong>Reviewed / approved by:</strong> {ts.cto_action_by} · {fmtTs(ts.cto_action_at)}</div>}
                      {ts.ai_validation_status && (
                        <div style={{ padding: '8px 12px', borderRadius: 6, background: 'var(--bg-surface)', borderLeft: `3px solid ${ts.ai_validation_status === 'PASSED' ? '#27ae60' : ts.ai_validation_status === 'FAILED' ? '#C0392B' : '#F39C12'}` }}>
                          <strong style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Bot size={13} /> AI validation (advisory): {ts.ai_validation_status}
                          </strong>
                          {ts.ai_validation_reason && <div style={{ marginTop: 3, color: 'var(--text-tertiary)' }}>{ts.ai_validation_reason}</div>}
                          <div style={{ marginTop: 3, fontStyle: 'italic', color: 'var(--text-tertiary)', fontSize: '0.68rem' }}>
                            Advisory only — produced by the AI validator, not the employee. The approval decision is yours, based on the submitted entries above.
                          </div>
                        </div>
                      )}
                      {ts.rejection_reason && <div style={{ color: '#C0392B' }}>Rejection reason: {ts.rejection_reason}</div>}
                    </div>

                    {/* Client sign-off tracking — auditable proof: sent → opened → signed */}
                    {(ts.state === 'CTO_APPROVED' || ts.state === 'CLIENT_SIGNED' || ts.sign_link_status) && (
                      <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, background: 'var(--bg-surface)', border: '1px solid var(--border-primary)', fontSize: '0.76rem' }}>
                        <div style={{ fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, fontSize: '0.68rem' }}>
                          <Mail size={12} style={{ verticalAlign: -1, marginRight: 4 }} /> Client sign-off tracking
                        </div>
                        <div style={{ marginBottom: 4 }}>
                          {ts.sign_link_status === 'SENT' ? (
                            <span style={{ color: '#34BF3A' }}>✓ Sign link sent to <strong>{ts.sign_link_to}</strong> on {fmtTs(ts.sign_link_sent_at)}{ts.sign_link_message_id ? <> · messageId <code style={{ fontFamily: 'var(--font-mono)' }}>{ts.sign_link_message_id}</code></> : ''}</span>
                          ) : ts.sign_link_status === 'NO_RECIPIENT' ? (
                            <span style={{ color: '#C0392B' }}>✗ No client approver email on the project — sign link could not be sent. Add a client contact to the project, then re-approve.</span>
                          ) : ts.sign_link_status === 'SEND_FAILED' ? (
                            <span style={{ color: '#C0392B' }}>✗ Sign link send FAILED to {ts.sign_link_to}: {ts.sign_link_send_error || 'unknown error'}</span>
                          ) : (
                            <span style={{ color: 'var(--text-tertiary)' }}>Sign link status pending…</span>
                          )}
                        </div>
                        <div style={{ marginBottom: 4 }}>
                          {ts.sign_link_first_opened_at
                            ? <span style={{ color: '#1598CC' }}>✓ Opened by client on {fmtTs(ts.sign_link_first_opened_at)}{ts.sign_link_open_count ? ` (${ts.sign_link_open_count}×)` : ''}</span>
                            : <span style={{ color: 'var(--text-tertiary)' }}>Not yet opened by the client</span>}
                        </div>
                        <div>
                          {(ts.state === 'CLIENT_SIGNED' || ts.client_action_at)
                            ? <span style={{ color: '#34BF3A' }}>✓ Signed on {fmtTs(ts.client_action_at)}{ts.client_signature_method ? ` · ${ts.client_signature_method}` : ''}</span>
                            : <span style={{ color: 'var(--text-tertiary)' }}>Awaiting client signature</span>}
                        </div>
                      </div>
                    )}

                    {/* Signed PDF Link */}
                    {ts.signed_pdf_url && (
                      <div style={{ marginBottom: 16 }}>
                        <a href={ts.signed_pdf_url} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: '#eafbe7', color: '#27ae60', border: '1px solid #27ae60', borderRadius: 6, fontSize: '0.8rem', fontWeight: 600, textDecoration: 'none' }}>
                          <CheckCircle size={14} /> View Signed Audit Record (PDF)
                        </a>
                      </div>
                    )}

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
