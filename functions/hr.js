const admin = require("firebase-admin");
const { notify } = require("./notifications");
const { logToBigQuery } = require("./lib/bigquery");

const db = admin.firestore();

// 1. resetLeaveBalances (Cloud Scheduler: "0 0 1 1 *")
async function resetLeaveBalancesHandler() {
  try {
    const snap = await db.collection("employees").where("employment_status", "==", "ACTIVE").get();
    
    const batch = db.batch();
    const now = new Date();
    
    for (const doc of snap.docs) {
      const emp = doc.data();
      const current_balance = emp.annual_leave_balance || 0;
      
      let entitlement = 21;
      if (emp.contract_start) {
        const startDate = new Date(emp.contract_start);
        const years = (now - startDate) / (1000 * 60 * 60 * 24 * 365.25);
        if (years >= 5) entitlement = 30;
      }
      
      const max_carry_over = entitlement * 0.5;
      const new_balance = Math.min(current_balance, max_carry_over) + entitlement;
      
      batch.update(doc.ref, {
        annual_leave_balance: new_balance,
        last_leave_reset: admin.firestore.FieldValue.serverTimestamp()
      });
    }
    
    if (!snap.empty) {
      await batch.commit();
      console.log(`[HR] Reset leave balances for ${snap.size} employees`);
    }
  } catch (err) {
    console.error("resetLeaveBalances error:", err);
  }
}

// 2. pdplCandidatePurge (Cloud Scheduler: "0 3 * * *")
//
// PDPL Art.18 — retention-expiry purge.
//
// Scope  : talent_pool docs where pdpl_purge_after ≤ now.
// Exclusions:
//   • WORM bucket (datalake-worm-hr) is never touched — immutable by design,
//     requires a DPO retention-policy unlock; flagged separately.
//   • Any record whose pdpl_purge_after is in the future is skipped.
//
// Per-doc actions:
//   1. Delete Storage file at cv_path (cvs/ prefix, main bucket only).
//   2. Delete the talent_pool Firestore document.
//   3. Write one task_audit_log entry as PDPL evidence.
//
// Called by:
//   • Cloud Scheduler daily at 03:00 Asia/Riyadh (exports.pdplCandidatePurge)
//   • CEO "Run PDPL Purge" button → exports.runPdplPurgeCEO (onRequest, CEO-gated)
//
async function pdplCandidatePurgeHandler(actorEmail) {
  const actor = actorEmail || "system:pdplCandidatePurge";
  const now   = new Date();
  const nowTs = admin.firestore.Timestamp.fromDate(now);

  // Collect all talent_pool docs whose retention window has passed.
  // We do a full collection scan rather than a Firestore inequality query
  // because pdpl_purge_after can be stored as a Timestamp or a string,
  // and an inequality query requires a composite index.  The collection is
  // small (candidates, not employees), so a full scan is cheap.
  const snap = await db.collection("talent_pool").get();

  const toPurge = snap.docs.filter(d => {
    const val = d.data().pdpl_purge_after;
    if (!val) return false;
    let purgeDate;
    if (val.toDate)    purgeDate = val.toDate();
    else if (val._seconds) purgeDate = new Date(val._seconds * 1000);
    else               purgeDate = new Date(val);
    return purgeDate <= now;
  });

  if (toPurge.length === 0) {
    console.log(`[PDPL] No candidates past retention date. Nothing to purge.`);
    return { purged: 0, errors: 0 };
  }

  const CV_BUCKET = admin.storage().bucket("datalake-production-sa.firebasestorage.app");
  const WORM_GUARD = "datalake-worm-hr"; // never delete from here

  let purgedCount = 0;
  let errorCount  = 0;
  const purgeLogEntries = [];

  for (const doc of toPurge) {
    const data     = doc.data();
    const docId    = doc.id;
    const name     = data.full_name || data.name || "(no name)";
    const cvPath   = data.cv_path  || null;
    const purgedAt = now.toISOString();
    let   fileDeleted = false;
    let   fileError   = null;

    // ── 1. Delete Storage files (cvs/ + interview-cvs/ in main bucket, never WORM) ──
    const filesToDelete = [cvPath, data.portfolio_path || null].filter(
      p => p && (p.startsWith("cvs/") || p.startsWith("interview-cvs/")) && !p.includes(WORM_GUARD)
    );
    for (const filePath of filesToDelete) {
      try {
        await CV_BUCKET.file(filePath).delete({ ignoreNotFound: true });
        fileDeleted = true;
        console.log(`[PDPL] Storage deleted: ${filePath}`);
      } catch (e) {
        fileError = e.message;
        console.warn(`[PDPL] Storage delete failed for ${filePath}: ${e.message}`);
        errorCount++;
      }
    }

    // ── 2. Delete Firestore doc ───────────────────────────────────────────
    try {
      await doc.ref.delete();
      purgedCount++;
      console.log(`[PDPL] Purged talent_pool/${docId} (${name})`);
    } catch (e) {
      console.error(`[PDPL] Firestore delete failed for ${docId}: ${e.message}`);
      errorCount++;
      continue; // don't write a "success" log if the doc wasn't deleted
    }

    // ── 3. Write per-doc audit evidence to task_audit_log ────────────────
    const logEntry = {
      event:            "PDPL_CANDIDATE_PURGE",
      actor,
      reason:           "PDPL Art.18 — retention_period_expired",
      executed_at:      admin.firestore.FieldValue.serverTimestamp(),
      candidate_id:     docId,
      candidate_name:   name,
      candidate_email:  data.email   || null,
      candidate_state:  data.state   || null,
      candidate_source: data.source_channel || data.source || null,
      created_at:       data.created_at || null,
      pdpl_purge_after: data.pdpl_purge_after || null,
      cv_path:          cvPath,
      storage_file_deleted: fileDeleted,
      storage_file_error:   fileError,
    };
    purgeLogEntries.push(logEntry);

    try {
      await db.collection("task_audit_log").add(logEntry);
    } catch (e) {
      console.error(`[PDPL] Audit log write failed for ${docId}: ${e.message}`);
      // Non-fatal — purge already happened; log the error but don't increment errorCount
      // (the audit log failure is its own incident)
    }
  }

  // ── 4. Summary audit log entry ────────────────────────────────────────
  try {
    await db.collection("task_audit_log").add({
      event:          "PDPL_PURGE_RUN_SUMMARY",
      actor,
      reason:         "PDPL Art.18 — retention_period_expired",
      executed_at:    admin.firestore.FieldValue.serverTimestamp(),
      candidates_scanned:  snap.size,
      candidates_purged:   purgedCount,
      candidates_errored:  errorCount,
      worm_note: "WORM bucket (datalake-worm-hr) not touched — requires DPO retention-policy unlock",
    });
  } catch (e) {
    console.warn("[PDPL] Summary audit log write failed:", e.message);
  }

  // ── 5. Notify CEO if anything was purged ──────────────────────────────
  if (purgedCount > 0) {
    try {
      await notify("ceo", "pdpl_purge_complete", {
        purged: purgedCount,
        errors: errorCount,
        actor,
        timestamp: now.toISOString(),
      });
    } catch (_) {}
  }

  console.log(`[PDPL] Run complete. Purged: ${purgedCount}, Errors: ${errorCount}`);
  return { purged: purgedCount, errors: errorCount };
}

// HTTP-callable version for the CEO "Run PDPL Purge" button.
// Requires CEO role. Returns JSON with counts so the UI can show real numbers.
async function pdplCandidatePurgeOnRequestHandler(req, res, { verifyAuth, getUserAccessProfile }) {
  res.set("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    const decoded = await verifyAuth(req);
    const profile = await getUserAccessProfile(decoded.uid);
    if (!["ceo", "hr"].includes(profile.role_id)) {
      return res.status(403).json({ error: "Forbidden: requires CEO or HR role" });
    }
    const result = await pdplCandidatePurgeHandler(profile.email);
    return res.status(200).json({
      success:  true,
      purged:   result.purged,
      errors:   result.errors,
      message:  result.purged === 0
        ? "No candidates past retention date. Nothing to purge."
        : `PDPL purge complete. ${result.purged} record(s) purged, ${result.errors} error(s). Audit log written.`,
    });
  } catch (err) {
    console.error("pdplCandidatePurgeOnRequest error:", err);
    return res.status(500).json({ error: err.message });
  }
}


// 3. scanContractExpiry (Cloud Scheduler: "0 9 1 * *")
async function scanContractExpiryHandler() {
  try {
    const snap = await db.collection("employees")
      .where("employment_status", "==", "ACTIVE")
      .where("contract_type", "==", "Limited Contract")
      .get();
      
    const now = new Date();
    const alertThreshold = new Date();
    alertThreshold.setDate(now.getDate() + 60);
    
    let expiringCount = 0;
    
    for (const doc of snap.docs) {
      const emp = doc.data();
      if (!emp.contract_start) continue;
      
      const startDate = new Date(emp.contract_start);
      // Assume 1 year auto-renew if contract_end is not present
      let endDate = emp.contract_end ? new Date(emp.contract_end) : new Date(startDate);
      if (!emp.contract_end) {
        while (endDate <= now) {
          endDate.setFullYear(endDate.getFullYear() + 1);
        }
      }
      
      if (endDate <= alertThreshold && endDate >= now) {
        await notify("ceo", "contract_expiring", { employee_id: emp.employee_id, name: emp.full_name, end_date: endDate.toISOString() });
        await notify("hr", "contract_expiring", { employee_id: emp.employee_id, name: emp.full_name, end_date: endDate.toISOString() });
        expiringCount++;
      }
    }
    console.log(`[HR] Scanned contracts, flagged ${expiringCount} for expiry`);
  } catch (err) {
    console.error("scanContractExpiry error:", err);
  }
}

// 4. validateHireBudget (Firestore Trigger: onDocumentCreated("pending_hires/{hireId}"))
// Defence-in-depth backstop to the synchronous gate in initiateHire: if an
// over-PO hire is created by any path that bypasses that gate, mark it
// BUDGET_BLOCKED so the downstream chain halts, and alert the CEO.
async function validateHireBudgetHandler(event) {
  try {
    const { evaluateHireBudget } = require("./lib/budget");
    const hireDoc = event.data;
    if (!hireDoc) return;
    const hire = hireDoc.data();

    if (!hire.project_id) return;

    const projDoc = await db.collection("projects").doc(hire.project_id).get();
    if (!projDoc.exists) return;
    const project = projDoc.data();

    // Project PO is stored as po_value_sar / po_used_sar (NOT po_value/po_used).
    const hireCostSar = Number(hire.salary_monthly || 0) * Number(hire.contract_duration_months || 0);
    const budget = evaluateHireBudget({
      poValueSar: project.po_value_sar,
      poUsedSar: project.po_used_sar,
      hireCostSar,
    });

    const hireId = event.params.hireId || event.params.docId;
    const update = { budget_check: { ...budget, checked_at: new Date().toISOString() } };
    if (budget.blocked && hire.status !== "BUDGET_BLOCKED") {
      update.status = "BUDGET_BLOCKED";
    }
    await hireDoc.ref.update(update);

    if (budget.blocked) {
      await notify("ceo", "hire_over_po", {
        hire_id: hireId,
        project_id: hire.project_id,
        over_by_sar: budget.over_by_sar,
      });
    }
  } catch (err) {
    console.error("validateHireBudget error:", err);
  }
}

// 5. gatekeeperMonthlyOpsHandler (Pub/Sub Subscriber to datalake.monthly.trigger)
async function gatekeeperMonthlyOpsHandler(event) {
  console.log("[HR] gatekeeperMonthlyOpsHandler triggered...");
  try {
    await scanContractExpiryHandler();
    await pdplCandidatePurgeHandler();
    console.log("[HR] Gatekeeper monthly ops complete.");
  } catch (err) {
    console.error("gatekeeperMonthlyOpsHandler error:", err);
  }
}

module.exports = {
  resetLeaveBalancesHandler,
  pdplCandidatePurgeHandler,
  pdplCandidatePurgeOnRequestHandler,
  scanContractExpiryHandler,
  validateHireBudgetHandler,
  gatekeeperMonthlyOpsHandler
};
