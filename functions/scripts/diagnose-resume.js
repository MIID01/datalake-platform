/**
 * Read-only diagnostic for two resume items. Mutates NOTHING.
 *
 *   cd functions && node scripts/diagnose-resume.js
 *
 * Item 2 — Acknowledgment register: dumps DLSA1007 (Mohamed Dahas)
 *          onboarding_evidence raw {policy_id, policy_version} (with JS types),
 *          the live platform_settings/policy_registry required {id, version},
 *          and the per-policy match result using the SAME normalized comparison
 *          now shipped in src/lib/policies.js — so we can see exactly why the
 *          register shows Pending and whether the normalization closes it.
 *
 * Item 4 — CEO backend access: dumps users/{ceo-uid}.role_id/status,
 *          roles/{role_id}, and access_matrix/{role_id}, then simulates what
 *          functions/lib/access.js#getUserAccessProfile would do (it has NO CEO
 *          bypass — bad data => 403 on every privileged CEO backend action).
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "datalake-production-sa" });
const db = admin.firestore();

const CEO_EMAIL = "m.alqumri@datalake.sa";
const TARGET_EMPLOYEE = "DLSA1007"; // Mohamed Dahas

// Mirror of src/lib/policies.js (that module is ESM frontend code; can't import here).
const DEFAULT_POLICY_REGISTRY = [
  { id: "privacy_policy",    version: "1.0", title: "Privacy Policy — Data Processing Notice" },
  { id: "pdpl_consent",      version: "1.0", title: "Privacy Notice — Personal Data Processing" },
  { id: "code_of_conduct",   version: "1.0", title: "Employee Code of Conduct" },
  { id: "infosec_awareness", version: "1.0", title: "Information Security Awareness (NCA ECC)" },
];
const normPolicyId = (v) => String(v ?? "").trim().toLowerCase();
function versionsMatch(a, b) {
  const sa = String(a ?? "").trim().toLowerCase().replace(/^v/, "");
  const sb = String(b ?? "").trim().toLowerCase().replace(/^v/, "");
  if (!sa || !sb) return false;
  if (sa === sb) return true;
  const na = Number(sa), nb = Number(sb);
  return Number.isFinite(na) && Number.isFinite(nb) && na === nb;
}
const legacyVersionEqual = (a, b) => String(a || "") === String(b); // the OLD comparison

async function getRegistry() {
  try {
    const snap = await db.collection("platform_settings").doc("policy_registry").get();
    const policies = snap.exists ? snap.data().policies : null;
    if (Array.isArray(policies) && policies.length) return { source: "platform_settings/policy_registry", policies };
  } catch (e) { console.log("  (registry read error:", e.message, "— using compiled defaults)"); }
  return { source: "compiled DEFAULT_POLICY_REGISTRY", policies: DEFAULT_POLICY_REGISTRY };
}

async function findEmployeeDoc(empCode) {
  // employee_id field first, then doc-id fallback.
  const q = await db.collection("employees").where("employee_id", "==", empCode).limit(1).get();
  if (!q.empty) return q.docs[0];
  const byId = await db.collection("employees").doc(empCode).get();
  if (byId.exists) return byId;
  return null;
}

async function diagnoseItem2() {
  console.log("\n══════════ ITEM 2 — ACK REGISTER (DLSA1007 / Mohamed Dahas) ══════════");
  const reg = await getRegistry();
  console.log(`Registry source: ${reg.source}`);
  console.log("Registry required {id, version (type)}:");
  reg.policies.forEach(p => console.log(`  - ${p.id}  v=${JSON.stringify(p.version)} (${typeof p.version})`));

  const empDoc = await findEmployeeDoc(TARGET_EMPLOYEE);
  if (!empDoc) { console.log(`\n✗ No employees doc for ${TARGET_EMPLOYEE}.`); return; }
  console.log(`\nEmployee doc id: ${empDoc.id}  (email: ${empDoc.data().email || "—"})`);

  const evSnap = await db.collection("employees").doc(empDoc.id).collection("onboarding_evidence").get();
  if (evSnap.empty) { console.log("✗ onboarding_evidence subcollection is EMPTY — never acknowledged."); }
  console.log(`\nRaw onboarding_evidence rows (${evSnap.size}):`);
  const rows = evSnap.docs.map(d => ({ _docId: d.id, ...d.data() }));
  rows.forEach(r => {
    console.log(`  docId=${r._docId}`);
    console.log(`     policy_id     = ${JSON.stringify(r.policy_id)} (${typeof r.policy_id})` +
                (r.id !== undefined ? `   [legacy id=${JSON.stringify(r.id)}]` : ""));
    console.log(`     policy_version= ${JSON.stringify(r.policy_version)} (${typeof r.policy_version})`);
  });

  console.log("\nPer-policy match (NEW normalized vs OLD strict):");
  let newComplete = true, oldComplete = true;
  for (const p of reg.policies) {
    const row = rows.find(r => normPolicyId(r.policy_id ?? r.id) === normPolicyId(p.id));
    const oldRow = rows.find(r => (r.policy_id || r.id) === p.id);
    const okNew = !!(row && versionsMatch(row.policy_version, p.version));
    const okOld = !!(oldRow && legacyVersionEqual(oldRow.policy_version, p.version));
    newComplete = newComplete && okNew;
    oldComplete = oldComplete && okOld;
    console.log(`  ${p.id.padEnd(18)} NEW=${okNew ? "✓" : "✗"}  OLD=${okOld ? "✓" : "✗"}` +
                (row ? `  (row v=${JSON.stringify(row.policy_version)})` : "  (no matching row)"));
  }
  console.log(`\n  => OLD derivation complete? ${oldComplete}`);
  console.log(`  => NEW derivation complete? ${newComplete}`);
  if (!newComplete) console.log("  NOTE: NEW still incomplete => the row is genuinely missing/unversioned;");
  console.log("        the employee must re-acknowledge through the onboarding flow (which now version-pins).");
}

async function diagnoseItem4() {
  console.log("\n══════════ ITEM 4 — CEO BACKEND ACCESS (getUserAccessProfile) ══════════");
  let uid = null;
  try { uid = (await admin.auth().getUserByEmail(CEO_EMAIL)).uid; console.log(`CEO Auth uid: ${uid}`); }
  catch (e) { console.log(`✗ Firebase Auth getUserByEmail(${CEO_EMAIL}) failed: ${e.message}`); }

  let userData = null;
  if (uid) {
    const ud = await db.collection("users").doc(uid).get();
    if (!ud.exists) console.log(`✗ users/${uid} MISSING (getUserAccessProfile throws "User record not found")`);
    else {
      userData = ud.data();
      console.log(`users/${uid}: role_id=${JSON.stringify(userData.role_id)} status=${JSON.stringify(userData.status)}`);
      if (userData.status !== "active") console.log(`  ✗ status !== "active" => throws "User is disabled"`);
      if (!userData.role_id) console.log(`  ✗ role_id missing => access_matrix lookup will fail`);
    }
  }
  // Also surface any users docs that match by email (drift between uid-keyed and email-keyed)
  const byEmail = await db.collection("users").where("email", "==", CEO_EMAIL).get();
  console.log(`users where email==CEO_EMAIL: ${byEmail.size} doc(s) -> ${byEmail.docs.map(d => `${d.id}{role_id:${d.data().role_id},status:${d.data().status}}`).join(", ") || "none"}`);

  const roleId = userData?.role_id || "ceo";
  const matrix = await db.collection("access_matrix").doc(roleId).get();
  console.log(`access_matrix/${roleId} exists? ${matrix.exists}`);
  if (!matrix.exists) console.log(`  ✗ getUserAccessProfile throws "Access matrix for role ${roleId} not found"`);
  else {
    const dc = matrix.data().data_classes;
    console.log(`  data_classes keys: ${dc ? Object.keys(dc).length : "MISSING data_classes field"}`);
  }
  const role = await db.collection("roles").doc(roleId).get();
  console.log(`roles/${roleId} exists? ${role.exists}`);
}

(async () => {
  try {
    await diagnoseItem2();
    await diagnoseItem4();
    console.log("\nDone (read-only).");
  } catch (e) { console.error("Diagnostic failed:", e); }
  process.exit(0);
})();
