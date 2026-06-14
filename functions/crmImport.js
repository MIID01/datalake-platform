// functions/crmImport.js — CRM hardened import + bulk soft-delete (DTLK-UI-CRM-001 §3, P0.0).
//
// WHY THIS IS SERVER-SIDE (§2 non-negotiables):
//   - AUDIT-ON-WRITE: every state-changing action writes an audit record (Firestore
//     task_audit_log + BigQuery datalake_audit.crm_audit) BEFORE the UI confirms.
//   - SERVER-SIDE ENFORCEMENT: the PDPL consent gate (consent_source + lawful_basis
//     when contact PII is present) is enforced HERE, not trusted from the client.
//   - SOFT-DELETE: deletes are soft (archived:true + archived_at/by/reason). Nothing
//     hard-deletes from a button; only the gated PDPL purge truly deletes.
//   - STRUCTURAL anti-"a1": the server reads ONLY the whitelisted deal fields off each
//     row object. Any stray column the client failed to drop is ignored here too.
//
// Two handlers:
//   crmImportLeads  — validate rows → write deals tagged with import_batch_id → audit.
//   crmArchiveDeals — soft-delete / restore by ids[] OR import_batch_id (one-click undo).

const admin = require("firebase-admin");
const crypto = require("crypto");
const { logToBigQuery } = require("./lib/bigquery");

const db = admin.firestore();
const CRM_ROLES = ["ceo", "business", "sales"];
const CEO_ROLES = ["ceo"];

// Firebase App Check (defense-in-depth, §2 / CEO-directed). These two endpoints
// are public-invoker (browser Firebase-token calls), so App Check ensures the
// caller is the genuine app — not curl/scripts — on TOP of verifyIdToken + the
// role gates (which remain the real security boundary). firebase-functions v2
// onRequest has no enforceAppCheck option, so we verify the header manually.
// Rollout is staged: APP_CHECK_ENFORCE=false logs unverified calls (monitor);
// flip to true to reject them 401 (fail-closed) once real traffic attests.
const APP_CHECK_ENFORCE = process.env.APP_CHECK_ENFORCE === "true";
async function verifyAppCheck(req) {
  const token = req.header("X-Firebase-AppCheck");
  if (token) {
    try { await admin.appCheck().verifyToken(token); return true; } catch (e) { /* invalid/expired token */ }
  }
  return false;
}

// FAIL-SAFE entity scope (§4 / D-1). No multi-entity model exists yet (only the
// single tenants/datalake branding doc). Until the CEO configures entities, every
// CRM object is stamped with this resolved default so the entity_id field + the
// entity-scoped query path exist now and light up unchanged when entities land.
const DEFAULT_ENTITY_ID = "datalake";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isBlank = (v) => v == null || String(v).trim() === "";
const clean = (v) => (v == null ? "" : String(v).trim());
const toNum = (v) => Number(String(v == null ? "" : v).replace(/[^0-9.-]/g, ""));
const sha256 = (obj) => crypto.createHash("sha256").update(JSON.stringify(obj)).digest("hex");

function setCors(req, res, ALLOWED_ORIGINS) {
  res.set("Access-Control-Allow-Origin", ALLOWED_ORIGINS && ALLOWED_ORIGINS.includes(req.headers.origin) ? req.headers.origin : "");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// One audit record → Firestore (queryable) + BigQuery (immutable evidence).
// Shape per §2 AUDIT-ON-WRITE: {actor, role, auth_method, entity_id, object,
// record_id, action, before/after SHA-256, timestamp}.
async function writeAudit({ decoded, profile, action, object, recordId, before, after, extra, req }) {
  const now = admin.firestore.FieldValue.serverTimestamp();
  const row = {
    event: action,
    action,
    object,
    record_id: recordId || null,
    actor: profile.email || decoded.email || null,
    actor_uid: decoded.uid || null,
    role: profile.role_id || null,
    auth_method: "firebase_id_token",
    entity_id: DEFAULT_ENTITY_ID,
    before_sha256: before == null ? null : sha256(before),
    after_sha256: after == null ? null : sha256(after),
    ip_address: req.ip || req.headers["x-forwarded-for"] || "unknown",
    user_agent: req.headers["user-agent"] || "unknown",
    action_by: profile.email || decoded.email || null, // legacy field name kept for task_audit_log consumers
    action_at: now,
    details: extra || {},
  };
  await db.collection("task_audit_log").add(row);
  // BigQuery mirror (best-effort; never blocks the write path). Timestamps as ISO.
  await logToBigQuery("datalake_audit", "crm_audit", {
    ...row, action_at: new Date().toISOString(), details: extra || {},
  });
}

// Whitelist + per-row validation. Mirrors the client rules so the server is the
// real boundary: a row with no title AND no company is REJECTED (never written as
// a placeholder); a non-numeric value is rejected; a malformed email is dropped
// (lead kept). Returns { valid:[dealDoc], skipped:[{idx,reason}], anyPii }.
function validateRows(rows, baseIdx) {
  const valid = [], skipped = [];
  let anyPii = false;
  rows.forEach((raw, i) => {
    const idx = (baseIdx || 0) + i;
    const r = raw && typeof raw === "object" ? raw : {};
    const title = clean(r.title), company = clean(r.company_name);
    if (!title && !company) { skipped.push({ idx, reason: "no title or company" }); return; }
    let value = 0;
    if (!isBlank(r.value_sar)) {
      if (String(r.value_sar).replace(/[^0-9.-]/g, "") === "") { skipped.push({ idx, reason: `value "${clean(r.value_sar)}" is not a number` }); return; }
      value = toNum(r.value_sar);
      if (!isFinite(value) || isNaN(value)) { skipped.push({ idx, reason: "value is not a number" }); return; }
      if (value < 0) { skipped.push({ idx, reason: "negative value" }); return; }
    }
    let email = clean(r.contact_email);
    if (email && !EMAIL_RE.test(email)) email = ""; // drop garbage PII, keep the lead
    const name = clean(r.contact_name), phone = clean(r.contact_phone);
    if (email || name || phone) anyPii = true;
    valid.push({
      title: title || company,
      company_name: company || "",
      value_sar: value,
      owner_email: clean(r.owner_email) || null,
      contact_name: name || null,
      contact_email: email || null,
      contact_phone: phone || null,
      expected_close: clean(r.expected_close) || null,
    });
  });
  return { valid, skipped, anyPii };
}

// ═══════════════════════════════════════════════════════════════════
// crmImportLeads — POST { rows:[mappedRow], consent:{lawful_basis,consent_source}, import_batch_id }
// Returns { import_batch_id, written, skipped:[{idx,reason}] }.
// The client maps columns + chunks; the server is the validation + audit boundary.
// ═══════════════════════════════════════════════════════════════════
async function crmImportLeadsHandler(req, res, { verifyAuth, getUserAccessProfile, ALLOWED_ORIGINS }) {
  setCors(req, res, ALLOWED_ORIGINS);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  // App Check (app-attestation) — gate BEFORE user auth. Monitor or enforce per flag.
  if (!(await verifyAppCheck(req))) {
    if (APP_CHECK_ENFORCE) return res.status(401).json({ error: "App Check verification failed" });
    console.warn(`[AppCheck] crmImportLeads unverified (monitor mode) ua=${req.headers["user-agent"] || "?"}`);
  }

  try {
    const decoded = await verifyAuth(req);
    let profile;
    try { profile = await getUserAccessProfile(decoded.uid); }
    catch (e) { return res.status(403).json({ error: e.message || "No active access profile" }); }
    if (!CRM_ROLES.includes(profile.role_id)) return res.status(403).json({ error: "CRM role required (ceo/business/sales)" });

    const { rows, consent, import_batch_id, base_idx } = req.body || {};
    if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: "rows[] required" });
    if (rows.length > 2000) return res.status(413).json({ error: "Send ≤2000 rows per request (chunk client-side under one import_batch_id)" });

    const { valid, skipped, anyPii } = validateRows(rows, base_idx);

    // SERVER-ENFORCED PDPL gate — contact PII requires a documented source + basis.
    const lawfulBasis = clean(consent && consent.lawful_basis);
    const consentSource = clean(consent && consent.consent_source);
    if (anyPii && (!consentSource || !["consent", "legitimate_interest"].includes(lawfulBasis))) {
      return res.status(422).json({ error: "PDPL: contact PII requires lawful_basis (consent|legitimate_interest) + consent_source" });
    }

    const batchId = clean(import_batch_id) || `IMPORT-${crypto.randomUUID()}`;
    const now = admin.firestore.FieldValue.serverTimestamp();
    const purgeAfter = anyPii ? admin.firestore.Timestamp.fromMillis(Date.now() + 365 * 2 * 86400000) : null;

    // AUDIT BEFORE WRITE (§2): record the intent + payload hash before committing.
    await writeAudit({
      decoded, profile, action: "CRM_IMPORT_LEADS", object: "deals", recordId: batchId,
      before: null, after: { written: valid.length, skipped: skipped.length },
      extra: { import_batch_id: batchId, attempted: rows.length, written: valid.length, skipped, source: "CSV_IMPORT", lawful_basis: anyPii ? lawfulBasis : null }, req,
    });

    // Batched Admin-SDK writes, each deal tagged with the import_batch_id + entity_id.
    let written = 0;
    for (let i = 0; i < valid.length; i += 400) {
      const batch = db.batch();
      valid.slice(i, i + 400).forEach((v) => {
        const pii = !!(v.contact_email || v.contact_phone || v.contact_name);
        batch.set(db.collection("deals").doc(), {
          ...v,
          stage: "NEW",
          owner_email: v.owner_email || profile.email || decoded.email || "unknown",
          client_id: null,
          source: "CSV_IMPORT",
          import_batch_id: batchId,
          entity_id: DEFAULT_ENTITY_ID,
          archived: false,
          lawful_basis: pii ? lawfulBasis : null,
          consent_source: pii ? consentSource : null,
          pdpl_purge_after: pii ? purgeAfter : null,
          created_at: now,
          created_by: profile.email || decoded.email || "unknown",
          created_by_uid: decoded.uid || null,
          updated_at: now,
        });
      });
      await batch.commit();
      written += Math.min(400, valid.length - i);
    }

    return res.status(200).json({ import_batch_id: batchId, written, skipped });
  } catch (err) {
    console.error("crmImportLeads error:", err);
    const code = err.code === "AUTH_MISSING" || err.code === "AUTH_INVALID" ? 401 : err.code === "AUTH_DOMAIN" ? 403 : 500;
    return res.status(code).json({ error: err.message || "Internal server error" });
  }
}

// ═══════════════════════════════════════════════════════════════════
// crmArchiveDeals — POST { ids:[], import_batch_id, reason, restore:bool }
// Soft-delete (archived:true) or restore (archived:false) a set of deals, by
// explicit ids OR by import_batch_id (the one-click UNDO of §3.1). CEO-only —
// matches firestore.rules where destructive deal ops are CEO-gated.
// Returns { affected }.
// ═══════════════════════════════════════════════════════════════════
async function crmArchiveDealsHandler(req, res, { verifyAuth, getUserAccessProfile, ALLOWED_ORIGINS }) {
  setCors(req, res, ALLOWED_ORIGINS);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  // App Check (app-attestation) — gate BEFORE user auth. Monitor or enforce per flag.
  if (!(await verifyAppCheck(req))) {
    if (APP_CHECK_ENFORCE) return res.status(401).json({ error: "App Check verification failed" });
    console.warn(`[AppCheck] crmArchiveDeals unverified (monitor mode) ua=${req.headers["user-agent"] || "?"}`);
  }

  try {
    const decoded = await verifyAuth(req);
    let profile;
    try { profile = await getUserAccessProfile(decoded.uid); }
    catch (e) { return res.status(403).json({ error: e.message || "No active access profile" }); }

    const { ids, import_batch_id, reason, restore } = req.body || {};
    // Role gate (mirror of src/lib/deals.js DEAL_DELETE_ROLES): a SINGLE-deal
    // delete/restore is open to the CRM team (ceo/business/sales) so a growing
    // sales team can manage its own pipeline; a MASS multi-select archive or a
    // whole import_batch undo stays CEO-only so one rep can't wipe the board.
    const isMass = !!import_batch_id || (Array.isArray(ids) && ids.length > 1);
    const allowed = isMass ? CEO_ROLES : CRM_ROLES;
    if (!allowed.includes(profile.role_id)) {
      return res.status(403).json({ error: isMass ? "CEO role required for bulk archive/undo" : "CRM role required (ceo/business/sales)" });
    }
    let refs = [];
    if (import_batch_id) {
      const snap = await db.collection("deals").where("import_batch_id", "==", clean(import_batch_id)).get();
      refs = snap.docs.map((d) => d.ref);
    } else if (Array.isArray(ids) && ids.length) {
      if (ids.length > 5000) return res.status(413).json({ error: "≤5000 ids per request" });
      refs = ids.map((id) => db.collection("deals").doc(String(id)));
    } else {
      return res.status(400).json({ error: "ids[] or import_batch_id required" });
    }
    if (!refs.length) return res.status(200).json({ affected: 0 });

    const action = restore ? "CRM_RESTORE_DEALS" : (import_batch_id ? "CRM_UNDO_IMPORT" : "CRM_BULK_ARCHIVE");
    await writeAudit({
      decoded, profile, action, object: "deals", recordId: clean(import_batch_id) || null,
      before: { archived: !restore }, after: { archived: !!restore },
      extra: { count: refs.length, reason: clean(reason) || null, import_batch_id: clean(import_batch_id) || null, ids: refs.slice(0, 200).map((r) => r.id) }, req,
    });

    const now = admin.firestore.FieldValue.serverTimestamp();
    const patch = restore
      ? { archived: false, archived_at: null, archived_by: null, archive_reason: null, updated_at: now }
      : { archived: true, archived_at: now, archived_by: profile.email || decoded.email || "unknown", archive_reason: clean(reason) || (import_batch_id ? "undo import" : "bulk archive"), updated_at: now };

    let affected = 0;
    for (let i = 0; i < refs.length; i += 400) {
      const batch = db.batch();
      refs.slice(i, i + 400).forEach((ref) => batch.set(ref, patch, { merge: true }));
      await batch.commit();
      affected += Math.min(400, refs.length - i);
    }

    return res.status(200).json({ affected });
  } catch (err) {
    console.error("crmArchiveDeals error:", err);
    const code = err.code === "AUTH_MISSING" || err.code === "AUTH_INVALID" ? 401 : err.code === "AUTH_DOMAIN" ? 403 : 500;
    return res.status(code).json({ error: err.message || "Internal server error" });
  }
}

module.exports = { crmImportLeadsHandler, crmArchiveDealsHandler, DEFAULT_ENTITY_ID };
