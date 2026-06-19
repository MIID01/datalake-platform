import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { auth, SIGN_PROJECT_TIMESHEET_URL } from '../lib/firebase'
import { CheckCircle2, Loader, AlertTriangle, FileText } from 'lucide-react'

// Client sign-off page — works two ways:
//   • Emailed link with ?t=<token> → no login needed.
//   • Logged-in client (from the client portal) → no token, uses the ID token.
const NAVY = '#022873'

export default function SignTimesheet() {
  const { docId } = useParams()
  const [params] = useSearchParams()
  const token = params.get('t') || ''

  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [affirm, setAffirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  const authHeader = async () => {
    if (token) return {}
    const u = auth.currentUser
    if (!u) return null
    return { Authorization: 'Bearer ' + (await u.getIdToken()) }
  }

  useEffect(() => {
    (async () => {
      try {
        const h = await authHeader()
        if (h === null) { setError('Please open this from the emailed link, or sign in to the client portal.'); setLoading(false); return }
        const qs = token ? `?docId=${encodeURIComponent(docId)}&t=${encodeURIComponent(token)}` : `?docId=${encodeURIComponent(docId)}`
        const res = await fetch(`${SIGN_PROJECT_TIMESHEET_URL}${qs}`, { headers: h })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || `Failed (${res.status})`)
        setSummary(data.summary)
      } catch (e) { setError(e.message) } finally { setLoading(false) }
    })()
  }, [docId, token]) // eslint-disable-line

  const sign = async () => {
    if (!name.trim() || !affirm) return
    setBusy(true); setError('')
    try {
      const h = await authHeader()
      const res = await fetch(SIGN_PROJECT_TIMESHEET_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(h || {}) },
        body: JSON.stringify({ docId, token, signer_name: name.trim(), affirm: true }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`)
      setDone(true)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const wrap = { minHeight: '100vh', background: '#F4F6F9', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: "'DM Sans', Arial, sans-serif" }
  const card = { background: '#fff', borderRadius: 14, padding: 28, maxWidth: 560, width: '100%', boxShadow: '0 8px 30px rgba(2,8,23,0.1)' }

  if (loading) return <div style={wrap}><div style={card}><Loader className="spin" /> Loading…<style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{100%{transform:rotate(360deg)}}`}</style></div></div>
  if (done) return <div style={wrap}><div style={{ ...card, textAlign: 'center' }}><CheckCircle2 size={48} color="#34BF3A" /><h2 style={{ color: NAVY }}>Signed — thank you</h2><p style={{ color: '#64748b' }}>The timesheet for {summary?.project_name} ({summary?.period_label}) is now signed and recorded.</p></div></div>
  if (error && !summary) return <div style={wrap}><div style={{ ...card, textAlign: 'center' }}><AlertTriangle size={40} color="#C0392B" /><p style={{ color: '#C0392B', marginTop: 12 }}>{error}</p></div></div>

  const alreadySigned = summary && !['CTO_APPROVED', 'SENT_TO_CLIENT'].includes(summary.state)

  return (
    <div style={wrap}>
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <FileText size={22} color="#1598CC" />
          <h1 style={{ fontSize: '1.3rem', fontWeight: 700, color: NAVY, margin: 0 }}>Timesheet sign-off</h1>
        </div>
        <p style={{ color: '#64748b', fontSize: '0.86rem', margin: '0 0 16px' }}>
          {summary?.project_name} · {summary?.period_label} · PO {summary?.po_number || '—'} · {summary?.client_name}
        </p>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.86rem', marginBottom: 16 }}>
          <thead><tr style={{ textAlign: 'left', color: '#94a3b8', borderBottom: '1px solid #E5E7EB' }}><th style={{ padding: '6px 4px' }}>Role</th><th style={{ padding: '6px 4px', textAlign: 'right' }}>Days</th></tr></thead>
          <tbody>
            {(summary?.rows || []).map((r, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #F1F5F9' }}><td style={{ padding: '7px 4px' }}>{r.role}</td><td style={{ padding: '7px 4px', textAlign: 'right', fontWeight: 600 }}>{Number(r.total).toFixed(2)}</td></tr>
            ))}
          </tbody>
        </table>
        {(summary?.additional_billable || []).length > 0 && (
          <div style={{ marginBottom: 16, fontSize: '0.82rem' }}>
            <div style={{ fontWeight: 700, color: NAVY, marginBottom: 4 }}>Additional billable items</div>
            {summary.additional_billable.map((e, i) => <div key={i} style={{ color: '#475569' }}>• [{String(e.category || '').replace(/_/g, ' ')}] {e.description} — {e.qty} {e.unit}</div>)}
          </div>
        )}

        {alreadySigned ? (
          <div style={{ padding: 14, background: '#ecfdf5', borderRadius: 8, color: '#15803d', fontSize: '0.86rem' }}>This timesheet is already {summary.state}.</div>
        ) : (
          <>
            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569' }}>Your full name (signature)</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Mohamed Marwan Yousfi" style={{ width: '100%', padding: '10px 12px', border: '1px solid #E5E7EB', borderRadius: 8, fontSize: '0.9rem', boxSizing: 'border-box', margin: '4px 0 12px' }} />
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: '0.82rem', color: '#475569', cursor: 'pointer' }}>
              <input type="checkbox" checked={affirm} onChange={e => setAffirm(e.target.checked)} style={{ marginTop: 3 }} />
              <span>I confirm I am authorised to sign on behalf of {summary?.client_name || 'the client'}, and that the hours and additional items above are accurate and approved for invoicing.</span>
            </label>
            {error && <div style={{ color: '#C0392B', fontSize: '0.82rem', marginTop: 10 }}>{error}</div>}
            <button onClick={sign} disabled={busy || !name.trim() || !affirm} style={{ width: '100%', marginTop: 16, padding: 12, borderRadius: 8, border: 'none', background: busy || !name.trim() || !affirm ? '#94a3b8' : NAVY, color: '#fff', fontWeight: 700, fontSize: '0.95rem', cursor: busy ? 'wait' : 'pointer' }}>
              {busy ? 'Signing…' : 'Sign & approve timesheet'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
