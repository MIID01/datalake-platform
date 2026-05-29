/**
 * Seed: Emkan Finance project + Khalid's assignment to it.
 *
 * Why: the timesheet flow reads engineer_project_assignments to know which
 * project to book hours against. Without that row the engineer sees
 * "No project assigned" and can't submit a timesheet — which blocks the
 * invoice flow which blocks revenue.
 *
 * Khalid (DLSA1003) is the proof-of-concept engineer. Once this lands he
 * can log in, see "Deployed at Emkan Finance" on the dashboard, and
 * submit hours.
 *
 * What gets written:
 *   projects/PRJ-EMKAN-001:
 *     project_id, project_name, client_name, po_number, po_value_sar,
 *     start_date, end_date, status, work_location_type, rate_structure,
 *     timesheet_type, client_approver_*, project_manager_id (CEO acting),
 *     created_at, created_by
 *   engineer_project_assignments/ASGN-EMKAN-DLSA1003:
 *     project_id (the PRJ-EMKAN-001 created above),
 *     engineer_id (employees doc id, DLSA1003),
 *     engineer_name, engineer_email,
 *     assignment_start_date, assignment_end_date,
 *     allocation_percentage, status: ACTIVE,
 *     created_at, created_by
 *
 * Idempotent — uses set(..., { merge: true }) on both docs.
 *
 * Run:
 *   cd functions && node scripts/seedEmkanProjectAndAssignment.js
 */

"use strict";

const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({ projectId: "datalake-production-sa" });
}
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

const PROJECT_ID = "PRJ-EMKAN-001";
const ASSIGNMENT_ID = "ASGN-EMKAN-DLSA1003";
const ENGINEER_DOC_ID = "DLSA1003";

const PROJECT = {
  project_id: PROJECT_ID,
  project_name: "Emkan Finance — Data Platform",
  client_name: "Emkan Finance",
  client_id: "CL-EMKAN",
  po_number: "PO-EMKAN-2026-01",
  po_value_sar: 480000,
  po_used_sar: 0,
  start_date: "2026-03-02",
  end_date: "2027-03-01",
  status: "ACTIVE",
  work_location_type: "CLIENT_OFFICE",
  work_location_address: "Emkan HQ, Riyadh",
  rate_structure: "MONTHLY",
  rate_amount_sar: 4000,
  timesheet_type: "CONSOLIDATED",
  client_approver_name: "Ahmed Al-Ghamdi",
  client_approver_email: "ahmed@emkan.sa",
  project_manager_id: null, // CEO acts as PM until a PM is appointed
  notes: "Seeded so Khalid (DLSA1003) has a project to log timesheets against.",
  created_at: FV.serverTimestamp(),
  created_by: "seed:seedEmkanProjectAndAssignment.js",
  updated_at: FV.serverTimestamp(),
};

const ASSIGNMENT = {
  project_id: PROJECT_ID,
  engineer_id: ENGINEER_DOC_ID,
  engineer_name: "Khalid Mohammed",
  engineer_email: "khaled@datalake.sa",
  assignment_start_date: "2026-03-02",
  assignment_end_date: "2027-03-01",
  allocation_percentage: 100,
  status: "ACTIVE",
  role_on_project: "Accountant",
  created_at: FV.serverTimestamp(),
  created_by: "seed:seedEmkanProjectAndAssignment.js",
  updated_at: FV.serverTimestamp(),
};

async function main() {
  const projRef = db.collection("projects").doc(PROJECT_ID);
  const asgnRef = db.collection("engineer_project_assignments").doc(ASSIGNMENT_ID);

  await projRef.set(PROJECT, { merge: true });
  console.log(`[seed] projects/${PROJECT_ID} merged`);

  await asgnRef.set(ASSIGNMENT, { merge: true });
  console.log(`[seed] engineer_project_assignments/${ASSIGNMENT_ID} merged`);

  console.log("\n[seed] Done.");
  console.log("       Khalid logs in → dashboard shows 'Deployed at Emkan Finance'");
  console.log("       /employee/timesheets finds the assignment → grid renders");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[seed] FAILED:", err);
    process.exit(1);
  });
