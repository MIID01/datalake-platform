/**
 * Compliance Calendar Automation
 *
 * complianceCalendarRunner — daily Cloud Scheduler job
 *   Reads compliance calendar, identifies items due in 7 days,
 *   drafts artifacts via the self-hosted LLM (Gemma 3; model id from LLM_MODEL env),
 *   routes to CEO for approval.
 *
 * approveDraftCompliance — CEO approves and archives to WORM
 *
 * DTLK-PROMPT-AI-001: NO Gemini / VertexAI / external APIs.
 * All AI inference via self-hosted datalake-ai-inference (Gemma 3; Qwen 2.5 retired).
 */

const admin = require("firebase-admin");
const { callLLM } = require("./lib/ai-client");

const db = admin.firestore();

// ── Compliance calendar items ──
const COMPLIANCE_CALENDAR = [
  { id: "access_review", title: "Quarterly Access Review", frequency: "quarterly", months: [1, 4, 7, 10], day: 1, template: "Review all user access rights, verify role assignments match current needs, flag stale accounts." },
  { id: "outsourcing_register", title: "Monthly Outsourcing Register Refresh", frequency: "monthly", day: 1, template: "Update outsourcing register with current engineer deployments, contract statuses, and client mappings." },
  { id: "incident_report", title: "Monthly Security Incident Summary", frequency: "monthly", day: 5, template: "Summarize security incidents, near-misses, and access violations for the month." },
  { id: "pdpl_audit", title: "Quarterly PDPL Compliance Audit", frequency: "quarterly", months: [1, 4, 7, 10], day: 15, template: "Audit consent records, data retention compliance, DSAR response times, and purge execution." },
  { id: "bcp_test", title: "Semi-Annual BCP Test", frequency: "semi-annual", months: [3, 9], day: 1, template: "Execute business continuity plan test, document results and recovery times." },
  { id: "vendor_review", title: "Quarterly Vendor Risk Assessment", frequency: "quarterly", months: [2, 5, 8, 11], day: 1, template: "Review third-party vendor security posture, SLA compliance, and data handling." },
];

async function complianceCalendarRunnerHandler() {
  const now = new Date();
  const inSevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const todayDay = now.getDate();
  const todayMonth = now.getMonth() + 1;
  const weekDay = inSevenDays.getDate();
  const weekMonth = inSevenDays.getMonth() + 1;

  console.log(`[ComplianceCalendar] Running — today: ${todayMonth}/${todayDay}, checking 7-day window`);

  const dueItems = COMPLIANCE_CALENDAR.filter(item => {
    const checkMonth = item.months ? item.months.includes(weekMonth) : true;
    return checkMonth && item.day >= todayDay && item.day <= weekDay;
  });

  if (dueItems.length === 0) {
    console.log("[ComplianceCalendar] No items due in the next 7 days.");
    return { processed: 0 };
  }

  const results = [];
  for (const item of dueItems) {
    try {
      // Check if already drafted this period
      const existingId = `${item.id}_${now.getFullYear()}_${String(todayMonth).padStart(2, "0")}`;
      const existingDoc = await db.collection("compliance_drafts").doc(existingId).get();
      if (existingDoc.exists) {
        console.log(`[ComplianceCalendar] ${item.id} already drafted for this period.`);
        continue;
      }

      // Draft artifact via self-hosted LLM (callLLM → datalake-ai-inference)
      const draftContent = await draftComplianceArtifact(item);

      await db.collection("compliance_drafts").doc(existingId).set({
        item_id: item.id,
        title: item.title,
        frequency: item.frequency,
        due_date: `${now.getFullYear()}-${String(weekMonth).padStart(2, "0")}-${String(item.day).padStart(2, "0")}`,
        draft_content: draftContent,
        status: "DRAFT",
        drafted_at: admin.firestore.FieldValue.serverTimestamp(),
        drafted_by: "compliance-calendar-runner",
        approved: false,
      });

      results.push({ item_id: item.id, title: item.title, status: "drafted" });
    } catch (err) {
      console.error(`[ComplianceCalendar] Failed for ${item.id}:`, err.message);
      results.push({ item_id: item.id, title: item.title, status: "failed", error: err.message });
    }
  }

  console.log(`[ComplianceCalendar] Drafted ${results.length} items.`);
  return { processed: results.length, results };
}

async function draftComplianceArtifact(item) {
  // DTLK-PROMPT-AI-001: Self-hosted LLM (Gemma 3) — no external AI APIs.
  const docId = `DTLK-COMP-${item.id.toUpperCase()}-${new Date().toISOString().split("T")[0].replace(/-/g, "")}`;

  const llmResult = await callLLM({
    agent: "auditor",
    type: "compliance_artifact_draft",
    triggeredBy: "scheduler",
    promptTemplateId: "AUDITOR_COMPLIANCE_ARTIFACT_V1",
    systemPrompt: `You are the Datalake Auditor AI for Datalake Saudi Arabia LLC (CR: 1009194773, NUN: 7048904952), a Saudi IT outsourcing company.
Draft a formal compliance artifact document.
Requirements:
- Follow NCA ECC-1:2018 and SAMA CSF frameworks
- Reference PDPL where applicable
- Use formal, audit-ready language
- Include a Findings section (use placeholder observations based on the task context)
- Include a Recommendations section
- Include document metadata: date, preparer (Auditor AI), regulatory basis
- Format as a structured document with numbered sections
- Do NOT include any information you are not given — use placeholders for specific data points
Do NOT use markdown headers — use plain numbered sections only.`,
    userPrompt: `Compliance Task: ${item.title}\nContext: ${item.template}\nDocument ID: ${docId}\nDate: ${new Date().toISOString().split("T")[0]}`,
  });

  if (!llmResult.success) {
    throw new Error(`AI drafting failed for ${item.id}: ${llmResult.error}`);
  }

  return llmResult.output;
}

async function approveDraftComplianceHandler(req, res, { verifyAuth, getUserAccessProfile, ALLOWED_ORIGINS }) {
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

    const { draft_id } = req.body;
    if (!draft_id) return res.status(400).json({ error: "draft_id required" });

    const draftDoc = await db.collection("compliance_drafts").doc(draft_id).get();
    if (!draftDoc.exists) return res.status(404).json({ error: "Draft not found" });
    const draft = draftDoc.data();

    if (draft.approved) return res.status(409).json({ error: "Already approved" });

    const now = admin.firestore.FieldValue.serverTimestamp();

    // Archive to WORM compliance bucket
    const wormBucket = admin.storage().bucket("datalake-worm-compliance");
    const wormPath = `compliance/${draft.item_id}/${draft_id}.txt`;
    await wormBucket.file(wormPath).save(draft.draft_content, {
      metadata: { contentType: "text/plain", metadata: { approved_by: profile.email, regulatory_basis: "NCA ECC-1:2018" } },
    });

    // Mark approved
    await db.collection("compliance_drafts").doc(draft_id).update({
      approved: true,
      approved_at: now,
      approved_by: profile.email,
      worm_path: wormPath,
      status: "APPROVED",
    });

    // Audit
    await db.collection("task_audit_log").add({
      event: "COMPLIANCE_ARTIFACT_APPROVED", action_by: profile.email, action_at: now,
      details: { draft_id, title: draft.title, worm_path: wormPath },
      ip_address: req.ip || req.headers["x-forwarded-for"] || "unknown",
    });

    return res.status(200).json({ success: true, worm_path: wormPath });
  } catch (err) {
    console.error("approveDraftCompliance error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

module.exports = { complianceCalendarRunnerHandler, approveDraftComplianceHandler };
