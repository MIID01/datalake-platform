import { useEffect, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { auth, db, FINANCE_REVIEW_QUOTE_URL } from '../../lib/firebase'
import { fmtSar } from '../../lib/deals'
import { ClipboardCheck, Loader, CheckCircle, XCircle } from 'lucide-react'

// Finance gate for CRM quotes. Lists deal_quotes in PENDING_FINANCE and forwards
// to the CEO (or rejects) via the financeReviewDealQuote Cloud Function — the
// status transition is enforced server-side, never written from here directly.
export default function FinanceQuoteReviews() {
  const [quotes, setQuotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, 'deal_quotes'), where('status', '==', 'PENDING_FINANCE')),
      s => { setQuotes(s.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false) },
      e => { setError(e); setLoading(false) })
    return () => unsub()
  }, [])

  const review = async (quoteId, decision) => {
    setMsg('')
    let notes
    if (decision === 'REJECT') {
      notes = window.prompt('Reason for rejection (required):')
      if (!notes) return
    }
    setBusyId(quoteId)
    try {
      const token = await auth.currentUser.getIdToken()
      const r = await fetch(FINANCE_REVIEW_QUOTE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ quote_id: quoteId, decision, notes }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setMsg(decision === 'APPROVE' ? 'Forwarded to CEO.' : 'Quote rejected.')
    } catch (e) { setMsg('Action failed: ' + e.message) } finally { setBusyId(null) }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>Loading quote reviews…</div>
  if (error) return (
    <div style={{ padding: 40, textAlign: 'center' }}>
      <h3 style={{ color: 'var(--red)', marginBottom: 8 }}>Unable to load quotes</h3>
      <p style={{ color: 'var(--text-secondary)' }}>{error.message}</p>
    </div>
  )

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: '1.3rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}><ClipboardCheck size={20} /> Quote Reviews</h1>
      <div style={{ fontSize: '0.82rem', color: 'var(--text-tertiary)', marginTop: 4, marginBottom: 16 }}>Quotes awaiting finance review. Approving forwards to the CEO for final sign-off.</div>
      {msg && <div style={{ fontSize: '0.82rem', marginBottom: 12, color: msg.includes('failed') ? '#ff8888' : '#34BF3A' }}>{msg}</div>}

      {quotes.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>No quotes awaiting finance review.</div>
      ) : quotes.map(q => (
        <div key={q.id} className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: '0.95rem', fontWeight: 700 }}>{q.deal_title || q.title || q.id}</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: 2 }}>{q.client_name || '—'} · submitted by {q.created_by || '—'}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>{fmtSar(q.total_sar)}</div>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)' }}>Subtotal {fmtSar(q.subtotal_sar)}{q.discount_pct ? ` · ${q.discount_pct}% off` : ''}</div>
            </div>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12, fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-tertiary)', fontSize: '0.72rem' }}>
                <th style={{ padding: '4px 6px' }}>Description</th><th style={{ padding: '4px 6px', textAlign: 'right' }}>Qty</th>
                <th style={{ padding: '4px 6px', textAlign: 'right' }}>Unit</th><th style={{ padding: '4px 6px', textAlign: 'right' }}>Line total</th>
              </tr>
            </thead>
            <tbody>
              {(q.line_items || []).map((li, i) => (
                <tr key={i} style={{ borderTop: '1px solid var(--border-primary, rgba(255,255,255,0.08))' }}>
                  <td style={{ padding: '4px 6px' }}>{li.description}</td>
                  <td style={{ padding: '4px 6px', textAlign: 'right' }}>{li.qty}</td>
                  <td style={{ padding: '4px 6px', textAlign: 'right' }}>{fmtSar(li.unit_price_sar)}</td>
                  <td style={{ padding: '4px 6px', textAlign: 'right' }}>{fmtSar(li.line_total_sar)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => review(q.id, 'REJECT')} disabled={busyId === q.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'transparent', border: '1px solid #C0392B', color: '#C0392B', borderRadius: 7, padding: '7px 14px', fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit' }}><XCircle size={14} /> Reject</button>
            <button className="btn btn-success" onClick={() => review(q.id, 'APPROVE')} disabled={busyId === q.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, borderRadius: 7, padding: '7px 14px', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit' }}>{busyId === q.id ? <Loader size={14} className="spin" /> : <CheckCircle size={14} />} Approve → CEO</button>
          </div>
        </div>
      ))}
    </div>
  )
}
