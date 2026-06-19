import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, onSnapshot } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { DEAL_STAGES, STAGE_IDS, OPEN_STAGE_IDS, STAGE_PROBABILITY, dealWeightedValue, stageMeta, fmtSar } from '../../lib/deals'
import { TrendingUp, Trophy, Percent, Layers, DollarSign, Clock, AlertTriangle, Loader, Target } from 'lucide-react'

// CRM Phase-2 analytics. Pure reads off the canonical `deals` collection — no new
// data model, no drift. Pipeline value by stage, win/loss, conversion, owners, aging.
const NAVY = '#022873'

function tsMillis(v) { return v?.toMillis ? v.toMillis() : (typeof v === 'number' ? v : null) }

export default function CRMDashboard() {
  const [deals, setDeals] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'deals'),
      snap => { setDeals(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false) },
      err => { setError(err.message); setLoading(false) })
    return () => unsub()
  }, [])

  const m = useMemo(() => {
    const live = deals.filter(d => !d.archived)
    const byStage = {}
    STAGE_IDS.forEach(id => { byStage[id] = { count: 0, value: 0 } })
    live.forEach(d => {
      const b = byStage[d.stage] || byStage.NEW
      b.count++; b.value += Number(d.value_sar || 0)
    })
    const openValue = OPEN_STAGE_IDS.reduce((s, id) => s + byStage[id].value, 0)
    const openCount = OPEN_STAGE_IDS.reduce((s, id) => s + byStage[id].count, 0)
    const wonValue = byStage.WON.value, wonCount = byStage.WON.count, lostCount = byStage.LOST.count
    const closed = wonCount + lostCount
    const winRate = closed ? Math.round((wonCount / closed) * 100) : 0
    const avgOpen = openCount ? openValue / openCount : 0
    // Weighted forecast: each open deal × its stage probability (lib/deals).
    const forecast = live.filter(d => OPEN_STAGE_IDS.includes(d.stage)).reduce((s, d) => s + dealWeightedValue(d), 0)

    // Deals by owner
    const owners = {}
    live.forEach(d => {
      const o = d.owner_email || '—'
      owners[o] ||= { email: o, total: 0, openValue: 0, won: 0 }
      owners[o].total++
      if (OPEN_STAGE_IDS.includes(d.stage)) owners[o].openValue += Number(d.value_sar || 0)
      if (d.stage === 'WON') owners[o].won++
    })
    const ownerRows = Object.values(owners).sort((a, b) => b.openValue - a.openValue)

    // Aging: open deals untouched > 30 days
    const now = Date.now()
    const aging = live
      .filter(d => OPEN_STAGE_IDS.includes(d.stage))
      .map(d => {
        const t = tsMillis(d.stage_updated_at) || tsMillis(d.updated_at) || tsMillis(d.created_at)
        return { ...d, ageDays: t ? Math.floor((now - t) / 86400000) : null }
      })
      .filter(d => d.ageDays != null && d.ageDays > 30)
      .sort((a, b) => b.ageDays - a.ageDays)
      .slice(0, 12)

    const maxStageVal = Math.max(1, ...STAGE_IDS.map(id => byStage[id].value))
    return { live, byStage, openValue, openCount, wonValue, wonCount, lostCount, winRate, avgOpen, forecast, ownerRows, aging, maxStageVal }
  }, [deals])

  if (loading) return (
    <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>
      <Loader size={26} className="spin" style={{ marginBottom: 10 }} /><div>Loading pipeline…</div>
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{100%{transform:rotate(360deg)}}`}</style>
    </div>
  )
  if (error) return <div style={{ padding: 32, color: '#C0392B' }}><AlertTriangle size={16} /> Could not load deals: {error}</div>

  const card = { background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 18 }

  return (
    <div style={{ padding: '28px 24px', maxWidth: 1200, margin: '0 auto', fontFamily: "'DM Sans', sans-serif" }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: NAVY, display: 'flex', alignItems: 'center', gap: 10, margin: 0 }}>
        <TrendingUp size={22} color="#1598CC" /> Pipeline Dashboard
      </h1>
      <p style={{ fontSize: '0.82rem', color: '#64748b', margin: '4px 0 22px' }}>{m.live.length} active deals · live from the pipeline</p>

      {m.live.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', color: '#94a3b8', padding: 48 }}>No deals yet. Add deals or import leads in the Pipeline.</div>
      ) : (
        <>
          {/* Stat cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 22 }}>
            <Stat Icon={DollarSign} color="#1598CC" label="Open pipeline value" value={fmtSar(m.openValue)} sub={`${m.openCount} open deals`} />
            <Stat Icon={Trophy} color="#34BF3A" label="Won value" value={fmtSar(m.wonValue)} sub={`${m.wonCount} won`} />
            <Stat Icon={Percent} color="#F39C12" label="Win rate" value={`${m.winRate}%`} sub={`${m.wonCount}W / ${m.lostCount}L closed`} />
            <Stat Icon={Layers} color={NAVY} label="Avg open deal" value={fmtSar(m.avgOpen)} sub="value per open deal" />
            <Stat Icon={Target} color="#7C3AED" label="Weighted forecast" value={fmtSar(m.forecast)} sub="open value × stage probability" />
          </div>

          {/* Stage breakdown */}
          <div style={{ ...card, marginBottom: 22 }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 14px', color: NAVY }}>Pipeline by stage</h3>
            {DEAL_STAGES.map(s => {
              const b = m.byStage[s.id]
              const pct = Math.round((b.value / m.maxStageVal) * 100)
              return (
                <div key={s.id} style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, color: '#334155' }}><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: s.color, marginRight: 7 }} />{s.label} · {b.count}</span>
                    <span style={{ color: '#64748b' }}>{fmtSar(b.value)}</span>
                  </div>
                  <div style={{ height: 8, background: '#F1F5F9', borderRadius: 5, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: s.color, transition: 'width .3s' }} />
                  </div>
                </div>
              )
            })}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 18 }}>
            {/* Deals by owner */}
            <div style={card}>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 12px', color: NAVY }}>Deals by owner</h3>
              {m.ownerRows.length === 0 ? <div style={{ color: '#94a3b8', fontSize: '0.85rem' }}>No owners.</div> : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                  <thead><tr style={{ textAlign: 'left', color: '#94a3b8' }}>
                    <th style={{ padding: '6px 4px' }}>Owner</th><th style={{ padding: '6px 4px' }}>Deals</th><th style={{ padding: '6px 4px' }}>Won</th><th style={{ padding: '6px 4px', textAlign: 'right' }}>Open value</th>
                  </tr></thead>
                  <tbody>
                    {m.ownerRows.map(o => (
                      <tr key={o.email} style={{ borderTop: '1px solid #F1F5F9' }}>
                        <td style={{ padding: '7px 4px', color: '#0F172A' }}>{o.email}</td>
                        <td style={{ padding: '7px 4px' }}>{o.total}</td>
                        <td style={{ padding: '7px 4px', color: '#15803D', fontWeight: 600 }}>{o.won}</td>
                        <td style={{ padding: '7px 4px', textAlign: 'right', fontWeight: 600 }}>{fmtSar(o.openValue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Aging / stuck deals */}
            <div style={card}>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 12px', color: NAVY, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Clock size={16} color="#F39C12" /> Stuck deals <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 400 }}>(open &gt; 30 days)</span>
              </h3>
              {m.aging.length === 0 ? <div style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Nothing stuck — pipeline is moving. 👍</div> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {m.aging.map(d => (
                    <Link key={d.id} to={`/crm/deals/${d.id}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: '#F8FAFC', borderRadius: 8, textDecoration: 'none', color: 'inherit' }}>
                      <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
                        {d.title || d.company_name || d.id}
                        <span style={{ display: 'block', fontSize: '0.7rem', color: stageMeta(d.stage).color, fontWeight: 700 }}>{stageMeta(d.stage).label}</span>
                      </span>
                      <span style={{ fontSize: '0.74rem', color: '#C0392B', fontWeight: 700, whiteSpace: 'nowrap' }}>{d.ageDays}d</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ Icon, color, label, value, sub }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#64748b', fontSize: '0.74rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        <Icon size={15} color={color} /> {label}
      </div>
      <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0F172A', marginTop: 6 }}>{value}</div>
      <div style={{ fontSize: '0.74rem', color: '#94a3b8', marginTop: 2 }}>{sub}</div>
    </div>
  )
}
