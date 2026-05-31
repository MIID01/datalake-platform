import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  collection, onSnapshot, query, doc, updateDoc, serverTimestamp,
} from 'firebase/firestore'
import { auth, db } from '../../lib/firebase'
import {
  TrendingUp, Building2, ChevronLeft, ChevronRight, Trophy, X as XIcon,
} from 'lucide-react'

// CRM pipeline — prospects only. Same clients collection. Sales user moves
// a card across stages via the < / > / Won / Lost buttons; the stage is
// persisted on the client doc (`pipeline_stage`). When a client is "Won"
// we also flip their top-level `status` to ACTIVE so they leave the
// prospect pool.

const STAGES = [
  { id: 'NEW',       label: 'New',       color: '#94a3b8' },
  { id: 'CONTACTED', label: 'Contacted', color: '#1598CC' },
  { id: 'PROPOSAL',  label: 'Proposal',  color: '#F39C12' },
  { id: 'WON',       label: 'Won',       color: '#34BF3A' },
  { id: 'LOST',      label: 'Lost',      color: '#C0392B' },
]

export default function CRMPipeline() {
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(null)

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'clients'),
      snap => { setClients(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false) },
      err => { console.warn(err); setLoading(false) })
    return () => unsub()
  }, [])

  const prospects = useMemo(() => {
    return clients.filter(c => {
      const status = (c.status || 'ACTIVE').toUpperCase()
      // Prospects = explicitly status PROSPECT OR pipeline_stage set (still in WON/LOST history).
      return status === 'PROSPECT' || c.pipeline_stage
    })
  }, [clients])

  const byStage = useMemo(() => {
    const m = {}
    STAGES.forEach(s => m[s.id] = [])
    prospects.forEach(c => {
      const stage = (c.pipeline_stage || 'NEW').toUpperCase()
      ;(m[stage] || m.NEW).push(c)
    })
    return m
  }, [prospects])

  const move = async (client, direction, opts = {}) => {
    setUpdating(client.id)
    try {
      const currentIdx = STAGES.findIndex(s => s.id === (client.pipeline_stage || 'NEW'))
      let next
      if (opts.toStage) next = opts.toStage
      else if (direction === 'forward') next = STAGES[Math.min(currentIdx + 1, STAGES.length - 1)].id
      else next = STAGES[Math.max(currentIdx - 1, 0)].id

      const patch = {
        pipeline_stage: next,
        pipeline_updated_at: serverTimestamp(),
        pipeline_updated_by: auth.currentUser?.email || 'unknown',
        last_interaction_at: serverTimestamp(),
      }
      // When a prospect is Won, the client becomes ACTIVE.
      if (next === 'WON') patch.status = 'ACTIVE'
      // When Lost, status flips to INACTIVE so they exit the active pipeline.
      if (next === 'LOST') patch.status = 'INACTIVE'

      await updateDoc(doc(db, 'clients', client.id), patch)
    } catch (err) {
      alert('Stage move failed: ' + err.message)
    } finally {
      setUpdating(null)
    }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Loading pipeline…</div>

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
          <TrendingUp size={22} color="#022873" /> Pipeline
        </h1>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-tertiary)', marginTop: 4 }}>
          Clients with status <strong>PROSPECT</strong> or a recorded stage. Move stages with the arrows. Winning a deal flips the client to ACTIVE.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${STAGES.length}, minmax(220px, 1fr))`, gap: 12, overflowX: 'auto' }}>
        {STAGES.map(stage => (
          <div key={stage.id} style={{ background: 'var(--bg-surface, #f8fafc)', border: '1px solid var(--border-primary, #E5E7EB)', borderRadius: 10, padding: 12, minHeight: 360 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: stage.color, display: 'inline-block' }} />
                <span style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-primary)' }}>{stage.label}</span>
              </div>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>{byStage[stage.id]?.length || 0}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(byStage[stage.id] || []).length === 0 ? (
                <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', textAlign: 'center', padding: '14px 4px' }}>—</div>
              ) : (
                (byStage[stage.id] || []).map(c => (
                  <div key={c.id} style={{ background: 'var(--bg-card, #fff)', border: '1px solid var(--border-primary, #E5E7EB)', borderRadius: 8, padding: 10 }}>
                    <Link to={`/crm/clients/${c.id}`} style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--text-primary)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Building2 size={12} /> {c.client_name}
                    </Link>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginTop: 4 }}>
                      {c.contact_person || c.contact_email || '—'}
                    </div>
                    {stage.id !== 'WON' && stage.id !== 'LOST' && (
                      <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
                        <button onClick={() => move(c, 'back')} disabled={updating === c.id} className="write-action" style={btn()}>
                          <ChevronLeft size={11} />
                        </button>
                        <button onClick={() => move(c, 'forward')} disabled={updating === c.id} className="write-action" style={btn(true)}>
                          <ChevronRight size={11} /> Advance
                        </button>
                        <button onClick={() => move(c, null, { toStage: 'WON' })} disabled={updating === c.id} className="write-action" style={{ ...btn(), background: 'rgba(52,191,58,0.12)', color: '#34BF3A', border: '1px solid rgba(52,191,58,0.35)' }}>
                          <Trophy size={11} /> Won
                        </button>
                        <button onClick={() => move(c, null, { toStage: 'LOST' })} disabled={updating === c.id} className="write-action" style={{ ...btn(), background: 'rgba(192,57,43,0.10)', color: '#C0392B', border: '1px solid rgba(192,57,43,0.30)' }}>
                          <XIcon size={11} /> Lost
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function btn(primary) {
  return {
    padding: '4px 8px', borderRadius: 4, border: primary ? '1px solid #022873' : '1px solid var(--border-primary, #E5E7EB)',
    background: primary ? '#022873' : 'transparent', color: primary ? '#fff' : 'var(--text-secondary)',
    fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
    display: 'inline-flex', alignItems: 'center', gap: 2,
  }
}
