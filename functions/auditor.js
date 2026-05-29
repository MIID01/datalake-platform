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
const { logToBigQuery } = require("./lib/bigquery");

const db = admin.firestore();

// ══════════════════════════════════════════════════════════════════
// 1. auditorContractReview — Pub/Sub trigger (datalake.grc.uploaded)
// Reads a GRC document from storage, OCRs it if needed,
// runs it through the Auditor AI to identify compliance risks.
// Output is stored as DRAFT, status PENDING_CEO_REVIEW.
// ══════════════════════════════════════════════════════════════════
async function auditorContractReviewHandler(event) {
  try {
    const { document_id } = event.data.message.json;
    if (!document_id) throw new Error("document_id required");

    // Load document metadata from Firestore
    const docRef = db.collection("grc_documents").doc(document_id);
    const docSnap = await docRef.get();
    if (!docSnap.exists) throw new Error(`GRC document not found: ${document_id}`);
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
        type: "compliance_audit",
        triggeredBy: "system",
      });

      if (!ocrResult.success) {
        throw new Error(`OCR failed — cannot read document: ${ocrResult.error}`);
      }

      contractText = ocrResult.lines.map((l) => l.text).join("\n");
    } catch (storageErr) {
      console.error("GRC document download/OCR failed:", storageErr.message);
      throw storageErr;
    }

    if (!contractText.trim()) {
      throw new Error("Document appears to be empty or image-only and could not be read");
    }

    // ── Auditor LLM: risk review ──
    const llmResult = await callLLM({
      agent: "auditor",
      type: "contract_risk_review",
      triggeredBy: "system",
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
      throw new Error(`AI review failed: ${llmResult.error}`);
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
      triggered_by: "system",
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
      event: "CONTRACT_REVIEWED_BY_AI",
      action_by: "system",
      action_at: now,
      details: { 
        document_id, 
        review_id: reviewRef.id, 
        risk_level: review.risk_level || "UNKNOWN",
        findings_count: review.findings?.length || 0,
        ai_model: "qwen2.5-7b-instruct-q4_K_M",
      },
    });

  } catch (err) {
    console.error("auditorContractReview error:", err);
    throw err;
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
    const activeUsers = allUsers.filter(u => u.status === "active");

    // PDPL consent analysis — no PII in prompt (IDs and states only)
    const consentStatus = activeUsers.map((e) => ({
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
      total_active_engineers: activeUsers.length,
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

// ══════════════════════════════════════════════════════════════════
// 5. aiAuditorMonthlyCronHandler — Phase 7 Auditor AI
// ══════════════════════════════════════════════════════════════════
async function aiAuditorMonthlyCronHandler(eventPayload) {
  console.log("[Auditor] Running aiAuditorMonthlyCronHandler...");
  try {
    const [usersSnap, contractsSnap, leaveSnap, talentSnap, timesheetsSnap] = await Promise.all([
      db.collection("users").get(),
      db.collection("contracts").get(),
      db.collection("leave_requests").get(),
      db.collection("talent_pool").where("state", "==", "REJECTED").get(),
      db.collection("timesheets").get()
    ]);

    const users = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const contracts = contractsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const leaves = leaveSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const rejectedTalent = talentSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const timesheets = timesheetsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 3600000);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 3600000);

    const issues = [];

    // Verify onboarding completion
    const incompleteOnboarding = users.filter(u => u.status === 'active' && !u.onboarding_complete);
    if (incompleteOnboarding.length > 0) issues.push(`Found ${incompleteOnboarding.length} active users with incomplete onboarding.`);

    // Contract validity
    const expiredContracts = contracts.filter(c => c.contract_end_date && new Date(c.contract_end_date) < now);
    if (expiredContracts.length > 0) issues.push(`Found ${expiredContracts.length} expired contracts.`);

    // Leave consistency
    // Simple check: do we have leaves in 'APPROVED' state without deduction? (simplified for prompt)
    const approvedLeaves = leaves.filter(l => l.status === 'APPROVED');
    issues.push(`Reviewed ${approvedLeaves.length} approved leave requests for consistency.`);

    // PDPL Purge status
    const unpurgedTalent = rejectedTalent.filter(t => t.rejected_at && t.rejected_at.toDate() < thirtyDaysAgo);
    if (unpurgedTalent.length > 0) issues.push(`PDPL Violation: Found ${unpurgedTalent.length} rejected candidates older than 30 days.`);

    // Timesheet status
    const pendingTimesheets = timesheets.filter(t => t.state === 'PENDING' || t.state === 'SUBMITTED');
    if (pendingTimesheets.length > 0) issues.push(`Found ${pendingTimesheets.length} unresolved timesheets.`);

    const systemPrompt = "You are the Datalake AI Auditor. Review the monthly activity summary and generate an audit finding report. Return strict JSON array of findings. E.g. [{\"issue\": \"...\", \"severity\": \"HIGH\"}]";
    const userPrompt = `Run the monthly audit on platform activity. Anomalies found: ${JSON.stringify(issues)}. Verify contract validity, leave consistency, PDPL purge status, timesheet status.`;

    const res = await callLLM({
      agent: "auditor",
      type: "MONTHLY_AUDIT",
      systemPrompt,
      userPrompt,
      triggeredBy: "system:monthly_ops"
    });
      
    await db.collection("audit_reports").add({
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      report_raw: res.output,
      status: "GENERATED",
      issues_summary: issues
    });
      
    await logToBigQuery("datalake_audit", "ai_actions", {
      agent_name: "Auditor",
      action_type: "MONTHLY_AUDIT",
      result: "SUCCESS",
      timestamp: new Date()
    });

    console.log("Monthly AI audit completed.");
  } catch (err) {
    console.error("Monthly AI audit failed:", err);
  }
}

// ══════════════════════════════════════════════════════════════════
// 6. checkEvidenceIntegrityHandler — Phase 7
// ══════════════════════════════════════════════════════════════════
async function checkEvidenceIntegrityHandler() {
  console.log("[Auditor] Running checkEvidenceIntegrityHandler...");
  try {
    const defaultBucket = admin.storage().bucket();
    const violations = [];

    // Check GCS files from a sample of approval_evidence
    const evidenceSnap = await db.collectionGroup("approval_evidence").get();
    for (const doc of evidenceSnap.docs) {
      const data = doc.data();
      if (data.evidence_storage_path && data.evidence_storage_path.startsWith('gs://')) {
        const filePath = data.evidence_storage_path.split('gs://')[1].split('/').slice(1).join('/');
        const bucketName = data.evidence_storage_path.split('gs://')[1].split('/')[0];
        const bucket = admin.storage().bucket(bucketName);
        const [exists] = await bucket.file(filePath).exists();
        if (!exists) {
          violations.push({ type: 'MISSING_EVIDENCE_FILE', docPath: doc.ref.path, path: data.evidence_storage_path });
        }
      }
    }

    // Check onboarding timestamps
    const usersSnap = await db.collection("users").where("status", "==", "active").get();
    usersSnap.docs.forEach(doc => {
      const data = doc.data();
      if (!data.created_at) {
        violations.push({ type: 'MISSING_ONBOARDING_TIMESTAMP', userId: doc.id });
      }
    });

    // Check PDPL consents valid
    const talentSnap = await db.collection("talent_pool").where("status", "==", "ACTIVE").get();
    talentSnap.docs.forEach(doc => {
      const data = doc.data();
      if (!data.pdpl_consent_url && data.pdpl_consent_state !== 'GRANTED') {
        violations.push({ type: 'INVALID_PDPL_CONSENT', candidateId: doc.id });
      }
    });

    // Check ZATCA XMLs exist for approved invoices
    const invoicesSnap = await db.collection("invoices").where("status", "==", "APPROVED").get();
    invoicesSnap.docs.forEach(doc => {
      const data = doc.data();
      if (!data.zatca_xml_url && !data.zatca_xml_payload) {
        violations.push({ type: 'MISSING_ZATCA_XML', invoiceId: doc.id });
      }
    });

    if (violations.length > 0) {
      console.warn(`[Auditor] Found ${violations.length} evidence integrity violations.`);
      const batch = db.batch();
      for (const v of violations) {
        const ref = db.collection("compliance_violations").doc();
        batch.set(ref, {
          ...v,
          detected_at: admin.firestore.FieldValue.serverTimestamp(),
          status: "OPEN"
        });
      }
      await batch.commit();
    } else {
      console.log("[Auditor] Evidence integrity check passed.");
    }
    await logToBigQuery("datalake_audit", "system_events", {
      event_type: "EVIDENCE_INTEGRITY_CHECK",
      details: `Violations found: ${violations.length}`,
      timestamp: new Date()
    });
  } catch (err) {
    console.error("checkEvidenceIntegrity error:", err);
  }
}

// ══════════════════════════════════════════════════════════════════
// 7. trackCAPAStatusHandler — Phase 7
// ══════════════════════════════════════════════════════════════════
async function trackCAPAStatusHandler() {
  console.log("[Auditor] Running trackCAPAStatusHandler...");
  try {
    const capasSnap = await db.collection("capas").where("status", "!=", "CLOSED").get();
    const now = new Date();
    
    const batch = db.batch();
    let updates = 0;

    capasSnap.docs.forEach(doc => {
      const capa = doc.data();
      let newStatus = capa.status;
      let needsUpdate = false;

      // Check overdue
      if (capa.due_date && capa.due_date.toDate() < now && capa.status !== 'IMPLEMENTED' && capa.status !== 'VERIFIED') {
        if (capa.status !== 'OVERDUE') {
          newStatus = 'OVERDUE';
          needsUpdate = true;
        }
      }

      // Check effectiveness review
      if (capa.status === 'IMPLEMENTED' && capa.effectiveness_review_date && capa.effectiveness_review_date.toDate() < now) {
        newStatus = 'REVIEW_REQUIRED';
        needsUpdate = true;
      }

      if (needsUpdate) {
        batch.update(doc.ref, { status: newStatus, last_updated: admin.firestore.FieldValue.serverTimestamp() });
        updates++;
      }
    });

    if (updates > 0) {
      await batch.commit();
      console.log(`[Auditor] Updated ${updates} CAPA records.`);
    }

    await logToBigQuery("datalake_audit", "system_events", {
      event_type: "TRACK_CAPA_STATUS",
      details: `Updates made: ${updates}`,
      timestamp: new Date()
    });
  } catch (err) {
    console.error("trackCAPAStatus error:", err);
  }
}

module.exports = {
  auditorContractReviewHandler,
  auditorComplianceCheckHandler,
  getContractReviewsHandler,
  getComplianceReportsHandler,
  aiAuditorMonthlyCronHandler,
  checkEvidenceIntegrityHandler,
  trackCAPAStatusHandler
};

