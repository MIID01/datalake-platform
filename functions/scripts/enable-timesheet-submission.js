// Disable the onboarding/training chain gate so every employee can submit timesheets.
// CEO directive 2026-06-21. Reversible: set enabled:true to re-arm once onboarding+
// training are actually complete for staff.
//   cd functions && node scripts/enable-timesheet-submission.js
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "datalake-production-sa" });
const db = admin.firestore();
(async () => {
  const ref = db.collection("platform_settings").doc("timesheet_gate");
  const before = (await ref.get()).data() || {};
  await ref.set({
    enabled: false,
    disabled_at: admin.firestore.FieldValue.serverTimestamp(),
    disabled_by: "CEO directive (every employee must be able to submit)",
    disabled_reason: "Chain gate (effective 2026-06-20) was blocking the whole team. Re-enable after onboarding + training are complete.",
  }, { merge: true });
  console.log(`timesheet_gate.enabled: ${before.enabled} -> false  (every project-assigned employee can now submit)`);
  process.exit(0);
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
