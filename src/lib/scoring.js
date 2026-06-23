// Lead/deal scoring (DTLK-CRM-ENT-001 Phase 2) — EXPLAINABLE, deterministic, honest.
// Every point traces to a real signal on the canonical `deals` doc. No AI, no black box,
// no fabricated number. A deal that was never contacted scores low and is flagged
// "low signal" — never a fake-positive default (No-Fabricated-Data / Status Integrity).
// More auditable than an opaque ML score, which matters for our compliance posture.
import { STAGE_PROBABILITY, OPEN_STAGE_IDS } from './deals'

// A deal at/above this value earns full value points. CEO-tunable later via CRM settings.
const VALUE_REF_SAR = 250000

const toMs = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : (typeof v === 'number' ? v : null))

// Days since the deal was last touched (activity logged / email sent / stage moved).
function daysSinceTouch(deal) {
  const t = toMs(deal.last_activity_at) || toMs(deal.stage_updated_at) || toMs(deal.updated_at) || toMs(deal.created_at)
  // Date.now() lives in this lib helper (not a component) on purpose — score reflects
  // recency at read time; the react purity rule only governs component/hook bodies.
  return t == null ? null : Math.floor((Date.now() - t) / 86400000)
}

function recencyPoints(days) {
  if (days == null) return 0
  if (days <= 7) return 35
  if (days <= 14) return 25
  if (days <= 30) return 15
  if (days <= 60) return 7
  return 0
}

export const SCORE_BANDS = [
  { label: 'Hot',  color: '#34BF3A', min: 70 },
  { label: 'Warm', color: '#F39C12', min: 40 },
  { label: 'Cold', color: '#94a3b8', min: 0 },
]
export const bandFor = (score) => SCORE_BANDS.find(b => score >= b.min) || SCORE_BANDS[SCORE_BANDS.length - 1]

// Returns { score 0-100, band, color, lowSignal, factors[] } for an OPEN deal, or null
// for terminal (WON/LOST) deals (scoring a closed deal is meaningless).
export function scoreDeal(deal) {
  if (!deal || !OPEN_STAGE_IDS.includes(deal.stage)) return null
  const stagePts = Math.round((STAGE_PROBABILITY[deal.stage] ?? 0) * 40)
  const value = Number(deal.value_sar || 0)
  const valuePts = Math.round(Math.min(value / VALUE_REF_SAR, 1) * 25)
  const days = daysSinceTouch(deal)
  const recPts = recencyPoints(days)
  const lowSignal = toMs(deal.last_activity_at) == null
  const score = Math.min(100, stagePts + valuePts + recPts)
  const band = bandFor(score)
  return {
    score,
    band: band.label,
    color: band.color,
    lowSignal,
    factors: [
      { label: 'Stage intent', points: stagePts, max: 40, note: deal.stage },
      { label: 'Deal value', points: valuePts, max: 25, note: value ? `SAR ${value.toLocaleString()}` : 'no value set' },
      { label: 'Recency', points: recPts, max: 35, note: days == null ? 'never contacted' : `${days}d since last touch` },
    ],
  }
}
