/**
 * One-shot cleanup. The employees collection has salary / contract / bank
 * fields that nobody ever entered through a real process — they came from
 * old backfill / seed scripts. Only one row had its data from a real
 * source: Khalid Mohammed (DLSA1003) was seeded yesterday from his Qiwa
 * contract and is marked with `contract_synced_from`.
 *
 * Rule: if an employees row has NO `contract_synced_from` marker, the
 * contract-related fields aren't real data and must be cleared. Identity
 * fields (employee_id, email, full_name, nationality, title,
 * employment_status, type, department, etc.) are NOT touched.
 *
 * Also re-runs yesterday's resetOnboardingExceptCeo against users for
 * idempotency — anything that crept back in since gets flipped back.
 *
 * Safe to re-run. The user-fields reset is idempotent; the employees
 * delete-fields step is also idempotent (deletes a missing field is a no-op).
 *
 * Run:
 *   cd functions && node scripts/clearFakeEmployeeContractData.js
 */

"use strict";

const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({ projectId: "datalake-production-sa" });
}
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

const CEO_EMAIL = "m.alqumri@datalake.sa";

// Fields that came from contract/payroll backfill — clear them when we have
// no proof the data is real (no contract_synced_from marker).
const CONTRACT_FIELDS_TO_CLEAR = [
  // wages + allowances
  "salary",
  "salary_monthly_sar",
  "housing_allowance_sar",
  "transport_allowance_sar",
  "total_wage_sar",
  // contract dates / terms
  "contract_start",
  "contract_end",
  "contract_start_date",
  "contract_end_date",
  "probation_period_days",
  "probation_period_months",
  "probation_days",
  "annual_leave_days",
  "notice_period_days",
  "work_location",
  // banking
  "bank_name",
  "iban",
  "bank_account_number",
  // identity numbers that come from the contract
  "iqama_national_id",
  "full_name_ar",
  // job_title intentionally NOT cleared — it's identity data from the
  // verified Emkan Profiles spreadsheet
];

// Fields on the users row that the old backfill flipped to true — clear them
// for everyone except the CEO. Idempotent with yesterday's P2 script.
const USER_FIELDS_TO_RESET = {
  onboarding_complete: false,
  pdpl_consent_state: null,
  training_completed: false,
  contract_signed: false,
};

async function main() {
  const [usersSnap, employeesSnap] = await Promise.all([
    db.collection("users").get(),
    db.collection("employees").get(),
  ]);

  console.log(`[clear] users: ${usersSnap.size} · employees: ${employeesSnap.size}\n`);

  // ── users ───────────────────────────────────────────────────────
  let userWrites = 0;
  let userSkipped = 0;
  for (const userDoc of usersSnap.docs) {
    const u = userDoc.data();
    const email = String(u.email || "").toLowerCase();
    if (email === CEO_EMAIL) {
      userSkipped++;
      continue;
    }
    await userDoc.ref.update({
      ...USER_FIELDS_TO_RESET,
      onboarding_reset_at: FV.serverTimestamp(),
      onboarding_reset_reason: "mass-cleanup-2026-05-31 — no real consent on record",
    });
    userWrites++;
  }

  // ── employees ───────────────────────────────────────────────────
  let empCleared = 0;
  let empPreserved = 0;
  const preservedList = [];

  for (const empDoc of employeesSnap.docs) {
    const e = empDoc.data();
    if (e.contract_synced_from) {
      empPreserved++;
      preservedList.push(`${empDoc.id} (${e.full_name || e.email || ""}) — contract_synced_from=${e.contract_synced_from}`);
      continue;
    }
    // Build a FieldValue.delete() patch for every CONTRACT_FIELD that exists
    // on this row. Skipping missing fields keeps the script idempotent.
    const patch = {};
    for (const f of CONTRACT_FIELDS_TO_CLEAR) {
      if (Object.prototype.hasOwnProperty.call(e, f)) {
        patch[f] = FV.delete();
      }
    }
    if (Object.keys(patch).length === 0) {
      // already clean
      continue;
    }
    patch.contract_cleared_at = FV.serverTimestamp();
    patch.contract_cleared_reason = "mass-cleanup-2026-05-31 — no Qiwa contract on record";
    await empDoc.ref.update(patch);
    empCleared++;
    console.log(`[clear] employees/${empDoc.id} (${e.full_name || e.email || ""}) — cleared ${Object.keys(patch).length - 2} field(s)`);
  }

  console.log("\n[clear] Summary:");
  console.log(`  users — reset: ${userWrites} · kept (CEO): ${userSkipped}`);
  console.log(`  employees — cleared: ${empCleared} · preserved: ${empPreserved}`);
  if (preservedList.length) {
    console.log("\n[clear] Preserved (Qiwa-sourced data on record):");
    preservedList.forEach((s) => console.log(`    • ${s}`));
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[clear] FAILED:", err);
    process.exit(1);
  });
