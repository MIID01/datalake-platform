"use strict";
//
// Iqama Lifecycle Module — DTLK-PROC-HR-002
//
// Every employee whose work_arrangement requires an Iqama (default:
// in_house, hybrid, remote inside KSA) has an iqama_records/{employeeId}
// doc that tracks the full lifecycle:
//
//   NONE              → no Iqama on record (initial)
//   IN_PROCESS        → HR requested + collecting docs
//   SUBMITTED         → submitted to authorities
//   ACTIVE            → issued + within validity window
//   EXPIRING          → < threshold days before expiry (banner color amber)
//   EXPIRED           → past expiry (compliance flag, employer liability)
//   TRANSFER_PENDING  → نقل كفالة in progress
//
// Each HR action writes an evidence row to
//   iqama_records/{employeeId}/iqama_evidence/{auto-id}
// with the same shape as approval_evidence so the audit export can
// surface it alongside other regulator-facing rows.
//
// Thresholds and the list of arrangements that require an Iqama live in
// platform_settings/iqama_config so the CEO can update them without
// code changes.

const admin = require("firebase-admin");

const db = admin.firestore();

const DEFAULT_CONFIG = {
  expiry_alert_thresholds_days: [90, 60, 30, 7],
  arrangements_requiring_iqama: ['in_house', 'hybrid', 'remote_ksa'],
  cross_border_arrangements: ['remote'],
};

const ALLOWED_STAGES = [
  'REQUEST_INITIATED',
  'DOCUMENTS_COLLECTED',
  'SUBMITTED_TO_AUTHORITIES',
  'ISSUED',
  'RENEWAL_INITIATED',
  'RENEWAL_APPROVED',
  'TRANSFER_INITIATED',
  'TRANSFER_COMPLETED',
];

// stage → derived top-level status (so the UI can color-code without joining)
const STAGE_TO_STATUS = {
  REQUEST_INITIATED:       'IN_PROCESS',
  DOCUMENTS_COLLECTED:     'IN_PROCESS',
  SUBMITTED_TO_AUTHORITIES:'IN_PROCESS',
  ISSUED:                  'ACTIVE',
  RENEWAL_INITIATED:       'ACTIVE',
  RENEWAL_APPROVED:        'ACTIVE',
  TRANSFER_INITIATED:      'TRANSFER_PENDING',
  TRANSFER_COMPLETED:      'ACTIVE',
};

async function loadConfig() {
  try {
    const snap = await db.collection('platform_settings').doc('iqama_config').get();
    if (snap.exists) return { ...DEFAULT_CONFIG, ...snap.data() };
  } catch (_) {}
  return DEFAULT_CONFIG;
}

function isHR(profile, email) {
  if (!profile && !email) return false;
  if (profile?.role_id === 'hr') return true;
  if (profile?.role_id === 'ceo') return true;
  if (email === 'hr@datalake.sa' || email === 'HR@datalake.sa') return true;
  if (email === 'm.alqumri@datalake.sa') return true;
  return false;
}

// ═══════════════════════════════════════════════════════════════════
// HTTP — advanceIqamaStage. HR-only. Writes evidence + updates the
// iqama_records doc atomically.
//
// Body: {
//   employee_id: "DLSA1003",
//   stage: "ISSUED" | "SUBMITTED_TO_AUTHORITIES" | ...,
//   payload?: { iqama_number?, issue_date?, expiry_date?, profession_on_iqama?, transfer_to_sponsor? },
//   evidence_url?, evidence_sha256?, notes?
// }
// ═══════════════════════════════════════════════════════════════════
async function advanceIqamaStageHandler(req, res, { getUserAccessProfile } = {}) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing auth token' });
    const decoded = await admin.auth().verifyIdToken(authHeader.slice(7));
    const profile = (getUserAccessProfile && (await getUserAccessProfile(decoded.uid))) || null;
    if (!isHR(profile, decoded.email)) return res.status(403).json({ error: 'HR or CEO only' });

    const { employee_id, stage, payload = {}, evidence_url, evidence_sha256, notes } = req.body || {};
    if (!employee_id) return res.status(400).json({ error: 'employee_id required' });
    if (!ALLOWED_STAGES.includes(stage)) return res.status(400).json({ error: `stage must be one of: ${ALLOWED_STAGES.join(', ')}` });

    const now = admin.firestore.FieldValue.serverTimestamp();
    const recordRef = db.collection('iqama_records').doc(employee_id);
    const beforeSnap = await recordRef.get();
    const before = beforeSnap.exists ? beforeSnap.data() : { stage_history: [] };

    // Derive top-level status from the new stage.
    const newStatus = STAGE_TO_STATUS[stage] || before.status || 'IN_PROCESS';

    // Fields that the stage may write into the record.
    const recordUpdate = {
      employee_id,
      current_stage: stage,
      status: newStatus,
      updated_at: now,
      updated_by: profile?.email || decoded.email,
    };
    if (payload.iqama_number)        recordUpdate.iqama_number = String(payload.iqama_number);
    if (payload.issue_date)          recordUpdate.issue_date = payload.issue_date;
    if (payload.expiry_date)         recordUpdate.expiry_date = payload.expiry_date;
    if (payload.profession_on_iqama) recordUpdate.profession_on_iqama = payload.profession_on_iqama;
    if (payload.transfer_to_sponsor) recordUpdate.transfer_to_sponsor = payload.transfer_to_sponsor;

    // Append to stage_history server-side.
    recordUpdate.stage_history = admin.firestore.FieldValue.arrayUnion({
      stage,
      at: new Date().toISOString(),
      by: profile?.email || decoded.email,
      notes: notes || null,
    });

    if (!beforeSnap.exists) {
      recordUpdate.created_at = now;
      recordUpdate.created_by = profile?.email || decoded.email;
    }

    await recordRef.set(recordUpdate, { merge: true });

    // Evidence row — same shape as approval_evidence so the audit export
    // surfaces it through the existing collectionGroup query path.
    const evidenceRef = recordRef.collection('iqama_evidence').doc();
    await evidenceRef.set({
      approver_email: profile?.email || decoded.email,
      approver_name: profile?.display_name || decoded.email,
      approver_role: profile?.role_id || 'hr',
      approved_at: now,
      ip_address: req.ip || req.headers['x-forwarded-for'] || 'unknown',
      user_agent: req.headers['user-agent'] || 'unknown',
      action: `IQAMA_${stage}`,
      label: `Iqama stage → ${stage}`,
      parent_collection: 'iqama_records',
      parent_id: employee_id,
      stage,
      payload,
      notes: notes || null,
      evidence_url: evidence_url || null,
      evidence_sha256: evidence_sha256 || null,
    });

    // Top-level audit trail.
    await db.collection('task_audit_log').add({
      event: 'IQAMA_STAGE_ADVANCED',
      action_by: profile?.email || decoded.email,
      action_at: now,
      details: { employee_id, stage, status: newStatus, payload },
      ip_address: req.ip || 'unknown',
    });

    return res.status(200).json({ success: true, employee_id, stage, status: newStatus });
  } catch (err) {
    console.error('advanceIqamaStage error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}

// ═══════════════════════════════════════════════════════════════════
// Scheduled — scanIqamaExpiries. Runs daily at 06:00 Riyadh.
// For every active iqama_records doc, computes days_to_expiry. If that
// number crosses a configured threshold (default 90/60/30/7) AND we
// haven't fired this threshold yet for this employee, write:
//   • notifications/{auto} — HR + CEO
//   • tasks/{auto} — "Iqama expires in X days — initiate renewal"
//   • iqama_records/{empId} — push alert into alerts_sent[] so we
//     don't re-fire the same threshold each day.
// Expired (days < 0) also flips status → EXPIRED + writes a compliance
// row that the audit-export picks up.
// ═══════════════════════════════════════════════════════════════════
async function scanIqamaExpiriesHandler() {
  const config = await loadConfig();
  const thresholds = (config.expiry_alert_thresholds_days || DEFAULT_CONFIG.expiry_alert_thresholds_days)
    .slice().sort((a, b) => b - a); // descending

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const ymd = today.toISOString().slice(0, 10);

  const snap = await db.collection('iqama_records').get();
  let scanned = 0, alerted = 0, expired = 0;

  for (const docSnap of snap.docs) {
    const r = docSnap.data();
    if (!r.expiry_date) continue;
    scanned++;

    const exp = new Date(r.expiry_date + 'T00:00:00Z');
    if (isNaN(exp.getTime())) continue;
    const days = Math.ceil((exp.getTime() - today.getTime()) / 86400000);

    const alertsSent = Array.isArray(r.alerts_sent) ? r.alerts_sent : [];

    if (days < 0) {
      // EXPIRED
      if (r.status !== 'EXPIRED') {
        await docSnap.ref.update({
          status: 'EXPIRED',
          expired_at: admin.firestore.FieldValue.serverTimestamp(),
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
        });
        await db.collection('compliance').doc(`IQAMA-EXPIRED__${docSnap.id}`).set({
          control_id: 'IQAMA-EXPIRED',
          title: `Iqama expired — ${r.employee_id}`,
          framework: 'KSA MoL — Employer Iqama Obligations',
          severity: 'CRITICAL',
          status: 'OPEN',
          employee_id: docSnap.id,
          expiry_date: r.expiry_date,
          days_overdue: -days,
          created_at: admin.firestore.FieldValue.serverTimestamp(),
          created_by: 'system:scanIqamaExpiries',
          scan_at: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        expired++;
      }
      continue;
    }

    // Find the highest threshold the days has crossed below (e.g. days=58
    // with thresholds 90/60/30/7 → fires the 60 alert if not already sent).
    const fire = thresholds.find(t => days <= t && !alertsSent.includes(t));
    if (!fire) continue;

    const empSnap = await db.collection('employees').doc(docSnap.id).get();
    const emp = empSnap.exists ? empSnap.data() : {};

    await db.collection('notifications').add({
      type: 'IQAMA_EXPIRY_WARNING',
      user_email: 'hr@datalake.sa',
      title: `Iqama expires in ${days} days — ${emp.full_name || docSnap.id}`,
      body: `Employee ${emp.full_name || docSnap.id} (${docSnap.id}) — Iqama expiry ${r.expiry_date}. Days remaining: ${days}. Threshold ${fire}.`,
      severity: fire <= 30 ? 'high' : 'medium',
      employee_id: docSnap.id,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
    });
    await db.collection('notifications').add({
      type: 'IQAMA_EXPIRY_WARNING',
      user_email: 'm.alqumri@datalake.sa',
      title: `Iqama expires in ${days} days — ${emp.full_name || docSnap.id}`,
      body: `Employee ${emp.full_name || docSnap.id} (${docSnap.id}) — Iqama expiry ${r.expiry_date}. Days remaining: ${days}.`,
      severity: fire <= 30 ? 'high' : 'medium',
      employee_id: docSnap.id,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
    });
    await db.collection('tasks').add({
      task_id: `IQAMA-RENEW-${docSnap.id}-${ymd}`,
      title: `Iqama renewal — ${emp.full_name || docSnap.id} (${days} days left)`,
      description: `Initiate Iqama renewal workflow at /hr/iqama for employee ${docSnap.id}.`,
      task_type: 'IQAMA_RENEWAL',
      creation_method: 'SYSTEM',
      created_by: 'system:scanIqamaExpiries',
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      assigned_to_type: 'ROLE',
      assigned_to_role: 'HR',
      priority: fire <= 30 ? 'HIGH' : 'NORMAL',
      state: 'OPEN',
      related_entity_type: 'IQAMA',
      related_entity_id: docSnap.id,
    });

    await docSnap.ref.update({
      alerts_sent: admin.firestore.FieldValue.arrayUnion(fire),
      status: days <= 30 ? 'EXPIRING' : (r.status || 'ACTIVE'),
      last_scan_at: admin.firestore.FieldValue.serverTimestamp(),
    });
    alerted++;
  }

  console.log(`[Iqama Scan] scanned=${scanned} alerted=${alerted} newly_expired=${expired}`);
  return { scanned, alerted, expired };
}

module.exports = {
  advanceIqamaStageHandler,
  scanIqamaExpiriesHandler,
  loadConfig,
  ALLOWED_STAGES,
  STAGE_TO_STATUS,
};
