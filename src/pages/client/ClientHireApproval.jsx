import { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import {
  collection, query, where, getDocs, doc, getDoc, updateDoc, deleteDoc,
  serverTimestamp, addDoc, FieldValue,
} from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { LEGAL_FOOTER_EN, LEGAL_FOOTER_AR, COMPANY } from '../../lib/company-legal'
import { CheckCircle2, AlertTriangle, ShieldCheck, Pen, Type, Upload } from 'lucide-react'

// Public hire-acknowledgement flow for a client PM with NO Firebase account.
// Reads client_hire_tokens/{token} → hire_id, then renders the hire details
// (engineer, role, project, start date) sourced from pending_hires/{hire_id}
// and the linked projects/clients records. Acknowledge / Dispute writes:
//   pending_hires/{hire_id} → client_acknowledged_at / client_disputed_at
//   pending_hires/{hire_id}/approval_evidence/{auto}  evidence row
//   token doc is burned on success.

function SignaturePad({ onSave, onCancel, signerName }) {
  const canvasRef = useRef(null)
  const [drawing, setDrawing] = useState(false)
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height)
    ctx.strokeStyle = '#022873'; ctx.lineWidth = 2; ctx.lineCap = 'round'
  }, [])

  const getPos = (e) => {
    const c = canvasRef.current
    const r = c.getBoundingClientRect()
    const t = e.touches?.[0] || e
    return { x: t.clientX - r.left, y: t.clientY - r.top }
  }
  const start = (e) => { e.preventDefault(); setDrawing(true); setTouched(true); const ctx = canvasRef.current.getContext('2d'); const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y) }
  const move = (e) => { if (!drawing) return; e.preventDefault(); const ctx = canvasRef.current.getContext('2d'); const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke() }
  const end = () => setDrawing(false)
  const clear = () => { const c = canvasRef.current; const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); setTouched(false) }
  const save = () => onSave(canvasRef.current.toDataURL('image/png'), 'draw')

  return (
    <div style={{ padding: 16, background: '#fff', borderRadius: 10, border: '1px solid #E5E7EB', maxWidth: 480 }}>
      <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: 8 }}>
        Signing as <strong>{signerName}</strong>
      </div>
      <canvas
        ref={canvasRef} width={440} height={180}
        style={{ width: '100%', height: 180, border: '1px solid #E5E7EB', borderRadius: 6, touchAction: 'none', background: '#fff' }}
        onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
        onTouchStart={start} onTouchMove={move} onTouchEnd={end}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button onClick={clear} style={btn('ghost')}>Clear</button>
        <button onClick={save} disabled={!touched} style={btn('primary', !touched)}>Sign</button>
        <button onClick={onCancel} style={btn('ghost')}>Cancel</button>
      </div>
    </div>
  )
}

function btn(kind, disabled) {
  const base = { padding: '8px 14px', borderRadius: 6, fontSize: '0.85rem', fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit', border: '1px solid #022873' }
  if (kind === 'primary') return { ...base, background: disabled ? '#94a3b8' : '#022873', color: '#fff', borderColor: disabled ? '#94a3b8' : '#022873' }
  if (kind === 'danger') return { ...base, background: '#fff', color: '#C0392B', borderColor: '#C0392B' }
  return { ...base, background: '#fff', color: '#022873' }
}

export default function ClientHireApproval() {
  const { token } = useParams()
  const [loading, setLoading] = useState(true)
  const [tokenDoc, setTokenDoc] = useState(null)
  const [hire, setHire] = useState(null)
  const [project, setProject] = useState(null)
  const [invalid, setInvalid] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(null) // 'acknowledged' | 'disputed'
  const [error, setError] = useState(null)
  const [mode, setMode] = useState(null) // 'sign' | 'dispute' | null
  const [disputeReason, setDisputeReason] = useState('')

  useEffect(() => {
    let alive = true
    async function load() {
      try {
        const tSnap = await getDoc(doc(db, 'client_hire_tokens', token))
        if (!tSnap.exists()) { if (alive) { setInvalid(true); setLoading(false) }; return }
        const t = tSnap.data()
        if (!alive) return
        setTokenDoc(t)
        const hireSnap = await getDoc(doc(db, 'pending_hires', t.hire_id))
        if (!hireSnap.exists()) { if (alive) { setInvalid(true); setLoading(false) }; return }
        const h = { id: hireSnap.id, ...hireSnap.data() }
        setHire(h)
        if (h.project_id) {
          const pSnap = await getDoc(doc(db, 'projects', h.project_id))
          if (pSnap.exists()) setProject(pSnap.data())
        }
        if (h.client_acknowledged_at || h.client_disputed_at) {
          setDone(h.client_acknowledged_at ? 'acknowledged' : 'disputed')
        }
        setLoading(false)
      } catch (err) {
        console.error('Token load failed:', err)
        if (alive) { setError(err.message); setLoading(false) }
      }
    }
    load()
    return () => { alive = false }
  }, [token])

  const submit = async (decision, payload) => {
    if (!hire || !tokenDoc) return
    setSubmitting(true)
    setError(null)
    try {
      const ip = await fetch('https://api.ipify.org?format=json').then(r => r.json()).then(j => j.ip).catch(() => 'unknown')
      const ua = navigator.userAgent || 'unknown'
      const nowIso = new Date().toISOString()

      const update = decision === 'ACKNOWLEDGE'
        ? { client_acknowledged_at: serverTimestamp(), client_acknowledged_by: tokenDoc.client_pm_email, client_action_ip: ip, client_signature_method: payload.method, client_signature_image: payload.image || null, client_signature_typed: payload.typed || null }
        : { client_disputed_at: serverTimestamp(), client_disputed_by: tokenDoc.client_pm_email, client_action_ip: ip, client_dispute_reason: payload.reason }
      await updateDoc(doc(db, 'pending_hires', hire.id), update)

      await addDoc(collection(db, 'pending_hires', hire.id, 'approval_evidence'), {
        approver_email: tokenDoc.client_pm_email,
        approver_name: tokenDoc.client_pm_name || tokenDoc.client_pm_email,
        approver_role: 'CLIENT_PM',
        approved_at: serverTimestamp(),
        ip_address: ip,
        user_agent: ua,
        signature_method: payload.method || 'dispute',
        signature_data: payload.image || payload.typed || null,
        action: decision === 'ACKNOWLEDGE' ? 'CLIENT_ACKNOWLEDGE_HIRE' : 'CLIENT_DISPUTE_HIRE',
        label: decision === 'ACKNOWLEDGE' ? 'Client acknowledged placement' : 'Client disputed placement',
        parent_collection: 'pending_hires',
        parent_id: hire.id,
        token_used: token,
        dispute_reason: payload.reason || null,
        timestamp_iso: nowIso,
      })

      // Burn token so the link cannot be replayed
      await deleteDoc(doc(db, 'client_hire_tokens', token))

      setDone(decision === 'ACKNOWLEDGE' ? 'acknowledged' : 'disputed')
      setMode(null)
    } catch (err) {
      console.error('Submit failed:', err)
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <Centered><p>Loading…</p></Centered>
  if (invalid) return <Centered><h2 style={{ color: '#C0392B' }}>Link expired or invalid</h2><p>Please ask Datalake HR for a new approval link.</p></Centered>
  if (error && !done) return <Centered><h2 style={{ color: '#C0392B' }}>Something went wrong</h2><p>{error}</p></Centered>

  const engineerName = hire.candidate_name || hire.full_name || 'Engineer'
  const role = hire.job_title || hire.role || 'IT Consultant'
  const clientName = hire.client_name || project?.client_name || tokenDoc.client_name || 'your organisation'
  const projectName = hire.project_name || project?.project_name || 'the engagement'
  const startDate = hire.start_date || hire.contract_start_date || '—'
  const duration = hire.contract_duration_months ? `${hire.contract_duration_months} months` : '—'

  return (
    <div style={{ minHeight: '100vh', background: '#F4F6F9', padding: '20px 16px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', background: '#fff', borderRadius: 12, boxShadow: '0 4px 20px rgba(2,40,115,0.08)', overflow: 'hidden' }}>
        <header style={{ background: '#022873', color: '#fff', padding: '20px 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '0.7rem', letterSpacing: 2, opacity: 0.7 }}>HIRE ACKNOWLEDGEMENT</div>
            <h1 style={{ fontSize: '1.4rem', margin: '4px 0 0', fontWeight: 700 }}>Client Approval Required</h1>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '0.78rem', opacity: 0.85 }}>{COMPANY.legal_name_en}</div>
            <div style={{ fontSize: '0.7rem', opacity: 0.6 }}>CR: {COMPANY.cr_number}</div>
          </div>
        </header>

        <section style={{ padding: '28px' }}>
          {done ? (
            <div style={{ textAlign: 'center', padding: '40px 20px' }}>
              <CheckCircle2 size={56} color={done === 'acknowledged' ? '#34BF3A' : '#EF5829'} style={{ margin: '0 auto 14px' }} />
              <h2 style={{ fontSize: '1.2rem', color: '#022873', margin: 0 }}>
                {done === 'acknowledged' ? 'Acknowledgement recorded' : 'Dispute recorded'}
              </h2>
              <p style={{ color: '#64748b', marginTop: 10, fontSize: '0.92rem' }}>
                {done === 'acknowledged'
                  ? `Thank you — your acknowledgement of ${engineerName} for ${projectName} has been signed and timestamped.`
                  : `Your concerns have been routed back to Datalake HR. They will reach out to ${tokenDoc.client_pm_email}.`}
              </p>
            </div>
          ) : (
            <>
              <p style={{ margin: '0 0 18px', color: '#64748b', fontSize: '0.92rem', lineHeight: 1.6 }}>
                Dear <strong>{tokenDoc.client_pm_name || tokenDoc.client_pm_email}</strong>,
                <br />
                Datalake is preparing to place the following engineer on <strong>{projectName}</strong> for <strong>{clientName}</strong>.
                Please review and acknowledge, or raise a concern.
              </p>

              <Row label="Engineer" value={engineerName} />
              <Row label="Role" value={role} />
              <Row label="Project" value={projectName} />
              <Row label="Client" value={clientName} />
              <Row label="Start date" value={startDate} />
              <Row label="Duration" value={duration} />
              {hire.po_number && <Row label="PO number" value={hire.po_number} />}

              <div style={{ marginTop: 22, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                {mode !== 'dispute' && mode !== 'sign' && (
                  <>
                    <button onClick={() => setMode('dispute')} style={btn('danger', submitting)}>
                      <AlertTriangle size={14} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
                      Dispute
                    </button>
                    <button onClick={() => setMode('sign')} style={btn('primary', submitting)}>
                      <CheckCircle2 size={14} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
                      Acknowledge & Sign
                    </button>
                  </>
                )}
              </div>

              {mode === 'sign' && (
                <div style={{ marginTop: 22 }}>
                  <SignaturePad
                    signerName={tokenDoc.client_pm_name || tokenDoc.client_pm_email}
                    onSave={(image, method) => submit('ACKNOWLEDGE', { method, image })}
                    onCancel={() => setMode(null)}
                  />
                </div>
              )}

              {mode === 'dispute' && (
                <div style={{ marginTop: 22, padding: 16, background: '#fff5f5', border: '1px solid #fee2e2', borderRadius: 8 }}>
                  <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#991b1b', display: 'block', marginBottom: 6 }}>
                    Reason for dispute (required) — sent to Datalake HR
                  </label>
                  <textarea
                    value={disputeReason}
                    onChange={e => setDisputeReason(e.target.value)}
                    rows={4}
                    placeholder="What's wrong with this placement? (qualifications, start date, role match, etc.)"
                    style={{ width: '100%', padding: 10, border: '1px solid #fecaca', borderRadius: 6, fontFamily: 'inherit', fontSize: '0.88rem', boxSizing: 'border-box' }}
                  />
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
                    <button onClick={() => setMode(null)} style={btn('ghost')}>Cancel</button>
                    <button
                      onClick={() => submit('DISPUTE', { reason: disputeReason.trim(), method: 'dispute' })}
                      disabled={!disputeReason.trim() || submitting}
                      style={btn('danger', !disputeReason.trim() || submitting)}
                    >
                      Send dispute
                    </button>
                  </div>
                </div>
              )}

              {error && (
                <div style={{ marginTop: 18, padding: 12, background: '#fff5f5', border: '1px solid #fee2e2', borderRadius: 6, color: '#991b1b', fontSize: '0.85rem' }}>
                  {error}
                </div>
              )}
            </>
          )}
        </section>

        <footer style={{ background: '#F4F6F9', borderTop: '1px solid #E5E7EB', padding: '14px 28px', fontSize: '0.72rem', color: '#64748b', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ShieldCheck size={13} />
            <span>{LEGAL_FOOTER_EN}</span>
          </div>
          <div dir="rtl" style={{ fontSize: '0.7rem' }}>{LEGAL_FOOTER_AR}</div>
        </footer>
      </div>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
      <span style={{ fontSize: '0.82rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      <span style={{ fontSize: '0.92rem', color: '#022873', fontWeight: 600 }}>{value}</span>
    </div>
  )
}

function Centered({ children }) {
  return (
    <div style={{ minHeight: '100vh', background: '#F4F6F9', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#fff', padding: 32, borderRadius: 12, textAlign: 'center', maxWidth: 480 }}>
        {children}
        <div style={{ marginTop: 24, fontSize: '0.72rem', color: '#64748b' }}>{LEGAL_FOOTER_EN}</div>
      </div>
    </div>
  )
}
