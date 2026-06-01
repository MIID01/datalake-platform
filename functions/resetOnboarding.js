"use strict";
//
// Reset Onboarding — HR/CEO only.
//
// Clears the onboarding flags on both the users/{uid} and employees/{id}
// docs for an employee so the next sign-in restarts the onboarding gate
// (PDPL consent, policy acknowledgments, training). The historical
// onboarding_evidence subcollection is intentionally LEFT INTACT — it's
// the regulatory audit trail of what they acknowledged previously; the
// new acks land as new rows.

const admin = require("firebase-admin");

const db = admin.firestore();

function isHrOrCeo(profile, email) {
  if (profile?.role_id === "ceo" || profile?.role_id === "hr") return true;
  if (email === "m.alqumri@datalake.sa") return true;
  if (email === "hr@datalake.sa" || email === "HR@datalake.sa") return true;
  return false;
}

async function resetOnboardingHandler(req, res, { getUserAccessProfile } = {}) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  try {
    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) return res.status(401).json({ error: "Missing auth token" });
    const decoded = await admin.auth().verifyIdToken(authHeader.slice(7));
    const profile = (getUserAccessProfile && (await getUserAccessProfile(decoded.uid))) || null;
    if (!isHrOrCeo(profile, decoded.email)) return res.status(403).json({ error: "HR or CEO only" });

    const { employee_id, email } = req.body || {};
    if (!employee_id && !email) {
      return res.status(400).json({ error: "employee_id or email required" });
    }

    // Resolve targets — both the employees doc and the users doc.
    let employeeDocId = null;
    let employeeData = null;
    let userDocId = null;
    let userData = null;

    if (employee_id) {
      const empSnap = await db.collection("employees").doc(employee_id).get();
      if (empSnap.exists) { employeeDocId = empSnap.id; employeeData = empSnap.data() }
    }
    if (!employeeDocId && email) {
      const q = await db.collection("employees").where("email", "==", String(email).toLowerCase()).limit(1).get();
      if (!q.empty) { employeeDocId = q.docs[0].id; employeeData = q.docs[0].data() }
    }
    if (!employeeDocId) return res.status(404).json({ error: "Employee not found" });

    const resolvedEmail = String(employeeData.email || email || "").toLowerCase();
    if (resolvedEmail) {
      // Users doc: try uid-keyed (legacy) then email lookup.
      if (employeeData.uid) {
        const u = await db.collection("users").doc(employeeData.uid).get();
        if (u.exists) { userDocId = u.id; userData = u.data() }
      }
      if (!userDocId) {
        const uq = await db.collection("users").where("email", "==", resolvedEmail).limit(1).get();
        if (!uq.empty) { userDocId = uq.docs[0].id; userData = uq.docs[0].data() }
      }
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const FieldValue = admin.firestore.FieldValue;

    // Patch both docs. We DELETE the consent fields rather than set to null
    // so the AuthGate logic that checks `!== true` cleanly re-prompts.
    // Keep onboarding_evidence subcollection intact — it's audit history.
    const employeePatch = {
      onboarding_complete: false,
      onboarding_completed_at: FieldValue.delete(),
      pdpl_consent_state: FieldValue.delete(),
      pdpl_consent_at: FieldValue.delete(),
      training_completed: false,
      contract_signed: false,
      onboarding_reset_at: now,
      onboarding_reset_by: profile?.email || decoded.email,
      updated_at: now,
    };
    await db.collection("employees").doc(employeeDocId).set(employeePatch, { merge: true });

    if (userDocId) {
      const userPatch = {
        onboarding_complete: false,
        onboarding_completed_at: FieldValue.delete(),
        pdpl_consent_state: FieldValue.delete(),
        pdpl_consent_at: FieldValue.delete(),
        pdpl_consent_ip: FieldValue.delete(),
        pdpl_consent_user_agent: FieldValue.delete(),
        training_completed: false,
        contract_signed: false,
        onboarding_reset_at: now,
        onboarding_reset_by: profile?.email || decoded.email,
      };
      await db.collection("users").doc(userDocId).set(userPatch, { merge: true });
    }

    await db.collection("task_audit_log").add({
      event: "ONBOARDING_RESET",
      action_by: profile?.email || decoded.email,
      action_at: now,
      details: { employee_id: employeeDocId, user_id: userDocId, email: resolvedEmail },
      ip_address: req.ip || req.headers["x-forwarded-for"] || "unknown",
    });

    return res.status(200).json({
      success: true,
      employee_id: employeeDocId,
      user_id: userDocId,
      email: resolvedEmail,
      note: "Onboarding flags cleared. Historical onboarding_evidence rows preserved for audit.",
    });
  } catch (err) {
    console.error("resetOnboarding error:", err);
    return res.status(500).json({ error: err.message || "Internal error" });
  }
}

module.exports = { resetOnboardingHandler };
