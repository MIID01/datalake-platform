import { useState, useEffect } from 'react'
import { auth, db } from '../../lib/firebase'
import { doc, getDoc, getDocs, collection, query, where } from 'firebase/firestore'
import QRCode from 'qrcode'
import { COMPANY } from '../../lib/company-legal'
import { IdCard, Download, Loader, AlertCircle, QrCode } from 'lucide-react'

// Employee digital card — QR-only, residency-locked. Everything is built
// in-browser from Firestore data: the vCard string is assembled client-side,
// the QR is rendered by the LOCAL `qrcode` lib (no external QR API), and the
// optional .vcf download is also built client-side. No photo, no server call.
// (A server-side photo/print card exists in functions/businessCard.js but is
// PARKED / un-deployed — see TODO.md T9.)

const vEsc = (s) => String(s ?? '')
  .replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')

// Photo-free vCard 3.0, assembled locally.
function buildVcard(emp) {
  const parts = String(emp.full_name || '').trim().split(/\s+/).filter(Boolean)
  const first = parts[0] || ''
  const last = parts.slice(1).join(' ')
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:${vEsc(last)};${vEsc(first)};;;`,
    `FN:${vEsc(emp.full_name)}`,
    `ORG:${vEsc(COMPANY.legal_name_en)}`,
  ]
  if (emp.job_title) lines.push(`TITLE:${vEsc(emp.job_title)}`)
  if (emp.email) lines.push(`EMAIL;TYPE=WORK:${vEsc(emp.email)}`)
  if (emp.phone) lines.push(`TEL;TYPE=WORK,VOICE:${vEsc(emp.phone)}`)
  lines.push(`URL:https://www.${COMPANY.domain}`)
  lines.push('END:VCARD')
  return lines.join('\r\n')
}

export default function BusinessCard() {
  const [emp, setEmp] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [qrUrl, setQrUrl] = useState('')

  // Resolve the signed-in user's own employee record (mirrors the Profile page):
  // users/{uid} → employee_id → employees/{employee_id}, with an email fallback.
  useEffect(() => {
    let cancelled = false
    const unsub = auth.onAuthStateChanged(async (user) => {
      if (!user) { setLoading(false); return }
      try {
        let userData = null
        const byUid = await getDoc(doc(db, 'users', user.uid))
        if (byUid.exists()) userData = byUid.data()
        else {
          const uq = await getDocs(query(collection(db, 'users'), where('email', '==', user.email)))
          if (!uq.empty) userData = uq.docs[0].data()
        }
        let empData = null
        const empId = userData?.employee_id
        if (empId) {
          const s = await getDoc(doc(db, 'employees', empId))
          if (s.exists()) empData = s.data()
        }
        if (!empData) {
          const eq = await getDocs(query(collection(db, 'employees'), where('email', '==', user.email)))
          if (!eq.empty) empData = eq.docs[0].data()
        }
        if (cancelled) return
        if (!empData) { setError('No employee record linked to your account — contact HR.'); setLoading(false); return }
        setEmp({
          full_name: empData.full_name || empData.name || userData?.display_name || '',
          job_title: empData.job_title || empData.title || '',
          email: empData.email || user.email,
          phone: empData.phone || '',
        })
        setLoading(false)
      } catch (e) {
        if (!cancelled) { setError(e.message); setLoading(false) }
      }
    })
    return () => { cancelled = true; unsub() }
  }, [])

  // Render the QR locally from the client-built vCard (no network).
  useEffect(() => {
    if (!emp) return
    let cancelled = false
    QRCode.toDataURL(buildVcard(emp), { margin: 1, width: 240, errorCorrectionLevel: 'M' })
      .then(url => { if (!cancelled) setQrUrl(url) })
      .catch(e => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [emp])

  const handleDownload = () => {
    const blob = new Blob([buildVcard(emp)], { type: 'text/vcard;charset=utf-8' })
    const safeName = (emp.full_name || 'datalake-contact').replace(/[^a-z0-9]+/gi, '-').toLowerCase()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${safeName}.vcf`
    document.body.appendChild(a); a.click(); a.remove()
    URL.revokeObjectURL(a.href)
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}><Loader size={20} className="spin" /> Loading…</div>
  if (error && !emp) return (
    <div style={{ padding: 24, maxWidth: 520, margin: '0 auto' }}>
      <div style={{ padding: '14px 18px', borderRadius: 10, background: 'rgba(192,57,43,0.1)', border: '1px solid rgba(192,57,43,0.3)', color: '#C0392B', fontSize: '0.88rem', display: 'flex', gap: 8 }}>
        <AlertCircle size={16} /> {error}
      </div>
    </div>
  )

  const card = { background: 'var(--bg-card, #fff)', border: '1px solid var(--border-card, #E5E7EB)', borderRadius: 12, padding: 22 }

  return (
    <div style={{ padding: '28px 24px', maxWidth: 760, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <IdCard size={22} color="#1598CC" />
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>My Digital Card</h1>
      </div>
      <p style={{ fontSize: '0.86rem', color: 'var(--text-secondary)', marginBottom: 22 }}>
        Share your contact details by QR, or download a contact file (.vcf). Everything is generated
        on your device from your record — nothing leaves the platform.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 20, alignItems: 'start' }}>
        {/* Card preview (photo-free) */}
        <div style={card}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <div style={{ width: 64, height: 64, borderRadius: '50%', flexShrink: 0, background: 'linear-gradient(135deg, #022873, #1598CC)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: '1.2rem' }}>
              {(emp.full_name || '?').split(' ').map(n => n[0]).join('').slice(0, 2)}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>{emp.full_name}</div>
              {emp.job_title && <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{emp.job_title}</div>}
              <div style={{ fontSize: '0.8rem', color: '#1598CC', fontWeight: 600 }}>{COMPANY.legal_name_en}</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: 4 }}>{emp.email}{emp.phone ? ' · ' + emp.phone : ''}</div>
            </div>
          </div>

          <button className="btn btn-primary" onClick={handleDownload} style={{ marginTop: 18 }}>
            <Download size={14} /> Download .vcf
          </button>
        </div>

        {/* QR (photo-free, rendered locally) */}
        <div style={{ ...card, textAlign: 'center', width: 220 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 10 }}>
            <QrCode size={14} /> Scan to save contact
          </div>
          {qrUrl
            ? <img src={qrUrl} alt="Contact QR code" style={{ width: 180, height: 180 }} />
            : <div style={{ width: 180, height: 180, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)' }}><Loader size={18} className="spin" /></div>}
          <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginTop: 8 }}>Contact details only — no photo.</div>
        </div>
      </div>

      <style>{`.spin { animation: spin 1s linear infinite; } @keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
