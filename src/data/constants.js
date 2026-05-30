// DTLK-DATA-CONSTANTS — Business constants extracted from mock data files
// These are NOT mock data — they are configuration constants and enum definitions.

// ── Open Roles (Careers Page) ────────────────────────────────
// Placeholder sample roles for the public careers page. Real listings live in
// Firestore `job_listings/` and are served via the HR Job Listings flow — these
// are only used as a fallback when no listings exist yet. No client names —
// public job pages must never expose which specific clients we work with.
export const openRoles = [
  { id: 'R-001', title: 'Senior Data Engineer', location: 'Riyadh, KSA', salaryMin: 25000, salaryMax: 35000, client: 'Confidential — KSA financial services', type: 'Full-time, On-site' },
  { id: 'R-002', title: 'ML Engineer', location: 'Riyadh, KSA (Hybrid)', salaryMin: 20000, salaryMax: 28000, client: 'Confidential — KSA banking', type: 'Full-time, Hybrid' },
  { id: 'R-003', title: 'Frontend Developer', location: 'Remote KSA', salaryMin: 18000, salaryMax: 25000, client: 'Multiple Clients', type: 'Full-time, Remote' },
]

// ── Task Categories & Priorities (TaskInbox) ─────────────────
export const taskCategories = {
  APPROVAL: { label: 'Approval', color: '#EF5829', icon: '✅' },
  REVIEW: { label: 'Review', color: '#1598CC', icon: '👁️' },
  ACTION: { label: 'Action Required', color: '#F39C12', icon: '⚡' },
  COMPLIANCE: { label: 'Compliance', color: '#34BF3A', icon: '🛡️' },
  SIGNATURE: { label: 'Signature', color: '#022873', icon: '✍️' },
  NOTIFICATION: { label: 'Notification', color: '#8898aa', icon: '🔔' },
}

export const taskPriorities = {
  CRITICAL: { label: 'Critical', color: '#C0392B' },
  HIGH: { label: 'High', color: '#EF5829' },
  MEDIUM: { label: 'Medium', color: '#F39C12' },
  LOW: { label: 'Low', color: '#34BF3A' },
}

// ── AI Agent Config (AIOperations) ───────────────────────────
export const TIERS = {
  SENIOR: { label: 'Senior', color: '#EF5829', short: 'SR' },
  JUNIOR: { label: 'Junior', color: '#1598CC', short: 'JR' },
  ASSISTANT: { label: 'Assistant', color: '#34BF3A', short: 'ASST' },
  OBSERVER: { label: 'Observer', color: '#8898aa', short: 'OBS' },
}

export const STATUSES = {
  ACTIVE: { label: 'Active', color: '#34BF3A', bg: 'rgba(52,191,58,0.12)' },
  PAUSED: { label: 'Paused', color: '#F39C12', bg: 'rgba(243,156,18,0.12)' },
  DRY_RUN: { label: 'Dry-Run', color: '#1598CC', bg: 'rgba(21,152,204,0.12)' },
  PROPOSED: { label: 'Proposed', color: '#8898aa', bg: 'rgba(136,152,170,0.12)' },
  DEPRECATED: { label: 'Deprecated', color: '#C0392B', bg: 'rgba(192,57,43,0.12)' },
  RETIRED: { label: 'Retired', color: '#5a6a84', bg: 'rgba(90,106,132,0.12)' },
}

export const DOMAINS = [
  { id: 'HR_TALENT', label: 'HR & Talent', icon: '👤', senior: 'sa-gatekeeper-v2' },
  { id: 'COMPLIANCE_LEGAL', label: 'Compliance & Legal', icon: '🛡️', senior: 'sa-auditor-v2' },
  { id: 'FINANCE', label: 'Finance', icon: '💰', senior: 'sa-controller-v2' },
  { id: 'SALES_CLIENT', label: 'Sales & Client', icon: '🤝', senior: null },
  { id: 'DELIVERY_PMO', label: 'Delivery & PMO', icon: '📦', senior: null },
  { id: 'LEARNING_DEV', label: 'Learning & Dev', icon: '📚', senior: null },
  { id: 'INFRASTRUCTURE', label: 'Infrastructure', icon: '🔧', senior: null },
  { id: 'SECURITY', label: 'Security', icon: '🔒', senior: 'sa-auditor-v2' },
]

// ── Recruitment Pipeline Config (Talent Page) ────────────────
export const tierConfig = {
  A: { label: 'Tier A — Immediate Offer', color: '#27ae60', bg: '#e8fbe5', sla: '24 hours' },
  B: { label: 'Tier B — Qualified Offer', color: '#2C5F7C', bg: '#e0f0f8', sla: '48 hours' },
  C: { label: 'Tier C — Conditional Offer', color: '#E8913A', bg: '#fff7ed', sla: 'Pending reference' },
  D: { label: 'Tier D — Hold / Backup', color: '#888', bg: '#f5f5f5', sla: 'Backup pool' },
  E: { label: 'Tier E — Decline', color: '#C0392B', bg: '#fde8e8', sla: 'Reject' },
}

export const stageConfig = {
  S1: { label: 'AI Pre-Screen', short: 'AI', color: '#8e44ad', icon: '🤖' },
  S2: { label: 'HR Screen', short: 'HR', color: '#2C5F7C', icon: '👤' },
  S3: { label: 'Client Technical', short: 'Tech', color: '#E8913A', icon: '⚙️' },
  S4: { label: 'Aggregate & Decision', short: 'Score', color: '#27ae60', icon: '📊' },
  S5: { label: 'Offer Dispatch', short: 'Offer', color: '#c0392b', icon: '📧' },
}

// ── Talent Pool Config (Talent Page) ─────────────────────────
export const STATE_COLORS = {
  PENDING_CONSENT: '#cbd5e1',
  ACTIVE_POOL_YEAR_1: '#4ade80',
  ACTIVE_POOL_YEAR_2: '#38bdf8',
  RENEWAL_PENDING: '#fbbf24',
  GRACE_PERIOD: '#fb923c',
}

export const STATE_LABELS = {
  PENDING_CONSENT: 'Pending Consent',
  ACTIVE_POOL_YEAR_1: 'Active Year 1',
  ACTIVE_POOL_YEAR_2: 'Active Year 2',
  RENEWAL_PENDING: 'Renewal Pending',
  GRACE_PERIOD: 'Grace Period',
}
