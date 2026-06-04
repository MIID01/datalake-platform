/**
 * Sign-link forensics for ONE timesheet. Read-only.
 *
 *   cd functions && node scripts/sign-link-status.js <timesheet_id>
 *
 * Answers: (2) what's on the timesheet for the sign step, (3) does the project
 * have a client_id + approver email to target, (5) the email_log row (recipient,
 * messageId, status, timestamps), (6) was the link opened (access events).
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "datalake-production-sa" });
const db = admin.firestore();

const tsId = process.argv[2];
if (!tsId) { console.error("Usage: node scripts/sign-link-status.js <timesheet_id>"); process.exit(1); }
const ts2s = (t) => (t && t.toDate ? t.toDate().toISOString() : (t || "—"));

(async () => {
  const tsDoc = await db.collection("timesheets").doc(tsId).get();
  if (!tsDoc.exists) { console.error(`No timesheets/${tsId}`); process.exit(1); }
  const ts = tsDoc.data();

  console.log(`\n── TIMESHEET ${tsId} ──`);
  console.log(`state: ${ts.state}   engineer: ${ts.engineer_email}   period: ${ts.period_label}`);
  console.log(`client_approver_email (on timesheet): ${ts.client_approver_email || "❌ MISSING"}`);
  console.log(`client_sign_token present: ${!!ts.client_sign_token}`);
  console.log(`sign_link_status:    ${ts.sign_link_status || "— (none — pre-fix approval, or never reached send step)"}`);
  console.log(`sign_link_to:        ${ts.sign_link_to || "—"}`);
  console.log(`sign_link_sent_at:   ${ts2s(ts.sign_link_sent_at)}`);
  console.log(`sign_link_message_id:${ts.sign_link_message_id || "—"}`);
  console.log(`sign_link_send_error:${ts.sign_link_send_error || "—"}`);
  console.log(`sign_link_first_opened_at: ${ts2s(ts.sign_link_first_opened_at)}   open_count: ${ts.sign_link_open_count || 0}`);
  console.log(`client signed at:    ${ts2s(ts.client_action_at)}   method: ${ts.client_signature_method || "—"}`);

  // (3) Project client linkage
  console.log(`\n── PROJECT (${ts.project_id || "no project_id on timesheet"}) ──`);
  if (ts.project_id) {
    let p = await db.collection("projects").doc(ts.project_id).get();
    if (!p.exists) {
      const q = await db.collection("projects").where("project_id", "==", ts.project_id).limit(1).get();
      p = q.empty ? null : q.docs[0];
    }
    if (p && p.exists) {
      const pd = p.data();
      console.log(`client_id:             ${pd.client_id || "❌ MISSING — nothing to target a sign link at"}`);
      console.log(`client_approver_email: ${pd.client_approver_email || "❌ MISSING"}`);
      console.log(`client_approver_name:  ${pd.client_approver_name || "—"}`);
    } else console.log("❌ project doc not found");
  }

  // (5) email_log rows for this timesheet
  console.log(`\n── email_log (related_entity_id == ${tsId}) ──`);
  const el = await db.collection("email_log").where("related_entity_id", "==", tsId).get();
  if (el.empty) console.log("❌ NO email_log row — the send never happened or wasn't logged (pre-fix: it was only console.logged).");
  el.docs.forEach(d => { const e = d.data();
    console.log(`  [${e.status}] to=${e.to} msgId=${e.gmail_message_id || "—"} created=${ts2s(e.created_at)} sent=${ts2s(e.sent_at)} err=${e.error || "—"}`);
  });

  // (6) access / dispatch audit events
  console.log(`\n── audit_log (sign-link events for ${tsId}) ──`);
  const al = await db.collection("audit_log").where("timesheet_id", "==", tsId).get();
  const evs = al.docs.map(d => d.data()).filter(e => String(e.event || "").includes("SIGN_LINK") || e.event === "TIMESHEET_EMAIL_SENT");
  if (!evs.length) console.log("  (no sign-link audit events)");
  evs.sort((a, b) => (a.timestamp?.toMillis?.() || 0) - (b.timestamp?.toMillis?.() || 0))
    .forEach(e => console.log(`  ${ts2s(e.timestamp)}  ${e.event}  to=${e.to || (e.sent_to || []).join(",") || "—"}  status=${e.status || "—"}  ip=${e.ip_address || "—"}`));

  console.log("\nDone (read-only).");
  process.exit(0);
})().catch(e => { console.error("Failed:", e); process.exit(1); });
