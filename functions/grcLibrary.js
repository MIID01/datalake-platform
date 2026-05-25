/**
 * GRC Document Library — Cloud Functions
 * Implements strict compliance auditing, WORM GCS tracking, and classification-based access.
 */

const admin = require("firebase-admin");
const { v4: uuidv4 } = require("uuid");
const { BigQuery } = require("@google-cloud/bigquery");
const { PubSub } = require("@google-cloud/pubsub");
const pubsub = new PubSub();

const db = admin.firestore();
const bigquery = new BigQuery();
const BUCKET_NAME = "datalake-grc-library";

// Regex updated per correction 1
const docIdRegex = /^DTLK-(POL|PROC|PRO|FORM|FOR|REG|TBL|PLN|INS|ARCH|MAP|RPT|WI|OPS|UI|PR)-(GRC|COM|RSK|HRM|OUT|DBM|PRI|BCM|SEC|FIN|LEG|OPS|SYS|DSN|CEO|ENG|PLAT|TLP|TSK)-\d{3}[A-Z]?$/;

// Matrix updated per correction 3
const ACCESS_MATRIX = {
  Public:       { ceo: true, cto: true, compliance_lead: true, hr: true, engineer: true, client: true },
  Internal:     { ceo: true, cto: true, compliance_lead: true, hr: true, engineer: true, client: false },
  Confidential: { ceo: true, cto: true, compliance_lead: true, hr: "HRM_ONLY", engineer: false, client: false },
  Restricted:   { ceo: true, cto: false, compliance_lead: true, hr: false, engineer: false, client: false }
};

function canAccess(role, classification, domain) {
  const allowed = ACCESS_MATRIX[classification]?.[role];
  if (allowed === true) return true;
  if (allowed === false || allowed === undefined) return false;
  if (allowed === "HRM_ONLY") return domain === "HRM";
  return false;
}

async function auditLog(req, profile, eventType, resourceId, details) {
  const eventId = uuidv4();
  const timestamp = admin.firestore.FieldValue.serverTimestamp();
  
  // 1. Write to BigQuery (datalake_audit.system_events)
  try {
    await bigquery.dataset("datalake_audit").table("system_events").insert({
      event_id: eventId,
      timestamp: bigquery.timestamp(new Date()),
      event_type: eventType,
      actor_email: profile.email,
      actor_uid: profile.uid,
      resource_id: resourceId,
      action_details: JSON.stringify(details),
      ip_address: req.ip || req.headers["x-forwarded-for"] || "unknown",
    });
  } catch (e) {
    console.error("BigQuery Audit Failed", e);
  }
}

async function writeChangeLog(t, data) {
  const logRef = db.collection("grc_change_log").doc();
  t.set(logRef, {
    log_id: logRef.id,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    ...data
  });
}

// ═══════════════════════════════════════════════════════════════════
// 1. uploadGrcDocument
// ═══════════════════════════════════════════════════════════════════
async function uploadGrcDocumentHandler(req, res, { verifyAuth, getUserAccessProfile, ALLOWED_ORIGINS }) {
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Origin", ALLOWED_ORIGINS.includes(req.headers.origin) ? req.headers.origin : "");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return res.status(204).send("");
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const decoded = await verifyAuth(req);
    const profile = await getUserAccessProfile(decoded.uid);
    if (!["ceo", "compliance_lead"].includes(profile.role_id)) {
      return res.status(403).json({ error: "Unauthorized. Requires ceo or compliance_lead." });
    }

    const { doc_id, doc_title, update_type, classification, owner, approver, effective_date, next_review_date, supersedes, related_documents, regulatory_basis, framework_tags, change_summary, file_format, file_base64 } = req.body;
    
    if (!doc_id || !doc_title || !file_base64 || !file_format) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    if (!docIdRegex.test(doc_id)) {
      return res.status(400).json({ error: "Invalid doc_id format." });
    }

    const parts = doc_id.split("-");
    const docType = parts[1];
    const domain = parts[2];
    
    // GCS Upload
    const fileBuffer = Buffer.from(file_base64, "base64");
    const fileSizeBytes = fileBuffer.length;

    let newVersion = "1.0";
    let previousVersion = null;
    let oldGcsPath = null;
    let actionType = "CREATED";

    await db.runTransaction(async (t) => {
      const activeQuery = await t.get(db.collection("grc_documents").where("doc_id", "==", doc_id).where("status", "==", "ACTIVE"));
      
      if (!activeQuery.empty) {
        actionType = "UPDATED";
        if (!change_summary) throw new Error("change_summary is required when updating an existing document.");
        if (!update_type || !["major", "minor"].includes(update_type)) throw new Error("update_type (major/minor) is required for updates.");
        
        const oldDoc = activeQuery.docs[0];
        const oldData = oldDoc.data();
        previousVersion = oldData.version;
        oldGcsPath = oldData.gcs_path;

        t.update(oldDoc.ref, { status: "SUPERSEDED" });
        
        // Version bump logic per Correction 2
        if (update_type === "major") {
          newVersion = (Math.floor(parseFloat(previousVersion)) + 1).toFixed(1);
        } else {
          const [maj, min] = String(previousVersion).split(".").map(Number);
          newVersion = `${maj}.${min + 1}`;
        }
      }

      const gcsPath = `${domain}/${doc_id}/${newVersion}/${doc_id}_v${newVersion}.${file_format}`;
      
      // We must write the file to GCS inside the transaction execution logic block
      // In practice, GCS uploads aren't transactional, so if transaction retries, it might upload twice, which is fine (overwrite).
      const bucket = admin.storage().bucket(BUCKET_NAME);
      const file = bucket.file(gcsPath);
      await file.save(fileBuffer, { metadata: { contentType: file_format === 'pdf' ? 'application/pdf' : 'application/octet-stream' }});

      const newRef = db.collection("grc_documents").doc();
      const docPayload = {
        doc_id, doc_title, doc_type: docType, domain, version: newVersion,
        classification, owner, approver, effective_date, next_review_date: next_review_date || null,
        supersedes: supersedes || null, related_documents: related_documents || [],
        regulatory_basis: regulatory_basis || "", framework_tags: framework_tags || [],
        gcs_path: gcsPath, file_format, file_size_bytes: fileSizeBytes,
        uploaded_by: profile.email, uploaded_at: admin.firestore.FieldValue.serverTimestamp(),
        status: "ACTIVE", change_summary: change_summary || "Initial upload"
      };

      t.set(newRef, docPayload);

      writeChangeLog(t, {
        doc_id, doc_title, action_type: actionType,
        actor_uid: profile.uid, actor_email: profile.email, actor_role: profile.role_id,
        previous_version: previousVersion, new_version: newVersion, change_summary: docPayload.change_summary,
        gcs_path_old: oldGcsPath, gcs_path_new: gcsPath, regulatory_basis: docPayload.regulatory_basis,
        ip_address: req.ip || req.headers["x-forwarded-for"] || "unknown"
      });
      
      // BigQuery Audit
      auditLog(req, profile, "GRC_DOCUMENT_" + actionType, doc_id, { version: newVersion, file_format, classification });
    });

    // PUBLISH PUB/SUB EVENT
    await pubsub.topic("datalake.grc.uploaded").publishMessage({ json: { document_id: doc_id } });

    return res.status(200).json({ success: true, doc_id, version: newVersion });
  } catch (err) {
    console.error(err);
    return res.status(err.message.includes("Unauthorized") ? 403 : 500).json({ error: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════
// 2. listGrcDocuments
// ═══════════════════════════════════════════════════════════════════
async function listGrcDocumentsHandler(req, res, { verifyAuth, getUserAccessProfile, ALLOWED_ORIGINS }) {
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Origin", ALLOWED_ORIGINS.includes(req.headers.origin) ? req.headers.origin : "");
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return res.status(204).send("");
  }
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const decoded = await verifyAuth(req);
    const profile = await getUserAccessProfile(decoded.uid);

    let query = db.collection("grc_documents").where("status", "==", "ACTIVE");
    const snap = await query.get();
    
    let docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Apply access matrix filtering
    docs = docs.filter(doc => canAccess(profile.role_id, doc.classification, doc.domain));

    auditLog(req, profile, "GRC_LIBRARY_BROWSED", "ALL", { result_count: docs.length });

    return res.status(200).json({ success: true, documents: docs });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════
// 3. downloadGrcDocument
// ═══════════════════════════════════════════════════════════════════
async function downloadGrcDocumentHandler(req, res, { verifyAuth, getUserAccessProfile, ALLOWED_ORIGINS }) {
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Origin", ALLOWED_ORIGINS.includes(req.headers.origin) ? req.headers.origin : "");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return res.status(204).send("");
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const decoded = await verifyAuth(req);
    const profile = await getUserAccessProfile(decoded.uid);
    const { doc_id, version } = req.body;

    if (!doc_id) return res.status(400).json({ error: "doc_id required" });

    let query = db.collection("grc_documents").where("doc_id", "==", doc_id);
    if (version) query = query.where("version", "==", version);
    else query = query.where("status", "==", "ACTIVE");

    const snap = await query.get();
    if (snap.empty) return res.status(404).json({ error: "Document not found" });

    const doc = snap.docs[0].data();

    if (!canAccess(profile.role_id, doc.classification, doc.domain)) {
      return res.status(403).json({ error: `Unauthorized. ${profile.role_id} cannot access ${doc.classification} in ${doc.domain}.` });
    }

    const bucket = admin.storage().bucket(BUCKET_NAME);
    const file = bucket.file(doc.gcs_path);
    
    const [url] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + 60 * 60 * 1000, // 60 minutes
    });

    await db.collection("grc_change_log").add({
      log_id: uuidv4(), timestamp: admin.firestore.FieldValue.serverTimestamp(),
      doc_id, doc_title: doc.doc_title, action_type: "DOWNLOADED",
      actor_uid: profile.uid, actor_email: profile.email, actor_role: profile.role_id,
      previous_version: doc.version, new_version: doc.version, change_summary: "File downloaded",
      gcs_path_old: doc.gcs_path, gcs_path_new: doc.gcs_path, ip_address: req.ip || "unknown"
    });

    auditLog(req, profile, "GRC_DOCUMENT_DOWNLOADED", doc_id, { version: doc.version });

    return res.status(200).json({ success: true, signed_url: url, doc_title: doc.doc_title, version: doc.version, file_format: doc.file_format });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════
// 4. getGrcChangeLog & 5. exportGrcChangeLog
// ═══════════════════════════════════════════════════════════════════
async function getGrcChangeLogHandler(req, res, { verifyAuth, getUserAccessProfile, ALLOWED_ORIGINS }) {
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Origin", ALLOWED_ORIGINS.includes(req.headers.origin) ? req.headers.origin : "");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return res.status(204).send("");
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const decoded = await verifyAuth(req);
    const profile = await getUserAccessProfile(decoded.uid);
    if (!["ceo", "compliance_lead"].includes(profile.role_id)) return res.status(403).json({ error: "Unauthorized" });

    const snap = await db.collection("grc_change_log").orderBy("timestamp", "desc").limit(200).get();
    const logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    auditLog(req, profile, "CHANGE_LOG_VIEWED", "ALL", { count: logs.length });

    return res.status(200).json({ success: true, logs });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}

module.exports = {
  uploadGrcDocumentHandler,
  listGrcDocumentsHandler,
  downloadGrcDocumentHandler,
  getGrcChangeLogHandler
};
