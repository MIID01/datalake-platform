/**
 * Flow-remediation — cancel the orphaned PER-ENGINEER client sign-requests that the
 * old ctoApproveTimesheet path emitted (one "Sign timesheet: {engineer}" task + sign
 * link per engineer, sent straight to the client). Under the consolidated-only model
 * the client signs ONE monthly project_timesheet, so these individual tasks/links are
 * superseded and must be retired — WITHOUT asking any engineer to re-upload (their
 * submissions stay intact and roll up into the consolidated sheet).
 *
 * Read-only by default — prints the affected tasks. Pass --apply to cancel them.
 * Optional scoping:  --project="Emkan"   --period="June 2026"
 *
 *   cd functions && node scripts/cancel-orphan-client-timesheet-tasks.js
 *   cd functions && node scripts/cancel-orphan-client-timesheet-tasks.js --project="Emkan" --period="June 2026"
 *   cd functions && node scripts/cancel-orphan-client-timesheet-tasks.js --apply --project="Emkan" --period="June 2026"
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "datalake-production-sa" });
const db = admin.firestore();

const argOf = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=").replace(/^["']|["']$/g, "") : null;
};
const APPLY = process.argv.includes("--apply");
const PROJECT = argOf("project");   // substring match on the timesheet project_name
const PERIOD = argOf("period");     // substring match on the timesheet period_label
const line = (s = "") => console.log(s);
const hr = () => line("─".repeat(78));

(async () => {
  // The orphaned artifacts: SIGN tasks routed to the CLIENT for an individual timesheet.
  const snap = await db.collection("tasks")
    .where("task_type", "==", "SIGN")
    .where("related_entity_type", "==", "TIMESHEET")
    .where("assigned_to_role", "==", "CLIENT_APPROVER")
    .get();

  const candidates = [];
  for (const doc of snap.docs) {
    const t = doc.data();
    if (!["OPEN", "PENDING_VERIFICATION"].includes(t.state)) continue; // leave already-closed ones
    // Pull the related timesheet for project/period scoping + display.
    let ts = {};
    if (t.related_entity_id) {
      const tsDoc = await db.collection("timesheets").doc(t.related_entity_id).get();
      ts = tsDoc.exists ? tsDoc.data() : {};
    }
    const projectName = ts.project_name || "";
    const periodLabel = ts.period_label || "";
    if (PROJECT && !projectName.toLowerCase().includes(PROJECT.toLowerCase())) continue;
    if (PERIOD && !periodLabel.toLowerCase().includes(PERIOD.toLowerCase())) continue;
    candidates.push({ id: doc.id, task: t, ts, projectName, periodLabel });
  }

  hr();
  line(`ORPHANED PER-ENGINEER CLIENT SIGN-REQUESTS  ${APPLY ? "(APPLY — will cancel)" : "(DRY-RUN — read only)"}`);
  if (PROJECT || PERIOD) line(`Filter: project~"${PROJECT || "*"}"  period~"${PERIOD || "*"}"`);
  hr();
  if (!candidates.length) { line("None found — nothing to cancel."); process.exit(0); }

  for (const c of candidates) {
    line(`• ${c.id}`);
    line(`    ${c.task.title || "(no title)"}`);
    line(`    engineer: ${c.ts.engineer_name || "?"}   project: ${c.projectName || "?"}   period: ${c.periodLabel || "?"}`);
    line(`    sent to:  ${c.task.assigned_to_id || "?"}   task state: ${c.task.state}   timesheet state: ${c.ts.state || "?"}`);
  }
  hr();
  line(`${candidates.length} task(s) ${APPLY ? "to cancel" : "would be cancelled"}.`);

  if (!APPLY) {
    line("");
    line("Dry-run only. Re-run with --apply to cancel these (engineer submissions are NOT touched).");
    process.exit(0);
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  let done = 0;
  for (const c of candidates) {
    await db.collection("tasks").doc(c.id).update({
      state: "CANCELLED",
      completion_action: "SUPERSEDED_BY_CONSOLIDATED",
      completion_reason_codes: ["FLOW_REMEDIATION"],
      completion_notes: "Per-engineer client sign-request superseded by the consolidated monthly project timesheet. No engineer action required.",
      completed_at: now,
      completed_by: "system:flow-remediation",
    });
    // Void any live sign link on the underlying timesheet so it can't be signed individually.
    if (c.task.related_entity_id) {
      await db.collection("timesheets").doc(c.task.related_entity_id).update({
        sign_link_status: "SUPERSEDED_CONSOLIDATED",
        sign_link_superseded_at: now,
      }).catch((e) => line(`    (timesheet update skipped for ${c.task.related_entity_id}: ${e.message})`));
    }
    await db.collection("audit_log").add({
      event: "TIMESHEET_CLIENT_TASK_SUPERSEDED", task_id: c.id,
      timesheet_id: c.task.related_entity_id || null, by: "system:flow-remediation", timestamp: now,
    });
    done++;
    line(`  ✓ cancelled ${c.id}`);
  }
  hr();
  line(`Done — ${done} task(s) cancelled. The consolidated sheet at /cto/timesheets is now the client's single deliverable.`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
