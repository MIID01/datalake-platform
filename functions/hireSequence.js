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
const { LEGAL_EMAIL_FOOTER } = require("./lib/company-legal");
const { PubSub } = require("@google-cloud/pubsub");
const pubsub = new PubSub();
// DTLK-PROMPT-AI-001: No external AI APIs. Self-hosted only.
const { callLLM, callOCR, parseJsonOutput, MODEL_NAME } = require("./lib/ai-client");
const { generateSetPasswordLink } = require("./passwordReset");
const { evaluateHireBudget } = require("./lib/budget");
const Busboy = require("busboy");
const { google } = require("googleapis");
const pdfParse = require("pdf-parse");

// Try the digital PDF text layer first (Qiwa contracts are real digital PDFs,
// not scans — pdf-parse reads them in milliseconds with no network call).
// Returns the extracted text or null if the PDF has no usable text layer
// (image-only scans → fall back to PaddleOCR).
async function tryPdfTextLayer(pdfBuffer) {
  try {
    const result = await pdfParse(pdfBuffer);
    const text = String(result?.text || "").trim();
    if (text.length < 80) return null; // too little to be real contract text
    return { text, pageCount: result?.numpages || 0, lineCount: text.split(/\n+/).filter(Boolean).length };
  } catch (err) {
    console.warn(`[Gatekeeper] pdf-parse failed (${err.message}) — falling back to OCR`);
    return null;
  }
}

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

    // ── Budget gate — REJECT an over-PO hire before any record is written ──
    const hireCostSar = Number(salary_monthly) * Number(contract_duration_months);
    const budget = evaluateHireBudget({
      poValueSar: project.po_value_sar,
      poUsedSar: project.po_used_sar,
      hireCostSar,
    });
    if (budget.blocked) {
      return res.status(400).json({ error: `Hire blocked — over PO budget. ${budget.reason}`, budget });
    }

    // ── Idempotency guard — no dedup before, so the SAME candidate could be
    //    submitted repeatedly (one was submitted 7×), each spawning a pending_hire
    //    + a full pipeline run. Cheap candidate-state check, then a pending_hires
    //    existence check (only NEW_HIRE rows carry candidate_id; EXISTING_EMPLOYEE
    //    contract shells do not, so they never false-match).
    if (candidate.state === "HIRE_INITIATED" || candidate.hire_id) {
      return res.status(409).json({ error: "A hire is already in progress for this candidate.", existing_hire_id: candidate.hire_id || null });
    }
    const dupSnap = await db.collection("pending_hires").where("candidate_id", "==", candidate_id).limit(1).get();
    if (!dupSnap.empty) {
      const ex = dupSnap.docs[0].data();
      return res.status(409).json({ error: "A pending hire already exists for this candidate.", existing_hire_id: ex.hire_id || dupSnap.docs[0].id });
    }

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
    systemPrompt: `You are the Datalake Gatekeeper AI — a legal document drafter for Datalake Saudi Arabia LLC,
a Saudi Arabian IT outsourcing company (CR: 1009194773, NUN: 7048904952, Riyadh Al-Yarmouk 13243).
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
      employer: "Datalake Saudi Arabia LLC, CR 1009194773, NUN 7048904952, Riyadh Al-Yarmouk 13243, Saudi Arabia",
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
        employer: "Datalake Saudi Arabia LLC, CR 1009194773, NUN 7048904952, Riyadh Al-Yarmouk 13243, Saudi Arabia",
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
      details: { draft_id: draftId, candidate_id, project_id, ai_model: MODEL_NAME, status: "DRAFT_AWAITING_CEO_APPROVAL" },
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
      subject: `Employment Contract — Datalake Saudi Arabia LLC — ${hire.project_name}`,
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

    // Send welcome email. The platform is email/password only (Google SSO was
    // removed), and a freshly-provisioned account has no password yet — so we
    // include a set-password link instead of the old "sign in with Google" text.
    try {
      const gmail = await getGmailClient();
      const setPwLink = await generateSetPasswordLink(hire.candidate_email);
      const welcomeBody = [
        `Dear ${hire.candidate_name},`,
        "",
        "Welcome to Datalake Saudi Arabia LLC!",
        "",
        `Your account has been provisioned (${hire.candidate_email}).`,
        `First, set your password using the secure link below:`,
        "",
        `  ${setPwLink || 'Open https://datalake-production-sa.web.app/ and use the "Forgot password?" link to set your password.'}`,
        "",
        `Then sign in at https://datalake-production-sa.web.app/ with your email and the password you chose.`,
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

// ═══════════════════════════════════════════════════════════════════
// 6. uploadContractPDF — CEO uploads signed contract PDF
//    Stores in Cloud Storage, publishes datalake.contract.uploaded
// ═══════════════════════════════════════════════════════════════════
async function uploadContractPDFHandler(req, res, { verifyAuth, getUserAccessProfile, ALLOWED_ORIGINS }) {
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

    // Parse multipart form
    const busboy = Busboy({ headers: req.headers });
    const fileBuffers = [];
    let fileName = null;
    let fileMimeType = null;
    let hireId = null;
    let employeeId = null;
    let contractId = null;

    await new Promise((resolve, reject) => {
      busboy.on("field", (name, val) => {
        if (name === "hire_id") hireId = val;
        if (name === "employee_id") employeeId = val;
        if (name === "contract_id") contractId = val;
      });
      busboy.on("file", (name, stream, info) => {
        if (name !== "contract_pdf") { stream.resume(); return; }
        fileMimeType = info.mimeType;
        fileName = info.filename;
        stream.on("data", (chunk) => fileBuffers.push(chunk));
        stream.on("end", () => {});
      });
      busboy.on("finish", resolve);
      busboy.on("error", reject);
      busboy.end(req.rawBody || req.body);
    });

    if (!hireId && !employeeId) return res.status(400).json({ error: "hire_id or employee_id field required" });
    if (fileBuffers.length === 0) return res.status(400).json({ error: "No contract_pdf file received" });

    const pdfBuffer = Buffer.concat(fileBuffers);
    if (pdfBuffer.length > 15 * 1024 * 1024) return res.status(400).json({ error: "File too large (max 15MB)" });

    const allowedTypes = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
    if (!allowedTypes.includes(fileMimeType)) {
      return res.status(400).json({ error: `Unsupported file type: ${fileMimeType}. Upload PDF, PNG, or JPG.` });
    }

    const bucket = admin.storage().bucket("datalake-worm-hr");
    const now = admin.firestore.FieldValue.serverTimestamp();

    if (employeeId) {
      // Direct employee upload flow
      const resolvedContractId = contractId || db.collection("contracts").doc().id;
      const storagePath = `contracts/employees/${employeeId}/${Date.now()}_${fileName}`;
      const file = bucket.file(storagePath);
      await file.save(pdfBuffer, {
        contentType: fileMimeType,
        metadata: {
          cacheControl: "private, max-age=0",
          metadata: { employee_id: employeeId, contract_id: resolvedContractId, uploaded_by: profile.email },
        },
      });

      await db.collection("contracts").doc(resolvedContractId).set({
        contract_id: resolvedContractId,
        employee_id: employeeId,
        contract_pdf_storage_path: storagePath,
        contract_pdf_filename: fileName,
        contract_pdf_size_bytes: pdfBuffer.length,
        contract_pdf_uploaded_at: now,
        contract_pdf_uploaded_by: profile.email,
        contract_extraction_status: "PENDING",
      }, { merge: true });

      await db.collection("task_audit_log").add({
        event: "CONTRACT_PDF_UPLOADED",
        action_by: profile.email,
        action_at: now,
        details: { employee_id: employeeId, contract_id: resolvedContractId, file_name: fileName, size_bytes: pdfBuffer.length, storage_path: storagePath },
        ip_address: req.ip || req.headers["x-forwarded-for"] || "unknown",
      });

      await pubsub.topic("datalake.contract.uploaded").publishMessage({ json: { contract_id: resolvedContractId, employee_id: employeeId } });

      return res.status(200).json({
        success: true,
        contract_id: resolvedContractId,
        employee_id: employeeId,
        storage_path: storagePath,
        message: "Contract PDF uploaded. Gatekeeper AI extraction started.",
      });
    }

    // Hire upload flow
    const hireDoc = await db.collection("pending_hires").doc(hireId).get();
    if (!hireDoc.exists) return res.status(404).json({ error: "Hire record not found" });

    const storagePath = `contracts/${hireId}/${Date.now()}_${fileName}`;
    const file = bucket.file(storagePath);
    await file.save(pdfBuffer, {
      contentType: fileMimeType,
      metadata: {
        cacheControl: "private, max-age=0",
        metadata: { hire_id: hireId, uploaded_by: profile.email },
      },
    });

    await db.collection("pending_hires").doc(hireId).update({
      contract_pdf_storage_path: storagePath,
      contract_pdf_filename: fileName,
      contract_pdf_size_bytes: pdfBuffer.length,
      contract_pdf_uploaded_at: now,
      contract_pdf_uploaded_by: profile.email,
      contract_extraction_status: "PENDING",
    });

    await db.collection("task_audit_log").add({
      event: "CONTRACT_PDF_UPLOADED",
      action_by: profile.email,
      action_at: now,
      details: { hire_id: hireId, file_name: fileName, size_bytes: pdfBuffer.length, storage_path: storagePath },
      ip_address: req.ip || req.headers["x-forwarded-for"] || "unknown",
    });

    await pubsub.topic("datalake.contract.uploaded").publishMessage({ json: { hire_id: hireId } });

    return res.status(200).json({
      success: true,
      hire_id: hireId,
      storage_path: storagePath,
      message: "Contract PDF uploaded. Gatekeeper AI extraction started.",
    });
  } catch (err) {
    console.error("uploadContractPDF error:", err);
    return res.status(500).json({ error: "Internal server error", detail: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════
// 7. gatekeeperContractExtract — Pub/Sub trigger (datalake.contract.uploaded)
//    OCR → LLM extracts 15 fields → populates pending_hires doc
//    DTLK-PROMPT-AI-001: Self-hosted OCR (PaddleOCR) + LLM (Qwen 2.5)
// ═══════════════════════════════════════════════════════════════════
async function gatekeeperContractExtractHandler(event) {
  try {
    let { hire_id, contract_id, employee_id } = event.data.message.json;
    if (!hire_id && !contract_id) {
      throw new Error("hire_id or contract_id required in Pub/Sub message");
    }

    let docRef;
    let targetDoc;
    let storagePath;

    if (contract_id) {
      docRef = db.collection("contracts").doc(contract_id);
      const doc = await docRef.get();
      if (!doc.exists) throw new Error(`Contract not found: ${contract_id}`);
      targetDoc = doc.data();
      // HRContracts.jsx writes `pdf_storage_path`; the backend uploadContractPDF
      // writes `contract_pdf_storage_path`. Accept either.
      storagePath = targetDoc.contract_pdf_storage_path || targetDoc.pdf_storage_path;
      // employee_id can be on the doc itself as employee_id OR linked_employee_id
      employee_id = employee_id || targetDoc.employee_id || targetDoc.linked_employee_id || targetDoc.linked_employee_employee_id;
    } else {
      docRef = db.collection("pending_hires").doc(hire_id);
      const doc = await docRef.get();
      if (!doc.exists) throw new Error(`Hire not found: ${hire_id}`);
      targetDoc = doc.data();
      storagePath = targetDoc.contract_pdf_storage_path || targetDoc.pdf_storage_path;
    }

    if (!storagePath) throw new Error(`No contract PDF on document (looked for contract_pdf_storage_path and pdf_storage_path)`);

    // Step 1: Download PDF from Cloud Storage
    const bucket = admin.storage().bucket("datalake-worm-hr");
    const [pdfBuffer] = await bucket.file(storagePath).download();
    console.log(`[Gatekeeper] Downloaded contract PDF: ${storagePath} (${pdfBuffer.length} bytes)`);

    // Step 2: Try digital PDF text layer FIRST (Qiwa PDFs are digital — no OCR
    // needed). Only fall back to PaddleOCR on image-only scans.
    let fullText;
    let extractedVia;
    let ocrLineCount = 0;
    const textLayer = await tryPdfTextLayer(pdfBuffer);
    if (textLayer && textLayer.text) {
      fullText = textLayer.text;
      extractedVia = "pdf-parse";
      ocrLineCount = textLayer.lineCount;
      console.log(`[Gatekeeper] pdf-parse: ${textLayer.text.length} chars across ${textLayer.pageCount} page(s) — skipping OCR`);
    } else {
      console.log(`[Gatekeeper] No digital text layer — calling PaddleOCR fallback`);
      const ocrResult = await callOCR({
        fileBase64: pdfBuffer.toString("base64"),
        lang: "en",
        agent: "gatekeeper",
        type: "contract_ocr",
        triggeredBy: "system:pubsub",
      });
      if (!ocrResult.success || !ocrResult.lines?.length) {
        await docRef.update({
          contract_extraction_status: "OCR_FAILED",
          status: "EXTRACTION_FAILED",
          extraction_error: `OCR error: ${ocrResult.error || "No text extracted"}`,
          contract_extraction_error: `OCR error: ${ocrResult.error || "No text extracted"}`,
        });
        throw new Error(`OCR failed: ${ocrResult.error || "no text"}`);
      }
      fullText = ocrResult.lines.map((l) => l.text).join("\n");
      ocrLineCount = ocrResult.lines.length;
      extractedVia = "paddle-ocr";
      console.log(`[Gatekeeper] OCR fallback: ${ocrResult.lines.length} lines from contract`);
    }

    // Step 3: LLM
    // Truncate the input to ~15000 chars — the data-bearing pages of a Qiwa
    // contract are at the top; sending all 34k chars makes Qwen 7B prone to
    // "summarize" the input instead of extract. This keeps the first ~5
    // pages of clean text plus the start of the wage breakdown.
    const truncatedText = fullText.length > 15000 ? fullText.slice(0, 15000) : fullText;

    // JSON Schema for Ollama structured outputs. With this set the model
    // can ONLY emit a JSON object with these exact keys — no invented
    // "sections" array, no markdown prose, no commentary.
    const CONTRACT_EXTRACT_SCHEMA = {
      type: "object",
      properties: {
        employee_name:           { type: ["string", "null"] },
        employee_name_ar:        { type: ["string", "null"] },
        nationality:             { type: ["string", "null"] },
        date_of_birth:           { type: ["string", "null"] },
        marital_status:          { type: ["string", "null"] },
        education_level:         { type: ["string", "null"] },
        passport_number:         { type: ["string", "null"] },
        iqama_national_id:       { type: ["string", "null"] },
        contract_number:         { type: ["string", "null"] },
        contract_type:           { type: ["string", "null"] },
        auto_renewal:            { type: ["boolean", "null"] },
        auto_renewal_notice_days:{ type: ["number", "null"] },
        job_title:               { type: ["string", "null"] },
        client_name:             { type: ["string", "null"] },
        po_number:               { type: ["string", "null"] },
        po_value_sar:            { type: ["number", "null"] },
        contract_start_date:     { type: ["string", "null"] },
        contract_end_date:       { type: ["string", "null"] },
        salary_monthly_sar:      { type: ["number", "null"] },
        housing_allowance_sar:   { type: ["number", "null"] },
        transport_allowance_sar: { type: ["number", "null"] },
        currency:                { type: ["string", "null"] },
        probation_period_months: { type: ["number", "null"] },
        notice_period_days:      { type: ["number", "null"] },
        annual_leave_days:       { type: ["number", "null"] },
        working_hours_per_day:   { type: ["number", "null"] },
        working_days_per_week:   { type: ["number", "null"] },
        weekly_rest_day:         { type: ["string", "null"] },
        non_compete_years:       { type: ["number", "null"] },
        confidentiality_years:   { type: ["number", "null"] },
        bank_name:               { type: ["string", "null"] },
        iban:                    { type: ["string", "null"] },
        work_location:           { type: ["string", "null"] },
      },
      required: [
        "employee_name","employee_name_ar","job_title","contract_start_date","contract_end_date",
        "salary_monthly_sar","housing_allowance_sar","transport_allowance_sar","nationality",
        "iban","bank_name","annual_leave_days","contract_type","iqama_national_id",
        "passport_number","date_of_birth",
      ],
      additionalProperties: false,
    };

    const llmResult = await callLLM({
      agent: "gatekeeper",
      type: "contract_extract",
      triggeredBy: "system:pubsub",
      jsonSchema: CONTRACT_EXTRACT_SCHEMA,
      promptTemplateId: "GATEKEEPER_CONTRACT_EXTRACT_V6",
      systemPrompt: `Extract employment data from a Saudi employment contract. The text is the raw output of pdf-parse.

CRITICAL — GROUNDING: Extract ONLY values that appear in the contract text. Copy each value verbatim. If a field is not present in the text, output null. Never invent, guess, or substitute sample/placeholder values — no "John Doe", no example passport numbers, no made-up banks or IBANs.

RULES:
1. Extract ONLY what is explicitly written in the contract. Do not derive, calculate, assume, or fill in any value.
2. If a field is present, copy it exactly as written. If it is not present, use null.
3. Do not infer salary breakdowns from percentages. Do not apply any policy. Read the actual printed numbers.
3b. CURRENCY — DO NOT CONVERT. Record every money amount exactly as printed. Put the contract's currency code in "currency" (e.g. SAR, USD, EUR, TND, AED). If the contract prints amounts in a foreign currency, put those printed numbers in the salary/allowance fields AS-IS and set "currency" to that foreign code — never convert to SAR, never guess an exchange rate. If no currency is printed, set "currency" to "SAR".
4. Numbers: digits only, no commas, no currency words. Convert Arabic digits ٠١٢٣٤٥٦٧٨٩ to 0-9.
5. Dates: YYYY-MM-DD, Gregorian.
6. English fields: Latin letters only. Arabic field: Arabic letters only.
7. Booleans: true/false only, not strings. If absent, null.
8. Return ONLY raw JSON. No markdown. No commentary. No code fences.

FIELDS:
{
  "employee_name": string|null,
  "employee_name_ar": string|null,
  "nationality": string|null,
  "date_of_birth": "YYYY-MM-DD"|null,
  "marital_status": string|null,
  "education_level": string|null,
  "passport_number": string|null,
  "iqama_national_id": string|null,
  "contract_number": string|null,
  "contract_type": "fixed_term"|"indefinite"|null,
  "auto_renewal": boolean|null,
  "auto_renewal_notice_days": number|null,
  "job_title": string|null,
  "client_name": string|null,
  "po_number": string|null,
  "po_value_sar": number|null,
  "contract_start_date": "YYYY-MM-DD"|null,
  "contract_end_date": "YYYY-MM-DD"|null,
  "salary_monthly_sar": number|null,
  "housing_allowance_sar": number|null,
  "transport_allowance_sar": number|null,
  "currency": string|null,
  "probation_period_months": number|null,
  "notice_period_days": number|null,
  "annual_leave_days": number|null,
  "working_hours_per_day": number|null,
  "working_days_per_week": number|null,
  "weekly_rest_day": string|null,
  "non_compete_years": number|null,
  "confidentiality_years": number|null,
  "bank_name": string|null,
  "iban": string|null,
  "work_location": string|null
}`,
      userPrompt: truncatedText,
    });

    if (!llmResult.success) {
      await docRef.update({
        contract_extraction_status: "LLM_FAILED",
        status: "EXTRACTION_FAILED",
        extraction_error: `LLM error: ${llmResult.error}`,
        contract_extraction_error: `LLM error: ${llmResult.error}`,
      });
      throw new Error(`LLM extraction failed: ${llmResult.error}`);
    }

    // Step 4: Parse and store extracted fields
    const parsed = parseJsonOutput(llmResult.output);
    if (!parsed.success) {
      // Capture the raw model output verbatim so we (and HR) can see exactly
      // what Qwen produced. Truncate to 4000 chars to stay well under
      // Firestore's 1MB doc limit while preserving the first JSON-looking
      // block that failed.
      const rawSnippet = String(llmResult.output || "").slice(0, 4000);
      await docRef.update({
        contract_extraction_status: "PARSE_FAILED",
        status: "EXTRACTION_FAILED",
        extraction_error: `Parsing error: AI output was not valid JSON. ${parsed.error || ""}`.trim(),
        contract_extraction_error: `Parsing error: AI output was not valid JSON. ${parsed.error || ""}`.trim(),
        extraction_raw_output: rawSnippet,
        extraction_raw_output_at: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.error(`[Gatekeeper] PARSE_FAILED — raw output: ${rawSnippet.slice(0, 500)}`);
      throw new Error("Parse failed");
    }

    const fields = parsed.data;
    const now = admin.firestore.FieldValue.serverTimestamp();

    // Currency guard — the AI extracts amount + currency verbatim and converts
    // NOTHING (no LLM-invented FX rates). A contract in SAR (or with no currency
    // printed, on a Saudi contract) is treated as SAR; any other currency means
    // the printed amounts are NOT SAR, so we must NOT copy them into the SAR
    // salary fields on the employee/hire record — Finance converts manually.
    const rawCurrency = String(fields.currency || "").trim().toUpperCase();
    const SAR_ALIASES = ["", "SAR", "SR", "SARS", "ر.س", "﷼", "RIYAL", "SAUDI RIYAL", "SAUDI RIYALS"];
    const isSar = SAR_ALIASES.includes(rawCurrency);
    fields.currency = rawCurrency || "SAR"; // normalise for storage + display

    // Helper: only mirror a money field to a SAR record field when it IS SAR.
    const sarMoney = (val) => (isSar && val ? Number(val) : undefined);

    // Mirror status fields so both the gatekeeper-facing
    // `contract_extraction_status` and the UI-facing `status` flip together —
    // HRContracts.jsx reads `c.status || c.contract_extraction_status`, so if
    // we only update one the UI sticks on "Extracting…".
    const update = {
      contract_extracted_fields: fields,
      contract_extraction_status: "EXTRACTED",
      status: "EXTRACTED",
      contract_extracted_at: now,
      contract_ocr_lines: ocrLineCount,
      contract_extraction_method: extractedVia,
      contract_extraction_model: MODEL_NAME,
      extraction_error: null,
      contract_extraction_error: null,
    };

    if (hire_id) {
      // SAR money fields only when the contract IS in SAR (else Finance converts).
      const salarySar = sarMoney(fields.salary_monthly_sar);
      const housingSar = sarMoney(fields.housing_allowance_sar);
      const transportSar = sarMoney(fields.transport_allowance_sar);
      const poSar = sarMoney(fields.po_value_sar);
      if (salarySar !== undefined) update.salary_monthly = salarySar;
      if (fields.contract_start_date) update.start_date = fields.contract_start_date;
      if (fields.job_title) update.job_title = fields.job_title;
      if (fields.po_number) update.po_number = fields.po_number;
      if (poSar !== undefined) update.po_value_sar = poSar;
      if (fields.contract_end_date) update.contract_end_date = fields.contract_end_date;
      if (housingSar !== undefined) update.housing_allowance_sar = housingSar;
      if (transportSar !== undefined) update.transport_allowance_sar = transportSar;
      if (fields.work_location) update.work_location = fields.work_location;
      if (!isSar) update.salary_currency = fields.currency; // flag for the SAR-conversion step
      await docRef.update(update);
    } else {
      await docRef.update(update);
      // Write extracted fields directly to employees/{employee_id}
      const employeeUpdate = {};
      if (fields.employee_name) employeeUpdate.full_name = fields.employee_name;
      if (fields.employee_name_ar) employeeUpdate.full_name_ar = fields.employee_name_ar;
      if (fields.job_title) employeeUpdate.job_title = fields.job_title;
      if (fields.client_name) employeeUpdate.client_name = fields.client_name;
      if (fields.po_number) employeeUpdate.po_number = fields.po_number;
      if (sarMoney(fields.po_value_sar) !== undefined) employeeUpdate.po_value_sar = sarMoney(fields.po_value_sar);
      if (fields.contract_start_date) employeeUpdate.contract_start = fields.contract_start_date;
      if (fields.contract_end_date) employeeUpdate.contract_end = fields.contract_end_date;
      if (sarMoney(fields.salary_monthly_sar) !== undefined) employeeUpdate.salary_monthly = sarMoney(fields.salary_monthly_sar);
      if (sarMoney(fields.housing_allowance_sar) !== undefined) employeeUpdate.housing_allowance_sar = sarMoney(fields.housing_allowance_sar);
      if (sarMoney(fields.transport_allowance_sar) !== undefined) employeeUpdate.transport_allowance_sar = sarMoney(fields.transport_allowance_sar);
      if (fields.work_location) employeeUpdate.work_location = fields.work_location;
      if (fields.iqama_national_id) employeeUpdate.national_id = fields.iqama_national_id;
      if (!isSar) employeeUpdate.salary_currency = fields.currency; // foreign — Finance converts to SAR manually

      await db.collection("employees").doc(employee_id).set(employeeUpdate, { merge: true });
    }

    // Step 5: Audit log
    await db.collection("task_audit_log").add({
      event: "CONTRACT_AI_EXTRACTED",
      action_by: "system:gatekeeperContractExtract",
      action_at: now,
      details: {
        target_id: contract_id || hire_id,
        fields_extracted: Object.keys(fields).filter((k) => fields[k] != null),
        fields_null: Object.keys(fields).filter((k) => fields[k] == null),
        ocr_lines: ocrLineCount,
        extraction_method: extractedVia,
        ai_model: MODEL_NAME,
        inference_ms: llmResult.inferenceMs,
      },
    });

    console.log(`[Gatekeeper] Contract extraction complete for ${contract_id || hire_id}: ${Object.keys(fields).filter((k) => fields[k] != null).length}/15 fields extracted`);
  } catch (err) {
    console.error("gatekeeperContractExtract error:", err);
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
    "We are pleased to extend an offer of employment with Datalake Saudi Arabia LLC.",
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
    LEGAL_EMAIL_FOOTER,
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

// ═══════════════════════════════════════════════════════════════════
// 8. syncContractToEmployee — onDocumentUpdated trigger (contracts/{contractId})
// ═══════════════════════════════════════════════════════════════════
async function syncContractToEmployeeHandler(event) {
  const before = event.data.before.data();
  const after = event.data.after.data();

  // Fire when:
  // 1. Status changes to REVIEWED or APPROVED (HR saved their review)
  // 2. reviewed_fields or contract_extracted_fields changed while in those states
  const validStatuses = ["REVIEWED", "APPROVED"];
  if (!validStatuses.includes(after.contract_extraction_status)) return;
  if (!after.employee_id) return;

  const statusChanged = after.contract_extraction_status !== before.contract_extraction_status;
  const reviewedFieldsChanged = JSON.stringify(after.reviewed_fields) !== JSON.stringify(before.reviewed_fields);
  const extractedFieldsChanged = JSON.stringify(after.contract_extracted_fields) !== JSON.stringify(before.contract_extracted_fields);

  if (!statusChanged && !reviewedFieldsChanged && !extractedFieldsChanged) return;

  // Prefer reviewed_fields (HR-edited) over raw AI extraction
  const fields = { ...(after.contract_extracted_fields || {}), ...(after.reviewed_fields || {}) };
  if (Object.keys(fields).length === 0) return;

  const num = (v) => (v === '' || v == null ? null : Number(v));
  const employeeUpdate = {};

  // Map all 15 Gatekeeper fields to employee document schema
  if (fields.employee_name) employeeUpdate.full_name = fields.employee_name;
  if (fields.employee_name_ar) employeeUpdate.full_name_ar = fields.employee_name_ar;
  if (fields.job_title) employeeUpdate.job_title = fields.job_title;
  if (fields.client_name) employeeUpdate.client_name = fields.client_name;
  if (fields.po_number) employeeUpdate.po_number = fields.po_number;
  if (fields.po_value_sar) employeeUpdate.po_value_sar = num(fields.po_value_sar);
  if (fields.contract_start_date) employeeUpdate.contract_start = fields.contract_start_date;
  if (fields.contract_end_date) employeeUpdate.contract_end = fields.contract_end_date;
  if (fields.salary_monthly_sar) {
    employeeUpdate.salary_monthly = num(fields.salary_monthly_sar);
    employeeUpdate.salary = num(fields.salary_monthly_sar); // convenience alias
  }
  if (fields.housing_allowance_sar) employeeUpdate.housing_allowance_sar = num(fields.housing_allowance_sar);
  if (fields.transport_allowance_sar) employeeUpdate.transport_allowance_sar = num(fields.transport_allowance_sar);
  if (fields.probation_period_months) employeeUpdate.probation_period_months = num(fields.probation_period_months);
  if (fields.notice_period_days) employeeUpdate.notice_period_days = num(fields.notice_period_days);
  if (fields.work_location) employeeUpdate.work_location = fields.work_location;
  if (fields.iqama_national_id) employeeUpdate.national_id = fields.iqama_national_id;

  // V5 fields — personal, contract structure, banking, schedule.
  if (fields.nationality) employeeUpdate.nationality = fields.nationality;
  if (fields.date_of_birth) employeeUpdate.date_of_birth = fields.date_of_birth;
  if (fields.marital_status) employeeUpdate.marital_status = fields.marital_status;
  if (fields.education_level) employeeUpdate.education_level = fields.education_level;
  if (fields.passport_number) employeeUpdate.passport_number = fields.passport_number;
  if (fields.contract_number) employeeUpdate.contract_number = fields.contract_number;
  if (fields.contract_type) employeeUpdate.contract_type = fields.contract_type;
  if (typeof fields.auto_renewal === 'boolean') employeeUpdate.auto_renewal = fields.auto_renewal;
  if (fields.auto_renewal_notice_days != null) employeeUpdate.auto_renewal_notice_days = num(fields.auto_renewal_notice_days);
  if (fields.annual_leave_days != null) employeeUpdate.annual_leave_days = num(fields.annual_leave_days);
  if (fields.working_hours_per_day != null) employeeUpdate.working_hours_per_day = num(fields.working_hours_per_day);
  if (fields.working_days_per_week != null) employeeUpdate.working_days_per_week = num(fields.working_days_per_week);
  if (fields.weekly_rest_day) employeeUpdate.weekly_rest_day = fields.weekly_rest_day;
  if (fields.non_compete_years != null) employeeUpdate.non_compete_years = num(fields.non_compete_years);
  if (fields.confidentiality_years != null) employeeUpdate.confidentiality_years = num(fields.confidentiality_years);
  if (fields.bank_name) employeeUpdate.bank_name = fields.bank_name;
  if (fields.iban) employeeUpdate.bank_iban = fields.iban;

  if (Object.keys(employeeUpdate).length === 0) return;

  // Add sync metadata
  employeeUpdate.contract_synced_from = event.params.contractId;
  employeeUpdate.contract_synced_at = admin.firestore.FieldValue.serverTimestamp();
  employeeUpdate.updated_at = admin.firestore.FieldValue.serverTimestamp();

  await db.collection("employees").doc(after.employee_id).set(employeeUpdate, { merge: true });
  console.log(`[Contract Sync] Synced ${Object.keys(employeeUpdate).length - 3} fields to employee ${after.employee_id} from contract ${event.params.contractId}`);
}

// ═══════════════════════════════════════════════════════════════════
// 9. retryContractExtraction — HTTP endpoint (CEO/HR only)
//    Re-publishes datalake.contract.uploaded for an existing contract
//    so HR can recover from OCR/LLM timeouts without re-uploading the PDF.
// ═══════════════════════════════════════════════════════════════════
async function retryContractExtractionHandler(req, res, helpers) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "POST required" });

    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!idToken) return res.status(401).json({ error: "Missing auth token" });

    const decoded = await admin.auth().verifyIdToken(idToken);
    const profile = await helpers.getUserAccessProfile(decoded.uid);
    if (!profile || !["ceo", "hr"].includes(profile.role_id)) {
      return res.status(403).json({ error: "Only CEO or HR may retry contract extraction" });
    }

    const { contract_id, hire_id } = req.body || {};
    if (!contract_id && !hire_id) {
      return res.status(400).json({ error: "contract_id or hire_id required" });
    }

    let docRef;
    let payload;
    if (contract_id) {
      docRef = db.collection("contracts").doc(contract_id);
      const snap = await docRef.get();
      if (!snap.exists) return res.status(404).json({ error: "Contract not found" });
      const data = snap.data();
      if (!data.contract_pdf_storage_path) {
        return res.status(400).json({ error: "Contract has no PDF — re-upload instead" });
      }
      payload = { contract_id, employee_id: data.employee_id };
    } else {
      docRef = db.collection("pending_hires").doc(hire_id);
      const snap = await docRef.get();
      if (!snap.exists) return res.status(404).json({ error: "Hire not found" });
      const data = snap.data();
      if (!data.contract_pdf_storage_path) {
        return res.status(400).json({ error: "Hire has no PDF — re-upload instead" });
      }
      payload = { hire_id };
    }

    await docRef.update({
      contract_extraction_status: "PENDING",
      extraction_error: null,
      contract_extraction_error: null,
      retry_requested_at: admin.firestore.FieldValue.serverTimestamp(),
      retry_requested_by: profile.email,
    });

    await pubsub.topic("datalake.contract.uploaded").publishMessage({ json: payload });

    await db.collection("task_audit_log").add({
      event: "CONTRACT_EXTRACTION_RETRIED",
      action_by: profile.email,
      action_at: admin.firestore.FieldValue.serverTimestamp(),
      details: { contract_id: contract_id || null, hire_id: hire_id || null },
      ip_address: req.ip || req.headers["x-forwarded-for"] || "unknown",
    });

    return res.status(200).json({ success: true, message: "Extraction re-queued." });
  } catch (err) {
    console.error("retryContractExtraction error:", err);
    return res.status(500).json({ error: "Internal server error", detail: err.message });
  }
}

module.exports = {
  initiateHireHandler,
  generateContractHandler,
  gatekeeperContractDraftHandler,
  dispatchContractHandler,
  recordSignatureHandler,
  provisionEngineerHandler,
  uploadContractPDFHandler,
  gatekeeperContractExtractHandler,
  syncContractToEmployeeHandler,
  retryContractExtractionHandler,
};
