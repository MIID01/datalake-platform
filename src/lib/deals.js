// Canonical vocabulary + helpers for the `deals` (opportunity) object.
// SINGLE SOURCE OF TRUTH — every CRM surface imports from here, so the stage
// enum, labels, ordering, and sources can never drift.
//
// Model rule: `deals` = opportunity, `clients` = account. A deal references a
// client via `client_id` (canonical FK) and NEVER copies account facts.

// Stage enum — UPPERCASE, same values the old CRMPipeline used (no new vocab).
export const DEAL_STAGES = [
  { id: 'NEW',       label: 'New',       color: '#94a3b8' },
  { id: 'CONTACTED', label: 'Contacted', color: '#1598CC' },
  { id: 'PROPOSAL',  label: 'Proposal',  color: '#F39C12' },
  { id: 'WON',       label: 'Won',       color: '#34BF3A' },
  { id: 'LOST',      label: 'Lost',      color: '#C0392B' },
]
export const STAGE_IDS = DEAL_STAGES.map(s => s.id)
export const OPEN_STAGE_IDS = ['NEW', 'CONTACTED', 'PROPOSAL'] // movable; WON/LOST are terminal
export const DEAL_SOURCES = ['MANUAL', 'CSV_IMPORT', 'WEB_FORM', 'REFERRAL']
export const LAWFUL_BASES = ['legitimate_interest', 'consent']
export const ACTIVITY_TYPES = ['NOTE', 'CALL', 'MEETING', 'EMAIL', 'TASK']

// Who may DELETE a deal. Deletes are soft (archived) + recoverable + audited.
// SINGLE-deal delete is open to the CRM team (so a growing sales team can manage
// their own pipeline); MASS multi-select archive stays CEO-only (see crmArchiveDeals)
// so one rep can't wipe the board in a click. Mirrored server-side in
// functions/crmImport.js — keep the two in sync. (Future: move to CRM Settings config.)
export const DEAL_DELETE_ROLES = ['ceo', 'business', 'sales']
export const canDeleteDeals = (roleId) => DEAL_DELETE_ROLES.includes(roleId)

export const stageMeta = (id) => DEAL_STAGES.find(s => s.id === id) || DEAL_STAGES[0]
export const stageIndex = (id) => Math.max(0, STAGE_IDS.indexOf(id))
export const fmtSar = (n) => 'SAR ' + Math.round(Number(n) || 0).toLocaleString()

// PDPL: default retention for lead/contact PII once a lawful basis is recorded.
// Drives `pdpl_purge_after`, mirroring the talent_pool retention posture so the
// purge sweep can expire stale lead contact data. CEO/DPO-tunable.
export const DEFAULT_LEAD_RETENTION_DAYS = 365 * 2 // 24 months

// ── Quote / discount approval (deal_quotes) ──
// A `deal_quotes/{id}` doc is the priced proposal for a deal. Line items,
// discount and totals are quote-native facts; deal_id/client_id are FKs (no copied
// account/opportunity facts). State machine — UPPERCASE, server-side enforced:
//   DRAFT → PENDING_FINANCE → PENDING_CEO → APPROVED   (+ REJECTED at any gate)
// Clients (sales) may only create DRAFT and submit DRAFT→PENDING_FINANCE; every
// transition into PENDING_CEO / APPROVED / REJECTED is done by Cloud Functions
// (financeReviewDealQuote, approveDealQuote) on the Admin SDK. See firestore.rules.
export const QUOTE_STATES = [
  { id: 'DRAFT',           label: 'Draft',            color: '#94a3b8' },
  { id: 'PENDING_FINANCE', label: 'Finance review',   color: '#F39C12' },
  { id: 'PENDING_CEO',     label: 'CEO approval',     color: '#1598CC' },
  { id: 'APPROVED',        label: 'Approved',         color: '#34BF3A' },
  { id: 'REJECTED',        label: 'Rejected',         color: '#C0392B' },
]
export const QUOTE_STATE_IDS = QUOTE_STATES.map(s => s.id)
export const quoteStateMeta = (id) => QUOTE_STATES.find(s => s.id === id) || QUOTE_STATES[0]

// Pure totals helper — the SINGLE source of truth for quote arithmetic. Reused by
// the builder UI for live preview AND mirrored verbatim by the gate functions
// (which recompute server-side so a tampered client total is never trusted).
// Returns integer-safe numbers; discountPct is clamped to 0..100.
export function computeQuoteTotals(lineItems, discountPct) {
  const items = Array.isArray(lineItems) ? lineItems : []
  const subtotal = items.reduce((sum, li) => {
    const qty = Number(li?.qty) || 0
    const unit = Number(li?.unit_price_sar) || 0
    return sum + qty * unit
  }, 0)
  const pct = Math.min(100, Math.max(0, Number(discountPct) || 0))
  const discount = subtotal * (pct / 100)
  const total = subtotal - discount
  const round2 = (n) => Math.round(n * 100) / 100
  return { subtotal_sar: round2(subtotal), discount_pct: pct, discount_sar: round2(discount), total_sar: round2(total) }
}
