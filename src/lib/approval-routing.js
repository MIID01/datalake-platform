// Centralized approval-routing logic for the post-CEO-bottleneck flow.
// Reads from Firestore:
//   - engineer_project_assignments  → who the requester is deployed under (and their PM)
//   - projects                      → client name + project_manager_id (+ client_approver_*)
//   - users                         → resolves Finance / HR / CEO / PM names from role_id
//   - approval_routing/config       → CEO-editable thresholds (DOA matrix); falls back to defaults

import { db } from './firebase'
import {
  collection, query, where, getDocs, doc, getDoc, limit,
} from 'firebase/firestore'

// Hard-coded fallbacks. CEO can override via /ceo/admin/delegation.
export const DEFAULT_ROUTING = {
  expense_thresholds: {
    auto_approve_under_sar: 200,          // <200 communication = auto-approved
    pm_max_sar: 1000,                     // <1000 → PM
    finance_max_sar: 5000,                // 1000–5000 → Finance; >5000 → CEO
    auto_approve_categories: ['Communication'],
  },
  leave_ceo_required_types: ['unpaid', 'hajj'],   // only these need CEO
  leave_hr_threshold_days: 5,                     // >5 days also goes through HR
  sick_auto_approve_max_days: 2,
  ticket_routing: {
    'IT / Access Issues': 'it_admin',
    'IT_ACCESS': 'it_admin',
    'SYSTEM_ISSUE': 'it_admin',
    'Payroll / Salary': 'finance',
    'PAYROLL_SALARY': 'finance',
    'Leave / HR': 'hr',
    'LEAVE_HR': 'hr',
    'Contract / Legal': 'hr',
    'CONTRACT_LEGAL': 'hr',
    'Housing / Travel': 'hr',
    'Client Conflict': 'pm',          // PM first, CEO if escalated
    'CLIENT_CONFLICT': 'pm',
    'Health & Safety': 'hr_and_ceo',  // both notified immediately
    'HEALTH_SAFETY': 'hr_and_ceo',
    'Other': 'hr',
  },
}

// Friendly labels used in the UI hints
const ROLE_LABELS = {
  pm: 'Project Manager',
  client_pm: 'Client PM',
  finance: 'Finance',
  hr: 'HR',
  ceo: 'CEO',
  it_admin: 'IT',
  hr_and_ceo: 'HR (CEO notified)',
}

// ─────────────────────────────────────────────────────────────────
// loadDelegationConfig — merges the Firestore override onto the defaults
// ─────────────────────────────────────────────────────────────────
export async function loadDelegationConfig() {
  try {
    const snap = await getDoc(doc(db, 'approval_routing', 'config'))
    if (!snap.exists()) return DEFAULT_ROUTING
    const stored = snap.data() || {}
    return {
      ...DEFAULT_ROUTING,
      ...stored,
      expense_thresholds: { ...DEFAULT_ROUTING.expense_thresholds, ...(stored.expense_thresholds || {}) },
      ticket_routing: { ...DEFAULT_ROUTING.ticket_routing, ...(stored.ticket_routing || {}) },
    }
  } catch {
    return DEFAULT_ROUTING
  }
}

// ─────────────────────────────────────────────────────────────────
// loadApprovalContext — one call from a form to get everything it needs.
// Returns a context object describing the requester's deployment and
// the resolved approver names. All fields are optional/null-safe so
// forms can render a sensible hint even when something is missing.
// ─────────────────────────────────────────────────────────────────
export async function loadApprovalContext({ email }) {
  const context = {
    isDeployed: false,
    project: null,           // { project_id, project_name, client_name, project_manager_id }
    clientPm: null,          // { name, email } — derived from project.client_approver_*
    datalakePm: null,        // { name, email, uid } — looked up from users by project_manager_id
    finance: null,
    hr: null,
    ceo: null,
    delegation: DEFAULT_ROUTING,
  }
  if (!email) return context

  // Parallel reads: delegation + role lookups + assignment query
  const [delegation, financeUser, hrUser, ceoUser, assignmentSnap] = await Promise.all([
    loadDelegationConfig(),
    findUserByRole('finance'),
    findUserByRole('hr'),
    findUserByEmail('m.alqumri@datalake.sa'),
    getDocs(query(
      collection(db, 'engineer_project_assignments'),
      where('engineer_email', '==', email),
      where('status', '==', 'ACTIVE'),
      limit(1),
    )).catch(() => ({ empty: true, docs: [] })),
  ])

  context.delegation = delegation
  context.finance = financeUser
  context.hr = hrUser
  context.ceo = ceoUser

  if (!assignmentSnap.empty) {
    const assignment = assignmentSnap.docs[0].data()
    context.isDeployed = true

    // Pull the matching project doc to get client PM + Datalake PM
    try {
      const projSnap = await getDocs(query(
        collection(db, 'projects'),
        where('project_id', '==', assignment.project_id),
        limit(1),
      ))
      if (!projSnap.empty) {
        const p = projSnap.docs[0].data()
        context.project = {
          project_id: p.project_id,
          project_name: p.project_name,
          client_name: p.client_name,
          project_manager_id: p.project_manager_id || null,
        }
        if (p.client_approver_name) {
          context.clientPm = { name: p.client_approver_name, email: p.client_approver_email || null }
        }
        if (p.project_manager_id) {
          // Resolve PM display name from users
          const pmSnap = await getDoc(doc(db, 'users', p.project_manager_id))
          if (pmSnap.exists()) {
            const pm = pmSnap.data()
            context.datalakePm = {
              uid: p.project_manager_id,
              name: pm.display_name || pm.full_name || pm.email,
              email: pm.email,
            }
          }
        }
      }
    } catch {
      /* project lookup is best-effort */
    }
  }

  // Final fallback for the Datalake PM: CEO acts as PM when none assigned.
  if (!context.datalakePm && context.ceo) {
    context.datalakePm = { ...context.ceo, isCeoFallback: true }
  }

  return context
}

async function findUserByRole(role) {
  try {
    const snap = await getDocs(query(
      collection(db, 'users'),
      where('role_id', '==', role),
      where('status', '==', 'active'),
      limit(1),
    ))
    if (snap.empty) return null
    const d = snap.docs[0].data()
    return { uid: snap.docs[0].id, name: d.display_name || d.full_name || d.email, email: d.email, role_id: role }
  } catch {
    return null
  }
}

async function findUserByEmail(email) {
  try {
    const snap = await getDocs(query(
      collection(db, 'users'),
      where('email', '==', email),
      limit(1),
    ))
    if (snap.empty) return { uid: null, name: 'CEO', email, role_id: 'ceo' }
    const d = snap.docs[0].data()
    return { uid: snap.docs[0].id, name: d.display_name || d.full_name || 'CEO', email, role_id: 'ceo' }
  } catch {
    return { uid: null, name: 'CEO', email, role_id: 'ceo' }
  }
}

// ─────────────────────────────────────────────────────────────────
// describeLeaveApprover — what to show on the leave form
// ─────────────────────────────────────────────────────────────────
export function describeLeaveApprover(context, { type, workingDays }) {
  if (!context) return { message: 'Awaiting approval.', chain: [] }
  const t = (type || '').toLowerCase()

  // Auto-approved short-circuits
  if (t === 'emergency') {
    return {
      message: 'Auto-approved. Management is notified.',
      chain: [{ label: 'Auto-approved', role: 'system' }],
      autoApproved: true,
    }
  }
  if (t === 'sick' && workingDays > 0 && workingDays <= (context.delegation.sick_auto_approve_max_days || 2)) {
    return {
      message: `Auto-approved (sick ≤${context.delegation.sick_auto_approve_max_days || 2} days). PM and HR will be notified.`,
      chain: [{ label: 'Auto-approved', role: 'system' }],
      autoApproved: true,
    }
  }

  // CEO-only categories (unpaid / hajj)
  const ceoTypes = (context.delegation.leave_ceo_required_types || []).map(s => s.toLowerCase())
  if (ceoTypes.includes(t)) {
    return {
      message: 'This will be sent to the CEO for approval.',
      chain: [{ label: context.ceo?.name || 'CEO', role: 'ceo' }],
    }
  }

  const chain = []
  if (context.isDeployed) {
    if (context.clientPm) chain.push({ label: context.clientPm.name, role: 'client_pm' })
    if (context.datalakePm) chain.push({
      label: context.datalakePm.name + (context.datalakePm.isCeoFallback ? ' (acting PM)' : ''),
      role: 'pm',
    })
  } else if (context.hr) {
    chain.push({ label: context.hr.name, role: 'hr' })
  } else {
    // No HR resolved yet — fall through to CEO as the only routine path
    chain.push({ label: context.ceo?.name || 'Management', role: 'ceo' })
  }

  // >5 days also goes through HR
  if (workingDays > (context.delegation.leave_hr_threshold_days || 5) && context.isDeployed && context.hr) {
    chain.push({ label: context.hr.name, role: 'hr' })
  }

  const firstApprover = chain[0]
  const message = firstApprover
    ? `This will be sent to ${firstApprover.label} (${ROLE_LABELS[firstApprover.role] || firstApprover.role}) for approval.`
    : 'Awaiting approval.'
  return { message, chain }
}

// ─────────────────────────────────────────────────────────────────
// describeExpenseApprover — live as user types the amount
// ─────────────────────────────────────────────────────────────────
export function describeExpenseApprover(context, { amount, category }) {
  if (!context) return { message: '', approver: null }
  const n = Number(amount) || 0
  const thr = context.delegation.expense_thresholds

  // Auto-approve communication under threshold
  const isAutoCategory = (thr.auto_approve_categories || []).map(s => s.toLowerCase()).includes(String(category || '').toLowerCase())
  if (n > 0 && n < thr.auto_approve_under_sar && isAutoCategory) {
    return {
      level: 'auto',
      message: `Auto-approved (under SAR ${thr.auto_approve_under_sar} — ${category}).`,
      approver: { label: 'Auto-approved', role: 'system' },
    }
  }

  if (n <= 0) return { level: null, message: 'Enter an amount to see who reviews this.', approver: null }

  if (n < thr.pm_max_sar) {
    const a = context.datalakePm || context.ceo
    return {
      level: 'pm',
      message: `This will be reviewed by ${a?.name || 'your PM'} (${ROLE_LABELS.pm}).`,
      approver: { label: a?.name, role: 'pm' },
    }
  }
  if (n <= thr.finance_max_sar) {
    const a = context.finance
    return {
      level: 'finance',
      message: `This will be reviewed by ${a?.name || 'Finance'} (${ROLE_LABELS.finance}).`,
      approver: { label: a?.name, role: 'finance' },
    }
  }
  const a = context.ceo
  return {
    level: 'ceo',
    message: `This exceeds SAR ${thr.finance_max_sar.toLocaleString()} — CEO approval required.`,
    approver: { label: a?.name, role: 'ceo' },
  }
}

// ─────────────────────────────────────────────────────────────────
// describeTicketAssignee — what to show on the support form
// ─────────────────────────────────────────────────────────────────
export function describeTicketAssignee(context, { category }) {
  if (!context) return { message: '', assignee: null }
  const role = context.delegation.ticket_routing?.[category] || 'hr'
  let person = null
  switch (role) {
    case 'it_admin': person = { name: 'IT Administration', role: 'it_admin' }; break
    case 'finance': person = { name: context.finance?.name || 'Finance', role: 'finance' }; break
    case 'hr': person = { name: context.hr?.name || 'HR', role: 'hr' }; break
    case 'pm': {
      const a = context.datalakePm
      person = { name: a?.name || 'your PM', role: 'pm' }; break
    }
    case 'hr_and_ceo':
      person = { name: `${context.hr?.name || 'HR'} (CEO notified)`, role: 'hr_and_ceo' }; break
    default: person = { name: 'HR', role: 'hr' }
  }
  return {
    message: `This will be assigned to ${person.name} (${ROLE_LABELS[person.role] || person.role}).`,
    assignee: person,
    role,
  }
}

// ─────────────────────────────────────────────────────────────────
// formatApprovalChain — used by F to render "X (PM) approved → Y (HR) approved"
// records: [{ name, role, action: 'approved'|'rejected', at }]
// ─────────────────────────────────────────────────────────────────
export function formatApprovalChain(records) {
  if (!records || records.length === 0) return ''
  return records.map(r => {
    const roleLabel = ROLE_LABELS[r.role] || r.role || ''
    const action = r.action || 'approved'
    const tag = roleLabel ? ` (${roleLabel})` : ''
    return `${r.name}${tag} ${action}`
  }).join(' → ')
}

export { ROLE_LABELS }
