/**
 * Hire Sequence Cloud Functions
 *
 * initiateHire             — CEO creates pending_hires record
 * generateContract         — Self-hosted Qwen 2.5 7B fills employment contract template
 * gatekeeperContractDraft  — AI drafts contract JSON for CEO review (DRAFT only)
 * dispatchContractForSignature — Gmail to candidate with accept link
 * recordSignature          — public, token-gated, candidate accepts
 * provisionEngineer        — on signature: Workspace + IAM + engineers collection
 *
 * DTLK-PROC-HRM-001 / DTLK-FORM-HRM-001 / DTLK-PROMPT-AI-001
 * NOTE: VertexAI / Gemini removed. All AI inference via self-hosted datalake-ai-inference.
 */

const admin = require("firebase-admin");
const { v4: uuidv4 } = require("uuid");
const { PubSub } = require("@google-cloud/pubsub");
const pubsub = new PubSub();
// DTLK-PROMPT-AI-001: No external AI APIs. Self-hosted only.
const { callLLM, parseJsonOutput } = require("./lib/ai-client");
const { google } = require("googleapis");

const db = admin.firestore();
const PROJECT_ID = "datalake-production-sa";

// ═══════════════════════════════════════════════════════════════════
// 1. initiateHire — CEO only
// ═══════════════════════════════════════════════════════════════════
async function initiateHireHandler(req, res, { verifyAuth, getUserAccessProfile, ALLOWED_ORIGINS }) {
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
    if (profile.role_id !== "ceo") {
      return res.status(403).json({ error: "CEO role required to initiate hire" });
    }

    const { candidate_id, project_id, salary_monthly, contract_duration_months, start_date, notes } = req.body;
    if (!candidate_id || !project_id || !salary_monthly || !contract_duration_months || !start_date) {
      return res.status(400).json({ error: "candidate_id, project_id, salary_monthly, contract_duration_months, start_date are required" });
    }

    // Load candidate
    const candidateDoc = await db.collection("talent_pool").doc(candidate_id).get();
    if (!candidateDoc.exists) return res.status(404).json({ error: "Candidate not found" });
    const candidate = candidateDoc.data();

    // PDPL gate
    if (candidate.state === "PURGED") return res.status(403).json({ error: "Candidate purged per PDPL" });
    if (!candidate.consent_granted_at) return res.status(403).json({ error: "No PDPL consent on record" });

    // Load project
    const projectDoc = await db.collection("projects").doc(project_id).get();
    if (!projectDoc.exists) return res.status(404).json({ error: "Project not found" });
    const project = projectDoc.data();

    const hireId = uuidv4();
    const now = admin.firestore.FieldValue.serverTimestamp();

    await db.collection("pending_hires").doc(hireId).set({
      hire_id: hireId,
      candidate_id,
      candidate_name: candidate.full_name,
      candidate_email: candidate.email,
      project_id,
      project_name: project.project_name,
      client_name: project.client_name,
      salary_monthly: Number(salary_monthly),
      contract_duration_months: Number(contract_duration_months),
      start_date,
      notes: notes || "",
      status: "PENDING_CONTRACT",
      initiated_by: profile.email,
      initiated_at: now,
      contract_generated: false,
      contract_sent: false,
      contract_signed: false,
      engineer_provisioned: false,
    });

    // Update talent_pool state
    await db.collection("talent_pool").doc(candidate_id).update({
      state: "HIRE_INITIATED",
      hire_id: hireId,
      updated_at: now,
    });

    // Audit
    await db.collection("task_audit_log").add({
      event: "HIRE_INITIATED",
      action_by: profile.email,
      action_at: now,
      details: { hire_id: hireId, candidate_id, candidate_name: candidate.full_name, project_id, salary_monthly },
      ip_address: req.ip || req.headers["x-forwarded-for"] || "unknown",
    });

    // PUBLISH PUB/SUB EVENT
    await pubsub.topic("datalake.hire.initiated").publishMessage({ json: { hire_id: hireId } });

    return res.status(200).json({ success: true, hire_id: hireId });
  } catch (err) {
    console.error("initiateHire error:", err);
    return res.status(500).json({ error: "Internal server error", detail: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════
// 2. generateContract — Pub/Sub trigger (datalake.hire.initiated)
// ═══════════════════════════════════════════════════════════════════
async function generateContractHandler(event) {
  try {
    const { hire_id } = event.data.message.json;
    if (!hire_id) throw new Error("hire_id is required in Pub/Sub message");

    const hireDoc = await db.collection("pending_hires").doc(hire_id).get();
    if (!hireDoc.exists) throw new Error("Hire record not found");
    const hire = hireDoc.data();

    if (hire.status !== "PENDING_CONTRACT") {
      console.warn(`generateContract skipped: status is ${hire.status}`);
      return;
    }

    // Generate contract text via Vertex AI
    const contractText = await generateContractWithAI(hire);

    const now = admin.firestore.FieldValue.serverTimestamp();
    await db.collection("pending_hires").doc(hire_id).update({
      contract_text: contractText,
      contract_generated: true,
      contract_generated_at: now,
      status: "CONTRACT_READY",
    });

    // PUBLISH PUB/SUB EVENT
    await pubsub.topic("datalake.contract.generated").publishMessage({ json: { hire_id } });

  } catch (err) {
    console.error("generateContract error:", err);
    throw err; // Allow Pub/Sub to retry if needed
  }
}

async function generateContractWithAI(hire) {
  // DTLK-PROMPT-AI-001: Self-hosted Qwen 2.5 7B — no external AI APIs.
  const endDate = new Date(hire.start_date);
  endDate.setMonth(endDate.getMonth() + hire.contract_duration_months);

  const llmResult = await callLLM({
    agent: "gatekeeper",
    type: "contract_draft",
    triggeredBy: hire.initiated_by || "system",
    promptTemplateId: "GATEKEEPER_CONTRACT_DRAFT_V1",
    systemPrompt: `You are the Datalake Gatekeeper AI — a legal document drafter for Datalake Information Technology,
a Saudi Arabian IT outsourcing company (CR: 109194773, Riyadh).
Draft an Employment Contract (DTLK-FORM-HRM-001) in English.
This is a fixed-term staff augmentation contract under Saudi Labor Law.
Include ALL of the following mandatory clauses:
1. Article 51 fields: employee name, nationality, ID number placeholder, job title, salary, start date, contract duration
2. Probation period (90 days per Art. 53)
3. Working hours (48hrs/week per Art. 98)
4. Annual leave (21 days per Art. 109; 30 days after 5 years)
5. End of service award (per Art. 84)
6. Notice period (per Art. 75)
7. Confidentiality and IP assignment to Datalake
8. Non-compete (within Saudi legal limits)
9. PDPL data processing consent clause
10. Termination conditions (Art. 74-82)
11. Dispute resolution (Saudi Labor Courts)
12. Client deployment terms
Format as a professional contract with numbered articles.
Do NOT include signatures — those will be added digitally.
Do NOT invent information — use only what is provided in the user message.
If any mandatory Art. 51 field is missing, note it in a MISSING_FIELDS comment at the end.`,
    userPrompt: JSON.stringify({
      employer: "Datalake Information Technology, CR 109194773, Riyadh, Saudi Arabia",
      candidate_name: hire.candidate_name,
      candidate_email: hire.candidate_email,
      position: `IT Consultant — outsourced to ${hire.client_name}`,
      project: hire.project_name,
      client: hire.client_name,
      start_date: hire.start_date,
      end_date: endDate.toISOString().split("T")[0],
      duration_months: hire.contract_duration_months,
      monthly_salary_sar: hire.salary_monthly,
      id_number: "[TO BE PROVIDED BY CANDIDATE]",
      note: "Nafath e-signature deferred to Phase 3. This contract uses click-to-accept + IP logging as interim.",
    }),
  });

  if (!llmResult.success) {
    throw new Error(`Contract AI drafting failed: ${llmResult.error}`);
  }

  return llmResult.output;
}

// ═══════════════════════════════════════════════════════════════════
// gatekeeperContractDraft — CEO only (DTLK-PROMPT-AI-001 Agent: Gatekeeper)
// AI drafts a contract JSON from candidate + project + terms.
// Output is ALWAYS a DRAFT — requires CEO approval before dispatch.
// ═══════════════════════════════════════════════════════════════════
async function gatekeeperContractDraftHandler(req, res, { verifyAuth, getUserAccessProfile, ALLOWED_ORIGINS }) {
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

    const { candidate_id, project_id, terms } = req.body;
    if (!candidate_id || !project_id || !terms) {
      return res.status(400).json({ error: "candidate_id, project_id, and terms object required" });
    }
    const requiredTerms = ["jobTitle", "monthlySalary", "startDate", "durationMonths"];
    for (const t of requiredTerms) {
      if (!terms[t]) return res.status(400).json({ error: `Missing terms.${t}` });
    }

    // Load candidate
    const candidateDoc = await db.collection("talent_pool").doc(candidate_id).get();
    if (!candidateDoc.exists) return res.status(404).json({ error: "Candidate not found" });
    const candidate = candidateDoc.data();
    if (candidate.state === "PURGED") return res.status(403).json({ error: "Candidate purged per PDPL" });

    // Load project
    const projectDoc = await db.collection("projects").doc(project_id).get();
    if (!projectDoc.exists) return res.status(404).json({ error: "Project not found" });
    const project = projectDoc.data();

    // Call self-hosted LLM to draft the contract structure as JSON
    const llmResult = await callLLM({
      agent: "gatekeeper",
      type: "contract_draft_json",
      triggeredBy: profile.email,
      promptTemplateId: "GATEKEEPER_CONTRACT_DRAFT_V1",
      systemPrompt: `You are the Datalake Gatekeeper AI. Draft an employment contract for a staff augmentation engineer.
The contract must comply with Saudi Labor Law (MHRSD) and include Article 51 mandatory fields.
Return ONLY a valid JSON object with this structure:
{
  "contract_title": "",
  "sections": [
    {"article": 1, "title": "Parties", "content": "..."},
    {"article": 2, "title": "Position and Assignment", "content": "..."},
    ...
  ],
  "missing_fields": ["field name if mandatory Art.51 field was not provided"],
  "compliance_note": "Brief statement on Saudi Labor Law compliance"
}
Do NOT invent information. If a mandatory field is missing from input, add it to missing_fields array.
Return valid JSON only, no markdown.`,
      userPrompt: JSON.stringify({
        candidate_name: candidate.extracted_data?.full_name || candidate.full_name,
        candidate_nationality: candidate.extracted_data?.nationality || null,
        candidate_id_number: "[TO BE PROVIDED BY CANDIDATE]",
        job_title: terms.jobTitle,
        client_name: project.client_name,
        project_name: project.project_name,
        monthly_salary_sar: terms.monthlySalary,
        start_date: terms.startDate,
        contract_duration_months: terms.durationMonths,
        probation_days: terms.probationDays || 90,
        housing_allowance_sar: terms.housingAllowance || 0,
        transport_allowance_sar: terms.transportAllowance || 0,
        employer: "Datalake Information Technology, CR 109194773, Riyadh, Saudi Arabia",
      }),
    });

    if (!llmResult.success) {
      return res.status(503).json({ error: "AI contract drafting failed", detail: llmResult.error });
    }

    const parsed = parseJsonOutput(llmResult.output);
    const contractDraft = parsed.success ? parsed.data : { raw: llmResult.output };

    // Store as DRAFT — CEO must approve before dispatch. AI NEVER takes final action.
    const draftId = uuidv4();
    const now = admin.firestore.FieldValue.serverTimestamp();
    await db.collection("pending_hires").doc(draftId).set({
      hire_id: draftId,
      status: "DRAFT_CONTRACT",
      contract_draft: contractDraft,
      drafted_by: "gatekeeper_ai",
      drafted_at: now,
      requires_ceo_approval: true,  // MANDATORY per DTLK-PROMPT-AI-001 Rule 4
      project_id,
      project_name: project.project_name,
      client_name: project.client_name,
      candidate_id,
      candidate_name: candidate.extracted_data?.full_name || candidate.full_name,
      candidate_email: candidate.email,
      terms,
      initiated_by: profile.email,
    });

    await db.collection("task_audit_log").add({
      event: "CONTRACT_DRAFT_CREATED_BY_AI",
      action_by: profile.email,
      action_at: now,
      details: { draft_id: draftId, candidate_id, project_id, ai_model: "qwen2.5-7b-instruct-q4_K_M", status: "DRAFT_AWAITING_CEO_APPROVAL" },
      ip_address: req.ip || req.headers["x-forwarded-for"] || "unknown",
    });

    return res.status(200).json({
      success: true,
      draft_id: draftId,
      status: "DRAFT_AWAITING_CEO_APPROVAL",
      missing_fields: contractDraft.missing_fields || [],
      message: "Contract draft created by Gatekeeper AI. CEO approval required before dispatch.",
    });
  } catch (err) {
    console.error("gatekeeperContractDraft error:", err);
    return res.status(500).json({ error: "Internal server error", detail: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════
// 3. dispatchContractForSignature — Pub/Sub trigger (datalake.contract.generated)
// ═══════════════════════════════════════════════════════════════════
async function dispatchContractHandler(event) {
  try {
    const { hire_id } = event.data.message.json;
    if (!hire_id) throw new Error("hire_id is required");

    const hireDoc = await db.collection("pending_hires").doc(hire_id).get();
    if (!hireDoc.exists) throw new Error("Hire not found");
    const hire = hireDoc.data();

    if (!hire.contract_generated) throw new Error("Contract not yet generated");
    if (hire.status === "CONTRACT_SENT") {
      console.warn("Contract already sent");
      return;
    }

    // Generate one-time acceptance token
    const acceptToken = uuidv4();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await db.collection("contract_tokens").doc(acceptToken).set({
      hire_id,
      candidate_id: hire.candidate_id,
      candidate_email: hire.candidate_email,
      expires_at: admin.firestore.Timestamp.fromDate(expiresAt),
      used: false,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    const acceptUrl = `https://datalake-production-sa.web.app/contract/${acceptToken}`;

    // Send via Gmail
    const gmail = await getGmailClient();
    const emailBody = buildContractEmail(hire, acceptUrl);
    const rawEmail = buildRawEmail({
      from: "Datalake HR <hr@datalake.sa>",
      to: `${hire.candidate_name} <${hire.candidate_email}>`,
      subject: `Employment Contract — Datalake Information Technology — ${hire.project_name}`,
      body: emailBody,
    });

    const sendResult = await gmail.users.messages.send({
      userId: "hr@datalake.sa",
      requestBody: { raw: rawEmail },
    });

    const now = admin.firestore.FieldValue.serverTimestamp();
    await db.collection("pending_hires").doc(hire_id).update({
      contract_sent: true,
      contract_sent_at: now,
      contract_accept_token: acceptToken,
      contract_gmail_id: sendResult.data.id,
      status: "CONTRACT_SENT",
    });

    await db.collection("task_audit_log").add({
      event: "CONTRACT_DISPATCHED", action_by: "system", action_at: now,
      details: { hire_id, candidate_name: hire.candidate_name, gmail_id: sendResult.data.id },
    });

  } catch (err) {
    console.error("dispatchContract error:", err);
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════
// 4. recordSignature — public, token-gated
// ═══════════════════════════════════════════════════════════════════
async function recordSignatureHandler(req, res, { ALLOWED_ORIGINS }) {
  const origin = req.headers.origin || "";
  res.set("Access-Control-Allow-Origin", ALLOWED_ORIGINS.includes(origin) ? origin : "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).send("");

  try {
    // GET: return contract for review
    if (req.method === "GET") {
      const { token } = req.query;
      if (!token) return res.status(400).json({ error: "Token required" });

      const tokenDoc = await db.collection("contract_tokens").doc(token).get();
      if (!tokenDoc.exists) return res.status(404).json({ error: "Invalid contract link" });
      const tokenData = tokenDoc.data();

      if (tokenData.used) return res.status(409).json({ error: "Contract already signed" });
      if (tokenData.expires_at.toDate() < new Date()) return res.status(410).json({ error: "Link expired" });

      const hireDoc = await db.collection("pending_hires").doc(tokenData.hire_id).get();
      const hire = hireDoc.data();

      return res.status(200).json({
        candidate_name: hire.candidate_name,
        project_name: hire.project_name,
        client_name: hire.client_name,
        contract_text: hire.contract_text,
        salary_monthly: hire.salary_monthly,
        start_date: hire.start_date,
        duration_months: hire.contract_duration_months,
      });
    }

    // POST: accept contract
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const { token, full_name_confirmation } = req.body;
    if (!token || !full_name_confirmation) {
      return res.status(400).json({ error: "token and full_name_confirmation are required" });
    }

    const tokenRef = db.collection("contract_tokens").doc(token);
    const tokenDoc = await tokenRef.get();
    if (!tokenDoc.exists) return res.status(404).json({ error: "Invalid contract link" });
    const tokenData = tokenDoc.data();

    if (tokenData.used) return res.status(409).json({ error: "Already signed" });
    if (tokenData.expires_at.toDate() < new Date()) return res.status(410).json({ error: "Expired" });

    const now = admin.firestore.FieldValue.serverTimestamp();
    const ipAddress = req.ip || req.headers["x-forwarded-for"] || "unknown";

    // Mark token used
    await tokenRef.update({ used: true, used_at: now });

    // Update hire record
    await db.collection("pending_hires").doc(tokenData.hire_id).update({
      contract_signed: true,
      contract_signed_at: now,
      contract_signed_name: full_name_confirmation,
      contract_signed_ip: ipAddress,
      contract_signed_user_agent: req.headers["user-agent"] || "unknown",
      status: "CONTRACT_SIGNED",
    });

    // Update talent_pool
    await db.collection("talent_pool").doc(tokenData.candidate_id).update({
      state: "CONTRACT_SIGNED",
      updated_at: now,
    });

    // Audit
    await db.collection("task_audit_log").add({
      event: "CONTRACT_SIGNED", action_by: tokenData.candidate_email, action_at: now,
      details: {
        hire_id: tokenData.hire_id, candidate_id: tokenData.candidate_id,
        signed_name: full_name_confirmation, ip: ipAddress,
        note: "Click-to-accept + IP logging. Nafath e-signature deferred to Phase 3.",
      },
      ip_address: ipAddress,
    });

    // PUBLISH PUB/SUB EVENT
    await pubsub.topic("datalake.contract.signed").publishMessage({ json: { hire_id: tokenData.hire_id } });

    return res.status(200).json({ success: true, message: "Contract accepted. Welcome to Datalake." });
  } catch (err) {
    console.error("recordSignature error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// ═══════════════════════════════════════════════════════════════════
// 5. provisionEngineer — Pub/Sub trigger (datalake.contract.signed)
// ═══════════════════════════════════════════════════════════════════
async function provisionEngineerHandler(event) {
  try {
    const { hire_id } = event.data.message.json;
    if (!hire_id) throw new Error("hire_id required");

    const hireDoc = await db.collection("pending_hires").doc(hire_id).get();
    if (!hireDoc.exists) throw new Error("Hire not found");
    const hire = hireDoc.data();

    if (!hire.contract_signed) throw new Error("Contract not yet signed");
    if (hire.engineer_provisioned) {
      console.warn("Engineer already provisioned");
      return;
    }

    // Calculate contract end date
    const endDate = new Date(hire.start_date);
    endDate.setMonth(endDate.getMonth() + hire.contract_duration_months);

    // Create engineer in Firebase Auth (using candidate email)
    let uid;
    try {
      const userRecord = await admin.auth().getUserByEmail(hire.candidate_email);
      uid = userRecord.uid;
    } catch (e) {
      if (e.code === "auth/user-not-found") {
        const newUser = await admin.auth().createUser({
          email: hire.candidate_email,
          displayName: hire.candidate_name,
          emailVerified: true,
        });
        uid = newUser.uid;
      } else throw e;
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const engineerId = `ENG-${Date.now().toString(36).toUpperCase()}`;

    // Create user doc with engineer role
    await db.collection("users").doc(uid).set({
      email: hire.candidate_email,
      display_name: hire.candidate_name,
      role_id: "engineer",
      status: "active",
      engineer_id: engineerId,
      created_at: now,
      created_by: hire.initiated_by || "system",
      client_id: null,
    }, { merge: true });

    // Create engineer doc
    await db.collection("engineers").doc(engineerId).set({
      engineer_id: engineerId,
      uid,
      full_name: hire.candidate_name,
      email: hire.candidate_email,
      project_id: hire.project_id,
      project_name: hire.project_name,
      client_name: hire.client_name,
      role: "IT Consultant",
      contract_start: hire.start_date,
      contract_end: endDate.toISOString().split("T")[0],
      salary_monthly: hire.salary_monthly,
      status: "active",
      hire_id: hire.hire_id,
      provisioned_at: now,
      provisioned_by: hire.initiated_by || "system",
    });

    // Update pending_hires
    await db.collection("pending_hires").doc(hire_id).update({
      engineer_provisioned: true,
      engineer_id: engineerId,
      engineer_uid: uid,
      status: "PROVISIONED",
      provisioned_at: now,
    });

    // Update talent_pool
    await db.collection("talent_pool").doc(hire.candidate_id).update({
      state: "HIRED",
      engineer_id: engineerId,
      updated_at: now,
    });

    // Send welcome email
    try {
      const gmail = await getGmailClient();
      const welcomeBody = [
        `Dear ${hire.candidate_name},`,
        "",
        "Welcome to Datalake Information Technology!",
        "",
        `Your account has been provisioned. You can access the Engineer Portal at:`,
        `https://datalake-production-sa.web.app/portal`,
        "",
        `Sign in using your Google account: ${hire.candidate_email}`,
        "",
        `Project: ${hire.project_name}`,
        `Client: ${hire.client_name}`,
        `Start Date: ${hire.start_date}`,
        `Engineer ID: ${engineerId}`,
        "",
        "Please log in and complete your profile setup.",
        "",
        "Best regards,",
        "Datalake HR Team",
        "hr@datalake.sa",
      ].join("\n");

      const raw = buildRawEmail({
        from: "Datalake HR <hr@datalake.sa>",
        to: `${hire.candidate_name} <${hire.candidate_email}>`,
        subject: `Welcome to Datalake — Account Provisioned — ${engineerId}`,
        body: welcomeBody,
      });

      await gmail.users.messages.send({ userId: "hr@datalake.sa", requestBody: { raw } });
    } catch (emailErr) {
      console.warn("Welcome email failed (non-blocking):", emailErr.message);
    }

    // Audit
    await db.collection("task_audit_log").add({
      event: "ENGINEER_PROVISIONED", action_by: "system", action_at: now,
      details: { hire_id, engineer_id: engineerId, candidate_name: hire.candidate_name },
    });

  } catch (err) {
    console.error("provisionEngineer error:", err);
    throw err;
  }
}

// ── Gmail helpers (same pattern as sendInterviewCV) ──
async function getGmailClient() {
  const auth = new google.auth.GoogleAuth({ scopes: ["https://www.googleapis.com/auth/gmail.send"] });
  const client = await auth.getClient();
  client.subject = "hr@datalake.sa";
  return google.gmail({ version: "v1", auth: client });
}

function buildContractEmail(hire, acceptUrl) {
  return [
    `Dear ${hire.candidate_name},`,
    "",
    "We are pleased to extend an offer of employment with Datalake Information Technology.",
    "",
    `Position: IT Consultant`,
    `Project: ${hire.project_name}`,
    `Client: ${hire.client_name}`,
    `Start Date: ${hire.start_date}`,
    `Duration: ${hire.contract_duration_months} months`,
    `Monthly Salary: SAR ${hire.salary_monthly.toLocaleString()}`,
    "",
    "Please review and accept your employment contract using the secure link below:",
    "",
    acceptUrl,
    "",
    "This link expires in 7 days.",
    "",
    "────────────────────────────────────────",
    "PRIVATE & CONFIDENTIAL",
    "This document contains personal data processed under PDPL Art. 5.",
    "────────────────────────────────────────",
    "",
    "Best regards,",
    "Datalake HR Team",
    "hr@datalake.sa",
    "",
    "Datalake Information Technology",
    "CR: 109194773 | www.datalake.sa",
  ].join("\n");
}

function buildRawEmail({ from, to, subject, body }) {
  const mimeMessage = [
    `From: ${from}`, `To: ${to}`, `Subject: ${subject}`,
    "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "",
    body,
  ].join("\r\n");
  return Buffer.from(mimeMessage).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

module.exports = {
  initiateHireHandler,
  generateContractHandler,
  gatekeeperContractDraftHandler,
  dispatchContractHandler,
  recordSignatureHandler,
  provisionEngineerHandler,
};
