// Re-validate every timesheet with the deterministic engine, replacing the old
// LLM verdicts (false FAILEDs). Advisory-only fields — does not touch state/billing.
//   cd functions && node scripts/backfill-timesheet-validation.js
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "datalake-production-sa" });
const db = admin.firestore();
const { validateTimesheet } = require("../lib/timesheet-validate");
(async () => {
  const ts = await db.collection("timesheets").get();
  const projCache = {};
  let changed = 0, same = 0;
  for (const doc of ts.docs) {
    const t = doc.data();
    let project = {};
    if (t.project_id) {
      if (!(t.project_id in projCache)) {
        const p = await db.collection("projects").doc(t.project_id).get();
        projCache[t.project_id] = p.exists ? p.data() : {};
      }
      project = projCache[t.project_id];
    }
    const v = validateTimesheet({ days: t.days, total_hours: t.total_hours, period_month: t.period_month, period_year: t.period_year }, project);
    if (t.ai_validation_status !== v.status) {
      await doc.ref.update({
        ai_validation: v, ai_validation_status: v.status,
        ai_validated_at: admin.firestore.FieldValue.serverTimestamp(),
        ai_validated_by: "automated_checks", ai_validation_model: "deterministic-v1", ai_validation_ms: 0,
      });
      console.log(`  ${doc.id}: ${t.ai_validation_status || "—"} -> ${v.status}`);
      changed++;
    } else same++;
  }
  console.log(`\nBackfilled: ${changed} updated, ${same} already correct.`);
  process.exit(0);
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
