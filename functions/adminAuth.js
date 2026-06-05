/**
 * adminAuth.js — Segregation-of-duties admin Cloud Functions.
 *
 * Kept in a SEPARATE module (not index.js) to avoid merge conflicts with the
 * in-progress Pub/Sub chain work. To deploy, index.js must re-export these:
 *
 *     const adminAuth = require("./adminAuth");
 *     exports.adminsetpassword = adminAuth.adminsetpassword;
 *     exports.assignrole = adminAuth.assignrole;
 *
 * Both are browser-facing HTTP functions, so after deploy they need the
 * allUsers run.invoker binding (same pattern as the other portal functions).
 *
 * Segregation:
 *   - adminsetpassword → ONLY role_id === "it_admin" (credential management)
 *   - assignrole       → ONLY the CEO (role assignment); CEO cannot change own role
 *   Every action is written to BigQuery datalake_audit.admin_audit_log (immutable)
 *   AND mirrored to Firestore task_audit_log so the IT audit page can render it.
 */
const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const crypto = require("crypto");
const { BigQuery } = require("@google-cloud/bigquery");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const bq = new BigQuery();

const REGION = "me-central2";
const CEO_EMAIL = "m.alqumri@datalake.sa";
const ASSIGNABLE_ROLES = ["employee", "hr", "finance", "it_admin", "cto", "ceo", "client", "pm"];

// ── helpers ────────────────────────────────────────────────────────────────

async function verifyCaller(req) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer (.+)$/);
  if (!match) throw Object.assign(new Error("Missing Authorization header"), { code: 401 });
  const decoded = await admin.auth().verifyIdToken(match[1]);
  // Authoritative role comes from the user's own Firestore record (not the token).
  let role_id = null;
  const userDoc = await db.collection("users").doc(decoded.uid).get();
  if (userDoc.exists) role_id = userDoc.data().role_id || null;
  else {
    const q = await db.collection("users").where("email", "==", (decoded.email || "").toLowerCase()).limit(1).get();
    if (!q.empty) role_id = q.docs[0].data().role_id || null;
  }
  return { uid: decoded.uid, email: decoded.email, role_id };
}

// Append-only audit: BigQuery (immutable) + Firestore mirror for the UI.
async function logAdminAudit({ actor, actor_role, target_user, action, details }) {
  const row = {
    actor: actor || "unknown",
    actor_role: actor_role || "unknown",
    target_user: target_user || "",
    action,
    details: details ? JSON.stringify(details) : "",
    timestamp: new Date().toISOString(),
  };
  // BigQuery (create table on first use).
  try {
    const dataset = bq.dataset("datalake_audit");
    const table = dataset.table("admin_audit_log");
    const [exists] = await table.exists();
    if (!exists) {
      await dataset.createTable("admin_audit_log", {
        schema: [
          { name: "actor", type: "STRING" },
          { name: "actor_role", type: "STRING" },
          { name: "target_user", type: "STRING" },
          { name: "action", type: "STRING" },
          { name: "details", type: "STRING" },
          { name: "timestamp", type: "TIMESTAMP" },
        ],
        location: REGION,
      });
    }
    await table.insert([row]);
  } catch (err) {
    console.error("admin_audit_log BigQuery insert failed:", err.message);
  }
  // Firestore mirror (best-effort) for the /admin/audit view.
  try {
    await db.collection("task_audit_log").add({
      event: action,
      action_by: actor,
      action_at: admin.firestore.FieldValue.serverTimestamp(),
      details: { target_user, actor_role, ...(details || {}) },
    });
  } catch (err) {
    console.error("task_audit_log mirror failed:", err.message);
  }
}

function generateTempPassword() {
  // 16 chars, mixed — avoids ambiguous characters.
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%^&*-_"];
  const bytes = crypto.randomBytes(16);
  let out = "";
  for (let i = 0; i < 16; i++) {
    const set = sets[i % sets.length];
    out += set[bytes[i] % set.length];
  }
  return out;
}

// Server-side mirror of src/lib/password-policy.js — keep the two in sync.
// Returns an array of human-readable failures (empty == policy met).
function validatePasswordPolicy(pw) {
  const s = String(pw || "");
  const fails = [];
  if (s.length < 12) fails.push("at least 12 characters");
  if (!/[A-Z]/.test(s)) fails.push("one uppercase letter");
  if (!/[a-z]/.test(s)) fails.push("one lowercase letter");
  if (!/[0-9]/.test(s)) fails.push("one number");
  if (!/[^A-Za-z0-9]/.test(s)) fails.push("one special character");
  return fails;
}

// Authenticated caller with NO role requirement — for self-service endpoints
// (a user acting on their OWN account). Returns { uid, email }.
async function verifyAuthed(req) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer (.+)$/);
  if (!match) throw Object.assign(new Error("Missing Authorization header"), { code: 401 });
  const decoded = await admin.auth().verifyIdToken(match[1]);
  return { uid: decoded.uid, email: decoded.email };
}

async function resolveTargetUid({ target_uid, target_email }) {
  if (target_uid) return target_uid;
  if (target_email) {
    const user = await admin.auth().getUserByEmail(target_email);
    return user.uid;
  }
  throw Object.assign(new Error("target_uid or target_email required"), { code: 400 });
}

// ── 1. adminsetpassword (it_admin ONLY) ──────────────────────────────────────
const adminsetpassword = onRequest({ region: REGION, memory: "256MiB", timeoutSeconds: 60, cors: true }, async (req, res) => {
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const caller = await verifyCaller(req);
    // SEGREGATION: only IT Admin may manage credentials — explicitly NOT the CEO.
    if (caller.role_id !== "it_admin") {
      return res.status(403).json({ error: "Forbidden: credential management requires the it_admin role." });
    }

    const { action, target_uid, target_email, target_uids } = req.body || {};
    const VALID = ["reset", "generate", "force_expiry", "bulk_reset"];
    if (!VALID.includes(action)) return res.status(400).json({ error: `action must be one of ${VALID.join(", ")}` });

    const now = admin.firestore.FieldValue.serverTimestamp();

    if (action === "force_expiry") {
      const uid = await resolveTargetUid({ target_uid, target_email });
      await db.collection("password_policies").doc(uid).set(
        { force_reset: true, expires_at: admin.firestore.Timestamp.now(), last_changed_by: caller.email, updated_at: now },
        { merge: true }
      );
      await logAdminAudit({ actor: caller.email, actor_role: caller.role_id, target_user: uid, action: "PASSWORD_EXPIRY_FORCED" });
      return res.status(200).json({ success: true, target_uid: uid });
    }

    if (action === "bulk_reset") {
      if (!Array.isArray(target_uids) || target_uids.length === 0) return res.status(400).json({ error: "target_uids[] required for bulk_reset" });
      const results = [];
      for (const uid of target_uids) {
        const password = generateTempPassword();
        await admin.auth().updateUser(uid, { password });
        await db.collection("password_policies").doc(uid).set(
          { force_reset: true, last_changed_at: now, last_changed_by: caller.email }, { merge: true }
        );
        await logAdminAudit({ actor: caller.email, actor_role: caller.role_id, target_user: uid, action: "PASSWORD_RESET", details: { bulk: true } });
        results.push({ uid, password });
      }
      return res.status(200).json({ success: true, results });
    }

    // reset / generate (single)
    const uid = await resolveTargetUid({ target_uid, target_email });
    const password = generateTempPassword();
    await admin.auth().updateUser(uid, { password });
    await db.collection("password_policies").doc(uid).set(
      { force_reset: true, last_changed_at: now, last_changed_by: caller.email }, { merge: true }
    );
    await logAdminAudit({ actor: caller.email, actor_role: caller.role_id, target_user: uid, action: action === "generate" ? "PASSWORD_GENERATED" : "PASSWORD_RESET" });
    // Returned ONCE — never stored in plaintext anywhere.
    return res.status(200).json({ success: true, target_uid: uid, temporary_password: password, must_change: true });
  } catch (err) {
    console.error("adminsetpassword error:", err.message);
    return res.status(err.code === 401 || err.code === 400 ? err.code : 500).json({ error: err.message });
  }
});

// ── 2. assignrole (CEO ONLY) ─────────────────────────────────────────────────
const assignrole = onRequest({ region: REGION, memory: "256MiB", timeoutSeconds: 30, cors: true }, async (req, res) => {
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const caller = await verifyCaller(req);
    // SEGREGATION: only the CEO assigns roles — explicitly NOT it_admin.
    const isCeo = caller.role_id === "ceo" || caller.email === CEO_EMAIL;
    if (!isCeo) {
      return res.status(403).json({ error: "Forbidden: role assignment requires the CEO role." });
    }

    const { target_uid, new_role_id } = req.body || {};
    if (!target_uid || !new_role_id) return res.status(400).json({ error: "target_uid and new_role_id required" });
    if (!ASSIGNABLE_ROLES.includes(new_role_id)) return res.status(400).json({ error: `new_role_id must be one of ${ASSIGNABLE_ROLES.join(", ")}` });

    // SEGREGATION: the CEO cannot change their OWN role.
    if (target_uid === caller.uid) {
      return res.status(403).json({ error: "Segregation of duties: the CEO cannot change their own role." });
    }

    const targetRef = db.collection("users").doc(target_uid);
    const targetDoc = await targetRef.get();
    if (!targetDoc.exists) return res.status(404).json({ error: "Target user not found" });
    const previous_role = targetDoc.data().role_id || null;

    await targetRef.update({ role_id: new_role_id, role_assigned_by: caller.email, role_assigned_at: admin.firestore.FieldValue.serverTimestamp() });
    await logAdminAudit({ actor: caller.email, actor_role: caller.role_id || "ceo", target_user: target_uid, action: "USER_ROLE_CHANGED", details: { previous_role, new_role_id } });

    return res.status(200).json({ success: true, target_uid, previous_role, new_role_id });
  } catch (err) {
    console.error("assignrole error:", err.message);
    return res.status(err.code === 401 || err.code === 400 ? err.code : 500).json({ error: err.message });
  }
});

// ── 3. getmypasswordstatus (any authenticated user) ─────────────────────────
// Reports whether THIS caller is on a forced temp password (force_reset === true
// on their own password_policies doc). The employee can't read that doc directly
// (it's it_admin-only in firestore.rules), so the forced-change login gate calls
// this. invoker:"public" — auth is enforced in-code via the ID token.
const getmypasswordstatus = onRequest({ invoker: "public", region: REGION, memory: "256MiB", timeoutSeconds: 15, cors: true }, async (req, res) => {
  if (req.method === "OPTIONS") return res.status(204).send("");
  try {
    const caller = await verifyAuthed(req);
    const snap = await db.collection("password_policies").doc(caller.uid).get();
    const must_change = snap.exists ? snap.data().force_reset === true : false;
    return res.status(200).json({ must_change });
  } catch (err) {
    console.error("getmypasswordstatus error:", err.message);
    return res.status(err.code === 401 ? 401 : 500).json({ error: err.message });
  }
});

// ── 4. changemypassword (any authenticated user — acts on OWN account) ───────
// Used by the forced first-login password-change gate. The caller just signed in
// (valid ID token), so no old-password re-entry is required for the temp-pw flow.
// The policy is enforced HERE (server-side) and force_reset is cleared in the SAME
// call — so the login gate only lifts after a real, policy-compliant change. No
// "skip the change" path exists: the client can't clear the flag itself.
const changemypassword = onRequest({ invoker: "public", region: REGION, memory: "256MiB", timeoutSeconds: 30, cors: true }, async (req, res) => {
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const caller = await verifyAuthed(req);
    const { new_password } = req.body || {};
    const fails = validatePasswordPolicy(new_password);
    if (fails.length) return res.status(400).json({ error: `Password must contain ${fails.join(", ")}.` });

    await admin.auth().updateUser(caller.uid, { password: new_password });
    const now = admin.firestore.FieldValue.serverTimestamp();
    await db.collection("password_policies").doc(caller.uid).set(
      {
        force_reset: false, must_change: false,
        last_changed_at: now, last_password_change: now,
        last_changed_by: caller.email, changed_self: true, updated_at: now,
      },
      { merge: true }
    );
    await logAdminAudit({ actor: caller.email, actor_role: "self", target_user: caller.uid, action: "PASSWORD_CHANGED_SELF" });
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("changemypassword error:", err.message);
    return res.status(err.code === 401 || err.code === 400 ? err.code : 500).json({ error: err.message });
  }
});

module.exports = { adminsetpassword, assignrole, getmypasswordstatus, changemypassword };
