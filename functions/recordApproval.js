// functions/recordApproval.js — universal SERVER-SIDE approval/sign recorder.
//
// Replaces the client-side src/lib/approval-evidence.js write path for every
// <ApprovalButton>. A signature/approval is a legal evidence event, so it must
// be produced on the Admin SDK — the client may NEVER write its own
// signed/approved status or evidence row (firestore.rules deny those).
//
// What this function does, atomically, per approval:
//   1. Authenticate — Firebase ID token + role (payroll/SAMA), OR a one-time
//      review-token verified against the parent doc (contracts external counsel).
//   2. Snapshot the parent BEFORE state → before_sha256.
//   3. Persist the signature PNG (display copy, default bucket) and write the
//      immutable signed records to WORM (datalake-worm-hr): the uploaded
//      document (if any) AND a signed-manifest JSON (the legal record).
//   4. Write the immutable approval_evidence row (Admin SDK) + flip the parent
//      status per a per-collection POLICY (server-validated transition only).
//   5. Compute after_sha256 and write an append-only BigQuery audit row
//      (datalake_audit.approval_audit) with before/after hashes + actor/role.
//
// Returns the evidence record (same shape the client used) so SignedBadge keeps
// rendering unchanged.

const admin = require("firebase-admin");
const crypto = require("crypto");
const { logToBigQuery } = require("./lib/bigquery");

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const WORM_BUCKET = "datalake-worm-hr";

const sha256 = (x) => crypto.createHash("sha256").update(typeof x === "string" ? x : JSON.stringify(x)).digest("hex");
const sha256Buf = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
// Canonical hash of a Firestore doc: stable-key JSON, Timestamps → ISO.
function canonical(obj) {
  const norm = (v) => {
    if (v && typeof v.toDate === "function") return v.toDate().toISOString();
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object") return Object.keys(v).sort().reduce((a, k) => { a[k] = norm(v[k]); return a; }, {});
    return v;
  };
  return JSON.stringify(norm(obj));
}

// ── Per-collection approval POLICY ──────────────────────────────────────────
// Each entry defines who may approve, the precondition, and the EXACT status
// transition (server-validated — the client cannot set arbitrary fields).
const POLICIES = {
  // Contract legal sign-off (LegalReview). External counsel via one-time token,
  // OR an authenticated ceo/legal user. Mirrors the old client decide('approve').
  contracts: {
    roles: ["ceo", "legal"],
    tokenFlow: true,
    tokenField: "legal_review_token",
    tokenRole: "legal:external",
    requiresDocument: false,
    precondition: (d) => d.legal_status !== "LEGAL_APPROVED" && d.status !== "ACTIVE",
    applyStatus: ({ identity, extra, nowIso, now }) => ({
      legal_status: "LEGAL_APPROVED",
      status: "ACTIVE",
      legal_review_token: null,
      legal_decision_at: now,
      legal_decision_action: "approved",
      legal_decision_comment: (extra && extra.comment) || null,
      status_history: FieldValue.arrayUnion({ status: "LEGAL_APPROVED", at: nowIso, by: identity.email || identity.name, notes: "Approved via server-recorded signature" }),
      updated_at: now,
    }),
    // Rejection needs no signature/WORM — just flag the contract, record the
    // reason, and burn the token so HR can correct it and re-issue.
    rejectStatus: ({ identity, extra, now, nowIso }) => ({
      legal_status: "LEGAL_REJECTED",
      status: "LEGAL_REJECTED",
      legal_review_token: null,
      legal_decision_at: now,
      legal_decision_action: "rejected",
      legal_decision_comment: (extra && extra.comment) || null,
      status_history: FieldValue.arrayUnion({ status: "LEGAL_REJECTED", at: nowIso, by: identity.email || identity.name || "legal:external", notes: (extra && extra.comment) || "Flagged by external counsel" }),
      updated_at: now,
    }),
  },
  // Payroll run approval — TWO-STAGE segregation of duties:
  //   HR prepares the DRAFT → FINANCE approves (DRAFT → FINANCE_APPROVED) →
  //   CEO gives final approval (FINANCE_APPROVED → APPROVED). Each stage is a
  //   distinct signer. Only final CEO approval requires the payroll-register
  //   document; the Finance stage is signature-only.
  payroll_runs: {
    roles: ["ceo", "finance"],
    tokenFlow: false,
    requiresDocument: (d) => d.status === "FINANCE_APPROVED",
    precondition: (d) => d.status === "DRAFT" || d.status === "FINANCE_APPROVED",
    validate: ({ before, identity }) => {
      if (before.status === "DRAFT" && identity.role !== "finance") {
        return "Finance must approve this payroll run first (DRAFT → Finance approval).";
      }
      if (before.status === "FINANCE_APPROVED" && identity.role !== "ceo") {
        return "Only the CEO can give final payroll approval.";
      }
      return null;
    },
    applyStatus: ({ before, identity, evidenceId, evidenceSha, now }) => {
      if (before.status === "DRAFT") {
        return {
          status: "FINANCE_APPROVED",
          finance_approved_at: now,
          finance_approved_by: identity.email,
          finance_approval_evidence_id: evidenceId,
          updated_at: now,
        };
      }
      return {
        status: "APPROVED",
        approved_at: now,
        approved_by: identity.email,
        approval_evidence_id: evidenceId,
        approval_evidence_sha256: evidenceSha || null,
        updated_at: now,
      };
    },
  },
  // SAMA materiality sign-off on an engagement.
  projects: {
    roles: ["ceo", "cto"],
    tokenFlow: false,
    requiresDocument: false,
    precondition: () => true,
    applyStatus: ({ identity, now }) => ({
      "sama_materiality.assessed_at": now,
      "sama_materiality.assessed_by": identity.email,
      "sama_materiality.assessment_signed": true,
      updated_at: now,
    }),
  },
};

function setCors(req, res, ALLOWED_ORIGINS) {
  res.set("Access-Control-Allow-Origin", ALLOWED_ORIGINS && ALLOWED_ORIGINS.includes(req.headers.origin) ? req.headers.origin : "");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// Upload a buffer to the WORM bucket (immutable; bucket retention/lock enforces it).
async function putWorm(path, buf, contentType, meta) {
  const file = admin.storage().bucket(WORM_BUCKET).file(path);
  await file.save(buf, { contentType, resumable: false, metadata: { cacheControl: "private, max-age=0", metadata: meta || {} } });
  return `gs://${WORM_BUCKET}/${path}`;
}

// Upload the signature PNG to the DEFAULT bucket for display, with a Firebase
// download token so SignedBadge's signature_url keeps working.
async function putDisplaySignature(path, buf) {
  const token = crypto.randomUUID();
  const file = admin.storage().bucket().file(path);
  await file.save(buf, { contentType: "image/png", resumable: false, metadata: { metadata: { firebaseStorageDownloadTokens: token } } });
  const bucketName = admin.storage().bucket().name;
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
  return { url, storage_path: `gs://${bucketName}/${path}` };
}

async function recordApprovalHandler(req, res, { verifyAuth, getUserAccessProfile, ALLOWED_ORIGINS }) {
  setCors(req, res, ALLOWED_ORIGINS);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const {
      parentCollection, parentId,
      signature, document = null,
      label = "Approve", action = "approved", extra = null,
      token = null,
    } = req.body || {};

    if (!parentCollection || !parentId) return res.status(400).json({ error: "parentCollection and parentId required" });
    const policy = POLICIES[parentCollection];
    if (!policy) return res.status(400).json({ error: `Collection '${parentCollection}' is not approvable via recordApproval` });
    // A rejection records a decision + reason — no signature or document required.
    const isReject = action === "reject" || action === "rejected";
    if (!isReject && (!signature || !signature.base64 || !signature.method)) {
      return res.status(400).json({ error: "signature {base64, method} required" });
    }

    const parentRef = db.collection(parentCollection).doc(String(parentId));
    const snap = await parentRef.get();
    if (!snap.exists) return res.status(404).json({ error: "Parent document not found" });
    const before = snap.data();

    // requiresDocument may be a boolean or a function of the current state
    // (e.g. payroll: only the final CEO stage needs the register document).
    const requiresDoc = typeof policy.requiresDocument === "function"
      ? policy.requiresDocument(before)
      : policy.requiresDocument;
    if (!isReject && requiresDoc && (!document || !document.base64)) {
      return res.status(400).json({ error: "This approval requires a document upload" });
    }

    // ── AuthN: token flow (contracts) OR Firebase Auth (+ role) ──
    let identity, authMethod, actorUid = null;
    if (token && policy.tokenFlow) {
      if (!before[policy.tokenField] || before[policy.tokenField] !== token) {
        return res.status(403).json({ error: "Invalid or already-consumed review token" });
      }
      // Attribute to the REAL signer — never a fabricated "legal@external". Use the
      // reviewer email captured when the review link was issued (if HR recorded one)
      // + the typed signature name; we do NOT invent an email or a person.
      identity = {
        email: (before.legal_reviewer_email || "").toString().trim() || null,
        name: (signature.typedName || before.legal_reviewer_name || "External legal reviewer").toString().trim(),
        role: policy.tokenRole || "legal:external",
      };
      authMethod = "review_token";
    } else {
      const decoded = await verifyAuth(req);
      let profile;
      try { profile = await getUserAccessProfile(decoded.uid); }
      catch (e) { return res.status(403).json({ error: e.message || "No active access profile" }); }
      if (!policy.roles.includes(profile.role_id)) {
        return res.status(403).json({ error: `Role '${profile.role_id}' may not approve ${parentCollection} (need: ${policy.roles.join("/")})` });
      }
      identity = { uid: decoded.uid, email: profile.email || decoded.email, name: profile.display_name || profile.email, role: profile.role_id };
      actorUid = decoded.uid;
      authMethod = "firebase_id_token";
    }

    // ── State precondition ──
    if (!policy.precondition(before)) {
      return res.status(409).json({ error: `Parent ${parentCollection}/${parentId} is not in an approvable state.` });
    }

    // ── Stage gate (e.g. payroll: Finance approves DRAFT, CEO approves the
    //    Finance-approved run). Enforces who may act at the current state. ──
    if (policy.validate) {
      const vErr = policy.validate({ before, identity });
      if (vErr) return res.status(403).json({ error: vErr });
    }

    // ── Rejection path: no signature/WORM — flag the parent, record the reason,
    //    burn the token, audit. Mirrors the old client decide('reject') but
    //    server-side (the client can no longer write contract status). ──
    if (isReject) {
      if (!policy.rejectStatus) return res.status(400).json({ error: `${parentCollection} does not support rejection` });
      const nowR = FieldValue.serverTimestamp();
      const nowIsoR = new Date().toISOString();
      await parentRef.set(policy.rejectStatus({ identity, extra, now: nowR, nowIso: nowIsoR }), { merge: true });
      await db.collection("legal_review_log").add({
        contract_id: String(parentId), action: "rejected",
        comment: (extra && extra.comment) || null,
        reviewer_email: identity.email || null, reviewer_name: identity.name || null,
        at: nowR,
      });
      const rejAudit = {
        event: "LEGAL_REJECTED", action: "rejected",
        parent_collection: parentCollection, parent_id: String(parentId),
        actor: identity.email || identity.name || null, actor_uid: actorUid, role: identity.role || null, auth_method: authMethod,
        evidence_id: null, before_sha256: null, after_sha256: null,
        signature_sha256: null, document_sha256: null,
        worm_manifest_path: null, worm_document_path: null,
        approved_at_iso: nowIsoR,
      };
      await logToBigQuery("datalake_audit", "approval_audit", rejAudit).catch((e) => console.error("BQ reject audit:", e.message));
      await db.collection("task_audit_log").add({ ...rejAudit, action_at: nowR });
      return res.status(200).json({ rejected: true, parent_id: String(parentId) });
    }

    const now = FieldValue.serverTimestamp();
    const nowIso = new Date().toISOString();
    const ts = Date.now();
    const before_sha256 = sha256(canonical(before));

    // ── Signature PNG → display (default bucket) ──
    const sigBuf = Buffer.from(signature.base64.replace(/^data:[^,]+,/, ""), "base64");
    const sigSha = sha256Buf(sigBuf);
    const sigDisplay = await putDisplaySignature(`approval-evidence/${parentCollection}/${parentId}/${ts}_signature.png`, sigBuf);

    // ── Document (if any) → WORM ──
    let evidence_url = null, evidence_filename = null, evidence_size_bytes = null, evidence_mime_type = null, evidence_sha256 = null, evidence_worm_path = null;
    if (requiresDoc && document) {
      const docBuf = Buffer.from(document.base64.replace(/^data:[^,]+,/, ""), "base64");
      evidence_sha256 = sha256Buf(docBuf);
      evidence_filename = document.filename || `${parentCollection}_${parentId}.pdf`;
      evidence_size_bytes = docBuf.length;
      evidence_mime_type = document.mimeType || "application/pdf";
      evidence_worm_path = await putWorm(`approval-evidence/${parentCollection}/${parentId}/${ts}_${evidence_filename}`, docBuf, evidence_mime_type, { parent_collection: parentCollection, parent_id: String(parentId), sha256: evidence_sha256, approver_email: identity.email });
      evidence_url = evidence_worm_path; // authoritative copy lives in WORM
    }

    // Pre-allocate the evidence doc id so the parent status can reference it.
    const evidenceRef = parentRef.collection("approval_evidence").doc();
    const evidenceId = evidenceRef.id;

    // PDPL data-minimisation (CEO-mandated): IP address and user-agent are
    // deliberately NOT captured on approval/GRC evidence. The evidence is the
    // approver identity + signature + timestamp + before/after SHA-256 — no
    // network/device metadata.

    // ── Signed manifest → WORM (the immutable legal record of THIS signing) ──
    const manifest = {
      parent_collection: parentCollection, parent_id: String(parentId),
      action, label,
      approver: identity, auth_method: authMethod,
      approved_at_iso: nowIso,
      signature: { method: signature.method, sha256: sigSha, storage_path: sigDisplay.storage_path, typed_name: signature.typedName || null },
      document: evidence_worm_path ? { filename: evidence_filename, sha256: evidence_sha256, worm_path: evidence_worm_path } : null,
      before_sha256,
      extra: extra || {},
      evidence_id: evidenceId,
    };
    const manifestBuf = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
    const manifest_sha256 = sha256Buf(manifestBuf);
    const manifest_worm_path = await putWorm(`approval-evidence/${parentCollection}/${parentId}/${ts}_signed-manifest.json`, manifestBuf, "application/json", { parent_collection: parentCollection, parent_id: String(parentId), sha256: manifest_sha256 });

    // ── Evidence row (Admin SDK; client is denied by firestore.rules) ──
    const evidenceRow = {
      approver_uid: actorUid, approver_email: identity.email || null, approver_name: identity.name || null, approver_role: identity.role || null,
      approved_at: now, approved_at_iso: nowIso,
      auth_method: authMethod,
      signature_url: sigDisplay.url, signature_storage_path: sigDisplay.storage_path, signature_method: signature.method, signature_size_bytes: sigBuf.length, signature_sha256: sigSha, signature_typed_name: signature.typedName || null,
      evidence_url, evidence_filename, evidence_size_bytes, evidence_mime_type, evidence_sha256, evidence_storage_path: evidence_worm_path,
      worm_manifest_path: manifest_worm_path, worm_manifest_sha256: manifest_sha256,
      requires_document: !!requiresDoc, label, action,
      parent_collection: parentCollection, parent_id: String(parentId),
      before_sha256,
      ...(extra || {}),
    };

    // ── Atomic: write evidence + flip parent status ──
    const statusUpdate = policy.applyStatus({ before, identity, extra, evidenceId, evidenceSha: evidence_sha256, now, nowIso });
    const batch = db.batch();
    batch.set(evidenceRef, evidenceRow);
    batch.set(parentRef, statusUpdate, { merge: true });
    await batch.commit();

    // after-state hash (best-effort recompute from the merge)
    const afterSnap = await parentRef.get();
    const after_sha256 = sha256(canonical(afterSnap.data()));

    // ── Append-only BigQuery audit (+ task_audit_log) with before/after hash ──
    const auditRow = {
      event: "APPROVAL_RECORDED", action,
      parent_collection: parentCollection, parent_id: String(parentId),
      actor: identity.email || null, actor_uid: actorUid, role: identity.role || null, auth_method: authMethod,
      evidence_id: evidenceId,
      before_sha256, after_sha256,
      signature_sha256: sigSha, document_sha256: evidence_sha256 || null,
      worm_manifest_path: manifest_worm_path, worm_document_path: evidence_worm_path,
      approved_at_iso: nowIso,
    };
    await logToBigQuery("datalake_audit", "approval_audit", auditRow);
    await db.collection("task_audit_log").add({ ...auditRow, action_at: now });

    return res.status(200).json({ id: evidenceId, ...evidenceRow, after_sha256 });
  } catch (err) {
    console.error("recordApproval error:", err);
    const code = err.code === "AUTH_MISSING" || err.code === "AUTH_INVALID" ? 401 : err.code === "AUTH_DOMAIN" ? 403 : 500;
    return res.status(code).json({ error: err.message || "Internal server error" });
  }
}

module.exports = { recordApprovalHandler, APPROVAL_COLLECTIONS: Object.keys(POLICIES) };
