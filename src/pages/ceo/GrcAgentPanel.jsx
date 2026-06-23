import { useState, useEffect } from 'react'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { ShieldCheck, AlertTriangle, CheckCircle, X, RefreshCw, Clock, FileWarning } from 'lucide-react'
import { auth, db, GRC_AUDIT_READINESS_URL, APPROVE_GRC_PROPOSAL_URL } from '../../lib/firebase'
import GrcChat from '../../components/GrcChat'

export default function GrcAgentPanel() {
  return (
    <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 4 }}>GRC Compliance Agent</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Talk to your compliance documents, track expiry &amp; audit-readiness, and approve the agent's proposed actions.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 1fr)', gap: 24, alignItems: 'start' }}>
        <GrcChat />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <ReadinessCard />
          <ProposalsCard />
        </div>
      </div>
    </div>
  )
}

function Metric({ label, value, tone }) {
  return (
    <div style={{ flex: 1, minWidth: 120, padding: '12px 14px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-primary)', borderRadius: 8 }}>
      <div style={{ fontSize: '1.5rem', fontWeight: 700, color: tone || 'var(--text-primary)' }}>{value}</div>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>{label}</div>
    </div>
  )
}

function ReadinessCard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const run = async () => {
    setLoading(true); setError('')
    try {
      const idToken = await auth.currentUser.getIdToken()
      const res = await fetch(GRC_AUDIT_READINESS_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Could not compute readiness')
      setData(json.readiness)
    } catch (err) {
      setError(err.message || 'Could not compute readiness')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}><ShieldCheck size={18} style={{ color: 'var(--sky)' }} /> Audit Readiness</h3>
        <button className="btn btn-ghost btn-sm" onClick={run} disabled={loading} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <RefreshCw size={14} /> {loading ? 'Computing…' : 'Run check'}
        </button>
      </div>
      {error && <div style={{ color: '#ff6b6b', fontSize: '0.82rem', marginBottom: 12 }}>{error}</div>}
      {!data && !error && (
        <p style={{ fontSize: '0.83rem', color: 'var(--text-tertiary)' }}>Run a check to compute readiness from the live document set. Figures are real counts — nothing is assumed compliant.</p>
      )}
      {data && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
            <Metric label="Active documents" value={data.total_active} />
            <Metric label="Overdue review" value={data.overdue} tone={data.overdue > 0 ? '#EF5829' : 'var(--green)'} />
            <Metric label="No review date" value={data.missing_review_date} tone={data.missing_review_date > 0 ? '#F39C12' : 'var(--green)'} />
            <Metric label="With owner" value={`${data.pct_with_owner}%`} />
            <Metric label="With approver" value={`${data.pct_with_approver}%`} />
            <Metric label="Due ≤30d" value={data.due_soon} tone={data.due_soon > 0 ? '#F39C12' : 'var(--text-primary)'} />
          </div>
          {Array.isArray(data.overdue_items) && data.overdue_items.length > 0 && (
            <div>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#EF5829', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}><FileWarning size={14} /> Overdue for review</div>
              {data.overdue_items.slice(0, 8).map((it) => (
                <div key={it.doc_id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', padding: '4px 0', borderBottom: '1px solid var(--border-primary)' }}>
                  <span style={{ fontFamily: 'monospace' }}>{it.doc_id}</span>
                  <span style={{ color: '#EF5829', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Clock size={12} />{it.days_overdue}d</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ProposalsCard() {
  const [proposals, setProposals] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actingId, setActingId] = useState(null)

  useEffect(() => {
    const q = query(collection(db, 'grc_proposals'), where('status', '==', 'PENDING'))
    const unsub = onSnapshot(q, (snap) => {
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      rows.sort((a, b) => (b.created_at?.seconds || 0) - (a.created_at?.seconds || 0))
      setProposals(rows)
      setLoading(false)
    }, (err) => { setError(err.message); setLoading(false) })
    return () => unsub()
  }, [])

  const decide = async (proposal_id, decision) => {
    setActingId(proposal_id + decision); setError('')
    try {
      const idToken = await auth.currentUser.getIdToken()
      const res = await fetch(APPROVE_GRC_PROPOSAL_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposal_id, decision }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Action failed')
      // onSnapshot removes it from the PENDING list automatically.
    } catch (err) {
      setError(err.message || 'Action failed')
    } finally {
      setActingId(null)
    }
  }

  const KIND_LABEL = { schedule_review: 'Schedule review', flag_for_review: 'Flag for review', draft_capa: 'Draft CAPA' }

  return (
    <div className="card">
      <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 16 }}>Agent Proposals <span style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', fontWeight: 400 }}>(your approval is required)</span></h3>
      {error && <div style={{ color: '#ff6b6b', fontSize: '0.82rem', marginBottom: 12 }}>{error}</div>}
      {loading ? (
        <p style={{ fontSize: '0.83rem', color: 'var(--text-tertiary)' }}>Loading proposals…</p>
      ) : proposals.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-tertiary)' }}>
          <CheckCircle size={32} style={{ opacity: 0.3, marginBottom: 8 }} />
          <p style={{ fontSize: '0.83rem' }}>No pending proposals.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {proposals.map((p) => (
            <div key={p.id} style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-primary)', borderRadius: 8, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--sky)' }}>{KIND_LABEL[p.kind] || p.kind}</span>
                {p.doc_id && <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{p.doc_id}</span>}
              </div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: 10 }}>{p.payload?.reason || p.payload?.capa_summary || '—'}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary btn-sm" disabled={actingId === p.id + 'APPROVE'} onClick={() => decide(p.id, 'APPROVE')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <CheckCircle size={14} /> Approve
                </button>
                <button className="btn btn-ghost btn-sm" disabled={actingId === p.id + 'REJECT'} onClick={() => decide(p.id, 'REJECT')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <X size={14} /> Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
