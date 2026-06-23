// Contract recovery from the WORM archive.
//
// When a contract's Firestore row is deleted, the signed PDF still lives in the
// WORM bucket (datalake-worm-hr, retained for compliance). These handlers let
// the CEO find PDFs that no live contract references ("orphans" — typically left
// by a hard delete) and rebuild a contract record from one. Soft-deleted
// contracts are recovered from the Recycle Bin instead; this is the fallback for
// records that predate soft-delete.

const admin = require("firebase-admin");
const { PubSub } = require("@google-cloud/pubsub");
const pubsub = new PubSub();
const db = admin.firestore();

const WORM_BUCKET = "datalake-worm-hr";
const CONTRACT_PREFIX = "contracts/";

const stripGs = (p) => String(p).replace(/^gs:\/\/[^/]+\//, "");

// GET/POST — list WORM contract PDFs that no contract doc references.
async function listOrphanedContractPdfsHandler(req, res, { verifyAuth, getUserAccessProfile }) {
  try {
    const decoded = await verifyAuth(req);
    const profile = await getUserAccessProfile(decoded.uid);
    if (profile.role_id !== "ceo") return res.status(403).json({ error: "CEO role required" });

    // Every storage path referenced by a current contract doc (any state,
    // including soft-deleted — those are recoverable from the Recycle Bin).
    const referenced = new Set();
    const snap = await db.collection("contracts").get();
    snap.forEach((d) => {
      const c = d.data();
      [c.pdf_storage_path, c.contract_pdf_storage_path].forEach((p) => {
        if (p) referenced.add(stripGs(p));
      });
    });

    const bucket = admin.storage().bucket(WORM_BUCKET);
    const [files] = await bucket.getFiles({ prefix: CONTRACT_PREFIX });

    const orphans = files
      .filter((f) => !f.name.endsWith("/"))
      .filter((f) => !referenced.has(f.name))
      .map((f) => ({
        storage_path: f.name,
        filename: f.name.split("/").pop(),
        size_bytes: Number(f.metadata?.size || 0),
        updated: f.metadata?.updated || null,
        employee_id: (f.metadata?.metadata && f.metadata.metadata.employee_id) || null,
        gcs_uri: `gs://${WORM_BUCKET}/${f.name}`,
      }))
      .sort((a, b) => String(b.updated).localeCompare(String(a.updated)));

    return res.status(200).json({ orphans, total_worm: files.length, total_referenced: referenced.size });
  } catch (err) {
    console.error("listOrphanedContractPdfs error:", err);
    return res.status(500).json({ error: err.message });
  }
}

// POST { storage_path, employee_id? } — rebuild a contract record from a WORM PDF
// and re-trigger extraction so its fields repopulate.
async function relinkContractPdfHandler(req, res, { verifyAuth, getUserAccessProfile }) {
  try {
    const decoded = await verifyAuth(req);
    const profile = await getUserAccessProfile(decoded.uid);
    if (profile.role_id !== "ceo") return res.status(403).json({ error: "CEO role required" });

    const { storage_path, employee_id } = req.body || {};
    if (!storage_path) return res.status(400).json({ error: "storage_path required" });
    const path = stripGs(storage_path);

    const bucket = admin.storage().bucket(WORM_BUCKET);
    const file = bucket.file(path);
    const [exists] = await file.exists();
    if (!exists) return res.status(404).json({ error: "PDF not found in WORM bucket" });
    const [meta] = await file.getMetadata();

    // Don't create a duplicate if an active contract already points at it.
    const dup = await db.collection("contracts").where("pdf_storage_path", "==", path).limit(1).get();
    if (!dup.empty) return res.status(409).json({ error: "A contract already references this PDF", contract_id: dup.docs[0].id });

    const now = admin.firestore.FieldValue.serverTimestamp();
    const empId = employee_id || (meta.metadata && meta.metadata.employee_id) || null;
    const ref = await db.collection("contracts").add({
      original_filename: path.split("/").pop(),
      pdf_storage_path: path,
      contract_pdf_storage_path: path,
      size_bytes: Number(meta.size || 0),
      mime_type: meta.contentType || "application/pdf",
      linked_employee_id: empId,
      contract_extraction_status: "PENDING_EXTRACTION",
      status: "PENDING_EXTRACTION",
      recovered_from_worm: true,
      recovered_by: profile.email,
      recovered_at: now,
      uploaded_by: profile.email,
      uploaded_at: now,
      created_at: now,
      updated_at: now,
      status_history: [{
        status: "RECOVERED_FROM_WORM", at: new Date().toISOString(), by: profile.email,
        notes: `Re-linked WORM PDF ${path}`,
      }],
    });

    await db.collection("task_audit_log").add({
      event: "CONTRACT_RECOVERED_FROM_WORM",
      action_by: profile.email,
      action_at: now,
      details: { contract_id: ref.id, storage_path: path, employee_id: empId },
      ip_address: req.ip || req.headers["x-forwarded-for"] || "unknown",
    });

    // Re-run extraction so the recovered contract repopulates its fields.
    try {
      await pubsub.topic("datalake.contract.uploaded").publishMessage({ json: { contract_id: ref.id, employee_id: empId } });
    } catch (e) {
      console.warn("relink: extraction publish skipped:", e.message);
    }

    return res.status(200).json({ success: true, contract_id: ref.id, storage_path: path });
  } catch (err) {
    console.error("relinkContractPdf error:", err);
    return res.status(500).json({ error: err.message });
  }
}

module.exports = { listOrphanedContractPdfsHandler, relinkContractPdfHandler };
