/**
 * One-shot cleanup: undo the over-eager backfills.
 *
 * Yesterday's scripts (backfillOnboardingToEmployees + earlier ones) walked
 * users.onboarding_complete and propagated it to employees. That worked, but
 * the SOURCE data was wrong — somebody had marked everyone as onboarded
 * regardless of whether they'd clicked through the 4 policies. As a result
 * the directory shows ✓ Onboarded next to engineers who have never logged in.
 *
 * Rule: only the CEO (m.alqumri@datalake.sa) has actually completed
 * onboarding. Everyone else should look exactly like they just received
 * their account.
 *
 * What this writes:
 *   users/{uid}:
 *     onboarding_complete: false
 *     pdpl_consent_state:  null
 *     training_completed:  false        (set by the policy submit handler)
 *     contract_signed:     false
 *     onboarding_reset_at: serverTimestamp
 *     onboarding_reset_reason: 'mass-cleanup-2026-05-30 — no real consent on record'
 *   employees/{emp_id}: (same flags except the audit trail also notes the source)
 *     onboarding_complete: false
 *     onboarding_reset_at: serverTimestamp
 *     onboarding_reset_reason: 'mass-cleanup-2026-05-30'
 *
 * Idempotent / safe to re-run.
 *
 * Run:
 *   cd functions && node scripts/resetOnboardingExceptCeo.js
 */

"use strict";

const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({ projectId: "datalake-production-sa" });
}
const db = admin.firestore();

const CEO_EMAIL = "m.alqumri@datalake.sa";
const RESET_REASON = "mass-cleanup-2026-05-30 — no real consent on record";

async function main() {
  const [usersSnap, employeesSnap] = await Promise.all([
    db.collection("users").get(),
    db.collection("employees").get(),
  ]);

  console.log(`[reset] users: ${usersSnap.size} · employees: ${employeesSnap.size}`);

  let userWrites = 0;
  let userSkipped = 0;
  let empWrites = 0;
  let empSkipped = 0;

  // ── users ────────────────────────────────────────────────────────
  for (const userDoc of usersSnap.docs) {
    const u = userDoc.data();
    const email = String(u.email || "").toLowerCase();
    if (email === CEO_EMAIL) {
      userSkipped++;
      console.log(`[reset] users/${userDoc.id} (${email}) — CEO, kept as-is`);
      continue;
    }
    await userDoc.ref.update({
      onboarding_complete: false,
      pdpl_consent_state: null,
      training_completed: false,
      contract_signed: false,
      onboarding_reset_at: admin.firestore.FieldValue.serverTimestamp(),
      onboarding_reset_reason: RESET_REASON,
    });
    userWrites++;
  }

  // ── employees ───────────────────────────────────────────────────
  for (const empDoc of employeesSnap.docs) {
    const e = empDoc.data();
    const email = String(e.email || "").toLowerCase();
    if (email === CEO_EMAIL) {
      empSkipped++;
      console.log(`[reset] employees/${empDoc.id} (${email}) — CEO, kept as-is`);
      continue;
    }
    await empDoc.ref.update({
      onboarding_complete: false,
      onboarding_reset_at: admin.firestore.FieldValue.serverTimestamp(),
      onboarding_reset_reason: RESET_REASON,
    });
    empWrites++;
  }

  console.log("\n[reset] Summary:");
  console.log(`  users   — reset: ${userWrites} · kept: ${userSkipped} (CEO only)`);
  console.log(`  employees — reset: ${empWrites} · kept: ${empSkipped} (CEO only)`);
  console.log("\nDone. Now only the CEO shows as onboarded. Anyone else has to actually");
  console.log("complete the 4 policies at /employee/onboarding for the flag to flip again.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[reset] FAILED:", err);
    process.exit(1);
  });
