import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { db } from '../../lib/firebase'
import {
  collection, query, where, getDocs, doc, updateDoc, addDoc,
  arrayUnion, serverTimestamp, limit,
} from 'firebase/firestore'
import {
  ScaleIcon, CheckCircle2, XCircle, Loader, AlertTriangle, FileText,
  MessageSquare, ShieldCheck,
} from 'lucide-react'
import ApprovalButton from '../../components/ApprovalButton'

// Mirrors HRContracts.jsx FIELD_SPECS — keep in sync.
const FIELD_SPECS = [
  { key: 'employee_name',         label: 'Employee Name' },
  { key: 'employee_name_ar',      label: 'Employee Name (Arabic)' },
  { key: 'iqama_national_id',     label: 'Iqama / National ID' },
  { key: 'job_title',             label: 'Job Title' },
  { key: 'client_name',           label: 'Client' },
  { key: 'po_number',             label: 'PO Number' },
  { key: 'po_value_sar',          label: 'PO Value (SAR)' },
  { key: 'contract_start_date',   label: 'Contract Start' },
  { key: 'contract_end_date',     label: 'Contract End' },
  { key: 'salary_monthly_sar',    label: 'Monthly Salary (SAR)' },
  { key: 'housing_allowance_sar', label: 'Housing Allowance (SAR)' },
  { key: 'transport_allowance_sar', label: 'Transport Allowance (SAR)' },
  { key: 'probation_period_months', label: 'Probation (months)' },
  { key: 'notice_period_days',    label: 'Notice Period (days)' },
  { key: 'work_location',         label: 'Work Location' },
]

const BRAND = {
  navy: '#022873', sky: '#1598CC', orange: '#EF5829',
  green: '#34BF3A', white: '#FFFFFF', bgDark: '#010e2b',
}

const page = {
  minHeight: '100vh',
  fontFamily: "'DM Sans', 'Inter', sans-serif",
  color: BRAND.white,
  background: `linear-gradient(135deg, ${BRAND.bgDark} 0%, ${BRAND.navy} 50%, #0a3a9e 100%)`,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  padding: '32px 16px',
}

const card = {
  background: 'rgba(2,40,115,0.5)',
  border: '1px solid rgba(21,152,204,0.2)',
  borderRadius: 14,
  padding: 28,
  maxWidth: 880,
  width: '100%',
  marginBottom: 20,
  backdropFilter: 'blur(12px)',
}

export default function LegalReview() {
  const { token } = useParams()
  const [state, setState] = useState('loading') // loading | review | submitting | success | rejected | error
  const [error, setError] = useState('')
  const [contract, setContract] = useState(null)
  const [contractId, setContractId] = useState(null)
  const [comment, setComment] = useState('')

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (!token) { setState('error'); setError('No review token in URL.'); return }
      try {
        const snap = await getDocs(query(
          collection(db, 'contracts'),
          where('legal_review_token', '==', token),
          limit(1),
        ))
        if (cancelled) return
        if (snap.empty) { setState('error'); setError('This review link is invalid or has expired.'); return }
        const d = snap.docs[0]
        const data = d.data()
        setContract(data); setContractId(d.id)
        // If the contract has already been decided, branch to the read-only state.
        if (data.legal_status === 'LEGAL_APPROVED') setState('success')
        else if (data.legal_status === 'LEGAL_REJECTED') setState('rejected')
        else setState('review')
      } catch (e) {
        if (!cancelled) { setState('error'); setError(e.message) }
      }
    }
    run()
    return () => { cancelled = true }
  }, [token])

  const fields = useMemo(() => {
    if (!contract) return {}
    return { ...(contract.contract_extracted_fields || {}), ...(contract.reviewed_fields || {}) }
  }, [contract])

  const decide = async (action) => {
    if (!contractId) return
    if (action === 'reject' && !comment.trim()) {
      alert('Please describe the issue so HR can correct it.')
      return
    }
    setState('submitting')
    try {
      const at = new Date().toISOString()
      const approved = action === 'approve'
      const update = {
        legal_status: approved ? 'LEGAL_APPROVED' : 'LEGAL_REJECTED',
        status: approved ? 'LEGAL_APPROVED' : 'LEGAL_REJECTED',
        legal_review_token: null,             // burn the token so the link can't be reused
        legal_decision_at: serverTimestamp(),
        legal_decision_action: approved ? 'approved' : 'rejected',
        legal_decision_comment: comment.trim() || null,
        status_history: arrayUnion({
          status: approved ? 'LEGAL_APPROVED' : 'LEGAL_REJECTED',
          at, by: 'legal:external',
          notes: comment.trim() || (approved ? 'Approved by external counsel' : 'Flagged by external counsel'),
        }),
        updated_at: serverTimestamp(),
      }
      // On approval, set the high-level status to ACTIVE so downstream provisioning kicks in.
      if (approved) update.status = 'ACTIVE'
      await updateDoc(doc(db, 'contracts', contractId), update)

      // Audit trail row — Legal is an external party, so we record explicitly.
      await addDoc(collection(db, 'legal_review_log'), {
        contract_id: contractId,
        action: approved ? 'approved' : 'rejected',
        comment: comment.trim() || null,
        at: serverTimestamp(),
        ip_user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      })
      setState(approved ? 'success' : 'rejected')
    } catch (e) {
      setState('review')
      alert('Could not submit: ' + e.message)
    }
  }

  // ─── Render states ────────────────────────────────────────────
  if (state === 'loading') return (
    <div style={page}><div style={card}><Loader size={22} className="spin" style={{ color: BRAND.sky }} /> Loading contract…</div></div>
  )
  if (state === 'error') return (
    <div style={page}>
      <div style={{ ...card, textAlign: 'center' }}>
        <AlertTriangle size={42} color={BRAND.orange} style={{ marginBottom: 14 }} />
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: 8 }}>Unable to load review</h1>
        <p style={{ color: 'rgba(255,255,255,0.65)' }}>{error}</p>
      </div>
    </div>
  )
  if (state === 'success') return (
    <div style={page}>
      <div style={{ ...card, textAlign: 'center' }}>
        <CheckCircle2 size={56} color={BRAND.green} style={{ marginBottom: 14 }} />
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 8 }}>Contract Approved</h1>
        <p style={{ color: 'rgba(255,255,255,0.65)' }}>
          Datalake HR has been notified. The employee record will be provisioned automatically.
        </p>
      </div>
    </div>
  )
  if (state === 'rejected') return (
    <div style={page}>
      <div style={{ ...card, textAlign: 'center' }}>
        <XCircle size={56} color={BRAND.orange} style={{ marginBottom: 14 }} />
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 8 }}>Issues recorded</h1>
        <p style={{ color: 'rgba(255,255,255,0.65)' }}>
          HR has been notified of the issues you flagged. They will revise the contract and re-send for review if needed.
        </p>
      </div>
    </div>
  )

  // ─── Review form ──────────────────────────────────────────────
  return (
    <div style={page}>
      <div style={{ textAlign: 'center', marginBottom: 18 }}>
        <span style={{ fontSize: '1.5rem', fontWeight: 800 }}>DATALAKE</span>{' '}
        <span style={{ fontSize: '1.5rem', color: BRAND.sky }}>IT</span>
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.78rem', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 4 }}>
          External Legal Review
        </p>
      </div>

      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <ScaleIcon size={20} color={BRAND.sky} />
          <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>Contract for review</h2>
        </div>
        <p style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.7)', lineHeight: 1.5 }}>
          This is the Qiwa Unified Employment Contract uploaded by Datalake HR. The fields below were extracted
          from the signed PDF by Gatekeeper AI and then verified by HR. Confirm the terms or flag any issue you
          spot.
        </p>
      </div>

      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <FileText size={16} color={BRAND.sky} />
          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0 }}>Verified Terms</h3>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
          {FIELD_SPECS.map(f => (
            <div key={f.key}>
              <div style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.5)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{f.label}</div>
              <div style={{ fontSize: '0.92rem', fontWeight: 600, color: '#fff', marginTop: 2 }}>
                {fields[f.key] != null && fields[f.key] !== '' ? String(fields[f.key]) : <span style={{ color: 'rgba(255,255,255,0.4)' }}>—</span>}
              </div>
            </div>
          ))}
        </div>

        {contract?.pdf_storage_path && (
          <div style={{ marginTop: 16, padding: '10px 14px', borderRadius: 8, background: 'rgba(21,152,204,0.08)', border: '1px solid rgba(21,152,204,0.25)', color: 'rgba(255,255,255,0.7)', fontSize: '0.78rem' }}>
            <ShieldCheck size={13} style={{ verticalAlign: -2, marginRight: 6 }} />
            Original PDF stored in WORM bucket — request a copy from HR if you need the signed source.
          </div>
        )}
      </div>

      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <MessageSquare size={16} color={BRAND.sky} />
          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0 }}>Decision</h3>
        </div>
        <p style={{ fontSize: '0.82rem', color: 'rgba(255,255,255,0.65)', marginBottom: 10 }}>
          Add a comment if you spot anything wrong. Required when flagging issues; optional when approving.
        </p>
        <textarea
          rows={4}
          value={comment}
          onChange={e => setComment(e.target.value)}
          placeholder="e.g. Probation period should be 90 days per Saudi Labor Law Art. 53, not 60."
          style={{
            width: '100%', padding: 12, borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)',
            background: 'rgba(0,0,0,0.25)', color: '#fff', fontSize: '0.9rem', fontFamily: 'inherit',
            outline: 'none', resize: 'vertical', boxSizing: 'border-box',
          }}
        />
        <div style={{ display: 'flex', gap: 12, marginTop: 14, justifyContent: 'flex-end' }}>
          <button
            onClick={() => decide('reject')}
            disabled={state === 'submitting'}
            style={{
              padding: '12px 22px', borderRadius: 8, border: '1px solid rgba(192,57,43,0.5)',
              background: 'rgba(192,57,43,0.15)', color: '#fca5a5', fontSize: '0.9rem', fontWeight: 700,
              fontFamily: 'inherit', cursor: state === 'submitting' ? 'not-allowed' : 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 8,
            }}
          >
            {state === 'submitting' ? <Loader size={14} className="spin" /> : <XCircle size={14} />} Flag Issues
          </button>
        </div>
      </div>

      {/* Approval evidence — captures approver identity + signed timestamp.
          The contract PDF is already in the WORM bucket from the HR upload step,
          so requiresDocument is false here; an evidence row is still recorded under
          contracts/{id}/approval_evidence so the audit chain is complete. */}
      <div style={{ ...card, padding: 22 }}>
        <ApprovalButton
          parentCollection="contracts"
          parentId={contractId}
          requiresDocument={false}
          label="Approve Contract"
          variant="success"
          identity={{
            email: 'legal@external',
            name: 'External Legal Counsel',
            role: 'legal:external',
          }}
          extra={{ comment: comment.trim() || null, review_token_used: true }}
          onApproved={async () => { await decide('approve') }}
          disabled={state === 'submitting'}
        />
      </div>

      <p style={{ textAlign: 'center', fontSize: '0.68rem', color: 'rgba(255,255,255,0.3)', marginBottom: 24 }}>
        Token-based access · IP &amp; user agent logged · Datalake IT · CR: 109194773
      </p>

      <style>{`
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
