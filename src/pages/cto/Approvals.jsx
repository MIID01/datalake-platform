import { useState, useEffect, useMemo } from 'react'
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore'
import { db, CTO_APPROVE_TIMESHEET_URL, RESEND_SIGN_LINK_URL } from '../../lib/firebase'
import { auth } from '../../lib/firebase'
import {
  ClipboardCheck, CheckCircle, XCircle, Clock, AlertTriangle,
  Calendar, ChevronDown, Send, MessageSquare, Bot, User, Hash,
  Briefcase, FileText, Mail, RefreshCw,
} from 'lucide-react'

// ─── constants ────────────────────────────────────────────────────────────────

const STATE_CONFIG = {
  SUBMITTED:          { label: 'Pending Review', color: '#EF5829', bg: 'rgba(239,88,41,0.12)' },
  CEO_ESCALATED:      { label: 'Escalated',      color: '#F39C12', bg: 'rgba(243,156,18,0.12)' },
  CTO_APPROVED:       { label: 'Approved',        color: '#34BF3A', bg: 'rgba(52,191,58,0.12)' },
  REJECTED_BY_CTO:    { label: 'Rejected',        color: '#C0392B', bg: 'rgba(192,57,43,0.12)' },
  CLIENT_SIGNED:      { label: 'Client Signed',   color: '#1598CC', bg: 'rgba(21,152,204,0.12)' },
  REJECTED_BY_CLIENT: { label: 'Client Rejected', color: '#C0392B', bg: 'rgba(192,57,43,0.12)' },
  DRAFT:              { label: 'Draft',            color: '#8898aa', bg: 'rgba(136,152,170,0.12)' },
}

const TABS = [
  { key: 'pending',   label: 'Pending',   states: ['SUBMITTED'],                              icon: Clock },
  { key: 'escalated', label: 'Escalated', states: ['CEO_ESCALATED'],                          icon: AlertTriangle },
  { key: 'approved',  label: 'Approved',  states: ['CTO_APPROVED', 'CLIENT_SIGNED'],          icon: CheckCircle },
  { key: 'rejected',  label: 'Rejected',  states: ['REJECTED_BY_CTO', 'REJECTED_BY_CLIENT', 'DRAFT'], icon: XCircle },
]

const TYPE_LABEL = {
  in_house:              'Office',
  remote:                'Remote',
  leave_annual:          'Annual Leave',
  leave_sick:            'Sick Leave',
  leave_public_holiday:  'Public Holiday',
  weekend:               'Weekend',
  holiday:               'Holiday',
}

const TYPE_COLOR = {
  in_house:             '#34BF3A',
  remote:               '#1598CC',
  leave_annual:         '#F39C12',
  leave_sick:           '#F39C12',
  leave_public_holiday: '#8898aa',
  weekend:              '#8898aa',
  holiday:              '#8898aa',
}

const AI_STATUS_CFG = {
  AI_VALID:        { label: 'AI: PASS',        bg: '#eafbe7', color: '#27ae60', border: '#27ae60' },
  AI_FLAGGED:      { label: 'AI: FLAGGED',     bg: '#fdecea', color: '#C0392B', border: '#C0392B' },
  AI_INCONCLUSIVE: { label: 'AI: INCONCLUSIVE',bg: '#fff3cd', color: '#F39C12', border: '#F39C12' },
  // legacy naming
  PASSED:          { label: 'AI: PASS',        bg: '#eafbe7', color: '#27ae60', border: '#27ae60' },
  FAILED:          { label: 'AI: FLAGGED',     bg: '#fdecea', color: '#C0392B', border: '#C0392B' },
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtTs(ts) {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts._seconds ? ts._seconds * 1000 : ts)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** Build sorted array of day entries that have hours > 0 */
function buildLineItems(ts) {
  if (!ts.days) return []
  return Object.keys(ts.days)
    .filter(d => Number(ts.days[d]?.hours) > 0)
    .sort((a, b) => Number(a) - Number(b))
    .map(d => {
      const entry = ts.days[d]
      const isoDate = `${ts.period_year}-${String(ts.period_month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      const dow = new Date(isoDate).toLocaleDateString('en-US', { weekday: 'short' })
      return {
        day: d,
        isoDate,
        dow,
        hours: Number(entry.hours),
        type: entry.type || null,
        typeLabel: TYPE_LABEL[entry.type] || entry.type || '—',
        typeColor: TYPE_COLOR[entry.type] || 'var(--text-tertiary)',
        description: entry.description || entry.task || entry.notes || null,
        project: entry.project || null,
        po: entry.po || null,
      }
    })
}

// ─── sub-components ───────────────────────────────────────────────────────────

/** Full timesheet line-item table — the primary review surface */
function TimesheetDetail({ ts, showToast }) {
  const lineItems = buildLineItems(ts)
  const aiCfg = AI_STATUS_CFG[ts.ai_validation_status] || null
  const [resending, setResending] = useState(false)

  // Resend the client sign-link. The token never leaves the server — this asks
  // the backend to re-email the existing link to the client approver and log a
  // fresh email_log row. The live timesheets listener reflects the updated
  // sign_link_status / sent_at / messageId automatically.
  const resendSignLink = async () => {
    setResending(true)
    try {
      const idToken = await auth.currentUser.getIdToken()
      const res = await fetch(RESEND_SIGN_LINK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ timesheet_id: ts.id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Resend failed')
      showToast?.(`Sign link re-sent to ${data.to}${data.message_id ? ` · messageId ${data.message_id}` : ''}`)
    } catch (err) {
      showToast?.(err.message || 'Could not resend the sign link.', 'error')
    } finally {
      setResending(false)
    }
  }

  return (
    <div style={{ padding: '0 20px 20px', borderTop: '1px solid var(--border-primary)', paddingTop: 20 }}>

      {/* ── 1. Submission provenance — corrected attribution ── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18, fontSize: '0.75rem' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 20, background: 'var(--bg-surface)', border: '1px solid var(--border-primary)' }}>
          <User size={12} color="var(--text-tertiary)" />
          <strong>Submitted by:</strong>&nbsp;{ts.engineer_name || ts.engineer_email || '—'}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 20, background: 'var(--bg-surface)', border: '1px solid var(--border-primary)' }}>
          <Calendar size={12} color="var(--text-tertiary)" />
          <strong>Period:</strong>&nbsp;{ts.period_label || `${ts.period_month}/${ts.period_year}`}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 20, background: 'var(--bg-surface)', border: '1px solid var(--border-primary)' }}>
          <Briefcase size={12} color="var(--text-tertiary)" />
          <strong>Project:</strong>&nbsp;{ts.project_name || '—'}
        </span>
        {ts.po_number && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 20, background: 'var(--bg-surface)', border: '1px solid var(--border-primary)' }}>
            <Hash size={12} color="var(--text-tertiary)" />
            <strong>PO:</strong>&nbsp;{ts.po_number}
          </span>
        )}
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 20, background: 'var(--bg-surface)', border: '1px solid var(--border-primary)' }}>
          <Clock size={12} color="var(--text-tertiary)" />
          <strong>Submitted:</strong>&nbsp;{fmtTs(ts.submitted_at)}
        </span>
      </div>

      {/* ── 2. Totals bar ── */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        {[
          { label: 'Total',       h: ts.total_hours,     color: 'var(--text-primary)', bg: 'var(--bg-surface)',          border: 'var(--border-primary)' },
          { label: 'Office',      h: ts.in_house_hours,  color: '#34BF3A',              bg: 'rgba(52,191,58,0.08)',       border: 'rgba(52,191,58,0.25)' },
          { label: 'Remote',      h: ts.remote_hours,    color: '#1598CC',              bg: 'rgba(21,152,204,0.08)',      border: 'rgba(21,152,204,0.25)' },
          { label: 'Leave',       h: ts.leave_hours,     color: '#F39C12',              bg: 'rgba(243,156,18,0.08)',      border: 'rgba(243,156,18,0.25)' },
        ].map(({ label, h, color, bg, border }) => (
          <div key={label} style={{ padding: '8px 16px', borderRadius: 8, background: bg, border: `1px solid ${border}`, minWidth: 70, textAlign: 'center' }}>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color }}>{h || 0}h</div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* ── 3. Line-item table — the actual engineer input ── */}
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-tertiary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: 5 }}>
          <FileText size={12} /> Submitted Line Items&nbsp;
          <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>({lineItems.length} working days)</span>
        </div>
        <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid var(--border-primary)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
            <thead>
              <tr style={{ background: 'var(--bg-surface)' }}>
                {['Date', 'Day', 'Hours', 'Type', 'Task / Description'].map(h => (
                  <th key={h} style={{ padding: '7px 12px', textAlign: 'left', fontWeight: 600, color: 'var(--text-tertiary)', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border-primary)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lineItems.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: '20px 12px', textAlign: 'center', color: 'var(--text-tertiary)' }}>No line entries with hours &gt; 0</td></tr>
              ) : lineItems.map((li, idx) => (
                <tr key={li.isoDate} style={{ background: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)', borderBottom: '1px solid var(--border-primary)' }}>
                  <td style={{ padding: '7px 12px', color: 'var(--text-primary)', fontFamily: 'var(--font-mono, monospace)', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>{li.isoDate}</td>
                  <td style={{ padding: '7px 12px', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>{li.dow}</td>
                  <td style={{ padding: '7px 12px', fontWeight: 700, color: li.typeColor }}>{li.hours}h</td>
                  <td style={{ padding: '7px 12px', whiteSpace: 'nowrap' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 10, background: `${li.typeColor}18`, color: li.typeColor, fontSize: '0.68rem', fontWeight: 600 }}>
                      {li.typeLabel}
                    </span>
                  </td>
                  <td style={{ padding: '7px 12px', color: 'var(--text-secondary)', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {li.description || <span style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: 'var(--bg-surface)', borderTop: '2px solid var(--border-primary)' }}>
                <td colSpan={2} style={{ padding: '8px 12px', fontWeight: 700, fontSize: '0.78rem' }}>Total</td>
                <td style={{ padding: '8px 12px', fontWeight: 700, color: 'var(--text-primary)' }}>{ts.total_hours || 0}h</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* ── 4. Engineer notes (if any) ── */}
      {ts.notes && (
        <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, background: 'var(--bg-surface)', border: '1px solid var(--border-primary)', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          <strong style={{ display: 'block', marginBottom: 4, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)' }}>Engineer notes</strong>
          {ts.notes}
        </div>
      )}

      {/* ── 5. AI advisory — labelled correctly, clearly secondary ── */}
      {ts.ai_validation_status && (
        <div style={{ marginBottom: 16, padding: '12px 14px', borderRadius: 8, background: aiCfg ? `${aiCfg.bg}` : 'rgba(136,152,170,0.08)', border: `1px solid ${aiCfg ? aiCfg.border : '#8898aa'}30` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <Bot size={14} color={aiCfg?.color || '#8898aa'} />
            <span style={{ fontWeight: 700, fontSize: '0.75rem', color: aiCfg?.color || '#8898aa' }}>
              AI Advisory — pre-screened by Datalake Controller AI
            </span>
            {aiCfg && (
              <span style={{ marginLeft: 'auto', padding: '2px 8px', borderRadius: 10, background: aiCfg.bg, color: aiCfg.color, border: `1px solid ${aiCfg.border}`, fontSize: '0.65rem', fontWeight: 700 }}>
                {aiCfg.label}
              </span>
            )}
          </div>
          {ts.ai_validation?.issues?.length > 0 && (
            <ul style={{ margin: '4px 0 0 18px', fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              {ts.ai_validation.issues.map((iss, i) => <li key={i}>{iss}</li>)}
            </ul>
          )}
          {ts.ai_validation?.warnings?.length > 0 && (
            <ul style={{ margin: '4px 0 0 18px', fontSize: '0.75rem', color: '#F39C12', lineHeight: 1.6 }}>
              {ts.ai_validation.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
          {ts.ai_validation?.notes && (
            <p style={{ margin: '6px 0 0', fontSize: '0.73rem', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>{ts.ai_validation.notes}</p>
          )}
          {ts.ai_validation_model && (
            <div style={{ marginTop: 6, fontSize: '0.64rem', color: 'var(--text-tertiary)' }}>
              Model: {ts.ai_validation_model}
              {ts.ai_validation_ms ? ` · ${ts.ai_validation_ms}ms` : ''}
              {ts.ai_validated_at ? ` · ${fmtTs(ts.ai_validated_at)}` : ''}
              &nbsp;·&nbsp;<em>Advisory only — the human approver above makes the decision</em>
            </div>
          )}
        </div>
      )}

      {/* ── 6. Prior CTO action (for approved/rejected tabs) ── */}
      {ts.cto_action_at && (
        <div style={{ marginBottom: 16, fontSize: '0.72rem', color: 'var(--text-tertiary)', padding: '8px 12px', borderRadius: 8, background: 'var(--bg-surface)', border: '1px solid var(--border-primary)' }}>
          <strong>CTO decision:</strong> {ts.cto_decision} by {ts.cto_action_by} at {fmtTs(ts.cto_action_at)}
          {ts.cto_notes && <span> — {ts.cto_notes}</span>}
          {ts.rejection_reason && <div style={{ marginTop: 4, color: '#C0392B' }}>Reason: {ts.rejection_reason}</div>}
        </div>
      )}

      {/* ── 6b. Client sign-off tracking — the evidence surface: sent → opened → signed ── */}
      {(ts.state === 'CTO_APPROVED' || ts.state === 'CLIENT_SIGNED' || ts.sign_link_status) && (
        <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, background: 'var(--bg-surface)', border: '1px solid var(--border-primary)', fontSize: '0.76rem' }}>
          <div style={{ fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, fontSize: '0.68rem' }}>
            <Mail size={12} style={{ verticalAlign: -1, marginRight: 4 }} /> Client sign-off tracking
          </div>
          <div style={{ marginBottom: 4 }}>
            {ts.sign_link_status === 'SENT' ? (
              <span style={{ color: '#34BF3A' }}>✓ Sign link sent to <strong>{ts.sign_link_to}</strong> on {fmtTs(ts.sign_link_sent_at)}{ts.sign_link_message_id ? <> · messageId <code style={{ fontFamily: 'var(--font-mono, monospace)' }}>{ts.sign_link_message_id}</code></> : ''}</span>
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
          {ts.state === 'CTO_APPROVED' && (
            <div style={{ marginTop: 10 }}>
              <button onClick={resendSignLink} disabled={resending}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border-primary)', background: 'var(--bg-card)', color: '#1598CC', fontSize: '0.74rem', fontWeight: 600, cursor: resending ? 'wait' : 'pointer' }}>
                <RefreshCw size={13} className={resending ? 'spin' : ''} />
                {resending ? 'Resending…' : (ts.sign_link_resend_count ? `Resend sign link (${ts.sign_link_resend_count}×)` : 'Resend sign link')}
              </button>
              <span style={{ marginLeft: 8, fontSize: '0.68rem', color: 'var(--text-tertiary)' }}>
                Re-emails the same link to {ts.client_approver_email || 'the client approver'} — the link is never shown here.
              </span>
            </div>
          )}
          <style>{`.spin { animation: spin 1s linear infinite; } @keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* ── 7. Signed PDF link ── */}
      {ts.cto_approval_pdf_path && (
        <div style={{ marginBottom: 16 }}>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>
            Approval snapshot written to WORM store: <code style={{ fontSize: '0.68rem' }}>{ts.cto_approval_pdf_path}</code>
          </span>
        </div>
      )}
      {ts.signed_pdf_url && (
        <div style={{ marginBottom: 16 }}>
          <a href={ts.signed_pdf_url} target="_blank" rel="noopener noreferrer"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: '#eafbe7', color: '#27ae60', border: '1px solid #27ae60', borderRadius: 6, fontSize: '0.8rem', fontWeight: 600, textDecoration: 'none' }}>
            <CheckCircle size={14} /> View Signed Audit Record (PDF)
          </a>
        </div>
      )}
    </div>
  )
}

// ─── main component ───────────────────────────────────────────────────────────

export default function Approvals() {
  const [timesheets, setTimesheets]   = useState([])
  const [activeTab, setActiveTab]     = useState('pending')
  const [expandedId, setExpandedId]   = useState(null)
  const [actionModal, setActionModal] = useState(null)   // { ts, decision }
  const [notes, setNotes]             = useState('')
  const [submitting, setSubmitting]   = useState(false)
  const [toast, setToast]             = useState(null)

  useEffect(() => {
    const q = query(collection(db, 'timesheets'), orderBy('submitted_at', 'desc'))
    const unsub = onSnapshot(q,
      snap => setTimesheets(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      err  => console.warn('Timesheets listener:', err.message)
    )
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

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 5000) }

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
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ timesheet_id: ts.id, decision, notes: notes.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to process timesheet')
      showToast(`Timesheet ${decision === 'APPROVE' ? 'approved — snapshot written to evidence store' : 'rejected'}`)
      setActionModal(null)
      setNotes('')
    } catch (err) { showToast(err.message, 'error') }
    setSubmitting(false)
  }

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Timesheet Approvals</h1>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: 4 }}>
          Review the engineer's submitted entries, then approve or reject. AI pre-screening is advisory only. 48hr SLA before management escalation.
        </p>
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
                <span style={{ background: isActive && (tab.key === 'pending' || tab.key === 'escalated') ? '#EF5829' : 'var(--text-tertiary)', color: '#fff', fontSize: '0.6rem', fontWeight: 700, padding: '1px 7px', borderRadius: 10, minWidth: 18, textAlign: 'center' }}>
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
            const isExpanded = expandedId === (ts.timesheet_id || ts.id)
            const sc = STATE_CONFIG[ts.state] || { label: ts.state, color: '#8898aa', bg: 'rgba(136,152,170,0.12)' }
            const aiCfg = AI_STATUS_CFG[ts.ai_validation_status] || null
            return (
              <div key={ts.timesheet_id || ts.id} className="animate-fade-in-up" style={{ animationDelay: `${i * 0.03}s`, background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 'var(--radius-lg)', borderLeft: `4px solid ${sc.color}`, boxShadow: 'var(--shadow-card)' }}>

                {/* ── Card header (always visible) ── */}
                <div style={{ padding: '16px 20px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14 }}
                  onClick={() => setExpandedId(isExpanded ? null : (ts.timesheet_id || ts.id))}>
                  <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg, #34BF3A, #1598CC)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: '0.7rem', flexShrink: 0 }}>
                    {ts.engineer_name?.split(' ').map(n => n[0]).join('').slice(0, 2)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.92rem' }}>{ts.engineer_name}</span>
                      <span style={{ padding: '2px 10px', borderRadius: 12, fontSize: '0.62rem', fontWeight: 600, background: sc.bg, color: sc.color }}>{sc.label}</span>
                      {/* AI badge — clearly labelled as advisory */}
                      {aiCfg && (
                        <span title={`AI Advisory: ${ts.ai_validation_status}`} style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 12,
                          fontSize: '0.62rem', fontWeight: 700, background: aiCfg.bg, color: aiCfg.color, border: `1px solid ${aiCfg.border}30`,
                        }}>
                          <Bot size={10} /> {aiCfg.label}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                      {ts.project_name} · {ts.client_name} · {ts.period_label}
                      {ts.po_number ? ` · PO ${ts.po_number}` : ''}
                    </div>
                  </div>
                  {/* Right: hours summary + expand toggle */}
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{ts.total_hours}h</div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)' }}>
                      {ts.in_house_hours}h office · {ts.remote_hours}h remote
                    </div>
                  </div>
                  <ChevronDown size={16} color="var(--text-tertiary)" style={{ flexShrink: 0, transition: 'transform 0.2s', transform: isExpanded ? 'rotate(180deg)' : 'none' }} />
                </div>

                {/* ── Expanded: full timesheet detail ── */}
                {isExpanded && <TimesheetDetail ts={ts} showToast={showToast} />}

                {/* ── Action buttons (only for actionable states, inside expanded) ── */}
                {isExpanded && (ts.state === 'SUBMITTED' || ts.state === 'CEO_ESCALATED') && (
                  <div style={{ padding: '0 20px 20px', display: 'flex', gap: 10 }}>
                    <button onClick={e => { e.stopPropagation(); setActionModal({ ts, decision: 'APPROVE' }); setNotes('') }} style={{
                      display: 'flex', alignItems: 'center', gap: 6, padding: '10px 20px', border: 'none', borderRadius: 8,
                      background: '#34BF3A', color: '#fff', fontWeight: 700, fontSize: '0.85rem', fontFamily: 'inherit', cursor: 'pointer', boxShadow: '0 2px 8px rgba(52,191,58,0.3)',
                    }}>
                      <CheckCircle size={16} /> Approve
                    </button>
                    <button onClick={e => { e.stopPropagation(); setActionModal({ ts, decision: 'REJECT' }); setNotes('') }} style={{
                      display: 'flex', alignItems: 'center', gap: 6, padding: '10px 20px', border: '1px solid rgba(192,57,43,0.3)', borderRadius: 8,
                      background: 'rgba(192,57,43,0.08)', color: '#C0392B', fontWeight: 700, fontSize: '0.85rem', fontFamily: 'inherit', cursor: 'pointer',
                    }}>
                      <XCircle size={16} /> Reject
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Approval confirmation modal ── */}
      {actionModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }} onClick={() => { setActionModal(null); setNotes('') }} />
          <div className="animate-fade-in-up" style={{ position: 'relative', background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 'var(--radius-xl)', padding: 32, width: '90%', maxWidth: 520, boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: 8 }}>
              {actionModal.decision === 'APPROVE' ? '✅ Approve Timesheet' : '❌ Reject Timesheet'}
            </h3>

            {/* Summary of what is being approved — explicit, not abstract */}
            <div style={{ marginBottom: 20, padding: '12px 14px', borderRadius: 8, background: 'var(--bg-surface)', border: '1px solid var(--border-primary)', fontSize: '0.82rem', lineHeight: 1.7 }}>
              <div><strong>Engineer:</strong> {actionModal.ts.engineer_name} ({actionModal.ts.engineer_email})</div>
              <div><strong>Period:</strong> {actionModal.ts.period_label}</div>
              <div><strong>Project / PO:</strong> {actionModal.ts.project_name}{actionModal.ts.po_number ? ` · PO ${actionModal.ts.po_number}` : ''}</div>
              <div><strong>Total hours:</strong> {actionModal.ts.total_hours}h ({actionModal.ts.in_house_hours}h office, {actionModal.ts.remote_hours}h remote, {actionModal.ts.leave_hours}h leave)</div>
              {actionModal.ts.ai_validation_status && (
                <div style={{ marginTop: 4, fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                  <Bot size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
                  AI advisory: {actionModal.ts.ai_validation_status}
                  {actionModal.ts.ai_validation?.issues?.length ? ` · ${actionModal.ts.ai_validation.issues.length} flag(s)` : ''}
                  &nbsp;— advisory only
                </div>
              )}
            </div>

            {actionModal.decision === 'APPROVE' && (
              <div style={{ marginBottom: 16, padding: '8px 12px', borderRadius: 8, background: 'rgba(52,191,58,0.06)', border: '1px solid rgba(52,191,58,0.2)', fontSize: '0.75rem', color: '#34BF3A' }}>
                Approving will: write an immutable snapshot of these line items + your identity to the evidence store, generate a client sign-link, and log to the WORM audit bucket.
              </div>
            )}

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
                <Send size={14} /> {submitting ? 'Submitting…' : actionModal.decision === 'APPROVE' ? 'Confirm Approval' : 'Confirm Rejection'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
