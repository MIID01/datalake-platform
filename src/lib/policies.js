// Policy registry — the onboarding policies an employee must ACKNOWLEDGE
// (Policy Acknowledgment & Privacy Notice Receipt). Versions are pinned: a
// version bump re-flags everyone in the HR acknowledgment register and — once
// the timesheet gate is enabled — blocks timesheet submission until re-ack.
//
// Firestore platform_settings/policy_registry overrides these defaults at
// runtime (CEO-editable) so versions can change without a deploy. The SAME
// registry is read server-side by the submitTimesheet gate (functions read the
// Firestore doc directly — they can't import this module).
//
// NOTE: this is an ACKNOWLEDGMENT model for employees (lawful basis = employment
// contract + legal obligation: Labor Law / GOSI / WPS / ZATCA), NOT consent.
// Candidate consent is a separate flow (src/pages/Consent.jsx).

import { db } from './firebase'
import { doc, getDoc, collection, getDocs, query, where, limit } from 'firebase/firestore'

export const DEFAULT_POLICY_REGISTRY = [
  { id: 'privacy_policy',    ref: 'DTLK-POL-PRI-001', title: 'Privacy Policy — Data Processing Notice',        version: '1.0' },
  { id: 'pdpl_consent',      ref: 'DTLK-POL-PRI-001', title: 'Privacy Notice — Personal Data Processing',       version: '1.0' },
  { id: 'code_of_conduct',   ref: 'DTLK-POL-HRM-002', title: 'Employee Code of Conduct',                        version: '1.0' },
  { id: 'infosec_awareness', ref: 'DTLK-POL-SEC-001', title: 'Information Security Awareness (NCA ECC)',        version: '1.0' },
]

let _cache = null

// Reads platform_settings/policy_registry; falls back to the defaults above.
export async function getPolicyRegistry() {
  if (_cache) return _cache
  try {
    const snap = await getDoc(doc(db, 'platform_settings', 'policy_registry'))
    const policies = snap.exists() ? snap.data().policies : null
    if (Array.isArray(policies) && policies.length) {
      _cache = policies
      return _cache
    }
  } catch {
    // permission/network — fall back to the compiled-in defaults
  }
  _cache = DEFAULT_POLICY_REGISTRY
  return _cache
}

// Normalize a policy id for comparison: an evidence row may key the policy as
// `policy_id` (current) or `id` (legacy); casing/whitespace drift is ignored.
const normPolicyId = (v) => String(v ?? '').trim().toLowerCase()

// Version-equality that tolerates format drift between what the onboarding flow
// wrote historically and what the registry pins now: number vs string, a leading
// "v", and trailing-zero forms ("1" / "1.0" / 1.0) all compare equal. An empty /
// missing version NEVER matches a pinned version — an unversioned legacy row is
// genuinely "not acknowledged at the current version" and must re-acknowledge.
export function versionsMatch(a, b) {
  const sa = String(a ?? '').trim().toLowerCase().replace(/^v/, '')
  const sb = String(b ?? '').trim().toLowerCase().replace(/^v/, '')
  if (!sa || !sb) return false
  if (sa === sb) return true
  const na = Number(sa), nb = Number(sb)
  return Number.isFinite(na) && Number.isFinite(nb) && na === nb
}

// Given an employee's onboarding_evidence rows ({ policy_id, policy_version, … })
// and the current registry, returns { complete, acknowledged, missing[] }.
// "Missing" = no row for a policy OR the acknowledged version != the current
// version (a version bump forces re-acknowledgment). This is the single
// derivation the register and the gate both use — no separate status flag.
export function deriveAcknowledgmentStatus(evidenceRows, registry = DEFAULT_POLICY_REGISTRY) {
  const rows = Array.isArray(evidenceRows) ? evidenceRows : []
  const missing = []
  const acknowledged = []
  for (const p of registry) {
    const row = rows.find(r => normPolicyId(r.policy_id ?? r.id) === normPolicyId(p.id))
    if (row && versionsMatch(row.policy_version, p.version)) {
      acknowledged.push({ id: p.id, title: p.title, version: p.version })
    } else {
      missing.push({ id: p.id, title: p.title, version: p.version })
    }
  }
  return { complete: missing.length === 0, acknowledged, missing }
}

// Acknowledgment-register summary for the gate toggle: { total, completed, pending }
// across all employee records (Completed = current-version evidence rows).
export async function getAcknowledgmentSummary() {
  const registry = await getPolicyRegistry()
  const empSnap = await getDocs(collection(db, 'employees'))
  let completed = 0
  await Promise.all(empSnap.docs.map(async (e) => {
    let evidence = []
    try {
      const ev = await getDocs(collection(db, 'employees', e.id, 'onboarding_evidence'))
      evidence = ev.docs.map(d => d.data())
    } catch { /* */ }
    if (deriveAcknowledgmentStatus(evidence, registry).complete) completed++
  }))
  const total = empSnap.size
  return { total, completed, pending: total - completed }
}

// Client-side mirror of the server submitTimesheet gate. Returns the chain
// status for an employee email so the engineer portal can show the locked state
// (and which items are outstanding) without a silent failure. When the feature
// flag (platform_settings/timesheet_gate) is off / pre-effective-date, returns
// active:false with everything "complete" so the UI shows no lock.
export async function getChainGateStatus(email) {
  const cleanEmail = String(email || '').toLowerCase()
  const open = { active: false, onboardingComplete: true, trainingComplete: true, missingPolicies: [], missingModules: [] }

  let gate = {}
  try {
    const gd = await getDoc(doc(db, 'platform_settings', 'timesheet_gate'))
    gate = gd.exists() ? gd.data() : {}
  } catch { return open }
  const eff = gate.effective_date
    ? (gate.effective_date.toDate ? gate.effective_date.toDate() : new Date(gate.effective_date))
    : null
  const active = gate.enabled === true && (!eff || Date.now() >= eff.getTime())
  if (!active) return open

  let empId = null
  try {
    const eq = await getDocs(query(collection(db, 'employees'), where('email', '==', cleanEmail), limit(1)))
    if (!eq.empty) empId = eq.docs[0].id
  } catch { /* */ }

  const registry = await getPolicyRegistry()
  let evidence = []
  if (empId) {
    try {
      const ev = await getDocs(collection(db, 'employees', empId, 'onboarding_evidence'))
      evidence = ev.docs.map(d => d.data())
    } catch { /* */ }
  }
  const { complete: onboardingComplete, missing } = deriveAcknowledgmentStatus(evidence, registry)

  let missingModules = []
  try {
    const [mod, comp] = await Promise.all([
      getDocs(query(collection(db, 'training_modules'), where('mandatory', '==', true))),
      getDocs(query(collection(db, 'training_completions'), where('engineer_email', '==', cleanEmail))),
    ])
    const done = new Set(comp.docs.map(d => d.data().module_id))
    missingModules = mod.docs
      .filter(d => !done.has(d.data().module_id || d.id))
      .map(d => d.data().title || d.data().module_id || d.id)
  } catch { /* */ }

  return {
    active: true,
    onboardingComplete,
    trainingComplete: missingModules.length === 0,
    missingPolicies: missing.map(m => m.title),
    missingModules,
  }
}
