import { useEffect, useState } from 'react'
import { auth, SEND_HR_EMAIL_URL, LIST_EMAIL_TEMPLATES_URL } from '../lib/firebase'
import { Mail, X, Loader, CheckCircle2, AlertCircle } from 'lucide-react'

// Universal compose modal — used from /hr/employees Send Email per row.
//
//   <SendEmailModal employee={emp} onClose={...} onSent={(logId) => ...} />
//
// Pulls templates from the backend (welcome_credentials + generic). When
// HR picks a template the subject + body fill in from the renderer; HR
// can still edit before sending. On send we POST to sendHrEmail which
// dispatches via the existing m.alqumri@datalake.sa Gmail DWD client and
// writes an email_log row.

export default function SendEmailModal({ employee, onClose, onSent }) {
  const [templates, setTemplates] = useState([{ id: 'generic', label: 'Blank message' }])
  const [templateId, setTemplateId] = useState('welcome_credentials')
  const [to, setTo] = useState(employee?.email || '')
  const [cc, setCc] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [sentInfo, setSentInfo] = useState(null)

  useEffect(() => {
    (async () => {
      try {
        const me = auth.currentUser
        const idToken = await me.getIdToken()
        const res = await fetch(LIST_EMAIL_TEMPLATES_URL, { headers: { Authorization: 'Bearer ' + idToken } })
        const data = await res.json().catch(() => ({}))
        if (Array.isArray(data.templates)) setTemplates(data.templates)
      } catch (_) { /* fall back to defaults */ }
    })()
  }, [])

  // When template changes, prefill from a client-side renderer so HR sees
  // the message before sending (server still re-renders authoritatively).
  useEffect(() => {
    if (!templateId) return
    if (templateId === 'welcome_credentials') {
      setSubject('Welcome to Datalake — your platform access')
      setBody([
        `Dear ${employee?.full_name || to},`,
        ``,
        `Welcome to Datalake Saudi Arabia LLC.`,
        ``,
        `Your account has been provisioned on the Datalake Platform. You may sign in at:`,
        ``,
        `  https://datalake-production-sa.web.app`,
        ``,
        `Username (email): ${to}`,
        `Initial password: (set by IT — use the "Forgot password?" link on the sign-in page to set your own)`,
        ``,
        `Once you sign in, please complete the onboarding flow (PDPL consent + workplace policies) before continuing.`,
        ``,
        `If you have any questions, reply to this email.`,
        ``,
        `— Datalake HR`,
      ].join('\n'))
    } else if (templateId === 'generic') {
      setSubject('')
      setBody('')
    }
  }, [templateId, employee, to])

  const send = async () => {
    if (!to || !subject || !body) { setError('To / subject / body are required.'); return }
    setSending(true); setError('')
    try {
      const me = auth.currentUser
      const idToken = await me.getIdToken()
      const res = await fetch(SEND_HR_EMAIL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
        body: JSON.stringify({
          to, cc: cc || null,
          subject, body, template_id: templateId === 'generic' ? null : templateId,
          employee_id: employee?.employee_id || employee?.id || null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Send failed (${res.status})`)
      setSentInfo(data)
      onSent?.(data.log_id)
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }} onClick={() => !sending && onClose()}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-surface, #fff)', borderRadius: 12, padding: 22, width: 620, maxWidth: '100%', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Mail size={18} color="#022873" /> Send email
          </h3>
          <button onClick={() => !sending && onClose()} style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}><X size={18} /></button>
        </div>
        <p style={{ fontSize: '0.76rem', color: 'var(--text-tertiary)', margin: '0 0 14px', lineHeight: 1.5 }}>
          Sent from <strong>m.alqumri@datalake.sa</strong> (HR/CEO mailbox) — replies route back to that inbox. Stamped in email_log.
        </p>

        {sentInfo ? (
          <div style={{ background: 'rgba(52,191,58,0.08)', border: '1px solid rgba(52,191,58,0.3)', borderRadius: 8, padding: 16, textAlign: 'center' }}>
            <CheckCircle2 size={28} color="#34BF3A" style={{ margin: '0 auto 8px' }} />
            <div style={{ fontSize: '0.92rem', fontWeight: 700, color: '#34BF3A', marginBottom: 4 }}>Sent</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              email_log: <code>{sentInfo.log_id}</code><br/>
              Gmail message ID: <code>{sentInfo.gmail_message_id || '—'}</code>
            </div>
            <button onClick={onClose} style={{ marginTop: 14, padding: '8px 16px', borderRadius: 6, border: '1px solid #022873', background: '#022873', color: '#fff', fontWeight: 600, fontSize: '0.84rem', cursor: 'pointer', fontFamily: 'inherit' }}>Close</button>
          </div>
        ) : (
          <>
            <Field label="Template">
              <select value={templateId} onChange={e => setTemplateId(e.target.value)} style={inp()}>
                {templates.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="To"><input value={to} onChange={e => setTo(e.target.value)} type="email" style={inp()} /></Field>
            <Field label="CC (optional)"><input value={cc} onChange={e => setCc(e.target.value)} style={inp()} placeholder="someone@…" /></Field>
            <Field label="Subject"><input value={subject} onChange={e => setSubject(e.target.value)} style={inp()} /></Field>
            <Field label="Body">
              <textarea value={body} onChange={e => setBody(e.target.value)} rows={12} style={{ ...inp(), resize: 'vertical', fontFamily: 'monospace', fontSize: '0.82rem' }} />
            </Field>

            {error && (
              <div style={{ marginTop: 8, padding: 10, background: 'rgba(192,57,43,0.1)', border: '1px solid rgba(192,57,43,0.3)', borderRadius: 6, color: '#C0392B', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertCircle size={14} /> {error}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
              <button onClick={onClose} disabled={sending} style={btn('ghost')}>Cancel</button>
              <button onClick={send} disabled={sending} style={btn('primary', sending)}>
                {sending ? <><Loader size={13} className="spin" /> Sending…</> : <><Mail size={13} /> Send</>}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ fontSize: '0.74rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  )
}
function inp() {
  return { width: '100%', padding: '9px 12px', borderRadius: 6, border: '1px solid var(--border-primary, #E5E7EB)', background: 'var(--bg-surface, #fff)', color: 'var(--text-primary)', fontSize: '0.86rem', fontFamily: 'inherit', boxSizing: 'border-box' }
}
function btn(kind, disabled) {
  const base = { padding: '8px 16px', borderRadius: 6, fontSize: '0.84rem', fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6 }
  if (kind === 'primary') return { ...base, background: disabled ? '#94a3b8' : '#022873', color: '#fff', border: '1px solid #022873' }
  return { ...base, background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border-primary, #E5E7EB)' }
}
