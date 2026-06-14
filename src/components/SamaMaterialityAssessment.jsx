import { useEffect, useMemo, useState } from 'react'
import {
  doc, getDoc, addDoc, collection, serverTimestamp, setDoc,
} from 'firebase/firestore'
import { db, auth } from '../lib/firebase'
import { ShieldCheck, AlertTriangle, CheckCircle2, Info, ScrollText, Loader } from 'lucide-react'
import ApprovalButton from './ApprovalButton'
import { SignedBadgeList } from './SignedBadge'

// SAMA Materiality Assessment — Compliance-as-Code.
//
// SAMA's Outsourcing Framework (SAMA-OUT-NOC-001) requires that any outsourcing
// arrangement entered into by a SAMA-regulated financial institution be
// classified as "material" or "non-material". Material arrangements require
// SAMA No-Objection BEFORE the engagement may commence. Non-material
// arrangements may be notified after the fact.
//
// This component is the structured assessment we run for every engagement
// (project) before it goes ACTIVE. The 6 default questions implement SAMA's
// published material-outsourcing criteria; they're overridable via
// platform_settings/sama_materiality_criteria for future regulatory updates.
//
// Persistence shape (written by the caller on form submit; this component
// returns the assessment object via onChange):
//   sama_materiality: {
//     answers: { is_sama_regulated, involves_customer_data, is_critical, failure_impact, decision_authority, cross_border },
//     determination: 'MATERIAL' | 'NON_MATERIAL' | 'NOT_SAMA',
//     noc_required: true | false,
//     noc_status: 'NONE' | 'REQUESTED' | 'OBTAINED' | 'WAIVED',
//     assessment_id,
//     assessed_by, assessed_at,
//     criteria_version,
//   }
//
// The CEO-approval step is rendered when `engagementId` is set (the parent
// doc must exist before we can hang an approval_evidence subcollection off
// it). When `engagementId` is null (new-project draft), we hide the approval
// button and tell the user "save first, sign after".

const DEFAULT_CRITERIA = {
  version: 1,
  questions: [
    {
      id: 'is_sama_regulated',
      label: 'Is the client a SAMA-regulated financial institution?',
      help: 'Banks, finance companies, insurers, money exchangers, payments — anyone licensed by SAMA.',
      anchor: true,
    },
    {
      id: 'involves_customer_data',
      label: "Does the outsourced function involve the client's customer or banking data?",
      help: 'KYC records, transactional data, account information, credit data.',
    },
    {
      id: 'is_critical',
      label: "Is the function critical to the client's core banking operations?",
      help: 'Core ledger, payments rails, KYC, AML monitoring, mobile banking — anything where downtime means the bank can\'t serve customers.',
    },
    {
      id: 'failure_impact',
      label: "Would failure of this service significantly disrupt the client's operations or customers?",
      help: 'Material reputational, regulatory, financial, or operational impact in the event of incident.',
    },
    {
      id: 'decision_authority',
      label: "Does the function involve decision-making authority over the client's business?",
      help: 'E.g., credit decisions, fraud-block decisions, customer-facing actions taken without the client\'s human in the loop.',
    },
    {
      id: 'cross_border',
      label: 'Does it involve cross-border data transfer?',
      help: 'Datalake operates only in KSA me-central2 — this should always be NO. If YES, escalate immediately, it is a PDPL/SAMA red flag.',
      redFlagIfYes: true,
    },
  ],
}

export function deriveDetermination(answers, criteria = DEFAULT_CRITERIA) {
  const a = answers || {}
  const is_sama = a.is_sama_regulated === true
  const anyMaterialTrigger = (
    a.involves_customer_data === true ||
    a.is_critical === true ||
    a.failure_impact === true ||
    a.decision_authority === true
  )
  if (!is_sama) {
    return {
      determination: 'NOT_SAMA',
      noc_required: false,
      summary: 'Not SAMA-regulated — standard outsourcing controls apply.',
      tone: 'neutral',
    }
  }
  if (anyMaterialTrigger) {
    return {
      determination: 'MATERIAL',
      noc_required: true,
      summary: 'MATERIAL outsourcing — SAMA No-Objection REQUIRED before engagement commencement.',
      tone: 'danger',
    }
  }
  return {
    determination: 'NON_MATERIAL',
    noc_required: false,
    summary: 'NON-MATERIAL — Notification to SAMA may suffice. No prior no-objection required.',
    tone: 'warning',
  }
}

export default function SamaMaterialityAssessment({
  engagementId,
  engagementCollection = 'projects',
  initial,
  onChange,
  readOnly = false,
  showHeading = true,
}) {
  const [criteria, setCriteria] = useState(DEFAULT_CRITERIA)
  const [criteriaLoading, setCriteriaLoading] = useState(true)
  const [answers, setAnswers] = useState(() => normalizeAnswers(initial?.answers))
  const [savingApproval, setSavingApproval] = useState(false)

  // Load criteria from platform_settings (override the defaults shipped here).
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const snap = await getDoc(doc(db, 'platform_settings', 'sama_materiality_criteria'))
        if (!alive) return
        if (snap.exists()) {
          const data = snap.data()
          if (Array.isArray(data.questions) && data.questions.length > 0) {
            setCriteria({ version: data.version || 1, questions: data.questions })
          }
        } else {
          // Seed defaults — only the CEO can write platform_settings per rules,
          // so we attempt the seed but ignore permission errors silently.
          try {
            await setDoc(doc(db, 'platform_settings', 'sama_materiality_criteria'), {
              ...DEFAULT_CRITERIA,
              seeded_at: serverTimestamp(),
              seeded_by: auth.currentUser?.email || 'system',
            })
          } catch (_) { /* non-CEO callers can't seed; fine, defaults stay */ }
        }
      } catch (err) {
        console.warn('Could not load SAMA criteria, using defaults:', err.message)
      } finally {
        if (alive) setCriteriaLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  // Recompute determination whenever the answers change; notify parent.
  const result = useMemo(() => deriveDetermination(answers, criteria), [answers, criteria])
  useEffect(() => {
    if (!onChange) return
    onChange({
      answers,
      determination: result.determination,
      noc_required: result.noc_required,
      noc_status: initial?.noc_status || 'NONE',
      assessment_id: initial?.assessment_id || crypto.randomUUID?.() || `sama-${Date.now()}`,
      criteria_version: criteria.version,
      // Server-side server-timestamp is preferred but writeable here for new drafts.
      assessed_by: initial?.assessed_by || auth.currentUser?.email || null,
      assessed_at: initial?.assessed_at || null,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers, result.determination, result.noc_required, criteria.version])

  const setAnswer = (qid, value) => {
    if (readOnly) return
    setAnswers(prev => ({ ...prev, [qid]: value }))
  }

  // After CEO approval lands, also stamp assessed_at + assessed_by on the
  // parent doc's sama_materiality.* fields. The ApprovalButton has already
  // written the evidence row; we just close the loop on attribution.
  const handleApproved = async () => {
    if (!engagementId) return
    try {
      setSavingApproval(true)
      // sama_materiality.{assessed_at,assessed_by,assessment_signed} is now written
      // server-side by recordApproval (the client may not self-write the signed state).
      // If MATERIAL, auto-create the compliance calendar item (idempotent).
      if (result.noc_required) {
        await ensureComplianceItem({
          engagementCollection, engagementId,
          assessment: { ...result, answers, criteria_version: criteria.version },
        })
      }
    } catch (err) {
      console.error('post-approval stamp failed:', err)
    } finally {
      setSavingApproval(false)
    }
  }

  if (criteriaLoading) {
    return <div style={{ padding: 18, color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: 8 }}><Loader size={14} className="spin" /> Loading SAMA criteria…</div>
  }

  const determinationColor = {
    MATERIAL: { bg: 'rgba(192,57,43,0.10)', border: 'rgba(192,57,43,0.35)', color: '#C0392B', icon: AlertTriangle },
    NON_MATERIAL: { bg: 'rgba(243,156,18,0.10)', border: 'rgba(243,156,18,0.35)', color: '#B7791F', icon: AlertTriangle },
    NOT_SAMA: { bg: 'rgba(52,191,58,0.08)', border: 'rgba(52,191,58,0.3)', color: '#34BF3A', icon: CheckCircle2 },
  }[result.determination] || { bg: '#f3f4f6', border: '#E5E7EB', color: '#6b7280', icon: Info }

  const Icon = determinationColor.icon

  return (
    <section style={{ marginTop: 16, padding: 18, border: '1px solid var(--border-primary, #E5E7EB)', borderRadius: 10, background: 'var(--bg-surface, #fff)' }}>
      {showHeading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <ShieldCheck size={18} color="#022873" />
          <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>SAMA Materiality Assessment</h3>
          <span style={{ fontSize: '0.7rem', background: 'rgba(2,40,115,0.08)', color: '#022873', padding: '2px 8px', borderRadius: 999, fontWeight: 600, letterSpacing: '0.04em' }}>SAMA-OUT-NOC-001</span>
        </div>
      )}
      <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '4px 0 14px', lineHeight: 1.5 }}>
        Answer all six questions before this engagement may go ACTIVE. The determination governs whether a SAMA No-Objection must be obtained first.
      </p>

      <ol style={{ paddingLeft: 18, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {criteria.questions.map((q) => {
          const val = answers[q.id]
          const set = (v) => setAnswer(q.id, v)
          const redFlag = q.redFlagIfYes && val === true
          return (
            <li key={q.id} style={{ background: redFlag ? 'rgba(192,57,43,0.06)' : 'transparent', padding: redFlag ? '8px 10px' : 0, borderRadius: 6 }}>
              <div style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--text-primary)' }}>{q.label}</div>
              {q.help && <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginTop: 2, lineHeight: 1.45 }}>{q.help}</div>}
              <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
                <YesNo value={val} onChange={set} disabled={readOnly} />
              </div>
              {redFlag && (
                <div style={{ marginTop: 6, fontSize: '0.74rem', color: '#C0392B', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <AlertTriangle size={12} /> Cross-border data transfer is a SAMA / PDPL red flag — escalate before proceeding.
                </div>
              )}
            </li>
          )
        })}
      </ol>

      <div style={{ marginTop: 16, padding: 12, borderRadius: 8, border: `1px solid ${determinationColor.border}`, background: determinationColor.bg, display: 'flex', alignItems: 'center', gap: 10 }}>
        <Icon size={18} color={determinationColor.color} />
        <div>
          <div style={{ fontSize: '0.82rem', fontWeight: 700, color: determinationColor.color, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Determination: {result.determination.replace('_', '-')}
          </div>
          <div style={{ fontSize: '0.8rem', color: determinationColor.color, marginTop: 2 }}>
            {result.summary}
          </div>
          {result.noc_required && (
            <div style={{ fontSize: '0.74rem', color: determinationColor.color, marginTop: 4, fontWeight: 600 }}>
              The engagement cannot transition to ACTIVE until <code>sama_materiality.noc_status = "OBTAINED"</code>.
            </div>
          )}
        </div>
      </div>

      {/* CEO sign-off — required for the assessment to be admissible */}
      {engagementId ? (
        <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border-primary, #E5E7EB)' }}>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <ScrollText size={13} /> Regulatory determination — must be CEO-signed.
          </div>
          <ApprovalButton
            parentCollection={engagementCollection}
            parentId={engagementId}
            requiresDocument={false}
            label="Sign Materiality Assessment"
            variant="ceo"
            extra={{
              kind: 'SAMA_MATERIALITY_ASSESSMENT',
              determination: result.determination,
              noc_required: result.noc_required,
              criteria_version: criteria.version,
              answers,
            }}
            onApproved={handleApproved}
            disabled={!isComplete(answers, criteria) || savingApproval}
          />
          {!isComplete(answers, criteria) && (
            <div style={{ marginTop: 6, fontSize: '0.74rem', color: 'var(--text-tertiary)' }}>
              Answer all six questions before signing.
            </div>
          )}
          <div style={{ marginTop: 10 }}>
            <SignedBadgeList parentCollection={engagementCollection} parentId={engagementId} compact />
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 14, padding: 10, borderRadius: 6, background: 'rgba(2,40,115,0.04)', fontSize: '0.74rem', color: '#022873', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Info size={13} /> Save the engagement first — the CEO signature attaches to the saved record.
        </div>
      )}
    </section>
  )
}

function YesNo({ value, onChange, disabled }) {
  const btn = (sel, isYes) => ({
    padding: '6px 14px', borderRadius: 6, border: '1px solid', fontWeight: 600, fontSize: '0.78rem',
    cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
    background: sel ? (isYes ? '#022873' : '#C0392B') : 'var(--bg-surface, #fff)',
    color: sel ? '#fff' : 'var(--text-primary)',
    borderColor: sel ? (isYes ? '#022873' : '#C0392B') : 'var(--border-primary, #E5E7EB)',
  })
  return (
    <>
      <button type="button" disabled={disabled} onClick={() => onChange(true)} style={btn(value === true, true)}>Yes</button>
      <button type="button" disabled={disabled} onClick={() => onChange(false)} style={btn(value === false, false)}>No</button>
    </>
  )
}

function normalizeAnswers(input) {
  const out = {}
  const ids = DEFAULT_CRITERIA.questions.map(q => q.id)
  for (const id of ids) out[id] = input?.[id] === true ? true : input?.[id] === false ? false : null
  return out
}

function isComplete(answers, criteria) {
  return criteria.questions.every(q => answers[q.id] === true || answers[q.id] === false)
}

// Idempotent: a single compliance doc per engagement+control.
async function ensureComplianceItem({ engagementCollection, engagementId, assessment }) {
  const controlId = 'SAMA-OUT-NOC-001'
  const complianceId = `${controlId}__${engagementCollection}_${engagementId}`
  try {
    const ref = doc(db, 'compliance', complianceId)
    const snap = await getDoc(ref)
    if (snap.exists()) return // already created — don't double-write
    await setDoc(ref, {
      control_id: controlId,
      title: 'SAMA No-Objection — Material Outsourcing',
      framework: 'SAMA Outsourcing Framework',
      severity: 'CRITICAL',
      status: 'OPEN',
      noc_status: 'REQUESTED',
      due_within_days: 14,
      engagement_collection: engagementCollection,
      engagement_id: engagementId,
      determination: assessment.determination,
      assessment_summary: assessment.summary,
      criteria_version: assessment.criteria_version,
      created_at: serverTimestamp(),
      created_by: auth.currentUser?.email || 'system:sama_materiality',
      blocks_engagement_active: true,
    })
    await addDoc(collection(db, 'task_audit_log'), {
      event: 'SAMA_NOC_CALENDAR_CREATED',
      action_by: auth.currentUser?.email || 'system',
      action_at: serverTimestamp(),
      details: { compliance_id: complianceId, engagement_collection: engagementCollection, engagement_id: engagementId },
    })
  } catch (err) {
    console.error('ensureComplianceItem failed:', err)
  }
}
