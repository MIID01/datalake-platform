/**
 * Seed the "finance" role — same permissions as "hr".
 * Usage: cd functions && node seed-finance.js
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "datalake-production-sa" });
const db = admin.firestore();
const now = admin.firestore.FieldValue.serverTimestamp();

async function seed() {
  console.log("═══ Adding finance role ═══\n");

  // 1. Role definition
  await db.collection("roles").doc("finance").set({
    role_id: "finance",
    role_name: "Finance",
    description: "Finance & accounting. Same permissions as HR for now.",
    role_type: "system",
    is_deletable: false,
    created_at: now,
    created_by: "m.alqumri@datalake.sa",
  });
  console.log("✓ Role: finance");

  // 2. Access matrix — cloned from hr
  await db.collection("access_matrix").doc("finance").set({
    role_id: "finance",
    data_classes: {
      admin_config: "hidden", user_management: "hidden", role_management: "hidden",
      candidate_pii: "read", candidate_anonymous: "read", hr_scoring: "read",
      project_full: "hidden", project_filtered: "hidden",
      own_timesheet: "read", other_timesheets: "hidden", client_timesheets: "hidden",
      client_billing: "hidden", engineer_rates: "hidden", finance_full: "hidden",
      audit_log: "hidden", compliance_documents: "read",
    },
    last_updated_by: "m.alqumri@datalake.sa",
    last_updated_at: now,
  });
  console.log("✓ Matrix: finance (cloned from hr)");

  // 3. Audit
  await db.collection("task_audit_log").add({
    event: "ROLE_CREATED",
    action_by: "system:seed-finance",
    action_at: now,
    details: { role_id: "finance", cloned_from: "hr" },
  });
  console.log("\n═══ Done ═══");
  process.exit(0);
}

seed().catch((err) => { console.error("Seed failed:", err); process.exit(1); });
