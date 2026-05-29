/**
 * One-shot backfill: copy `onboarding_complete` from users → employees.
 *
 * Why: yesterday the Onboarding flow only flipped the flag on users/{uid}, but
 * the HR / Talent directory pages read from employees/{employee_id}. Anyone who
 * onboarded before today (the CEO included) shows as "not onboarded" in those
 * directories. This script reconciles the two collections.
 *
 * Match strategy, in order of preference:
 *   1. users/{uid}.employee_id → employees/{employee_id}
 *   2. users/{uid}.email       → employees where email matches (case-insensitive)
 *
 * Safe to re-run: only writes when `users.onboarding_complete === true` AND the
 * employees row is missing the field or has a different value.
 *
 * Run:
 *   cd functions && node scripts/backfillOnboardingToEmployees.js
 */

"use strict";

const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({ projectId: "datalake-production-sa" });
}
const db = admin.firestore();

async function main() {
  const [usersSnap, employeesSnap] = await Promise.all([
    db.collection("users").where("onboarding_complete", "==", true).get(),
    db.collection("employees").get(),
  ]);

  console.log(
    `[backfill] users with onboarding_complete=true: ${usersSnap.size} · employees rows: ${employeesSnap.size}`
  );

  // Build two lookup tables so we can match by employee_id or by email without
  // re-querying for every user.
  const employeesByEmpId = new Map();
  const employeesByEmail = new Map();
  for (const doc of employeesSnap.docs) {
    const d = doc.data();
    if (d.employee_id) employeesByEmpId.set(String(d.employee_id), doc);
    if (d.email) employeesByEmail.set(String(d.email).toLowerCase(), doc);
  }

  let writes = 0;
  let alreadyCorrect = 0;
  let noMatch = 0;
  const noMatchSummary = [];

  for (const userDoc of usersSnap.docs) {
    const u = userDoc.data();
    let emp =
      (u.employee_id && employeesByEmpId.get(String(u.employee_id))) ||
      (u.email && employeesByEmail.get(String(u.email).toLowerCase()));

    if (!emp) {
      noMatch++;
      noMatchSummary.push({ uid: userDoc.id, email: u.email, employee_id: u.employee_id || null });
      continue;
    }

    const empData = emp.data();
    if (empData.onboarding_complete === true) {
      alreadyCorrect++;
      continue;
    }

    await emp.ref.update({
      onboarding_complete: true,
      onboarding_completed_at:
        u.onboarding_completed_at || admin.firestore.FieldValue.serverTimestamp(),
      onboarding_backfilled_from: userDoc.id,
      onboarding_backfilled_at: admin.firestore.FieldValue.serverTimestamp(),
    });
    writes++;
    console.log(
      `[backfill] wrote employees/${emp.id}.onboarding_complete=true (from users/${userDoc.id})`
    );
  }

  console.log("\n[backfill] Summary:");
  console.log(`  wrote          : ${writes}`);
  console.log(`  already correct: ${alreadyCorrect}`);
  console.log(`  no employees match for user (skipped): ${noMatch}`);
  if (noMatchSummary.length) {
    console.log("[backfill] users with no employees match:");
    noMatchSummary.forEach((r) =>
      console.log(`    - ${r.uid} · ${r.email || "no-email"} · emp_id=${r.employee_id}`)
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[backfill] FAILED:", err);
    process.exit(1);
  });
