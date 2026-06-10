import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, onSnapshot, doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { auth, db } from '../../lib/firebase'
import { DEAL_STAGES, OPEN_STAGE_IDS, STAGE_IDS, stageIndex, fmtSar } from '../../lib/deals'
import AddDealModal from '../../components/AddDealModal'
import CSVImportModal from '../../components/CSVImportModal'
import { TrendingUp, Building2, ChevronLeft, ChevronRight, Trophy, X as XIcon, Plus, Upload } from 'lucide-react'

// Pipeline board — canonical source is the `deals` collection (NOT clients).
// Deals are created here / via CSV import; stage moves persist on the deal.
export default function CRMPipeline() {
  const [deals, setDeals] = useState([])
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [showCsv, setShowCsv] = useState(false)

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'deals'),
      snap => { setDeals(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false) },
      err => { console.warn('deals:', err.message); setLoading(false) })
    return () => unsub()
  }, [])

  const byStage = useMemo(() => {
    const m = {}; DEAL_STAGES.forEach(s => { m[s.id] = [] })
    deals.forEach(d => { (m[d.stage] || m.NEW).push(d) })
    return m
  }, [deals])

  const totals = useMemo(() => {
    const open = deals.filter(d => OPEN_STAGE_IDS.includes(d.stage))
    return {
      openCount: open.length,
      openValue: open.reduce((s, d) => s + (Number(d.value_sar) || 0), 0),
      wonValue: deals.filter(d => d.stage === 'WON').reduce((s, d) => s + (Number(d.value_sar) || 0), 0),
    }
  }, [deals])

  const move = async (deal, dir, opts = {}) => {
    setUpdating(deal.id)
    try {
      const idx = stageIndex(deal.stage)
      const next = opts.toStage
        ? opts.toStage
        : dir === 'forward' ? STAGE_IDS[Math.min(idx + 1, STAGE_IDS.length - 1)] : STAGE_IDS[Math.max(idx - 1, 0)]
      const patch = { stage: next, updated_at: serverTimestamp(), stage_updated_by: auth.currentUser?.email || 'unknown' }
      if (next === 'WON') { patch.won_at = serverTimestamp(); patch.won_client_id = deal.client_id || null }
      await updateDoc(doc(db, 'deals', deal.id), patch)
    } catch (e) { alert('Stage move failed: ' + e.message) }
    finally { setUpdating(null) }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Loading pipeline…</div>

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <TrendingUp size={22} color="#022873" /> Pipeline
          </h1>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-tertiary)', marginTop: 4 }}>
            Deals move through stages with the ‹ / Advance / Won / Lost buttons. (No drag-and-drop yet.) Won links the deal to a client account.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowCsv(true)} className="btn btn-ghost write-action" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Upload size={15} /> Import CSV</button>
          <button onClick={() => setShowAdd(true)} className="btn btn-primary write-action" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Plus size={16} /> Add Deal</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 16, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
        <span><strong>{totals.openCount}</strong> open deals</span>
        <span>Open value <strong style={{ color: '#022873' }}>{fmtSar(totals.openValue)}</strong></span>
        <span>Won <strong style={{ color: '#34BF3A' }}>{fmtSar(totals.wonValue)}</strong></span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${DEAL_STAGES.length}, minmax(220px, 1fr))`, gap: 12, overflowX: 'auto' }}>
        {DEAL_STAGES.map(stage => (
          <div key={stage.id} style={{ background: 'var(--bg-surface, #f8fafc)', border: '1px solid var(--border-primary, #E5E7EB)', borderRadius: 10, padding: 12, minHeight: 360 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.84rem', fontWeight: 700 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: stage.color }} /> {stage.label}
              </span>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>{byStage[stage.id]?.length || 0}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(byStage[stage.id] || []).length === 0 ? (
                <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', textAlign: 'center', padding: '14px 4px' }}>—</div>
              ) : (
                (byStage[stage.id] || []).map(d => (
                  <div key={d.id} style={{ background: 'var(--bg-card, #fff)', border: '1px solid var(--border-primary, #E5E7EB)', borderRadius: 8, padding: 10 }}>
                    <Link to={`/crm/deals/${d.id}`} style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--text-primary)', textDecoration: 'none' }}>{d.title || '(untitled deal)'}</Link>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
                      <Building2 size={11} /> {d.company_name || '—'} · {fmtSar(d.value_sar)}
                    </div>
                    {OPEN_STAGE_IDS.includes(stage.id) && (
                      <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
                        <button onClick={() => move(d, 'back')} disabled={updating === d.id} className="write-action" style={btn()}><ChevronLeft size={11} /></button>
                        <button onClick={() => move(d, 'forward')} disabled={updating === d.id} className="write-action" style={btn(true)}><ChevronRight size={11} /> Advance</button>
                        <button onClick={() => move(d, null, { toStage: 'WON' })} disabled={updating === d.id} className="write-action" style={{ ...btn(), background: 'rgba(52,191,58,0.12)', color: '#34BF3A', border: '1px solid rgba(52,191,58,0.35)' }}><Trophy size={11} /> Won</button>
                        <button onClick={() => move(d, null, { toStage: 'LOST' })} disabled={updating === d.id} className="write-action" style={{ ...btn(), background: 'rgba(192,57,43,0.10)', color: '#C0392B', border: '1px solid rgba(192,57,43,0.30)' }}><XIcon size={11} /> Lost</button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        ))}
      </div>

      {showAdd && <AddDealModal onClose={() => setShowAdd(false)} />}
      {showCsv && <CSVImportModal onClose={() => setShowCsv(false)} />}
    </div>
  )
}

function btn(primary) {
  return {
    padding: '4px 8px', borderRadius: 4, border: primary ? '1px solid #022873' : '1px solid var(--border-primary, #E5E7EB)',
    background: primary ? '#022873' : 'transparent', color: primary ? '#fff' : 'var(--text-secondary)',
    fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 2,
  }
}
