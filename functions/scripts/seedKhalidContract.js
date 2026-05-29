/**
 * Proof-of-concept: seed Khalid Mohammed's (DLSA1003) HR data from his
 * actual Qiwa contract. This is the same shape /hr/contracts → Save Review
 * writes for an Existing-employee upload, just typed in by hand.
 *
 * After this runs the payroll page should show Khalid with the real
 * numbers — proof that the contract→employees→payroll chain works
 * end-to-end. The CEO can then upload the other 11 Qiwa PDFs and watch
 * the same fields populate automatically.
 *
 * Run:
 *   cd functions && node scripts/seedKhalidContract.js
 *
 * Safe to re-run: it's an idempotent set with merge:true.
 */

"use strict";

const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({ projectId: "datalake-production-sa" });
}
const db = admin.firestore();

const EMPLOYEE_ID = "DLSA1003";

const CONTRACT = {
  employee_id: EMPLOYEE_ID,
  full_name: "Khalid Mohammed",
  email: "khaled@datalake.sa",
  job_title: "Accountant",
  // Wage breakdown (Qiwa contract, SAR/month)
  salary_monthly_sar: 3090,
  housing_allowance_sar: 600,
  transport_allowance_sar: 310,
  total_wage_sar: 4000,
  // Mirror onto the field payroll calls expect ("salary" alone).
  salary: 3090,
  // Contract dates
  contract_start: "2026-03-02",
  contract_end:   "2027-03-01",
  // Saudi Labor Law parameters from the contract
  probation_period_days: 180,
  annual_leave_days: 21,
  // Banking
  bank_name: "Al Rajhi Bank",
  // Free-form marker so it's obvious in Firestore where these came from
  contract_synced_from: "seed:Khalid_DLSA1003",
  contract_synced_at: admin.firestore.FieldValue.serverTimestamp(),
  updated_at: admin.firestore.FieldValue.serverTimestamp(),
};

async function main() {
  // employees/ is keyed by employee_id (DLSA1003) on this platform — confirm
  // by reading the doc first so we don't accidentally create a duplicate row
  // keyed by some other id.
  const refByEmpId = db.collection("employees").doc(EMPLOYEE_ID);
  const byEmpId = await refByEmpId.get();
  if (byEmpId.exists) {
    console.log(`[seed] employees/${EMPLOYEE_ID} found · merging contract fields`);
    await refByEmpId.set(CONTRACT, { merge: true });
    console.log("[seed] OK");
    return;
  }

  // Fallback: scan for any employees row where employee_id field == DLSA1003.
  const snap = await db
    .collection("employees")
    .where("employee_id", "==", EMPLOYEE_ID)
    .limit(1)
    .get();

  if (snap.empty) {
    console.error(
      `[seed] No employees row found for ${EMPLOYEE_ID}. Create the employee first (Khalid is in the master tracker — DLSA1003) then re-run.`
    );
    process.exit(2);
  }

  const target = snap.docs[0];
  console.log(`[seed] employees/${target.id} matched by employee_id · merging contract fields`);
  await target.ref.set(CONTRACT, { merge: true });
  console.log("[seed] OK");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[seed] FAILED:", err);
    process.exit(1);
  });
