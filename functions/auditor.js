/**
 * Auditor Agent — Datalake AI Capability
 *
 * auditorContractReview     — AI reviews GRC documents for compliance risks
 * auditorComplianceCheck    — Monthly scheduled compliance check (read-only, no mutations)
 *
 * DTLK-PROMPT-AI-001 | Agent: Auditor
 * Rules enforced:
 *   - No external AI APIs. Self-hosted Qwen 2.5 7B only.
 *   - All outputs are DRAFTS pending CEO review.
 *   - EXCEPTION: auditorComplianceCheck is read-only/scheduled — no CEO gate needed per rule 4.
 *   - Every AI call logged to BigQuery datalake_audit.ai_actions.
 */

"use strict";

const admin = require("firebase-admin");
const { callLLM, callOCR, parseJsonOutput } = require("./lib/ai-client");

const db = admin.firestore();

// ══════════════════════════════════════════════════════════════════
// 1. auditorContractReview — CEO only
// Reads a GRC document from storage, OCRs it if needed,
// runs it through the Auditor AI to identify compliance risks.
// Output is stored as DRAFT, status PENDING_CEO_REVIEW.
// ══════════════════════════════════════════════════════════════════
async function auditorContractReviewHandler(req, res, { verifyAuth, getUserAccessProfile, ALLOWED_ORIGINS }) {
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
    if (profile.role_id !== "ceo") return res.status(403).json({ error: "CEO role required" });

    const { document_id } = req.body;
    if (!document_id) return res.status(400).json({ error: "document_id required" });

    // Load document metadata from Firestore
    const docRef = db.collection("grc_documents").doc(document_id);
    const docSnap = await docRef.get();
    if (!docSnap.exists) return res.status(404).json({ error: "GRC document not found" });
    const grcDoc = docSnap.data();

    // Download file from WORM GCS bucket
    let contractText = "";
    try {
      const wormBucket = admin.storage().bucket("datalake-grc-library");
      const [fileBuffer] = await wormBucket.file(grcDoc.storage_path || grcDoc.file_path).download();

      // OCR if PDF; otherwise assume it's already text-extractable
      const ocrResult = await callOCR({
        fileBase64: fileBuffer.toString("base64"),
        lang: "en",
        agent: "auditor",
        type: "contract_ocr",
        triggeredBy: profile.email,
      });

      if (!ocrResult.success) {
        return res.status(503).json({ error: "OCR failed — cannot read document", detail: ocrResult.error });
      }

      contractText = ocrResult.lines.map((l) => l.text).join("\n");
    } catch (storageErr) {
      console.error("GRC document download/OCR failed:", storageErr.message);
      return res.status(500).json({ error: "Failed to retrieve document from storage", detail: storageErr.message });
    }

    if (!contractText.trim()) {
      return res.status(422).json({ error: "Document appears to be empty or image-only and could not be read" });
    }

    // ── Auditor LLM: risk review ──
    const llmResult = await callLLM({
      agent: "auditor",
      type: "contract_risk_review",
      triggeredBy: profile.email,
      promptTemplateId: "AUDITOR_CONTRACT_REVIEW_V1",
      systemPrompt: `You are the Datalake Auditor AI. Review this contract for compliance risks.
Check against ALL of the following regulations:
1. SAMA Outsourcing Regulations: audit rights clause, data residency, exit plan, subcontracting restrictions
2. NCA ECC-1:2018: access control requirements, data handling, incident notification (72 hours)
3. PDPL (Saudi Personal Data Protection Law): data processing terms, consent, cross-border transfer clause, breach notification
4. Saudi Labor Law (if employment-related): Article 51 mandatory fields
5. ISO 27001 Annex A: information security controls

Return ONLY a valid JSON object with this structure:
{
  "risk_level": "LOW|MEDIUM|HIGH|CRITICAL",
  "findings": [
    {
      "clause_reference": "Section X / Clause Y or null",
      "regulation": "SAMA Art X / NCA ECC-1:X-X / PDPL Art X / Labor Law Art X",
      "risk": "Description of the specific risk identified",
      "severity": "LOW|MEDIUM|HIGH|CRITICAL",
      "recommendation": "What must be changed or added"
    }
  ],
  "missing_clauses": ["audit rights", "data residency", "breach notification 72h", etc.],
  "compliant_clauses": ["list of clauses that ARE compliant"],
  "overall_assessment": "2-3 sentence summary of contract compliance posture"
}
Return valid JSON only, no markdown.`,
      userPrompt: contractText,
    });

    if (!llmResult.success) {
      return res.status(503).json({ error: "AI review failed", detail: llmResult.error });
    }

    const parsed = parseJsonOutput(llmResult.output);
    const review = parsed.success ? parsed.data : { raw: llmResult.output, parse_error: parsed.error };

    // Store review as DRAFT — CEO decides whether to act. AI NEVER takes final action.
    const now = admin.firestore.FieldValue.serverTimestamp();
    const reviewRef = await db.collection("contract_reviews").add({
      document_id,
      document_name: grcDoc.document_name || grcDoc.name || document_id,
      review,
      risk_level: review.risk_level || "UNKNOWN",
      reviewed_by: "auditor_ai",
      reviewed_at: now,
      status: "PENDING_CEO_REVIEW",       // CEO must review before any action
      requires_ceo_approval: true,
      triggered_by: profile.email,
      ai_model: "qwen2.5-7b-instruct-q4_K_M",
      inference_ms: llmResult.inferenceMs,
    });

    // Update the GRC document to reflect it was reviewed
    await docRef.update({
      last_ai_review_at: now,
      last_ai_review_id: reviewRef.id,
      ai_risk_level: review.risk_level || "UNKNOWN",
    });

    await db.collection("task_audit_log").add({
      event: "CONTRACT_REVIEW_CREATED_BY_AI",
      action_by: profile.email,
      action_at: now,
      details: {
        document_id,
        review_id: reviewRef.id,
        risk_level: review.risk_level || "UNKNOWN",
        findings_count: review.findings?.length || 0,
        ai_model: "qwen2.5-7b-instruct-q4_K_M",
      },
      ip_address: req.ip || req.headers["x-forwarded-for"] || "unknown",
    });

    return res.status(200).json({
      success: true,
      review_id: reviewRef.id,
      risk_level: review.risk_level || "UNKNOWN",
      findings_count: review.findings?.length || 0,
      status: "PENDING_CEO_REVIEW",
      message: "Contract review completed by Auditor AI. CEO review required before action.",
    });
  } catch (err) {
    console.error("auditorContractReview error:", err);
    return res.status(500).json({ error: "Internal server error", detail: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════
// 2. auditorComplianceCheck — Scheduled (monthly), read-only
// Per DTLK-PROMPT-AI-001 Rule 4 EXCEPTION: scheduled compliance
// checks are read-only, no mutations — no CEO gate required.
// Generates a compliance report and stores it for CEO review.
// ══════════════════════════════════════════════════════════════════
async function auditorComplianceCheckHandler() {
  console.log("[Auditor] Monthly compliance check starting...");

  try {
    // ── Gather system state (read-only) ──
    const [usersSnap, policiesSnap, grcSnap] = await Promise.all([
      db.collection("users").get(),
      db.collection("grc_documents").where("type", "==", "policy").get(),
      db.collection("grc_documents").get(),
    ]);

    const allUsers = usersSnap.docs.map((d) => d.data());
    const activeEngineers = allUsers.filter(
      (u) => u.role_id === "engineer" && u.status === "active"
    );

    // PDPL consent analysis — no PII in prompt (IDs and states only)
    const consentStatus = activeEngineers.map((e) => ({
      uid: e.uid || e.id,
      pdpl_consent_state: e.pdpl_consent_state || "UNKNOWN",
      role: e.role_id,
      status: e.status,
    }));

    const missingConsent = consentStatus.filter(
      (e) => !["GRANTED", "VERIFIED"].includes(e.pdpl_consent_state)
    );

    // Policy freshness check
    const now = new Date();
    const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    const policies = policiesSnap.docs.map((d) => {
      const p = d.data();
      const lastReview = p.last_reviewed_at?.toDate?.() || p.created_at?.toDate?.() || null;
      return {
        document_id: d.id,
        name: p.document_name || p.name,
        last_reviewed_at: lastReview ? lastReview.toISOString().split("T")[0] : "never",
        overdue_for_review: lastReview ? lastReview < oneYearAgo : true,
        version: p.version || "1.0",
      };
    });

    const systemState = {
      check_date: now.toISOString().split("T")[0],
      total_users: allUsers.length,
      total_active_engineers: activeEngineers.length,
      engineers_missing_pdpl_consent: missingConsent.length,
      total_policies_in_library: policiesSnap.size,
      total_grc_documents: grcSnap.size,
      policies_overdue_for_annual_review: policies.filter((p) => p.overdue_for_review).length,
      policy_details: policies,
      // consent_details omitted — contains UIDs which are not PII but kept minimal
      pdpl_consent_summary: {
        granted: consentStatus.filter((e) => e.pdpl_consent_state === "GRANTED").length,
        pending: consentStatus.filter((e) => e.pdpl_consent_state === "PENDING").length,
        unknown: consentStatus.filter((e) => e.pdpl_consent_state === "UNKNOWN").length,
        expired: consentStatus.filter((e) => e.pdpl_consent_state === "EXPIRED").length,
      },
    };

    // ── Auditor LLM: monthly compliance analysis ──
    const llmResult = await callLLM({
      agent: "auditor",
      type: "monthly_compliance_check",
      triggeredBy: "scheduler",
      promptTemplateId: "AUDITOR_MONTHLY_CHECK_V1",
      systemPrompt: `You are the Datalake Auditor AI performing a monthly compliance check.
Given the current system state, identify ALL compliance gaps against:
1. PDPL Art. 5: all employees must have granted consent — flag any missing
2. ISO 27001 Annex A.5.1: policies must be reviewed annually — flag overdue ones
3. NCA ECC-1:2018: access control, data handling policies must be current
4. ZATCA: quarterly filing deadlines
5. SAMA CSF: quarterly self-assessments

Return ONLY a valid JSON object:
{
  "check_date": "YYYY-MM-DD",
  "compliance_score": 0-100,
  "findings": [
    {
      "category": "PDPL|ISO27001|NCA|ZATCA|SAMA",
      "severity": "LOW|MEDIUM|HIGH|CRITICAL",
      "issue": "Description",
      "action_required": "What to do",
      "deadline": "YYYY-MM-DD or null"
    }
  ],
  "actions_required": ["Action 1", "Action 2"],
  "commendations": ["What is currently working well"],
  "next_review_date": "YYYY-MM-DD",
  "summary": "2-3 sentence executive summary"
}
Return valid JSON only, no markdown.`,
      userPrompt: JSON.stringify(systemState),
    });

    if (!llmResult.success) {
      console.error("[Auditor] LLM compliance check failed:", llmResult.error);
      // Log failure to Firestore but do not throw — scheduler should not crash
      await db.collection("compliance_reports").add({
        report: null,
        generated_by: "auditor_ai",
        generated_at: admin.firestore.FieldValue.serverTimestamp(),
        status: "AI_FAILED",
        error: llmResult.error,
        system_state_snapshot: systemState,
      });
      return;
    }

    const parsed = parseJsonOutput(llmResult.output);
    const report = parsed.success ? parsed.data : { raw: llmResult.output };

    // Store compliance report — CEO reviews. Scheduled check = read-only, no mutations made.
    await db.collection("compliance_reports").add({
      report,
      compliance_score: report.compliance_score || null,
      findings_count: report.findings?.length || 0,
      generated_by: "auditor_ai",
      generated_at: admin.firestore.FieldValue.serverTimestamp(),
      status: "PENDING_CEO_REVIEW",
      ai_model: "qwen2.5-7b-instruct-q4_K_M",
      inference_ms: llmResult.inferenceMs,
      system_state_snapshot: {
        // Store aggregate counts only, no PII
        total_users: systemState.total_users,
        active_engineers: systemState.total_active_engineers,
        missing_consent: systemState.engineers_missing_pdpl_consent,
        policies_overdue: systemState.policies_overdue_for_annual_review,
        check_date: systemState.check_date,
      },
    });

    // Also create a CEO task for review
    const taskId = `TSK-COMP-${Date.now()}`;
    await db.collection("tasks").add({
      task_id: taskId,
      title: `Monthly Compliance Report Ready — ${systemState.check_date}`,
      description: `Auditor AI has completed the monthly compliance check. Score: ${report.compliance_score || "N/A"}/100. ${report.findings?.length || 0} findings. Review required.`,
      task_type: "REVIEW",
      creation_method: "AI_SCHEDULED",
      created_by: "auditor_ai",
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      assigned_to_type: "INDIVIDUAL",
      assigned_to_id: "m.alqumri@datalake.sa",
      assigned_to_role: "CEO",
      priority: (report.compliance_score || 100) < 70 ? "HIGH" : "NORMAL",
      escalation_type: "NONE",
      due_at: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 3600000)),
      related_entity_type: "COMPLIANCE_REPORT",
      state: "OPEN",
    });

    console.log(
      `[Auditor] Monthly compliance check complete. Score: ${report.compliance_score || "N/A"}. Findings: ${report.findings?.length || 0}`
    );
  } catch (err) {
    console.error("[Auditor] auditorComplianceCheck fatal error:", err);
    // Do not re-throw — Cloud Scheduler should not retry indefinitely on errors
  }
}

// ══════════════════════════════════════════════════════════════════
// 3. getContractReviews — CEO only, retrieves stored AI reviews
// ══════════════════════════════════════════════════════════════════
async function getContractReviewsHandler(req, res, { verifyAuth, getUserAccessProfile, ALLOWED_ORIGINS }) {
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Origin", ALLOWED_ORIGINS.includes(req.headers.origin) ? req.headers.origin : "");
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return res.status(204).send("");
  }

  try {
    const decoded = await verifyAuth(req);
    const profile = await getUserAccessProfile(decoded.uid);
    if (profile.role_id !== "ceo") return res.status(403).json({ error: "CEO role required" });

    const { document_id } = req.query;
    let query = db.collection("contract_reviews").orderBy("reviewed_at", "desc").limit(20);
    if (document_id) query = db.collection("contract_reviews").where("document_id", "==", document_id);

    const snap = await query.get();
    const reviews = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    return res.status(200).json({ reviews });
  } catch (err) {
    console.error("getContractReviews error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// ══════════════════════════════════════════════════════════════════
// 4. getComplianceReports — CEO only, retrieves compliance reports
// ══════════════════════════════════════════════════════════════════
async function getComplianceReportsHandler(req, res, { verifyAuth, getUserAccessProfile, ALLOWED_ORIGINS }) {
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Origin", ALLOWED_ORIGINS.includes(req.headers.origin) ? req.headers.origin : "");
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return res.status(204).send("");
  }

  try {
    const decoded = await verifyAuth(req);
    const profile = await getUserAccessProfile(decoded.uid);
    if (profile.role_id !== "ceo") return res.status(403).json({ error: "CEO role required" });

    const snap = await db.collection("compliance_reports")
      .orderBy("generated_at", "desc")
      .limit(12)
      .get();

    const reports = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return res.status(200).json({ reports });
  } catch (err) {
    console.error("getComplianceReports error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

module.exports = {
  auditorContractReviewHandler,
  auditorComplianceCheckHandler,
  getContractReviewsHandler,
  getComplianceReportsHandler,
};
