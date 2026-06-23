import { useEffect, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { auth, db, RUN_FOLLOWUP_AGENT_URL, APPROVE_AGENT_PROPOSAL_URL } from '../../lib/firebase'
import { Bot, Sparkles, Check, X, Loader, AlertTriangle, Clock } from 'lucide-react'

// DTLK-AI-AGENT-001 — CRM Stuck-Deal Follow-up agent surface.
// The agent only PROPOSES; this panel is the human-in-the-loop boundary. Approve
// creates the crm_task (server-side); Reject closes the proposal. Nothing the agent
// produces becomes real without a click here. CEO/business only (gated by parent).
const NAVY = '#022873'

async function postJson(url, body) {
  const token = await auth.currentUser.getIdToken()
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body || {}),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.detail || data.error || `Request failed (${r.status})`)
  return data
}

const tsMillis = (v) => (v?.toMillis ? v.toMillis() : (typeof v === 'number' ? v : null))

export default function CRMAgentPanel() {
  const [proposals, setProposals] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const [runMsg, setRunMsg] = useState('')
  const [busyId, setBusyId] = useState('')
  const [minDays, setMinDays] = useState(14) // "stuck" window; CEO-tunable per run

  useEffect(() => {
    // Equality-only query → no composite index needed; sort client-side. Expiry is
    // resolved here (in the callback, not render) so the render stays pure.
    const unsub = onSnapshot(query(collection(db, 'agent_proposals'), where('status', '==', 'PENDING')),
      snap => {
        const nowMs = Date.now()
        const rows = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .map(p => {
            const exp = tsMillis(p.expires_at)
            return { ...p, _expired: exp != null && exp <= nowMs, _daysLeft: exp != null ? Math.max(0, Math.ceil((exp - nowMs) / 86400000)) : null }
          })
          .filter(p => !p._expired)
        rows.sort((a, b) => (tsMillis(b.created_at) || 0) - (tsMillis(a.created_at) || 0))
        setProposals(rows); setLoading(false)
      },
      err => { setError(err.message); setLoading(false) })
    return () => unsub()
  }, [])

  const live = proposals

  const run = async () => {
    setRunning(true); setRunMsg('')
    try {
      const res = await postJson(RUN_FOLLOWUP_AGENT_URL, { min_days: minDays })
      setRunMsg(res.summary || `Created ${res.proposals_created ?? 0} proposal(s).`)
    } catch (e) {
      setRunMsg('⚠ ' + e.message)
    } finally { setRunning(false) }
  }

  const decide = async (p, decision) => {
    setBusyId(p.id)
    try {
      await postJson(APPROVE_AGENT_PROPOSAL_URL, { proposal_id: p.id, decision })
      // The onSnapshot listener drops it from PENDING automatically.
    } catch (e) {
      window.alert(e.message)
    } finally { setBusyId('') }
  }

  const card = { background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 18, marginBottom: 22 }

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        <div>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0, color: NAVY, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Bot size={18} color="#7C3AED" /> Follow-up assistant
            <span style={{ fontSize: '0.66rem', fontWeight: 700, color: '#7C3AED', background: '#F3E8FF', padding: '2px 7px', borderRadius: 999 }}>AGENT · PROPOSES ONLY</span>
          </h3>
          <p style={{ fontSize: '0.78rem', color: '#64748b', margin: '4px 0 0' }}>
            Drafts a grounded follow-up task for each stuck deal. Nothing is created until you approve it below.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <label style={{ fontSize: '0.74rem', color: '#64748b', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            Stuck = open &gt;
            <select value={minDays} onChange={e => setMinDays(Number(e.target.value))} disabled={running}
              style={{ padding: '6px 8px', borderRadius: 7, border: '1px solid #E5E7EB', fontSize: '0.78rem', fontFamily: 'inherit', background: '#fff' }}>
              {[3, 7, 14, 30, 60].map(d => <option key={d} value={d}>{d} days</option>)}
            </select>
          </label>
          <button onClick={run} disabled={running} style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 8, border: 'none',
            background: running ? '#94a3b8' : '#7C3AED', color: '#fff', fontWeight: 700, fontSize: '0.82rem', cursor: running ? 'wait' : 'pointer',
          }}>
            {running ? <Loader size={15} className="spin" /> : <Sparkles size={15} />} {running ? 'Working…' : 'Run follow-up assistant'}
          </button>
        </div>
      </div>

      {running && <div style={{ fontSize: '0.74rem', color: '#7C3AED', marginBottom: 10 }}>The agent is reading stuck deals and drafting follow-ups on the in-KSA model — this can take a minute on a cold start.</div>}
      {runMsg && <div style={{ fontSize: '0.8rem', color: runMsg.startsWith('⚠') ? '#C0392B' : '#15803d', marginBottom: 10 }}>{runMsg}</div>}

      {loading ? (
        <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8' }}><Loader size={20} className="spin" /></div>
      ) : error ? (
        <div style={{ color: '#C0392B', fontSize: '0.82rem' }}><AlertTriangle size={14} /> Could not load proposals: {error}</div>
      ) : live.length === 0 ? (
        <div style={{ padding: 18, textAlign: 'center', color: '#94a3b8', fontSize: '0.84rem', background: '#F8FAFC', borderRadius: 8 }}>
          No pending proposals. Run the assistant to draft follow-ups for stuck deals.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {live.map(p => {
            const daysLeft = p._daysLeft
            const busy = busyId === p.id
            return (
              <div key={p.id} style={{ border: '1px solid #E5E7EB', borderRadius: 10, padding: 12, background: '#fff' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ fontWeight: 700, color: '#0F172A', fontSize: '0.9rem' }}>{p.payload?.title || 'Follow-up'}</div>
                    <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: 3 }}>
                      Deal: <b>{p.deal_title || p.deal_id}</b>
                      {p.payload?.due_date && <span> · due {p.payload.due_date}</span>}
                      {p.payload?.assignee_email && <span> · {p.payload.assignee_email}</span>}
                    </div>
                    {p.reason && <div style={{ fontSize: '0.78rem', color: '#475569', marginTop: 6, fontStyle: 'italic' }}>“{p.reason}”</div>}
                    <div style={{ display: 'flex', gap: 10, marginTop: 6, fontSize: '0.68rem', color: '#94a3b8', flexWrap: 'wrap' }}>
                      {!p.grounded && <span style={{ color: '#b45309' }}>⚠ no logged activity — re-engagement check-in</span>}
                      {daysLeft != null && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Clock size={11} /> expires in {daysLeft}d</span>}
                      {p.model_name && <span>model: {p.model_name}</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => decide(p, 'APPROVE')} disabled={busy} title="Approve → creates the task"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 8, border: 'none', background: busy ? '#94a3b8' : '#34BF3A', color: '#fff', fontWeight: 700, fontSize: '0.76rem', cursor: busy ? 'wait' : 'pointer' }}>
                      {busy ? <Loader size={12} className="spin" /> : <Check size={13} />} Approve
                    </button>
                    <button onClick={() => decide(p, 'REJECT')} disabled={busy} title="Reject"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 8, border: '1px solid #E5E7EB', background: '#fff', color: '#C0392B', fontWeight: 700, fontSize: '0.76rem', cursor: busy ? 'wait' : 'pointer' }}>
                      <X size={13} /> Reject
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{100%{transform:rotate(360deg)}}`}</style>
    </div>
  )
}
