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

export const stageMeta = (id) => DEAL_STAGES.find(s => s.id === id) || DEAL_STAGES[0]
export const stageIndex = (id) => Math.max(0, STAGE_IDS.indexOf(id))
export const fmtSar = (n) => 'SAR ' + Math.round(Number(n) || 0).toLocaleString()

// PDPL: default retention for lead/contact PII once a lawful basis is recorded.
// Drives `pdpl_purge_after`, mirroring the talent_pool retention posture so the
// purge sweep can expire stale lead contact data. CEO/DPO-tunable.
export const DEFAULT_LEAD_RETENTION_DAYS = 365 * 2 // 24 months
