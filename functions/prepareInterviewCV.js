/**
 * prepareInterviewCV — Cloud Function (onRequest)
 *
 * Pulls a candidate's raw CV from GCS, sends it to the cv-agent
 * microservice for reformatting into the Datalake Skills Portfolio
 * template, stores the output DOCX in the WORM bucket, and updates
 * the talent_pool document with interview preparation metadata.
 *
 * Auth: role must be "hr" or "ceo"
 * PDPL: blocks PURGED candidates and those without consent
 *
 * DTLK-FORM-HR-CV-002-v2
 */

// [CV_AGENT integration enabled]
const fetch = require("node-fetch");
//   event_type STRING, actor STRING, candidate_id STRING, project_id STRING,
//   pdpl_consent_verified BOOL, regulatory_basis STRING, timestamp TIMESTAMP,
//   details JSON]

const admin = require("firebase-admin");
const FormData = require("form-data");
const { httpErrorStatus } = require("./lib/httpErrors");

const db = admin.firestore();
const cvBucket = admin.storage().bucket("datalake-cv-uploads");
const wormBucket = admin.storage().bucket("datalake-worm-hr");

/**
 * Handler for prepareInterviewCV onRequest function.
 * Called from index.js — receives (req, res) plus helpers via closure.
 */
async function handler(req, res, { verifyAuth, getUserAccessProfile, ALLOWED_ORIGINS }) {
  // CORS preflight and response headers
  res.set("Access-Control-Allow-Origin", "https://datalake-production-sa.web.app");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.set("Access-Control-Max-Age", "3600");
    return res.status(204).send("");
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // ── 1. Auth: verify token + role ──
    const decoded = await verifyAuth(req);
    const profile = await getUserAccessProfile(decoded.uid);
    if (!["hr", "ceo"].includes(profile.role_id)) {
      return res.status(403).json({ error: "Forbidden: requires HR or CEO role" });
    }

    const { candidate_id, project_id, jd_text } = req.body;
    if (!candidate_id || !project_id) {
      return res.status(400).json({ error: "candidate_id and project_id are required" });
    }

    // ── 2. Load candidate from talent_pool ──
    const candidateDoc = await db.collection("talent_pool").doc(candidate_id).get();
    if (!candidateDoc.exists) {
      return res.status(404).json({ error: "Candidate not found" });
    }
    const candidate = candidateDoc.data();

    // ── 3. PDPL gate — non-negotiable ──
    if (candidate.state === "PURGED") {
      return res.status(403).json({
        error: "Candidate data has been purged per PDPL retention policy. Cannot prepare CV.",
      });
    }
    if (!candidate.consent_granted_at) {
      return res.status(403).json({
        error: "Candidate has not granted PDPL consent. Cannot process personal data.",
      });
    }
    if (!candidate.cv_path) {
      return res.status(400).json({
        error: "No CV file on record for this candidate. cv_path is missing.",
      });
    }

    // ── 4. Load project ──
    const projectDoc = await db.collection("projects").doc(project_id).get();
    if (!projectDoc.exists) {
      return res.status(404).json({ error: "Project not found" });
    }
    const project = projectDoc.data();

    // ── 5. Download raw CV from GCS ──
    const cvFile = cvBucket.file(candidate.cv_path);
    const [cvExists] = await cvFile.exists();
    if (!cvExists) {
      return res.status(404).json({
        error: `CV file not found in storage at path: ${candidate.cv_path}`,
      });
    }
    const [cvBuffer] = await cvFile.download();

    // Determine original filename from cv_path
    const cvPathParts = candidate.cv_path.split("/");
    const originalFilename = cvPathParts[cvPathParts.length - 1];

    // ── 6. Build JD text ──
    const jdContent = jd_text && jd_text.trim()
      ? jd_text.trim()
      : buildDefaultJD(project, candidate);

    // ── 7. Call cv-agent microservice ──
    const cvAgentUrl = process.env.CV_AGENT_URL || "https://datalake-cv-agent-808056940626.me-central2.run.app";
    
    const form = new FormData();
    form.append("cv_file", cvBuffer, { filename: originalFilename || "cv.pdf", contentType: "application/pdf" });
    if (jdContent) {
      form.append("jd_file", Buffer.from(jdContent, "utf-8"), { filename: "jd.txt", contentType: "text/plain" });
    }

    const agentRes = await fetch(`${cvAgentUrl}/reformat`, {
      method: "POST",
      body: form,
      headers: form.getHeaders(),
    });

    if (!agentRes.ok) {
      const errText = await agentRes.text();
      throw new Error(`cv-agent failed with status ${agentRes.status}: ${errText}`);
    }

    const outputBuffer = await agentRes.buffer();

    // ── 11. Store output in WORM bucket ──
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeName = (candidate.full_name).replace(/[^a-zA-Z0-9\s]/g, "").replace(/\s+/g, "_");
    const wormPath = `interview-cvs/${project_id}/${candidate_id}/${timestamp}_DTLK-FORM-HR-CV-002_${safeName}.docx`;

    const wormFile = wormBucket.file(wormPath);
    await wormFile.save(outputBuffer, {
      metadata: {
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        metadata: {
          candidate_id,
          project_id,
          prepared_by: profile.email,
          regulatory_basis: "PDPL Art. 4, 5; NCA ECC-1:2018",
        },
      },
    });

    // ── 12. Update talent_pool doc ──
    const now = admin.firestore.FieldValue.serverTimestamp();
    await db.collection("talent_pool").doc(candidate_id).update({
      portfolio_generated: true,
      portfolio_path: wormPath,
      portfolio_generated_at: now,
      internal_assessment: {
        fit_score: null,
        red_flags: [],
        interview_questions: []
      },
      // Keep old fields for backward compatibility
      interview_cv_path: wormPath,
      interview_cv_bucket: "datalake-worm-hr",
      interview_cv_prepared_at: now,
      interview_cv_prepared_by: profile.email,
      interview_cv_project_id: project_id,
      interview_cv_format: "docx",
    });

    // ── 13. BigQuery audit ──
    await writeBigQueryAudit({
      event_type: "INTERVIEW_CV_PREPARED",
      actor: profile.email,
      candidate_id,
      project_id,
      pdpl_consent_verified: true,
      regulatory_basis: "PDPL Art. 4, 5; NCA ECC-1:2018",
    });

    // ── 11. Generate signed URL (60 min) ──
    const [signedUrl] = await wormFile.getSignedUrl({
      action: "read",
      expires: Date.now() + 60 * 60 * 1000,
    });

    // ── 15. Audit log (Firestore — consistent with rest of codebase) ──
    await db.collection("task_audit_log").add({
      event: "INTERVIEW_CV_PREPARED",
      action_by: profile.email,
      action_at: now,
      details: {
        candidate_id,
        candidate_name: candidate.full_name,
        project_id,
        project_name: project.project_name,
        client_name: project.client_name,
        worm_path: wormPath,
        format: "docx",
      },
      ip_address: req.ip || req.headers["x-forwarded-for"] || "unknown",
    });

    return res.status(200).json({
      success: true,
      signed_url: signedUrl,
      worm_path: wormPath,
      format: "docx",
      candidate_name: candidate.full_name,
      client_approver_email: project.client_approver_email || null,
      client_approver_name: project.client_approver_name || null,
    });
  } catch (err) {
    console.error("prepareInterviewCV error:", err);
    // AUTH_MISSING/AUTH_INVALID → 401, "Forbidden" → 403, validation → 400, else 500.
    return res.status(httpErrorStatus(err)).json({ error: err.message });
  }
}

/**
 * Build a default JD from project + candidate context.
 */
function buildDefaultJD(project, candidate) {
  return [
    `Position: ${candidate.role_interest || "Engineering Consultant"}`,
    `Client: ${project.client_name}`,
    `Project: ${project.project_name}`,
    `Work Location: ${project.work_location_type || "On-site"} ${project.work_location_address ? "— " + project.work_location_address : ""}`,
    `Rate Structure: ${project.rate_structure || "Monthly"}`,
    ``,
    `Requirements:`,
    `- Relevant experience in ${candidate.role_interest || "software engineering"}`,
    `- Strong communication skills (English and Arabic preferred)`,
    `- KSA work authorization required`,
    candidate.skills && candidate.skills.length > 0
      ? `- Key skills: ${candidate.skills.join(", ")}`
      : "",
    ``,
    `This is an outsourcing engagement managed by Datalake Saudi Arabia LLC.`,
    `The candidate will be deployed to ${project.client_name} under project ${project.project_name}.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Write audit event to BigQuery.
 * Fails silently — audit should not block the main flow.
 */
async function writeBigQueryAudit(eventData) {
  // [TODO: provision BigQuery dataset datalake_audit and table system_events in me-central2]
  try {
    const { BigQuery } = require("@google-cloud/bigquery");
    const bq = new BigQuery({ projectId: "datalake-production-sa", location: "me-central2" });
    await bq.dataset("datalake_audit").table("system_events").insert([
      {
        ...eventData,
        timestamp: new Date().toISOString(),
      },
    ]);
  } catch (err) {
    console.warn("BigQuery audit write failed (non-blocking):", err.message);
  }
}

module.exports = { handler, writeBigQueryAudit };
