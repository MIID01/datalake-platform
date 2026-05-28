// Hire-budget calculator — drives the traffic-light check on the Hire Request form
// and the budget summary card on the CEO dashboard.

// Defaults you can override per request (e.g. expat vs. Saudi national).
export const DEFAULTS = {
  gosi_employer_pct: 11.75,   // Saudi national rate (Art. 18 GOSI). Expat = 2%.
  monthly_hours: 160,         // Standard billable hours for monthly rate × hourly conversion.
  green_margin_pct: 40,
  amber_margin_pct: 20,
}

// Statuses, in order, for a hire request. The first one set is DRAFT.
// status_history entries are append-only.
export const HIRE_STATUSES = [
  'DRAFT',
  'BUDGET_CHECKED',
  'CEO_APPROVED',
  'RECRUITING',
  'CANDIDATE_SELECTED',
  'OFFER_SENT',
  'CONTRACT_PENDING',
  'LEGAL_REVIEW',
  'SIGNED',
  'PROVISIONING',
  'ONBOARDED',
  'DEPLOYED',
]

export const STATUS_META = {
  DRAFT:              { label: 'Draft',              color: '#78909C', bg: 'rgba(120,144,156,0.12)' },
  BUDGET_CHECKED:     { label: 'Budget Checked',     color: '#1598CC', bg: 'rgba(21,152,204,0.12)' },
  CEO_APPROVED:       { label: 'CEO Approved',       color: '#34BF3A', bg: 'rgba(52,191,58,0.12)' },
  RECRUITING:         { label: 'Recruiting',         color: '#1598CC', bg: 'rgba(21,152,204,0.12)' },
  CANDIDATE_SELECTED: { label: 'Candidate Selected', color: '#1598CC', bg: 'rgba(21,152,204,0.18)' },
  OFFER_SENT:         { label: 'Offer Sent',         color: '#F39C12', bg: 'rgba(243,156,18,0.12)' },
  CONTRACT_PENDING:   { label: 'Contract Pending',   color: '#F39C12', bg: 'rgba(243,156,18,0.18)' },
  LEGAL_REVIEW:       { label: 'Legal Review',       color: '#9C27B0', bg: 'rgba(156,39,176,0.15)' },
  SIGNED:             { label: 'Signed',             color: '#34BF3A', bg: 'rgba(52,191,58,0.15)' },
  PROVISIONING:       { label: 'Provisioning',       color: '#1598CC', bg: 'rgba(21,152,204,0.22)' },
  ONBOARDED:          { label: 'Onboarded',          color: '#1598CC', bg: 'rgba(21,152,204,0.28)' },
  DEPLOYED:           { label: 'Deployed',           color: '#34BF3A', bg: 'rgba(52,191,58,0.22)' },
  REJECTED:           { label: 'Rejected',           color: '#C0392B', bg: 'rgba(192,57,43,0.12)' },
  CANCELLED:          { label: 'Cancelled',          color: '#78909C', bg: 'rgba(120,144,156,0.12)' },
}

// Compute the per-hire monthly cost to Datalake, including GOSI employer contribution.
// All inputs in SAR.
export function monthlyCost({ salary, housing = 0, transport = 0, gosi_employer_pct = DEFAULTS.gosi_employer_pct }) {
  const s = Number(salary) || 0
  const h = Number(housing) || 0
  const t = Number(transport) || 0
  const gosi = (s * (Number(gosi_employer_pct) || 0)) / 100
  return s + h + t + gosi
}

// Annual cost projection (12 × monthly).
export function annualCost(args) {
  return monthlyCost(args) * 12
}

// Derive a billable monthly revenue figure from the project's rate.
// project.rate_structure is one of HOURLY / MONTHLY / FIXED.
// project.rate_amount_sar is the per-engineer rate matching that structure.
//   HOURLY  → revenue = rate × monthly_hours (default 160)
//   MONTHLY → revenue = rate (per engineer per month)
//   FIXED   → falls back to the PO value divided by months, if start/end known; else null.
export function monthlyClientRevenue(project, { monthly_hours = DEFAULTS.monthly_hours } = {}) {
  if (!project) return null
  const rate = Number(project.rate_amount_sar) || 0
  const structure = String(project.rate_structure || 'MONTHLY').toUpperCase()
  if (structure === 'HOURLY' && rate > 0)  return rate * monthly_hours
  if (structure === 'MONTHLY' && rate > 0) return rate
  if (structure === 'FIXED' && project.po_value_sar && project.start_date && project.end_date) {
    const months = monthsBetween(project.start_date, project.end_date)
    return months > 0 ? Number(project.po_value_sar) / months : null
  }
  return null
}

function monthsBetween(start, end) {
  const a = new Date(start), b = new Date(end)
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
}

// Main budget calculation. Returns a structured result the UI consumes.
// `project` is a projects/* doc (or null); `costs` is the salary/housing/etc payload.
// `currentPoUsed` is what the project has already burned (defaults to project.po_used || 0).
export function evaluateHireBudget({ project, costs, currentPoUsed }) {
  const revenuePerMonth = monthlyClientRevenue(project)
  const cost = monthlyCost(costs)
  const annual = cost * 12
  const margin = revenuePerMonth != null ? revenuePerMonth - cost : null
  const marginPct = (revenuePerMonth && revenuePerMonth > 0)
    ? (margin / revenuePerMonth) * 100
    : null

  const poValue = project?.po_value_sar ? Number(project.po_value_sar) : null
  const poUsed = currentPoUsed != null ? Number(currentPoUsed) : Number(project?.po_used || 0)
  const poRemaining = poValue != null ? poValue - poUsed : null
  const poFitsAnnualCost = poRemaining != null ? poRemaining >= annual : null

  // Traffic light. CEO-editable thresholds could live alongside DOA later.
  const { green_margin_pct, amber_margin_pct } = DEFAULTS
  let light = 'unknown'   // 'green' | 'amber' | 'red' | 'unknown'
  let headline = 'Add a project rate to see the margin check.'
  if (marginPct != null && poFitsAnnualCost != null) {
    if (marginPct >= green_margin_pct && poFitsAnnualCost) {
      light = 'green'
      headline = 'Hire approved within budget.'
    } else if (marginPct < amber_margin_pct || poFitsAnnualCost === false) {
      light = 'red'
      headline = poFitsAnnualCost === false
        ? 'Budget insufficient — PO will not cover the annual cost. Requires CEO override.'
        : 'Margin below ' + amber_margin_pct + '% — requires CEO override.'
    } else {
      light = 'amber'
      headline = 'Hire possible, low margin — CEO review required.'
    }
  } else if (marginPct == null && poFitsAnnualCost === false) {
    light = 'red'
    headline = 'PO has no remaining budget.'
  } else if (marginPct != null && poFitsAnnualCost == null) {
    // Margin known but PO not set — still useful
    if (marginPct >= green_margin_pct) { light = 'green'; headline = 'Margin healthy. Confirm PO before approval.' }
    else if (marginPct < amber_margin_pct) { light = 'red'; headline = 'Margin below ' + amber_margin_pct + '% — requires CEO override.' }
    else { light = 'amber'; headline = 'Low margin — CEO review required.' }
  }

  return {
    monthly_cost: cost,
    annual_cost: annual,
    monthly_revenue: revenuePerMonth,
    monthly_margin: margin,
    margin_pct: marginPct,
    po_value: poValue,
    po_used: poUsed,
    po_remaining: poRemaining,
    po_fits_annual_cost: poFitsAnnualCost,
    light,
    headline,
  }
}

// Helper: derive a unique client list from projects (we don't have a separate clients collection
// in some installs — projects.client_name is the source of truth today).
export function distinctClientsFromProjects(projects) {
  const seen = new Map()
  for (const p of projects) {
    const name = p.client_name?.trim()
    if (!name) continue
    if (!seen.has(name)) seen.set(name, { client_name: name, projects: [] })
    seen.get(name).projects.push(p)
  }
  return Array.from(seen.values()).sort((a, b) => a.client_name.localeCompare(b.client_name))
}
