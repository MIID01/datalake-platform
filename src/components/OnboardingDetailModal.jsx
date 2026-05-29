import { useEffect, useState } from 'react'
import { collection, getDocs, doc, getDoc, query } from 'firebase/firestore'
import { auth, db, GENERATE_PDF_URL } from '../lib/firebase'
import {
  X, CheckCircle2, AlertTriangle, Loader, FileText, Globe, Monitor,
  ShieldCheck, Download,
} from 'lucide-react'

// Inspector + PDPL consent download for a single employee. Wired into HR and
// CEO employee directories: row click → opens this modal.
//
// What it shows:
//   - employee identity (name, employee_id, email, job_title)
//   - users-side consent state (pdpl_consent_state, IP, UA, timestamp)
//   - the onboarding_evidence subcollection rows (one per policy acknowledgment)
// What it does:
//   - Download PDPL Consent Certificate as PDF (calls /generatePDF with
//     template=pdpl_consent, docId=employee_id)

function fmtTs(ts) {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString()
}

export default function OnboardingDetailModal({ employee, onClose }) {
  const [acks, setAcks] = useState([])
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')

  useEffect(() => {
    if (!employee?.id) return
    let cancelled = false
    const run = async () => {
      setLoading(true); setError('')
      try {
        // Prefer the new onboarding_evidence subcollection. Fall back to the legacy
        // `onboarding` rows so existing records keep rendering until they're
        // re-acknowledged.
        const ev = await getDocs(query(collection(db, 'employees', employee.id, 'onboarding_evidence')))
        let rows = ev.docs.map(d => ({ id: d.id, ...d.data() }))
        if (rows.length === 0) {
          const legacy = await getDocs(query(collection(db, 'employees', employee.id, 'onboarding')))
          rows = legacy.docs.map(d => ({ id: d.id, ...d.data() }))
        }
        if (cancelled) return
        setAcks(rows)

        // Best-effort: find the linked users row to surface consent state + IP.
        let userData = null
        if (employee.uid) {
          const u = await getDoc(doc(db, 'users', employee.uid))
          if (u.exists()) userData = { uid: u.id, ...u.data() }
        }
        if (!userData && employee.employee_id) {
          const uByEmpId = await getDoc(doc(db, 'users', employee.employee_id))
          if (uByEmpId.exists()) userData = { uid: uByEmpId.id, ...uByEmpId.data() }
        }
        if (cancelled) return
        setUser(userData)
      } catch (e) {
        if (!cancelled) setError(e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [employee?.id, employee?.uid, employee?.employee_id])

  const handleDownload = async () => {
    setDownloading(true); setDownloadError('')
    try {
      const me = auth.currentUser
      if (!me) throw new Error('Not signed in')
      const idToken = await me.getIdToken()
      const res = await fetch(GENERATE_PDF_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
        body: JSON.stringify({ template: 'pdpl_consent', docId: employee.id, options: {} }),
      })
      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        let msg = `HTTP ${res.status}`
        try { msg = JSON.parse(txt).error || msg } catch { /* not JSON */ }
        throw new Error(msg)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `pdpl_consent_${employee.id}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
    } catch (e) {
      setDownloadError(e.message)
    } finally {
      setDownloading(false)
    }
  }

  if (!employee) return null

  const consentGranted = employee.onboarding_complete === true || user?.onboarding_complete === true
  const consentState = user?.pdpl_consent_state || (consentGranted ? 'GRANTED' : 'NOT_GRANTED')
  const consentAt = user?.onboarding_completed_at || employee.onboarding_completed_at
  const consentIp = user?.pdpl_consent_ip || 'not captured (network policy)'

  const row = (label, val, mono = false) => (
    <div style={{ display: 'flex', gap: 14, padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
      <div style={{ width: 160, color: 'rgba(255,255,255,0.55)', fontSize: '0.74rem', textTransform: 'uppercase', fontWeight: 600, flexShrink: 0 }}>{label}</div>
      <div style={{ flex: 1, fontSize: '0.85rem', color: '#fff', fontFamily: mono ? "'JetBrains Mono', monospace" : 'inherit', wordBreak: 'break-all' }}>
        {val || <span style={{ color: 'rgba(255,255,255,0.4)' }}>—</span>}
      </div>
    </div>
  )

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(6px)', zIndex: 10000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16, overflowY: 'auto',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#0f1d36', border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 14, maxWidth: 740, width: '100%',
          maxHeight: 'calc(100vh - 32px)', display: 'flex', flexDirection: 'column',
          color: '#fff', fontFamily: "'DM Sans', sans-serif",
        }}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ShieldCheck size={18} color={consentGranted ? '#34BF3A' : '#F39C12'} />
            <div>
              <div style={{ fontSize: '1rem', fontWeight: 700 }}>
                Onboarding status — {employee.full_name || employee.name || employee.id}
              </div>
              <div style={{ fontSize: '0.74rem', color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>
                Source of truth: <code style={{ fontFamily: "'JetBrains Mono', monospace" }}>employees/{employee.id}/onboarding_evidence</code>
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.55)', cursor: 'pointer', padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: 20, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: 30, textAlign: 'center', color: 'rgba(255,255,255,0.55)' }}>
              <Loader size={20} className="spin" /> Loading consent record…
            </div>
          ) : error ? (
            <div style={{ padding: 14, borderRadius: 8, background: 'rgba(192,57,43,0.12)', border: '1px solid rgba(192,57,43,0.3)', color: '#fca5a5' }}>
              <AlertTriangle size={14} style={{ verticalAlign: -2, marginRight: 6 }} /> {error}
            </div>
          ) : (
            <>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '5px 12px', borderRadius: 999, marginBottom: 16,
                background: consentGranted ? 'rgba(52,191,58,0.15)' : 'rgba(243,156,18,0.15)',
                color: consentGranted ? '#34BF3A' : '#F39C12', fontWeight: 700, fontSize: '0.82rem',
              }}>
                {consentGranted ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
                Consent state: {consentState}
              </div>

              {row('Employee ID', employee.employee_id || employee.id, true)}
              {row('Email', employee.email || user?.email, true)}
              {row('Job Title', employee.job_title)}
              {row('Granted at', fmtTs(consentAt))}
              {row('From IP', <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Globe size={11} /> {consentIp}</span>, true)}
              {row('User agent', <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Monitor size={11} /> {user?.pdpl_consent_user_agent || 'not captured'}</span>, true)}

              <div style={{ marginTop: 18, marginBottom: 10, fontSize: '0.78rem', color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', fontWeight: 600 }}>
                Policies acknowledged ({acks.length})
              </div>
              {acks.length === 0 ? (
                <div style={{ padding: 14, borderRadius: 8, background: 'rgba(243,156,18,0.10)', border: '1px solid rgba(243,156,18,0.25)', color: '#F39C12', fontSize: '0.82rem' }}>
                  No acknowledgment rows. This employee has not completed onboarding yet.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {acks.map(a => (
                    <div key={a.id} style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', fontWeight: 700 }}>
                        <CheckCircle2 size={13} color="#34BF3A" />
                        {a.policy_name || a.policy_id || a.item_id || a.id}
                      </div>
                      <div style={{ fontSize: '0.74rem', color: 'rgba(255,255,255,0.55)', marginTop: 4 }}>
                        acknowledged_by {a.acknowledged_by || a.employee_email || '—'} · at {fmtTs(a.acknowledged_at || a.completed_at)}
                        {a.ip_address ? <> · from {a.ip_address}</> : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.5)' }}>
            <FileText size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
            PDF generated server-side from the same Firestore rows shown above.
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {downloadError && (
              <span style={{ fontSize: '0.76rem', color: '#fca5a5' }}>
                {downloadError}
              </span>
            )}
            <button
              onClick={handleDownload}
              disabled={downloading || !employee.id}
              style={{
                padding: '9px 16px', borderRadius: 8, border: 'none',
                background: downloading ? 'rgba(255,255,255,0.1)' : '#1598CC',
                color: '#fff', fontSize: '0.85rem', fontWeight: 700, fontFamily: 'inherit',
                cursor: downloading ? 'not-allowed' : 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              {downloading ? <Loader size={13} className="spin" /> : <Download size={13} />}
              {downloading ? 'Generating…' : 'Download PDPL Consent Certificate'}
            </button>
          </div>
        </div>

        <style>{`
          .spin { animation: spin 1s linear infinite; }
          @keyframes spin { 100% { transform: rotate(360deg); } }
        `}</style>
      </div>
    </div>
  )
}
