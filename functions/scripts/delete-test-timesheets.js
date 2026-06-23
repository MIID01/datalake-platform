// Delete ONLY the explicitly-named test timesheets (and their subcollections).
// Hardcoded IDs — no inference rule that could match real data. Real records
// (Dahas ×3, CEO May) are NOT in this list and are untouched.
//   cd functions && node scripts/delete-test-timesheets.js
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "datalake-production-sa" });
const db = admin.firestore();

const TEST_IDS = [
  "TS-2026-04-AHMEDTES-PRJ-2026-TEST4216", // "Ahmed Test Engineer" / Revenue Loop Test
  "TS-E2E-TEST-1779624392191",             // E2E test, 160h vs 0 day entries
  "TS-TEST-SOD-PROBE",                      // "[TEST] SOD Probe"
];

(async () => {
  for (const id of TEST_IDS) {
    const ref = db.collection("timesheets").doc(id);
    const snap = await ref.get();
    if (!snap.exists) { console.log(`  ${id}: not found (already gone)`); continue; }
    const t = snap.data();
    if (typeof db.recursiveDelete === "function") {
      await db.recursiveDelete(ref);
    } else {
      const ev = await ref.collection("approval_evidence").get();
      for (const e of ev.docs) await e.ref.delete();
      await ref.delete();
    }
    console.log(`  deleted ${id}  (engineer: ${t.engineer_name || t.engineer_email || "—"}, state: ${t.state})`);
  }
  console.log("\nDone. Real timesheets untouched.");
  process.exit(0);
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
