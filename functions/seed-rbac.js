/**
 * RBAC Seed Script — Run once to populate Firestore with system roles,
 * access matrices, CEO user record, and Emkan client.
 *
 * Usage: cd functions && node seed-rbac.js
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "datalake-production-sa" });
const db = admin.firestore();
const now = admin.firestore.FieldValue.serverTimestamp();

const CEO_EMAIL = "m.alqumri@datalake.sa";

// ═══ ROLES ═══
const ROLES = [
  { role_id: "ceo", role_name: "CEO", description: "Full administrative access. Defines roles, matrix, and platform configuration." },
  { role_id: "cto", role_name: "CTO", description: "Technical leadership. Approves timesheets. Sees all engineering and project data, no financial detail." },
  { role_id: "engineer", role_name: "Engineer", description: "Field engineer. Sees only own assignments, own timesheets, and projects they're staffed on." },
  { role_id: "client", role_name: "Client", description: "External client representative. Sees only their organization's projects and timesheets." },
  { role_id: "hr", role_name: "HR", description: "HR & recruiting. Sees candidate data, scoring, but not financial detail." },
];

// ═══ ACCESS MATRICES ═══
const ALL_READ = {
  admin_config: "read", user_management: "read", role_management: "read",
  candidate_pii: "read", candidate_anonymous: "read", hr_scoring: "read",
  project_full: "read", project_filtered: "read",
  own_timesheet: "read", other_timesheets: "read", client_timesheets: "read",
  client_billing: "read", engineer_rates: "read", finance_full: "read",
  audit_log: "read", compliance_documents: "read",
};

const MATRICES = {
  ceo: { ...ALL_READ },
  cto: {
    admin_config: "hidden", user_management: "hidden", role_management: "hidden",
    candidate_pii: "read", candidate_anonymous: "read", hr_scoring: "read",
    project_full: "hidden", project_filtered: "read",
    own_timesheet: "read", other_timesheets: "read", client_timesheets: "read",
    client_billing: "hidden", engineer_rates: "hidden", finance_full: "hidden",
    audit_log: "read", compliance_documents: "read",
  },
  engineer: {
    admin_config: "hidden", user_management: "hidden", role_management: "hidden",
    candidate_pii: "hidden", candidate_anonymous: "hidden", hr_scoring: "hidden",
    project_full: "hidden", project_filtered: "read",
    own_timesheet: "read", other_timesheets: "hidden", client_timesheets: "hidden",
    client_billing: "hidden", engineer_rates: "read", finance_full: "hidden",
    audit_log: "hidden", compliance_documents: "hidden",
  },
  client: {
    admin_config: "hidden", user_management: "hidden", role_management: "hidden",
    candidate_pii: "hidden", candidate_anonymous: "hidden", hr_scoring: "hidden",
    project_full: "hidden", project_filtered: "read",
    own_timesheet: "hidden", other_timesheets: "hidden", client_timesheets: "read",
    client_billing: "read", engineer_rates: "hidden", finance_full: "hidden",
    audit_log: "hidden", compliance_documents: "hidden",
  },
  hr: {
    admin_config: "hidden", user_management: "hidden", role_management: "hidden",
    candidate_pii: "read", candidate_anonymous: "read", hr_scoring: "read",
    project_full: "hidden", project_filtered: "hidden",
    own_timesheet: "read", other_timesheets: "hidden", client_timesheets: "hidden",
    client_billing: "hidden", engineer_rates: "hidden", finance_full: "hidden",
    audit_log: "hidden", compliance_documents: "read",
  },
};

async function seed() {
  console.log("═══ RBAC SEED START ═══\n");

  // 1. Seed roles
  for (const role of ROLES) {
    await db.collection("roles").doc(role.role_id).set({
      ...role,
      role_type: "system",
      is_deletable: false,
      created_at: now,
      created_by: CEO_EMAIL,
    });
    console.log(`✓ Role: ${role.role_id}`);
  }

  // 2. Seed access matrices
  for (const [roleId, dataClasses] of Object.entries(MATRICES)) {
    await db.collection("access_matrix").doc(roleId).set({
      role_id: roleId,
      data_classes: dataClasses,
      last_updated_by: CEO_EMAIL,
      last_updated_at: now,
    });
    console.log(`✓ Matrix: ${roleId}`);
  }

  // 3. Look up CEO user in Firebase Auth and create users record
  try {
    const ceoUser = await admin.auth().getUserByEmail(CEO_EMAIL);
    await db.collection("users").doc(ceoUser.uid).set({
      uid: ceoUser.uid,
      email: CEO_EMAIL,
      display_name: ceoUser.displayName || "Mohammed Alqumri",
      role_id: "ceo",
      status: "active",
      client_id: null,
      assigned_projects: [],
      created_at: now,
      last_login_at: null,
      created_by: "system:seed",
    });
    console.log(`✓ CEO user: ${ceoUser.uid} (${CEO_EMAIL})`);
  } catch (err) {
    console.error(`✗ CEO user lookup failed: ${err.message}`);
    console.log("  → You may need to create this user via Firebase Auth first.");
  }

  // 4. Seed Emkan client
  await db.collection("clients").doc("emkan").set({
    client_id: "emkan",
    client_name: "Emkan Finance",
    auth_type: "full",
    is_sama_regulated: true,
    contact_email: "contact@emkan.com.sa",
    contact_name: "Emkan Finance",
    created_at: now,
    status: "active",
  });
  console.log("✓ Client: emkan");

  // 5. Audit log
  await db.collection("task_audit_log").add({
    event: "RBAC_SEED_COMPLETED",
    action_by: "system:seed",
    action_at: now,
    details: {
      roles_seeded: ROLES.map(r => r.role_id),
      matrices_seeded: Object.keys(MATRICES),
      client_seeded: "emkan",
    },
  });

  console.log("\n═══ RBAC SEED COMPLETE ═══");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
