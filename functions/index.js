const { onRequest } = require("firebase-functions/v2/https");
const { onMessagePublished } = require("firebase-functions/v2/pubsub");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentCreated, onDocumentUpdated, onDocumentWritten } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
const { v4: uuidv4 } = require("uuid");
const Busboy = require("busboy");
const crypto = require("crypto");
const pdfParse = require("pdf-parse"); // digital-PDF text layer for CV extraction (no PaddleOCR)
const { PubSub } = require("@google-cloud/pubsub");
const pubsub = new PubSub();
const { setGlobalOptions } = require("firebase-functions/v2");
const { httpErrorStatus } = require("./lib/httpErrors");
// NOTE: VertexAI / Gemini removed per DTLK-PROMPT-AI-001.
// All AI inference now runs on the self-hosted Gemma 3 backend (Ollama, me-central2)
// — the in-KSA GPU VM (datalake-ai-gpu) reached privately over the VPC connector.

// Attach the Serverless VPC connector so functions can reach the in-KSA GPU VM
// (Gemma 3, private IP 10.216.0.2:11434). PRIVATE_RANGES_ONLY: only RFC-1918
// destinations use the connector; all public egress (BigQuery, Gmail, Firestore,
// Cloud Run, Zoho) stays on the direct path — so non-AI functions are unaffected.
setGlobalOptions({
  region: "me-central2",
  vpcConnector: "datalake-ai-connector",
  vpcConnectorEgressSettings: "PRIVATE_RANGES_ONLY",
});

const { callLLM, callOCR, parseJsonOutput, MODEL_NAME } = require("./lib/ai-client");
const { LEGAL_EMAIL_FOOTER } = require("./lib/company-legal");

admin.initializeApp();
const db = admin.firestore();
const bucket = admin.storage().bucket("datalake-cv-uploads");
const { getUserAccessProfile, logAccessEvent } = require("./lib/access");

// ── CORS origin whitelist ──
// Only production hosting + localhost dev are allowed.
// Update when custom domain (e.g. app.datalake.sa) is configured.
const ALLOWED_ORIGINS = [
  "https://datalake-production-sa.web.app",
  "https://datalake-production-sa.firebaseapp.com",
  "http://localhost:5173",   // Vite dev server
  "http://localhost:4173",   // Vite preview
];

// HTTP endpoint: submitCareerApplication
// Accepts multipart/form-data: candidate fields + cv file
// Writes to Firestore talent_pool collection with state=PENDING_CONSENT
exports.submitCareerApplication = onRequest({
    invoker: 'public',
    region: "me-central2",
    memory: "512MiB",
    timeoutSeconds: 60,
    cors: ALLOWED_ORIGINS,
    
    
  },
  async (req, res) => {
    // CORS headers
    res.set("Access-Control-Allow-Origin", "https://datalake-production-sa.web.app");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Max-Age", "3600");
      return res.status(204).send("");
    }
    // CORS headers
    res.set("Access-Control-Allow-Origin", "https://datalake-production-sa.web.app");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    // Career applications are multipart/form-data (CV upload). A non-multipart
    // body makes Busboy throw → guard it as a 400 instead of an unhandled 500.
    if (!String(req.headers["content-type"] || "").includes("multipart/form-data")) {
      return res.status(400).json({ error: "Content-Type must be multipart/form-data" });
    }
    let busboy;
    try {
      busboy = Busboy({ headers: req.headers });
    } catch (e) {
      return res.status(400).json({ error: "Malformed multipart request" });
    }
    busboy.on("error", (e) => {
      console.error("submitCareerApplication busboy error:", e.message);
      if (!res.headersSent) res.status(400).json({ error: "Malformed upload" });
    });
    const fields = {};
    let cvFile = null;
    let cvFilename = null;
    let cvMimetype = null;

    busboy.on("field", (fieldname, val) => {
      fields[fieldname] = val;
    });

    busboy.on("file", (fieldname, file, info) => {
      if (fieldname === "cv") {
        cvFilename = info.filename;
        cvMimetype = info.mimeType;
        const chunks = [];
        file.on("data", (chunk) => chunks.push(chunk));
        file.on("end", () => {
          cvFile = Buffer.concat(chunks);
        });
      } else {
        file.resume();
      }
    });

    busboy.on("finish", async () => {
      try {
        // Accept optional job_listing_id from multipart form
        const job_listing_id = fields.job_listing_id || null;

        // Validate required fields
        const required = ["full_name", "email", "phone", "location", "consent_granted"];
        for (const f of required) {
          if (!fields[f]) {
            res.status(400).json({ error: `Missing required field: ${f}` });
            return;
          }
        }

        if (fields.consent_granted !== "true") {
          res.status(400).json({ error: "PDPL consent required" });
          return;
        }

        if (!cvFile) {
          res.status(400).json({ error: "CV file required" });
          return;
        }

        // Generate candidate ID
        const year = new Date().getFullYear();
        const serial = Math.floor(1000 + Math.random() * 9000);
        const candidateId = `C-${year}-${serial}`;

        // Upload CV to Cloud Storage
        const cvPath = `cvs/${candidateId}/${uuidv4()}-${cvFilename}`;
        const file = bucket.file(cvPath);
        await file.save(cvFile, {
          metadata: {
            contentType: cvMimetype,
            metadata: {
              candidate_id: candidateId,
              uploaded_at: new Date().toISOString(),
            },
          },
        });

        // Write to Firestore talent_pool
        const now = admin.firestore.FieldValue.serverTimestamp();
        const docRef = db.collection("talent_pool").doc(candidateId);
        await docRef.set({
          candidate_id: candidateId,
          full_name: fields.full_name,
          email: fields.email,
          phone: fields.phone,
          location: fields.location,
          experience: fields.experience || null,
          notice_period: fields.notice_period || null,
          skills: fields.skills ? fields.skills.split(",").map((s) => s.trim()) : [],
          linkedin_url: fields.linkedin_url || null,
          current_employer: fields.current_employer || null,
          salary_expectation: fields.salary_expectation || null,
          role_interest: fields.role_interest || null,
          cv_path: cvPath,
          source_channel: "WEBSITE",
          state: "APPLIED",
          applied_at: now,
          job_listing_id: job_listing_id,
          lifecycle_history: [{
            state: "APPLIED",
            timestamp: new Date().toISOString(),
            actor: "system:submitCareerApplication",
            notes: "Application submitted via careers page"
          }],
          consent_granted_at: now,
          consent_text_version: "v1.0",
          consent_ip_address:
            req.ip || req.headers["x-forwarded-for"] || "unknown",
          pdpl_purge_after: admin.firestore.Timestamp.fromDate(
            new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
          ),
          created_at: now,
          updated_at: now,
        });

        // Audit log entry
        await db.collection("audit_log").add({
          event: "CAREER_APPLICATION_SUBMITTED",
          candidate_id: candidateId,
          timestamp: now,
          ip_address: req.ip || "unknown",
          user_agent: req.headers["user-agent"] || "unknown",
        });

        // ── FIRE-AND-FORGET: CV Extraction (Gatekeeper AI) ──
        (async () => {
          try {
            console.log(`[Gatekeeper AI] Starting background CV extraction for ${candidateId}`);
            const CV_SYS = `You are the Datalake Gatekeeper AI. Extract structured data from this CV.
GROUNDING: Extract ONLY information actually present in the CV. If a field is not present, use null. Never invent names, employers, dates, emails, phones, certifications, or skills.
Return ONLY a valid JSON object with these exact fields (use null for any not found):
{
  "full_name": "candidate full name",
  "email": "email address",
  "phone": "phone number with country code",
  "location": "city and country",
  "nationality": "nationality if mentioned",
  "years_experience": "one of: 0-2 years, 3-5 years, 6-10 years, 10+ years",
  "current_employer": "current or most recent company",
  "current_role": "current or most recent job title",
  "skills": ["skill1", "skill2"],
  "education": [{"degree": "...", "institution": "...", "year": "..."}],
  "certifications": ["cert1", "cert2"]
}
Return valid JSON only, no markdown.`;
            // Images -> Gemma vision; digital PDFs -> pdf-parse text -> Gemma. No PaddleOCR.
            let llmResult;
            if ((cvMimetype || "").startsWith("image/")) {
              llmResult = await callLLM({
                agent: "gatekeeper", type: "cv_extract", triggeredBy: "system:submitCareerApplication",
                promptTemplateId: "GATEKEEPER_CV_EXTRACT_V2_VISION",
                systemPrompt: CV_SYS,
                userPrompt: "Read this CV image and extract the candidate data as JSON.",
                jsonMode: true,
                images: [{ base64: cvFile.toString("base64"), mimeType: cvMimetype }],
              });
            } else {
              let fullText = "";
              try { fullText = ((await pdfParse(cvFile)).text || "").trim(); } catch (e) { console.warn("pdf-parse failed:", e.message); }
              if (!fullText) throw new Error("Scanned PDF with no text layer — cannot extract (upload an image instead)");
              llmResult = await callLLM({
                agent: "gatekeeper", type: "cv_extract", triggeredBy: "system:submitCareerApplication",
                promptTemplateId: "GATEKEEPER_CV_EXTRACT_V2",
                systemPrompt: CV_SYS,
                userPrompt: fullText,
                jsonMode: true,
              });
            }

            if (llmResult.success) {
              const parsed = parseJsonOutput(llmResult.output);
              if (parsed.success) {
                await db.collection("talent_pool").doc(candidateId).update({
                  ai_extracted_data: parsed.data,
                  ai_extracted_at: admin.firestore.FieldValue.serverTimestamp(),
                  ai_extraction_status: "COMPLETED"
                });
                console.log(`[Gatekeeper AI] CV extraction complete for ${candidateId}`);
              }
            }
          } catch (aiErr) {
            console.error(`[Gatekeeper AI] Background extraction error for ${candidateId}:`, aiErr.message);
            await db.collection("talent_pool").doc(candidateId).update({
              ai_extraction_status: "FAILED",
              ai_extraction_error: aiErr.message
            });
          }
        })();

        res.status(200).json({
          success: true,
          candidate_id: candidateId,
          message:
            "Application received. You will receive a confirmation email shortly.",
        });
      } catch (err) {
        console.error("submitCareerApplication error:", err);
        res
          .status(500)
          .json({ error: "Internal server error", detail: err.message });
      }
    });

    busboy.end(req.rawBody);
  }
);

// HTTP endpoint: extractTimesheetAI
// Parses a timesheet PDF/image using OCR and LLM to extract daily hours
exports.extractTimesheetAI = onRequest(
  {
    region: "me-central2",
    memory: "1GiB",
    timeoutSeconds: 120,
    cors: ALLOWED_ORIGINS,
    
    
  },
  async (req, res) => {
    // CORS headers
    res.set("Access-Control-Allow-Origin", "https://datalake-production-sa.web.app");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Max-Age", "3600");
      return res.status(204).send("");
    }
    res.set("Access-Control-Allow-Origin", "https://datalake-production-sa.web.app");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) return res.status(401).json({ error: "Missing authorization" });

    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(authHeader.split("Bearer ")[1]);
    } catch (err) {
      return res.status(401).json({ error: "Invalid token" });
    }

    const busboy = Busboy({ headers: req.headers });
    let fileBuffer = null;

    busboy.on("file", (fieldname, file) => {
      if (fieldname === "file") {
        const chunks = [];
        file.on("data", (chunk) => chunks.push(chunk));
        file.on("end", () => { fileBuffer = Buffer.concat(chunks); });
      } else {
        file.resume();
      }
    });

    busboy.on("finish", async () => {
      try {
        if (!fileBuffer) return res.status(400).json({ error: "File required" });

        console.log(`[AI Extraction] Starting OCR for ${decodedToken.email}`);
        const fileBase64 = fileBuffer.toString("base64");
        
        const ocrResult = await callOCR({
          fileBase64, lang: "en", agent: "auditor", type: "timesheet_ocr", triggeredBy: decodedToken.uid
        });
        if (!ocrResult.success) throw new Error("OCR extraction failed");

        const fullText = ocrResult.lines.map(l => l.text).join("\n");
        if (!fullText.trim()) throw new Error("No text found in document");

        console.log(`[AI Extraction] OCR complete. Starting LLM extraction for ${decodedToken.email}`);
        const llmResult = await callLLM({
          agent: "auditor", type: "timesheet_extract", triggeredBy: decodedToken.uid,
          promptTemplateId: "AUDITOR_TIMESHEET_EXTRACT_V1",
          systemPrompt: `You are the Datalake AI Auditor. Extract daily hours from this timesheet text.
Return ONLY a valid JSON object matching this schema:
{
  "dayHours": {
    "2026-05-01": "8",
    "2026-05-02": "8"
  }
}
The keys must be YYYY-MM-DD format. The values must be strings representing the hours worked that day (e.g. "8", "8.5"). Only include days with hours > 0.
Return valid JSON only, no markdown.`,
          userPrompt: fullText
        });

        if (!llmResult.success) throw new Error("LLM extraction failed");

        const parsed = parseJsonOutput(llmResult.output);
        if (!parsed.success) throw new Error("Failed to parse LLM output");

        res.status(200).json({
          success: true,
          dayHours: parsed.data.dayHours || {}
        });
      } catch (err) {
        console.error("extractTimesheetAI error:", err);
        res.status(500).json({ error: "AI Extraction failed", detail: err.message });
      }
    });

    busboy.end(req.rawBody);
  }
);

// HTTP endpoint: createTask
// Creates a new task in Firestore tasks collection
// Requires Google SSO auth (CEO only in v1)
exports.createTask = onRequest(
  {
    region: "me-central2",
    memory: "512MiB",
    timeoutSeconds: 30,
    cors: ALLOWED_ORIGINS,
    
    
  },
  async (req, res) => {
    // CORS headers
    res.set("Access-Control-Allow-Origin", "https://datalake-production-sa.web.app");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Max-Age", "3600");
      return res.status(204).send("");
    }
    // CORS headers
    res.set("Access-Control-Allow-Origin", "https://datalake-production-sa.web.app");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    // Verify Firebase ID token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing or invalid authorization" });
      return;
    }

    const idToken = authHeader.split("Bearer ")[1];
    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(idToken);
    } catch (err) {
      res.status(401).json({ error: "Invalid token", detail: err.message });
      return;
    }

    // Only CEO can create tasks in v1
    if (decodedToken.email !== "m.alqumri@datalake.sa") {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }

    try {
      const body = req.body;

      // Validate required fields
      const required = [
        "title",
        "description",
        "assigned_to_type",
        "task_type",
        "priority",
        "due_at",
        "escalation_type",
      ];
      for (const f of required) {
        if (!body[f]) {
          res.status(400).json({ error: `Missing required field: ${f}` });
          return;
        }
      }

      // Generate task ID
      const year = new Date().getFullYear();
      const month = String(new Date().getMonth() + 1).padStart(2, "0");
      const random = Math.floor(1000 + Math.random() * 9000);
      const taskId = `TSK-${year}-${month}${random}`;

      const now = admin.firestore.FieldValue.serverTimestamp();
      const dueDate = new Date(body.due_at);
      if (isNaN(dueDate.getTime())) {
        res.status(400).json({ error: "Invalid due_at date format" });
        return;
      }

      const taskRecord = {
        task_id: taskId,
        title: body.title,
        description: body.description,
        task_type: body.task_type,
        creation_method: "MANUAL",
        created_by: decodedToken.email,
        created_at: now,
        assigned_to_type: body.assigned_to_type,
        assigned_to_id: body.assigned_to_id || null,
        assigned_to_role: body.assigned_to_role || null,
        priority: body.priority,
        escalation_type: body.escalation_type,
        due_at: admin.firestore.Timestamp.fromDate(dueDate),
        location: body.location || null,
        location_details: body.location_details || null,
        compliance_tag: body.compliance_tag || "NONE",
        related_entity_type: body.related_entity_type || "NONE",
        related_entity_id: body.related_entity_id || null,
        state: "OPEN",
        completed_at: null,
        completed_by: null,
        completion_evidence: null,
        evidence_verified: false,
        recurrence: body.recurrence || "ONE_TIME",
        notes: body.notes || null,
      };

      await db.collection("tasks").doc(taskId).set(taskRecord);

      // Audit log
      await db.collection("audit_log").add({
        event: "TASK_CREATED",
        task_id: taskId,
        created_by: decodedToken.email,
        assigned_to:
          body.assigned_to_type +
          ":" +
          (body.assigned_to_id || body.assigned_to_role || "unknown"),
        priority: body.priority,
        timestamp: now,
      });

      res.status(200).json({
        success: true,
        task_id: taskId,
        message: "Task created successfully",
      });
    } catch (err) {
      console.error("createTask error:", err);
      res
        .status(500)
        .json({ error: "Internal server error", detail: err.message });
    }
  }
);

// HTTP endpoint: submitHRScore
// Submits HR interview scorecard for a candidate
// Requires Google SSO auth (@datalake.sa accounts)
exports.submitHRScore = onRequest(
  {
    region: "me-central2",
    memory: "512MiB",
    timeoutSeconds: 30,
    cors: ALLOWED_ORIGINS,
    
    
  },
  async (req, res) => {
    // CORS headers
    res.set("Access-Control-Allow-Origin", "https://datalake-production-sa.web.app");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Max-Age", "3600");
      return res.status(204).send("");
    }
    // CORS headers
    res.set("Access-Control-Allow-Origin", "https://datalake-production-sa.web.app");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing authorization" });
      return;
    }

    const idToken = authHeader.split("Bearer ")[1];
    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(idToken);
    } catch (err) {
      res.status(401).json({ error: "Invalid token" });
      return;
    }

    try {
      const body = req.body;
      const { candidate_id, scores, hr_interview_notes } = body;

      if (!candidate_id || !scores || !Array.isArray(scores)) {
        res.status(400).json({ error: "Missing candidate_id or scores array" });
        return;
      }
      if (!hr_interview_notes || !hr_interview_notes.trim()) {
        res.status(400).json({ error: "hr_interview_notes (overall interview notes) is required per DTLK-OPS-PRC-002" });
        return;
      }

      // Verify candidate exists
      const candidateRef = db.collection("talent_pool").doc(candidate_id);
      const candidateDoc = await candidateRef.get();
      if (!candidateDoc.exists) {
        res.status(404).json({ error: "Candidate not found" });
        return;
      }

      // Validate all 7 criteria present
      const requiredCriteria = [
        "communication_clarity",
        "cultural_fit",
        "ksa_work_authorization",
        "availability_start_date",
        "salary_expectation_alignment",
        "reference_checks",
        "relocation_willingness",
      ];

      for (const criterion of requiredCriteria) {
        const found = scores.find((s) => s.criterion === criterion);
        if (!found) {
          res
            .status(400)
            .json({ error: `Missing criterion: ${criterion}` });
          return;
        }
        if (
          found.notes === undefined ||
          found.notes === null ||
          found.notes.trim() === ""
        ) {
          res
            .status(400)
            .json({ error: `Missing notes for criterion: ${criterion}` });
          return;
        }
      }

      // Check pass/fail gates
      const passFailCriteria = [
        "ksa_work_authorization",
        "salary_expectation_alignment",
        "reference_checks",
      ];
      let hardFail = false;
      let hardFailReason = null;
      for (const pf of passFailCriteria) {
        const entry = scores.find((s) => s.criterion === pf);
        if (entry && entry.pass_fail === "FAIL") {
          hardFail = true;
          hardFailReason = pf;
          break;
        }
      }

      // Calculate weighted score
      const weights = {
        communication_clarity: 15,
        cultural_fit: 15,
        ksa_work_authorization: 20,
        availability_start_date: 15,
        salary_expectation_alignment: 20,
        reference_checks: 10,
        relocation_willingness: 5,
      };

      let totalWeightedScore = 0;
      for (const s of scores) {
        if (s.pass_fail) {
          totalWeightedScore +=
            s.pass_fail === "PASS" ? weights[s.criterion] : 0;
        } else {
          totalWeightedScore +=
            (s.raw_score / 5) * weights[s.criterion];
        }
      }

      const hrScore = Math.round(totalWeightedScore);
      const passed = !hardFail && hrScore >= 70;

      const now = admin.firestore.FieldValue.serverTimestamp();

      // Write individual evaluation records
      const batch = db.batch();
      for (const s of scores) {
        const evalRef = db.collection("evaluations").doc();
        batch.set(evalRef, {
          candidate_id: candidate_id,
          evaluation_stage: "HR_SCREEN",
          evaluator_id: decodedToken.email,
          evaluator_org: "DATALAKE",
          criterion_key: s.criterion,
          raw_score: s.raw_score || null,
          pass_fail: s.pass_fail || null,
          weight_applied: weights[s.criterion],
          weighted_score: s.pass_fail
            ? s.pass_fail === "PASS"
              ? weights[s.criterion]
              : 0
            : (s.raw_score / 5) * weights[s.criterion],
          evaluator_notes: s.notes,
          submitted_at: now,
          ip_address: req.ip || "unknown",
        });
      }
      await batch.commit();

      const oldState = candidateDoc.data().state;
      // Lifecycle state transition
      let newState;
      if (hardFail) {
        newState = "REJECTED";
      } else if (passed) {
        newState = "SHORTLISTED";
      } else {
        newState = "SCREENED"; // Below threshold but not hard fail — HR can override
      }

      const lifecycleEntry = {
        state: newState,
        timestamp: new Date().toISOString(),
        actor: decodedToken.email,
        notes: hardFail
          ? `Hard fail: ${hardFailReason}. Score: ${hrScore}/100`
          : `HR score: ${hrScore}/100. ${passed ? 'Passed threshold.' : 'Below threshold (70).'}`
      };

      // Update candidate record with HR score and lifecycle
      await candidateRef.update({
        hr_score: hrScore,
        hr_passed: passed,
        hr_hard_fail: hardFail,
        hr_hard_fail_reason: hardFailReason,
        hr_evaluated_by: decodedToken.email,
        hr_evaluated_at: now,
        hr_interview_notes: hr_interview_notes,
        state: newState,
        scoring_stage: passed ? "S3_CLIENT_EVAL" : hardFail ? "S2_HR_REJECTED" : "S2_HR_BELOW_THRESHOLD",
        updated_at: now,
        lifecycle_history: admin.firestore.FieldValue.arrayUnion(lifecycleEntry),
      });

      // Firestore audit log
      await db.collection("task_audit_log").add({
        event: "HR_SCORE_SUBMITTED",
        candidate_id: candidate_id,
        action_by: decodedToken.email,
        action_at: now,
        old_state: oldState,
        new_state: newState,
        details: {
          hr_score: hrScore,
          passed: passed,
          hard_fail: hardFail,
          hard_fail_reason: hardFailReason,
          hr_interview_notes: hr_interview_notes,
        },
        ip_address: req.ip || "unknown",
        user_agent: req.headers["user-agent"] || "unknown",
      });

      // BigQuery talent_actions log
      (async () => {
        try {
          await logTalentAction({
            candidate_id,
            actor_email: decodedToken.email,
            action_type: "HR_SCORE_SUBMITTED",
            old_status: oldState,
            new_status: newState,
            notes: `Score: ${hrScore}/100. ${hardFail ? `Hard fail: ${hardFailReason}` : passed ? 'Passed' : 'Below threshold'}`,
            evidence_link: null,
            ip_address: req.ip || "unknown",
          });
        } catch (bqErr) { console.error("[BQ talent_actions] HR score log failed:", bqErr.message); }
      })();

      // If below threshold (not hard fail) — create CEO override task in TaskInbox
      if (!passed && !hardFail) {
        const overrideTaskId = `TSK-OVERRIDE-${Date.now()}`;
        await db.collection("tasks").doc(overrideTaskId).set({
          task_id: overrideTaskId,
          title: `HR Override Request: ${candidateDoc.data().full_name} (Score: ${hrScore}/100)`,
          description: `HR scored ${candidateDoc.data().full_name} at ${hrScore}/100 (below 70 threshold). HR is requesting CEO approval to shortlist this candidate.\n\nInterview Notes: ${hr_interview_notes}`,
          task_type: "APPROVE_REJECT",
          creation_method: "RULE_TRIGGERED",
          created_by: decodedToken.email,
          created_at: now,
          assigned_to_type: "ROLE",
          assigned_to_role: "CEO",
          priority: "NORMAL",
          escalation_type: "SOFT_DEADLINE",
          due_at: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 48 * 3600000)),
          related_entity_type: "CANDIDATE",
          related_entity_id: candidate_id,
          state: "OPEN",
          completed_at: null,
          completed_by: null,
          completion_action: null,
          notes: `Candidate score: ${hrScore}/100. Override requires CEO approval to move to SHORTLISTED.`,
        });
      }

      res.status(200).json({
        success: true,
        candidate_id: candidate_id,
        hr_score: hrScore,
        passed: passed,
        hard_fail: hardFail,
        hard_fail_reason: hardFailReason,
        new_state: newState,
        next_action: passed ? "SHORTLISTED" : hardFail ? "REJECTED" : "BELOW_THRESHOLD",
        message: passed
          ? `Score ${hrScore}/100 — Candidate shortlisted. Ready for Interview Prep.`
          : hardFail
            ? `Hard fail on ${hardFailReason} — Candidate rejected`
            : `Score ${hrScore}/100 (below 70) — CEO override request sent to TaskInbox`,
      });
    } catch (err) {
      console.error("submitHRScore error:", err);
      res.status(500).json({ error: "Internal server error", detail: err.message });
    }
  }
);

// ============================================================
// BigQuery helper — logTalentAction
// Auto-creates datalake_audit.talent_actions table if missing.
// Schema: action_id, timestamp, actor_email, candidate_id,
//         action_type, old_status, new_status, notes, evidence_link
// Partitioned by DATE(timestamp). Append-only.
// ============================================================
const { BigQuery } = require("@google-cloud/bigquery");
const _bq = new BigQuery({ projectId: "datalake-production-sa" });
const TALENT_DATASET = "datalake_audit";
const TALENT_TABLE = "talent_actions";

async function ensureTalentActionsTable() {
  const dataset = _bq.dataset(TALENT_DATASET);
  const table = dataset.table(TALENT_TABLE);
  const [exists] = await table.exists();
  if (!exists) {
    const schema = [
      { name: "action_id",    type: "STRING",    mode: "REQUIRED" },
      { name: "timestamp",    type: "TIMESTAMP",  mode: "REQUIRED" },
      { name: "actor_email",  type: "STRING",    mode: "NULLABLE" },
      { name: "candidate_id", type: "STRING",    mode: "REQUIRED" },
      { name: "action_type",  type: "STRING",    mode: "REQUIRED" },
      { name: "old_status",   type: "STRING",    mode: "NULLABLE" },
      { name: "new_status",   type: "STRING",    mode: "NULLABLE" },
      { name: "notes",        type: "STRING",    mode: "NULLABLE" },
      { name: "evidence_link",type: "STRING",    mode: "NULLABLE" },
      { name: "ip_address",   type: "STRING",    mode: "NULLABLE" },
    ];
    await dataset.createTable(TALENT_TABLE, {
      schema,
      timePartitioning: { type: "DAY", field: "timestamp" },
    });
    console.log("[BQ] Created datalake_audit.talent_actions table");
  }
}

async function logTalentAction({ candidate_id, actor_email, action_type, old_status, new_status, notes, evidence_link, ip_address }) {
  try {
    await ensureTalentActionsTable();
    await _bq.dataset(TALENT_DATASET).table(TALENT_TABLE).insert([{
      action_id: require("uuid").v4(),
      timestamp: _bq.timestamp(new Date()),
      actor_email: actor_email || null,
      candidate_id,
      action_type,
      old_status: old_status || null,
      new_status: new_status || null,
      notes: notes || null,
      evidence_link: evidence_link || null,
      ip_address: ip_address || null,
    }]);
  } catch (err) {
    console.error("[BQ talent_actions] Insert failed:", err.message);
  }
}

// ============================================================
// HTTP endpoint: updateCandidateStage
// Explicit lifecycle stage transition. Used by HR and CEO.
// Validates allowed transitions and appends lifecycle_history.
// Logs to task_audit_log + BigQuery talent_actions.
// ============================================================
const ALLOWED_TRANSITIONS = {
  APPLIED:              ["SCREENED", "REJECTED"],
  SCREENED:             ["SHORTLISTED", "REJECTED"],
  SHORTLISTED:          ["INTERVIEW_SCHEDULED", "REJECTED"],
  INTERVIEW_SCHEDULED:  ["INTERVIEWED", "REJECTED"],
  INTERVIEWED:          ["SCORED", "REJECTED"],
  SCORED:               ["SELECTED", "REJECTED"],
  SELECTED:             ["INTERVIEW_PREP", "REJECTED"],
  INTERVIEW_PREP:       ["CLIENT_SUBMITTED", "REJECTED"],
  CLIENT_SUBMITTED:     ["HIRED", "REJECTED"],
  HIRED:                ["ONBOARDING"],
  ONBOARDING:           ["ACTIVE_EMPLOYEE"],
  REJECTED:             [],
  ACTIVE_EMPLOYEE:      [],
};

exports.updateCandidateStage = onRequest(
  { region: "me-central2", memory: "512MiB", timeoutSeconds: 30, cors: ALLOWED_ORIGINS },
  async (req, res) => {
    // CORS headers
    res.set("Access-Control-Allow-Origin", "https://datalake-production-sa.web.app");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Max-Age", "3600");
      return res.status(204).send("");
    }
    // CORS headers
    res.set("Access-Control-Allow-Origin", "https://datalake-production-sa.web.app");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) return res.status(401).json({ error: "Missing authorization" });
    let decoded;
    try { decoded = await admin.auth().verifyIdToken(authHeader.split("Bearer ")[1]); }
    catch { return res.status(401).json({ error: "Invalid token" }); }

    // HR and CEO can transition stages
    const profile = await getUserAccessProfile(decoded.uid).catch(() => null);
    const allowedRoles = ["ceo", "hr"];
    if (!profile || !allowedRoles.includes(profile.role_id)) {
      return res.status(403).json({ error: "HR or CEO role required" });
    }

    const { candidate_id, new_state, notes } = req.body;
    if (!candidate_id || !new_state) return res.status(400).json({ error: "candidate_id and new_state required" });

    try {
      const candidateRef = db.collection("talent_pool").doc(candidate_id);
      const candidateDoc = await candidateRef.get();
      if (!candidateDoc.exists) return res.status(404).json({ error: "Candidate not found" });

      const currentState = candidateDoc.data().state;
      const allowed = ALLOWED_TRANSITIONS[currentState] || [];
      if (!allowed.includes(new_state)) {
        return res.status(400).json({
          error: `Invalid transition: ${currentState} → ${new_state}`,
          allowed_transitions: allowed,
        });
      }

      const now = admin.firestore.FieldValue.serverTimestamp();
      const lifecycleEntry = {
        state: new_state,
        timestamp: new Date().toISOString(),
        actor: decoded.email,
        notes: notes || `Stage updated by ${decoded.email}`,
      };

      await candidateRef.update({
        state: new_state,
        updated_at: now,
        lifecycle_history: admin.firestore.FieldValue.arrayUnion(lifecycleEntry),
        ...(new_state === "INTERVIEW_SCHEDULED" && req.body.interview_date ? { interview_date: req.body.interview_date } : {}),
        ...(new_state === "INTERVIEW_PREP" && req.body.interview_notes ? { interview_notes: req.body.interview_notes } : {}),
      });

      // Firestore audit
      await db.collection("task_audit_log").add({
        event: "CANDIDATE_STAGE_UPDATED",
        candidate_id,
        actor_email: decoded.email,
        action_at: now,
        old_state: currentState,
        new_state,
        notes: notes || null,
        ip_address: req.ip || "unknown",
      });

      // BigQuery audit
      await logTalentAction({
        candidate_id,
        actor_email: decoded.email,
        action_type: "STAGE_TRANSITION",
        old_status: currentState,
        new_status: new_state,
        notes: notes || `Stage updated by ${decoded.email}`,
        evidence_link: null,
        ip_address: req.ip || "unknown",
      });

      return res.status(200).json({ success: true, candidate_id, old_state: currentState, new_state });
    } catch (err) {
      console.error("updateCandidateStage error:", err);
      return res.status(500).json({ error: "Internal server error", detail: err.message });
    }
  }
);

// ============================================================
// HTTP endpoint: downloadCandidateCV
// Returns a signed GCS URL for the candidate's original CV.
// HR and CEO only. Logs download to task_audit_log.
// ============================================================
exports.downloadCandidateCV = onRequest(
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 30, cors: ALLOWED_ORIGINS },
  async (req, res) => {
    // CORS headers
    res.set("Access-Control-Allow-Origin", "https://datalake-production-sa.web.app");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Max-Age", "3600");
      return res.status(204).send("");
    }
    // CORS headers
    res.set("Access-Control-Allow-Origin", "https://datalake-production-sa.web.app");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) return res.status(401).json({ error: "Missing authorization" });
    let decoded;
    try { decoded = await admin.auth().verifyIdToken(authHeader.split("Bearer ")[1]); }
    catch { return res.status(401).json({ error: "Invalid token" }); }

    const profile = await getUserAccessProfile(decoded.uid).catch(() => null);
    if (!profile || !["ceo", "hr"].includes(profile.role_id)) {
      return res.status(403).json({ error: "HR or CEO role required" });
    }

    const { candidate_id } = req.body;
    if (!candidate_id) return res.status(400).json({ error: "candidate_id required" });

    try {
      const candidateDoc = await db.collection("talent_pool").doc(candidate_id).get();
      if (!candidateDoc.exists) return res.status(404).json({ error: "Candidate not found" });

      const candidate = candidateDoc.data();
      if (candidate.state === "PURGED") return res.status(403).json({ error: "Candidate data purged per PDPL" });
      if (!candidate.cv_path) return res.status(404).json({ error: "No CV on file for this candidate" });

      // Careers uploads land in datalake-cv-uploads (cvs/<id>/<uuid>-<name>);
      // some older/manual CVs sit in the main bucket. Try the upload bucket
      // first, then fall back, so we find the file wherever it actually is.
      const CV_BUCKETS = ["datalake-cv-uploads", "datalake-production-sa.firebasestorage.app"];
      let file = null;
      for (const b of CV_BUCKETS) {
        const f = admin.storage().bucket(b).file(candidate.cv_path);
        const [exists] = await f.exists();
        if (exists) { file = f; break; }
      }
      if (!file) return res.status(404).json({ error: "CV file not found in storage" });

      const [signedUrl] = await file.getSignedUrl({
        version: "v4",
        action: "read",
        expires: Date.now() + 60 * 60 * 1000, // 60 min
      });

      await db.collection("task_audit_log").add({
        event: "CANDIDATE_CV_DOWNLOADED",
        candidate_id,
        actor_email: decoded.email,
        action_at: admin.firestore.FieldValue.serverTimestamp(),
        cv_path: candidate.cv_path,
        ip_address: req.ip || "unknown",
      });

      await logTalentAction({
        candidate_id,
        actor_email: decoded.email,
        action_type: "CV_DOWNLOADED",
        old_status: candidate.state,
        new_status: candidate.state,
        notes: `CV downloaded by ${decoded.email}`,
        evidence_link: null,
        ip_address: req.ip || "unknown",
      });

      return res.status(200).json({
        success: true,
        signed_url: signedUrl,
        candidate_name: candidate.full_name,
        cv_path: candidate.cv_path,
      });
    } catch (err) {
      console.error("downloadCandidateCV error:", err);
      return res.status(500).json({ error: "Internal server error", detail: err.message });
    }
  }
);

// ============================================================
// HTTP endpoint: createProject
// Creates a new project in Firestore when a deal is won
// Requires CEO auth
// ============================================================
exports.createProject = onRequest(

  {
    region: "me-central2",
    memory: "512MiB",
    timeoutSeconds: 30,
    cors: ALLOWED_ORIGINS,
    
    
  },
  async (req, res) => {
    // CORS headers
    res.set("Access-Control-Allow-Origin", "https://datalake-production-sa.web.app");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Max-Age", "3600");
      return res.status(204).send("");
    }
    // CORS headers
    res.set("Access-Control-Allow-Origin", "https://datalake-production-sa.web.app");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) { res.status(401).json({ error: "Missing authorization" }); return; }
    let decodedToken;
    try { decodedToken = await admin.auth().verifyIdToken(authHeader.split("Bearer ")[1]); } catch (err) { res.status(401).json({ error: "Invalid token" }); return; }
    if (decodedToken.email !== "m.alqumri@datalake.sa") { res.status(403).json({ error: "CEO access only" }); return; }

    try {
      const body = req.body;
      const required = ["project_name","client_name","po_number","po_value_sar","start_date","end_date","client_approver_name","client_approver_email","work_location_type","rate_structure"];
      for (const f of required) { if (body[f] === undefined || body[f] === null || body[f] === "") { res.status(400).json({ error: `Missing required field: ${f}` }); return; } }
      if (!/^\S+@\S+\.\S+$/.test(body.client_approver_email)) { res.status(400).json({ error: "Invalid client_approver_email format" }); return; }
      const startDate = new Date(body.start_date);
      const endDate = new Date(body.end_date);
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) { res.status(400).json({ error: "Invalid date format" }); return; }
      if (endDate <= startDate) { res.status(400).json({ error: "end_date must be after start_date" }); return; }

      const year = new Date().getFullYear();
      const random = Math.floor(1000 + Math.random() * 9000);
      const projectId = `PRJ-${year}-${random}`;
      const now = admin.firestore.FieldValue.serverTimestamp();

      await db.collection("projects").doc(projectId).set({
        project_id: projectId,
        project_name: body.project_name,
        client_name: body.client_name,
        client_id: body.client_id || null,
        po_number: body.po_number,
        po_value_sar: Number(body.po_value_sar),
        start_date: admin.firestore.Timestamp.fromDate(startDate),
        end_date: admin.firestore.Timestamp.fromDate(endDate),
        client_approver_name: body.client_approver_name,
        client_approver_email: body.client_approver_email,
        work_location_type: body.work_location_type,
        work_location_address: body.work_location_address || null,
        rate_structure: body.rate_structure,
        rate_amount_sar: Number(body.rate_amount_sar) || null,
        timesheet_type: body.timesheet_type || "CONSOLIDATED",
        status: "ACTIVE",
        created_by: decodedToken.email,
        created_at: now,
        updated_at: now,
        notes: body.notes || null,
      });

      await db.collection("task_audit_log").add({
        event: "PROJECT_CREATED", project_id: projectId, action_by: decodedToken.email, action_at: now,
        details: { project_name: body.project_name, client_name: body.client_name, po_number: body.po_number, po_value_sar: Number(body.po_value_sar) },
        ip_address: req.ip || "unknown", user_agent: req.headers["user-agent"] || "unknown",
      });

      res.status(200).json({ success: true, project_id: projectId, message: "Project created successfully" });
    } catch (err) {
      console.error("createProject error:", err);
      res.status(500).json({ error: "Internal server error", detail: err.message });
    }
  }
);

// ============================================================
// HTTP endpoint: assignEngineerToProject
// Assigns an engineer to a project with role and dates
// Requires CEO auth
// ============================================================
exports.assignEngineerToProject = onRequest(
  {
    region: "me-central2",
    memory: "512MiB",
    timeoutSeconds: 30,
    cors: ALLOWED_ORIGINS,
    
    
  },
  async (req, res) => {
    // CORS headers
    res.set("Access-Control-Allow-Origin", "https://datalake-production-sa.web.app");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Max-Age", "3600");
      return res.status(204).send("");
    }
    // CORS headers
    res.set("Access-Control-Allow-Origin", "https://datalake-production-sa.web.app");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) { res.status(401).json({ error: "Missing authorization" }); return; }
    let decodedToken;
    try { decodedToken = await admin.auth().verifyIdToken(authHeader.split("Bearer ")[1]); } catch (err) { res.status(401).json({ error: "Invalid token" }); return; }
    if (decodedToken.email !== "m.alqumri@datalake.sa") { res.status(403).json({ error: "CEO access only" }); return; }

    try {
      const body = req.body;
      const required = ["project_id","engineer_id","engineer_name","engineer_email","role_on_project","assignment_start_date","assignment_end_date"];
      for (const f of required) { if (body[f] === undefined || body[f] === null || body[f] === "") { res.status(400).json({ error: `Missing required field: ${f}` }); return; } }

      const projectRef = db.collection("projects").doc(body.project_id);
      const projectDoc = await projectRef.get();
      if (!projectDoc.exists) { res.status(404).json({ error: "Project not found" }); return; }

      const startDate = new Date(body.assignment_start_date);
      const endDate = new Date(body.assignment_end_date);
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) { res.status(400).json({ error: "Invalid date format" }); return; }

      const assignmentId = `ASG-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const now = admin.firestore.FieldValue.serverTimestamp();

      await db.collection("engineer_project_assignments").doc(assignmentId).set({
        assignment_id: assignmentId,
        project_id: body.project_id,
        project_name: projectDoc.data().project_name,
        client_name: projectDoc.data().client_name,
        engineer_id: body.engineer_id,
        engineer_name: body.engineer_name,
        engineer_email: body.engineer_email,
        role_on_project: body.role_on_project,
        assignment_start_date: admin.firestore.Timestamp.fromDate(startDate),
        assignment_end_date: admin.firestore.Timestamp.fromDate(endDate),
        allocation_percentage: Number(body.allocation_percentage) || 100,
        status: "ACTIVE",
        assigned_by: decodedToken.email,
        assigned_at: now,
        notes: body.notes || null,
      });

      await db.collection("task_audit_log").add({
        event: "ENGINEER_ASSIGNED_TO_PROJECT", project_id: body.project_id, assignment_id: assignmentId,
        engineer_email: body.engineer_email, action_by: decodedToken.email, action_at: now,
        details: { engineer_name: body.engineer_name, role: body.role_on_project, allocation_percentage: Number(body.allocation_percentage) || 100 },
        ip_address: req.ip || "unknown", user_agent: req.headers["user-agent"] || "unknown",
      });

      res.status(200).json({ success: true, assignment_id: assignmentId, project_id: body.project_id, message: `Engineer ${body.engineer_name} assigned to ${projectDoc.data().project_name}` });
    } catch (err) {
      console.error("assignEngineerToProject error:", err);
      res.status(500).json({ error: "Internal server error", detail: err.message });
    }
  }
);

// ============================================================
// Resolve a logged-in engineer's ACTIVE project assignments robustly. Firestore
// equality is case-sensitive, so an assignment stored with a differently-cased
// engineer_email (or linked only by engineer_id) would otherwise look
// "unassigned" — the bug where every employee saw "no active project assignment".
// Matches by email (exact + lowercased) and by engineer_id (resolved from the
// employees directory), then filters status case-insensitively to ACTIVE.
async function findActiveEngineerAssignments(email, projectId) {
  const col = db.collection("engineer_project_assignments");
  const emailLc = String(email || "").toLowerCase();
  const found = new Map();
  const add = (snap) => snap.forEach((d) => found.set(d.id, d.data()));

  add(await col.where("engineer_email", "==", email).get());
  if (emailLc && emailLc !== email) add(await col.where("engineer_email", "==", emailLc).get());

  let employeeId = null;
  let eq = await db.collection("employees").where("email", "==", email).limit(1).get();
  if (eq.empty && emailLc !== email) eq = await db.collection("employees").where("email", "==", emailLc).limit(1).get();
  if (!eq.empty) employeeId = eq.docs[0].data().employee_id || eq.docs[0].id;
  if (employeeId) add(await col.where("engineer_id", "==", employeeId).get());

  let list = [...found.values()].filter((a) => String(a.status || "").toUpperCase() === "ACTIVE");
  if (projectId) list = list.filter((a) => a.project_id === projectId);
  return list;
}

// HTTP endpoint: getEngineerProjectView
// Returns projects assigned to the calling engineer with
// financial and commercial fields STRIPPED
// Requires Firebase auth (any authenticated @datalake.sa user)
// ============================================================
exports.getEngineerProjectView = onRequest(
  {
    region: "me-central2",
    memory: "512MiB",
    timeoutSeconds: 30,
    cors: ALLOWED_ORIGINS,
    
    
  },
  async (req, res) => {
    // CORS headers
    res.set("Access-Control-Allow-Origin", "https://datalake-production-sa.web.app");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Max-Age", "3600");
      return res.status(204).send("");
    }
    // CORS headers
    res.set("Access-Control-Allow-Origin", "https://datalake-production-sa.web.app");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method !== "POST" && req.method !== "GET") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing authorization" });
      return;
    }

    let decodedToken;
    try {
      decodedToken = await admin
        .auth()
        .verifyIdToken(authHeader.split("Bearer ")[1]);
    } catch (err) {
      res.status(401).json({ error: "Invalid token" });
      return;
    }

    try {
      const engineerEmail = decodedToken.email;

      // Find active assignments for this engineer (robust to email case / id link)
      const assignments = await findActiveEngineerAssignments(engineerEmail);

      if (assignments.length === 0) {
        res
          .status(200)
          .json({ projects: [], message: "No active assignments" });
        return;
      }

      // Get unique project IDs
      const projectIds = [...new Set(assignments.map((a) => a.project_id))];

      // Fetch project docs and build filtered view
      const projectsData = [];
      for (const projectId of projectIds) {
        const projectDoc = await db
          .collection("projects")
          .doc(projectId)
          .get();
        if (!projectDoc.exists) continue;

        const full = projectDoc.data();

        // ── STRIP CONFIDENTIAL FIELDS ──
        // Engineer sees ONLY operational fields.
        // NO: po_number, po_value_sar, rate_amount_sar, rate_structure,
        //     client_approver_email, client_approver_name,
        //     notes, timesheet_type, billing details
        const engineerView = {
          project_id: full.project_id,
          project_name: full.project_name,
          client_name: full.client_name,
          start_date: full.start_date,
          end_date: full.end_date,
          work_location_type: full.work_location_type,
          work_location_address: full.work_location_address || null,
          status: full.status,
          // Engineer's own assignment details ONLY (no rate, no allocation %)
          my_assignment: assignments
            .filter((a) => a.project_id === projectId)
            .map((a) => ({
              assignment_id: a.assignment_id,
              role_on_project: a.role_on_project,
              assignment_start_date: a.assignment_start_date,
              assignment_end_date: a.assignment_end_date,
              status: a.status,
              // STRIPPED: rate_sar, allocation_percentage, notes
            }))[0] || null,
        };

        projectsData.push(engineerView);
      }

      res.status(200).json({ projects: projectsData });
    } catch (err) {
      console.error("getEngineerProjectView error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ============================================================
// HTTP endpoint: submitTimesheet
// Engineer submits monthly timesheet for a project
// Enforces 18th-25th submission window (Riyadh time)
// ============================================================
// Default onboarding policy registry — mirror of src/lib/policies.js. Functions
// can't import src/, so the canonical versions live in Firestore
// (platform_settings/policy_registry); this is the fallback.
const GATE_DEFAULT_POLICIES = [
  { id: "privacy_policy", version: "1.0", title: "Privacy Policy — Data Processing Notice" },
  { id: "pdpl_consent", version: "1.0", title: "Privacy Notice — Personal Data Processing" },
  { id: "code_of_conduct", version: "1.0", title: "Employee Code of Conduct" },
  { id: "infosec_awareness", version: "1.0", title: "Information Security Awareness (NCA ECC)" },
];

// Hard onboarding → training → timesheet gate. Feature-flagged via
// platform_settings/timesheet_gate { enabled, effective_date } so it only
// enforces after existing employees are backfilled. Returns active=false (skip)
// when the flag is off / before the effective date — never blocks in-flight
// billing until the CEO switches it on. When active, computes the same
// version-pinned acknowledgment "Completed" the HR register uses, plus mandatory
// training completion.
async function checkOnboardingTrainingGate(email) {
  let gate = {};
  try {
    const gd = await db.collection("platform_settings").doc("timesheet_gate").get();
    gate = gd.exists ? gd.data() : {};
  } catch { gate = {}; }
  const eff = gate.effective_date
    ? (gate.effective_date.toDate ? gate.effective_date.toDate() : new Date(gate.effective_date))
    : null;
  const active = gate.enabled === true && (!eff || Date.now() >= eff.getTime());
  if (!active) return { active: false, blocked: false, missingPolicies: [], missingModules: [] };

  const cleanEmail = String(email || "").toLowerCase();

  // onboarding_evidence lives under employees/{empId}
  let empId = null;
  try {
    const eq = await db.collection("employees").where("email", "==", cleanEmail).limit(1).get();
    if (!eq.empty) empId = eq.docs[0].id;
  } catch { /* */ }

  let registry = GATE_DEFAULT_POLICIES;
  try {
    const pr = await db.collection("platform_settings").doc("policy_registry").get();
    const pols = pr.exists ? pr.data().policies : null;
    if (Array.isArray(pols) && pols.length) {
      registry = pols.map(p => ({ id: p.id, version: p.version, title: p.title || p.id }));
    }
  } catch { /* */ }

  let evidence = [];
  if (empId) {
    try {
      const evSnap = await db.collection("employees").doc(empId).collection("onboarding_evidence").get();
      evidence = evSnap.docs.map(d => d.data());
    } catch { /* */ }
  }
  const missingPolicies = registry.filter(p => {
    const row = evidence.find(r => (r.policy_id || r.id) === p.id);
    return !row || String(row.policy_version || "") !== String(p.version);
  }).map(p => p.title || p.id);

  let missingModules = [];
  try {
    const [modSnap, compSnap] = await Promise.all([
      db.collection("training_modules").where("mandatory", "==", true).get(),
      db.collection("training_completions").where("engineer_email", "==", cleanEmail).get(),
    ]);
    const done = new Set(compSnap.docs.map(d => d.data().module_id));
    missingModules = modSnap.docs
      .filter(d => !done.has(d.data().module_id || d.id))
      .map(d => d.data().title || d.data().module_id || d.id);
  } catch { /* */ }

  return {
    active: true,
    blocked: missingPolicies.length > 0 || missingModules.length > 0,
    missingPolicies,
    missingModules,
    effectiveDate: eff ? eff.toISOString() : null,
  };
}

exports.submitTimesheet = onRequest(
  { region: "me-central2", memory: "512MiB", timeoutSeconds: 30, cors: ALLOWED_ORIGINS },
  async (req, res) => {
    // CORS headers
    res.set("Access-Control-Allow-Origin", "https://datalake-production-sa.web.app");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Max-Age", "3600");
      return res.status(204).send("");
    }
    // CORS headers
    res.set("Access-Control-Allow-Origin", "https://datalake-production-sa.web.app");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) { res.status(401).json({ error: "Missing authorization" }); return; }
    let decodedToken;
    try { decodedToken = await admin.auth().verifyIdToken(authHeader.split("Bearer ")[1]); } catch { res.status(401).json({ error: "Invalid token" }); return; }

    try {
      const { project_id, period_month, period_year, days, notes } = req.body;
      if (!project_id || !period_month || !period_year || !days) { res.status(400).json({ error: "Missing required fields" }); return; }

      // ── Hard onboarding → training → timesheet gate (feature-flagged) ──
      const gate = await checkOnboardingTrainingGate(decodedToken.email);
      if (gate.blocked) {
        const parts = [];
        if (gate.missingPolicies.length) parts.push(`acknowledge the current policies (${gate.missingPolicies.join(", ")})`);
        if (gate.missingModules.length) parts.push(`complete required training (${gate.missingModules.join(", ")})`);
        const reason = `Timesheet submission blocked — you must first ${parts.join(" and ")}.`;
        try {
          // Insert directly (not via logToBigQuery, which JSON-stringifies arrays)
          // to match the existing datalake_audit.control_events schema:
          // missing_modules is REPEATED STRING; missing_onboarding is BOOLEAN.
          const { BigQuery } = require("@google-cloud/bigquery");
          await new BigQuery().dataset("datalake_audit").table("control_events").insert([{
            event_id: require("crypto").randomUUID(),
            control_name: "ONBOARDING_TRAINING_GATE",
            outcome: "BLOCKED",
            actor_email: decodedToken.email,
            actor_uid: decodedToken.uid || null,
            missing_onboarding: gate.missingPolicies.length > 0,
            missing_modules: gate.missingModules,
            gate_enabled: true,
            effective_date: gate.effectiveDate || null,
            timestamp: new Date(),
          }]);
        } catch (e) { console.error("[gate] control_events audit insert failed:", e.message); }
        res.status(403).json({ error: reason, missing_policies: gate.missingPolicies, missing_modules: gate.missingModules });
        return;
      }

      // Enforce 1st-28th window (widened for testing — original: 18th-25th)
      const now = new Date();
      const riyadhTime = new Date(now.getTime() + (3 * 60 + now.getTimezoneOffset()) * 60000);
      const currentDay = riyadhTime.getDate();
      if (currentDay < 1 || currentDay > 28) {
        res.status(403).json({ error: "Submission window closed", detail: "Timesheets can only be submitted between the 1st and 28th of each month (Riyadh time).", current_day: currentDay });
        return;
      }

      // Verify engineer assignment (robust to email case / engineer_id link)
      const myAssignments = await findActiveEngineerAssignments(decodedToken.email, project_id);
      if (myAssignments.length === 0) { res.status(403).json({ error: "You are not assigned to this project" }); return; }
      const assignment = myAssignments[0];

      const projectDoc = await db.collection("projects").doc(project_id).get();
      if (!projectDoc.exists) { res.status(404).json({ error: "Project not found" }); return; }
      const project = projectDoc.data();

      // Calculate totals
      let total_hours = 0, in_house_hours = 0, remote_hours = 0, leave_hours = 0;
      for (const [, entry] of Object.entries(days)) {
        const h = Number(entry.hours) || 0;
        total_hours += h;
        if (entry.type === "in_house") in_house_hours += h;
        else if (entry.type === "remote") remote_hours += h;
        else if (entry.type?.startsWith("leave")) leave_hours += h;
      }

      // Deterministic ID
      const engPart = decodedToken.email.split("@")[0].toUpperCase().replace(/[^A-Z0-9]/g, "").substring(0, 8);
      const timesheetId = `TS-${period_year}-${String(period_month).padStart(2, "0")}-${engPart}-${project_id}`;

      // Check duplicate
      const existing = await db.collection("timesheets").doc(timesheetId).get();
      if (existing.exists) {
        const es = existing.data().state;
        if (es !== "DRAFT" && es !== "REJECTED_BY_CTO" && es !== "REJECTED_BY_CLIENT") {
          res.status(409).json({ error: "Timesheet already submitted for this period", existing_state: es });
          return;
        }
      }

      const nowTS = admin.firestore.FieldValue.serverTimestamp();
      const periodLabel = new Date(period_year, period_month - 1, 1).toLocaleDateString("en-US", { year: "numeric", month: "long" });

      await db.collection("timesheets").doc(timesheetId).set({
        timesheet_id: timesheetId, engineer_email: decodedToken.email, engineer_name: assignment.engineer_name,
        project_id, project_name: project.project_name, client_name: project.client_name,
        client_approver_email: project.client_approver_email, client_approver_name: project.client_approver_name,
        period_month, period_year, period_label: periodLabel, days, total_hours, in_house_hours, remote_hours, leave_hours,
        notes: (typeof notes === "string" && notes.trim()) ? notes.trim() : null,
        po_number: project.po_number || null,
        state: "SUBMITTED", submitted_at: nowTS,
        cto_action_at: null, cto_action_by: null, cto_decision: null, cto_notes: null,
        ceo_escalated_at: null, ceo_action_at: null, ceo_action_by: null,
        client_action_at: null, client_signature_hash: null, client_signature_method: null, client_action_ip: null,
        rejection_reason: null,
        audit_trail: [{ timestamp: new Date().toISOString(), event: "SUBMITTED", actor: decodedToken.email }],
        created_at: nowTS, updated_at: nowTS,
      });

      // CTO review task
      const taskId = `TSK-${period_year}-${String(period_month).padStart(2, "0")}${Math.floor(1000 + Math.random() * 9000)}`;
      await db.collection("tasks").doc(taskId).set({
        task_id: taskId, title: `Approve timesheet: ${assignment.engineer_name} — ${periodLabel}`,
        description: `Timesheet ${timesheetId} submitted. Total hours: ${total_hours}. Project: ${project.project_name}.`,
        task_type: "APPROVE_REJECT", creation_method: "RULE_TRIGGERED", created_by: "system:submitTimesheet", created_at: nowTS,
        assigned_to_type: "ROLE", assigned_to_role: "CTO", assigned_to_id: null, priority: "NORMAL",
        escalation_type: "AUTO_ESCALATION", due_at: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 48*3600000)),
        related_entity_type: "TIMESHEET", related_entity_id: timesheetId, state: "OPEN",
        completed_at: null, completed_by: null, completion_action: null, completion_reason_codes: [], completion_notes: null,
        verification_status: "PENDING_VERIFICATION", recurrence: "ONE_TIME", notes: null,
      });

      await db.collection("task_audit_log").add({
        event: "TIMESHEET_SUBMITTED", timesheet_id: timesheetId, project_id,
        action_by: decodedToken.email, action_at: nowTS,
        details: { total_hours, period: periodLabel },
        ip_address: req.ip || "unknown", user_agent: req.headers["user-agent"] || "unknown",
      });

      res.status(200).json({ success: true, timesheet_id: timesheetId, state: "SUBMITTED", message: "Timesheet submitted. CTO will review within 48 hours." });

      // ── FIRE-AND-FORGET: Controller AI timesheet validation ──
      // Runs async after response is sent. Does NOT block the engineer.
      // CTO sees AI badge (✅ or ⚠️) when reviewing in TaskInbox.
      (async () => {
        try {
          const validationInput = {
            timesheet_id: timesheetId, period_label: periodLabel,
            period_month, period_year,
            engineer_name: assignment.engineer_name,
            project_name: project.project_name, client_name: project.client_name,
            total_hours_submitted: total_hours, in_house_hours, remote_hours, leave_hours,
            days_entries: days,
            contracted_rate_sar_per_hour: project.rate_amount_sar || null,
            rate_structure: project.rate_structure || "HOURLY",
            po_value_sar: project.po_value_sar || null,
            po_total_hours: project.po_total_hours || null,
            po_used_hours: project.po_used_hours || null,
            billing_period_start: `${period_year}-${String(period_month).padStart(2, "0")}-01`,
            billing_period_end: new Date(period_year, period_month, 0).toISOString().split("T")[0],
          };

          const llmResult = await callLLM({
            agent: "controller", type: "timesheet_validate",
            triggeredBy: decodedToken.email,
            promptTemplateId: "CONTROLLER_TIMESHEET_V1",
            systemPrompt: `You are the Datalake Controller AI. Validate this timesheet against the purchase order and Saudi tax requirements.
Check ALL of the following:
1. Total hours match sum of all day entries
2. No duplicate dates in day entries
3. All dates fall within the billing period
4. Hour types valid: in_house, remote, leave_annual, leave_sick, leave_public_holiday
5. If rate provided: total_amount_sar = total_hours × rate
6. VAT: vat_amount_sar = total_amount_sar × 0.15 (ZATCA requirement)
7. total_with_vat_sar = total_amount_sar + vat_amount_sar
8. If PO caps provided: check hours do not exceed cap

Return ONLY a valid JSON object:
{
  "valid": true|false,
  "total_hours_verified": N,
  "total_amount_sar": N or null,
  "vat_amount_sar": N or null,
  "total_with_vat_sar": N or null,
  "po_remaining_hours": N or null,
  "po_remaining_amount_sar": N or null,
  "issues": ["..."],
  "warnings": ["..."],
  "notes": "..."
}
Return valid JSON only, no markdown.`,
            userPrompt: JSON.stringify(validationInput),
          });

          if (llmResult.success) {
            const parsed = parseJsonOutput(llmResult.output);
            const validation = parsed.success ? parsed.data : { valid: null, issues: ["AI output parse failed"], raw: llmResult.output };
            const validationStatus = validation.valid === true ? "AI_VALID" : validation.valid === false ? "AI_FLAGGED" : "AI_INCONCLUSIVE";

            await db.collection("timesheets").doc(timesheetId).update({
              ai_validation: validation,
              ai_validation_status: validationStatus,
              ai_validated_at: admin.firestore.FieldValue.serverTimestamp(),
              ai_validated_by: "controller_ai",
              ai_validation_model: MODEL_NAME,
              ai_validation_ms: llmResult.inferenceMs,
            });
            console.log(`[Controller AI] Timesheet ${timesheetId} → ${validationStatus} (${validation.issues?.length || 0} issues)`);
          } else {
            console.warn(`[Controller AI] Timesheet ${timesheetId} validation failed:`, llmResult.error);
          }
        } catch (aiErr) {
          console.error(`[Controller AI] Timesheet ${timesheetId} fire-and-forget error:`, aiErr.message);
        }
      })();

    } catch (err) { console.error("submitTimesheet error:", err); res.status(500).json({ error: "Internal server error", detail: err.message }); }
  }
);

// ============================================================
// HTTP endpoint: ctoApproveTimesheet
// CTO (or CEO for escalated) approves/rejects a timesheet
// ============================================================
exports.ctoApproveTimesheet = onRequest(
  { region: "me-central2", memory: "512MiB", timeoutSeconds: 30, cors: ALLOWED_ORIGINS },
  async (req, res) => {
    // CORS headers
    res.set("Access-Control-Allow-Origin", "https://datalake-production-sa.web.app");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Max-Age", "3600");
      return res.status(204).send("");
    }
    // CORS headers
    res.set("Access-Control-Allow-Origin", "https://datalake-production-sa.web.app");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) { res.status(401).json({ error: "Missing authorization" }); return; }
    let decodedToken;
    try { decodedToken = await admin.auth().verifyIdToken(authHeader.split("Bearer ")[1]); } catch { res.status(401).json({ error: "Invalid token" }); return; }

    const authorized = ["cto@datalake.sa", "m.alqumri@datalake.sa"];
    if (!authorized.includes(decodedToken.email)) { res.status(403).json({ error: "Only CTO or CEO can approve timesheets" }); return; }

    try {
      const { timesheet_id, decision, notes } = req.body;
      if (!timesheet_id || !decision) { res.status(400).json({ error: "Missing timesheet_id or decision" }); return; }
      if (!["APPROVE", "REJECT"].includes(decision)) { res.status(400).json({ error: "Decision must be APPROVE or REJECT" }); return; }
      if (decision === "REJECT" && !notes) { res.status(400).json({ error: "Rejection requires notes" }); return; }

      const tsRef = db.collection("timesheets").doc(timesheet_id);
      const tsDoc = await tsRef.get();
      if (!tsDoc.exists) { res.status(404).json({ error: "Timesheet not found" }); return; }
      const ts = tsDoc.data();

      if (!["SUBMITTED", "CEO_ESCALATED"].includes(ts.state)) { res.status(400).json({ error: `Cannot act on timesheet in state: ${ts.state}` }); return; }
      // CEO can approve their own test timesheets (CEO operates all roles during setup)
      if (ts.engineer_email === decodedToken.email && decodedToken.email !== "m.alqumri@datalake.sa") { res.status(403).json({ error: "Cannot approve your own timesheet" }); return; }

      const nowTS = admin.firestore.FieldValue.serverTimestamp();
      const newState = decision === "APPROVE" ? "CTO_APPROVED" : "DRAFT";

      await tsRef.update({
        state: newState, cto_action_at: nowTS, cto_action_by: decodedToken.email, cto_decision: decision,
        cto_notes: notes || null, rejection_reason: decision === "REJECT" ? notes : null, updated_at: nowTS,
        audit_trail: admin.firestore.FieldValue.arrayUnion({
          timestamp: new Date().toISOString(), event: newState, actor: decodedToken.email, notes: notes || null,
        }),
      });

      if (decision === "APPROVE") {
        const clientToken = crypto.randomBytes(32).toString("hex");
        await tsRef.update({
          client_sign_token: clientToken,
          // 30-day TTL on the sign token (resend re-extends). The token is also
          // single-use (burned on sign/reject) and per-timesheet scoped.
          sign_token_expires_at: admin.firestore.Timestamp.fromMillis(Date.now() + 30 * 24 * 3600 * 1000),
        });

        // ── Immutable approval snapshot: the exact line items + totals approved,
        // the AI advisory result, and approver identity + timestamp. Written to
        // the timesheet, an immutable approval_evidence row, AND a WORM PDF —
        // so "show me the input + what was approved" is one record. Best-effort
        // (try/catch) so an audit-write hiccup never blocks the approval itself.
        try {
          // Build line items with description/task per entry
          const lineItems = Object.keys(ts.days || {})
            .filter(d => Number(ts.days[d] && ts.days[d].hours) > 0)
            .sort((a, b) => Number(a) - Number(b))
            .map(d => ({
              date: `${ts.period_year}-${String(ts.period_month).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
              hours: Number(ts.days[d].hours),
              type: ts.days[d].type || null,
              // Capture any free-text the engineer entered per day
              description: ts.days[d].description || ts.days[d].task || ts.days[d].notes || null,
            }));

          // Immutable snapshot: line items + totals the approver reviewed,
          // AI advisory result (labelled as AI — not conflated with engineer),
          // and approver identity + timestamp.
          const snapshot = {
            // ── Engineer submission ──────────────────────────
            submitted_by_email: ts.engineer_email || null,
            submitted_by_name:  ts.engineer_name  || null,
            submitted_at_iso:   ts.submitted_at   || null,
            period_label:       ts.period_label   || null,
            project_name:       ts.project_name   || null,
            po_number:          ts.po_number       || null,
            line_items: lineItems,
            totals: {
              total_hours:    ts.total_hours    || 0,
              in_house_hours: ts.in_house_hours || 0,
              remote_hours:   ts.remote_hours   || 0,
              leave_hours:    ts.leave_hours    || 0,
            },
            engineer_notes: ts.notes || null,

            // ── AI advisory (separate from engineer identity) ─
            ai_validation_status: ts.ai_validation_status || null,
            ai_validation_detail: ts.ai_validation        || null,
            ai_validated_by:      ts.ai_validated_by      || "controller_ai",
            ai_validation_model:  ts.ai_validation_model  || null,
            ai_validated_at_iso:  ts.ai_validated_at      || null,

            // ── Human approver ──────────────────────────────
            approver_email: decodedToken.email,
            approver_uid:   decodedToken.uid || null,
            approved_at_iso: new Date().toISOString(),
          };
          await tsRef.update({ cto_approval_snapshot: { ...snapshot, approved_at: nowTS } });
          await tsRef.collection("approval_evidence").add({
            ...snapshot, approved_at: nowTS, action: "CTO_APPROVE_TIMESHEET",
          });

          // WORM PDF audit record (datalake-worm-finance)
          const PDFDocument = require("pdfkit");
          const wormBucket = admin.storage().bucket("datalake-worm-finance");
          const pdfPath = `timesheet-approvals/${timesheet_id}/${Date.now()}_approval.pdf`;
          const wfile  = wormBucket.file(pdfPath);
          const wstream = wfile.createWriteStream({ contentType: "application/pdf", metadata: { metadata: { timesheet_id, approver: decodedToken.email } } });
          const pdf = new PDFDocument({ margin: 50 });
          pdf.pipe(wstream);
          pdf.fontSize(16).fillColor("#022873").text("Timesheet Approval Record", { align: "center" });
          pdf.moveDown(0.4).fontSize(10).fillColor("#555")
            .text(`${ts.project_name || ""} · ${ts.client_name || ""} · ${ts.period_label || ""}`, { align: "center" });
          // Attribution block — engineer and AI are clearly separate
          pdf.moveDown(1).fillColor("black").fontSize(11)
            .text(`Submitted by:       ${ts.engineer_name || ""} <${ts.engineer_email || ""}>  (engineer)`)
            .text(`Approved by:        ${decodedToken.email}  (CTO/CEO)`)
            .text(`Approved at:        ${snapshot.approved_at_iso}`);
          if (ts.ai_validation_status) {
            pdf.text(`AI pre-screening:   ${ts.ai_validation_status} — model: ${ts.ai_validation_model || "controller_ai"}` +
              (ts.ai_validation?.issues?.length ? ` — flags: ${ts.ai_validation.issues.join("; ")}` : "") +
              `  [advisory only — human approved above]`);
          }
          if (ts.notes) pdf.moveDown(0.4).text(`Engineer notes: ${ts.notes}`);
          pdf.moveDown(0.8).fontSize(12).fillColor("#022873").text("Approved line items");
          pdf.moveDown(0.3).fontSize(10).fillColor("black");
          for (const li of lineItems) {
            pdf.text(`  ${li.date}  ${li.hours}h  ${li.type || ""}${li.description ? "  — " + li.description : ""}`);
          }
          pdf.moveDown(0.4).fontSize(11).text(`Total: ${ts.total_hours || 0}h`, { underline: true });
          pdf.moveDown(1).fontSize(8).fillColor("#666")
            .text("Generated at approval time by the Datalake platform. Immutable mirror stored at timesheets/{id}/approval_evidence/. The AI result is advisory; the human approver above made the decision.", { align: "justify" });
          pdf.end();
          await new Promise((resolve, reject) => { wstream.on("finish", resolve); wstream.on("error", reject); });
          await tsRef.update({ cto_approval_pdf_path: `gs://datalake-worm-finance/${pdfPath}` });
        } catch (snapErr) {
          console.error("[ctoApproveTimesheet] approval snapshot/PDF failed (non-blocking):", snapErr.message);
        }

        const cTaskId = `TSK-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        await db.collection("tasks").doc(cTaskId).set({
          task_id: cTaskId, title: `Sign timesheet: ${ts.engineer_name} — ${ts.period_label}`,
          description: `Please review and sign the approved timesheet for ${ts.engineer_name} on project ${ts.project_name}.`,
          task_type: "SIGN", creation_method: "RULE_TRIGGERED", created_by: "system:ctoApproveTimesheet", created_at: nowTS,
          assigned_to_type: "INDIVIDUAL", assigned_to_id: ts.client_approver_email, assigned_to_role: "CLIENT_APPROVER",
          priority: "NORMAL", escalation_type: "HARD_DEADLINE",
          due_at: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 7*24*3600000)),
          related_entity_type: "TIMESHEET", related_entity_id: timesheet_id, state: "OPEN",
          completed_at: null, completed_by: null, completion_action: null, completion_reason_codes: [],
          completion_notes: null, verification_status: "PENDING_VERIFICATION", recurrence: "ONE_TIME", notes: null,
        });

        // ── Send the client sign-link email FOR REAL (Gmail DWD) + email_log proof ──
        // Previously this step only console.logged a fake "[Email] Sent" line, so the
        // token was generated but no link ever reached the client and nothing was
        // logged. Now we actually dispatch, write an email_log row (PENDING →
        // SENT/FAILED with the Gmail messageId), and stamp the timesheet with the
        // sent proof so the approval view can surface it. Wrapped so an email hiccup
        // never blocks the approval itself.
        const signUrl = `https://datalake-production-sa.web.app/client/timesheet/${clientToken}`;
        const clientTo = ts.client_approver_email || null;
        try {
          const { getGmailClient, sendEmailRaw } = require("./lib/gmail");
          const logRef = db.collection("email_log").doc();
          const emailSubject = `Action required: sign ${ts.engineer_name}'s timesheet — ${ts.period_label}`;
          const emailBody = [
            `Dear ${ts.client_approver_name || "Client Approver"},`,
            ``,
            `${ts.engineer_name}'s timesheet for ${ts.period_label} on ${ts.project_name} has been approved and is ready for your signature.`,
            `Total: ${ts.total_hours || 0} hours.`,
            ``,
            `Review and sign here (no login required):`,
            signUrl,
            ``,
            `This link is unique to you — please do not forward it.`,
            ``,
            LEGAL_EMAIL_FOOTER,
          ].join("\n");

          await logRef.set({
            log_id: logRef.id, to: clientTo, subject: emailSubject,
            template_id: "timesheet_client_sign",
            related_entity_type: "TIMESHEET", related_entity_id: timesheet_id,
            sign_url: signUrl, sent_by: "system:ctoApproveTimesheet", created_at: nowTS,
            status: clientTo ? "PENDING" : "SKIPPED_NO_RECIPIENT",
          });

          if (!clientTo) {
            // The project carried no client approver email, so there is nobody to
            // send the sign link to. Surface WHY on the timesheet — this is the most
            // likely "the link didn't generate" cause when a project lacks a client.
            console.error(`[ctoApproveTimesheet] timesheet ${timesheet_id} has no client_approver_email — sign link not sent.`);
            await tsRef.update({ sign_link_status: "NO_RECIPIENT", sign_link_url: signUrl, sign_link_email_log_id: logRef.id });
          } else {
            try {
              const gmail = await getGmailClient();
              const result = await sendEmailRaw(gmail, clientTo, emailSubject, emailBody);
              const messageId = result?.data?.id || null;
              await logRef.update({ status: "SENT", gmail_message_id: messageId, sent_at: nowTS });
              await tsRef.update({
                sign_link_status: "SENT", sign_link_url: signUrl, sign_link_to: clientTo,
                sign_link_sent_at: nowTS, sign_link_email_log_id: logRef.id, sign_link_message_id: messageId,
              });
            } catch (sendErr) {
              console.error(`[ctoApproveTimesheet] Gmail send failed for ${clientTo}:`, sendErr.message);
              await logRef.update({ status: "FAILED", error: String(sendErr.message || sendErr).slice(0, 500), failed_at: nowTS });
              await tsRef.update({
                sign_link_status: "SEND_FAILED", sign_link_url: signUrl, sign_link_to: clientTo,
                sign_link_email_log_id: logRef.id, sign_link_send_error: String(sendErr.message || sendErr).slice(0, 300),
              });
            }
          }

          await db.collection("audit_log").add({
            event: "TIMESHEET_SIGN_LINK_DISPATCHED", timesheet_id, to: clientTo,
            email_log_id: logRef.id, sign_url: signUrl,
            status: clientTo ? "ATTEMPTED" : "NO_RECIPIENT",
            timestamp: nowTS,
          });
        } catch (emailStepErr) {
          console.error(`[ctoApproveTimesheet] sign-link email step failed (non-blocking):`, emailStepErr.message);
        }

        // Trigger Controller AI timesheet validation via Pub/Sub
        await pubsub.topic("datalake.timesheet.cto_approved").publishMessage({ json: { timesheet_id } });
      }

      await db.collection("task_audit_log").add({
        event: decision === "APPROVE" ? "TIMESHEET_CTO_APPROVED" : "TIMESHEET_CTO_REJECTED",
        timesheet_id, action_by: decodedToken.email, action_at: nowTS,
        details: { decision, notes: notes || null, was_escalated: ts.state === "CEO_ESCALATED" },
        ip_address: req.ip || "unknown", user_agent: req.headers["user-agent"] || "unknown",
      });

      res.status(200).json({
        success: true, timesheet_id, new_state: newState,
        message: decision === "APPROVE" ? "Timesheet approved. Client notified to sign." : "Timesheet rejected. Engineer will resubmit.",
      });
    } catch (err) { console.error("ctoApproveTimesheet error:", err); res.status(500).json({ error: "Internal server error", detail: err.message }); }
  }
);

// ============================================================
// HTTP endpoint: clientSignTimesheet
// Client approver signs or rejects an approved timesheet
// Requires Firebase Auth — client_email derived from ID token
// ============================================================
exports.clientSignTimesheet = onRequest(
  { region: "me-central2", memory: "512MiB", timeoutSeconds: 30, cors: ALLOWED_ORIGINS },
  async (req, res) => {
    // CORS headers
    res.set("Access-Control-Allow-Origin", "https://datalake-production-sa.web.app");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Max-Age", "3600");
      return res.status(204).send("");
    }
    // CORS headers
    res.set("Access-Control-Allow-Origin", "https://datalake-production-sa.web.app");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    // Verify Firebase Auth
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing authorization. Please sign in." });
      return;
    }
    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(authHeader.split("Bearer ")[1]);
    } catch (err) {
      res.status(401).json({ error: "Invalid or expired token." });
      return;
    }

    try {
      // Client email comes from the authenticated token, NOT from request body
      const client_email = decodedToken.email;
      const { timesheet_id, signature_method, signature_data, decision, rejection_reason } = req.body;
      if (!timesheet_id || !decision) { res.status(400).json({ error: "Missing required fields" }); return; }
      if (!["SIGN", "REJECT"].includes(decision)) { res.status(400).json({ error: "Decision must be SIGN or REJECT" }); return; }
      if (decision === "SIGN" && (!signature_method || !signature_data)) { res.status(400).json({ error: "Signature method and data required" }); return; }
      if (decision === "REJECT" && !rejection_reason) { res.status(400).json({ error: "Rejection reason required" }); return; }

      const tsRef = db.collection("timesheets").doc(timesheet_id);
      const tsDoc = await tsRef.get();
      if (!tsDoc.exists) { res.status(404).json({ error: "Timesheet not found" }); return; }
      const ts = tsDoc.data();

      // The client's sign-off is their INDEPENDENT attestation: ONLY the named
      // client approver's own session may sign. No CEO/staff bypass — if the
      // approver who signs can be the same person who approves the invoice, the
      // "client signed" evidence is forgeable and fails audit. CEO setup-testing
      // uses the test-client + test-token path, never a production bypass.
      if (ts.client_approver_email !== client_email) { res.status(403).json({ error: "Not authorized — only the named client approver may sign." }); return; }
      if (ts.state !== "CTO_APPROVED") { res.status(400).json({ error: `Cannot sign timesheet in state: ${ts.state}` }); return; }

      const nowTS = admin.firestore.FieldValue.serverTimestamp();
      const newState = decision === "SIGN" ? "CLIENT_SIGNED" : "DRAFT";

      let signatureHash = null;
      if (decision === "SIGN") {
        const crypto = require("crypto");
        signatureHash = crypto.createHash("sha256").update(`${timesheet_id}|${client_email}|${signature_method}|${Date.now()}`).digest("hex");
      }

      await tsRef.update({
        state: newState, client_action_at: nowTS, client_signature_hash: signatureHash,
        client_signature_method: decision === "SIGN" ? signature_method : null,
        client_action_ip: req.ip || req.headers["x-forwarded-for"] || "unknown",
        rejection_reason: decision === "REJECT" ? rejection_reason : ts.rejection_reason,
        client_sign_token: decision === "REJECT" ? admin.firestore.FieldValue.delete() : ts.client_sign_token,
        updated_at: nowTS,
        audit_trail: admin.firestore.FieldValue.arrayUnion({
          timestamp: new Date().toISOString(), event: newState, actor: client_email,
          signature_hash: signatureHash, rejection_reason: decision === "REJECT" ? rejection_reason : null,
        }),
      });

      if (decision === "SIGN") {
        await db.collection("finance_notifications").add({
          type: "INVOICE_READY_TO_PREPARE", timesheet_id, project_id: ts.project_id,
          project_name: ts.project_name, client_name: ts.client_name, engineer_name: ts.engineer_name,
          period_label: ts.period_label, total_hours: ts.total_hours, created_at: nowTS, processed: false,
        });
      }

      await db.collection("task_audit_log").add({
        event: decision === "SIGN" ? "TIMESHEET_CLIENT_SIGNED" : "TIMESHEET_CLIENT_REJECTED",
        timesheet_id, action_by: client_email, action_at: nowTS,
        details: { decision, signature_method: signature_method || null, signature_hash: signatureHash, rejection_reason: rejection_reason || null },
        ip_address: req.ip || "unknown", user_agent: req.headers["user-agent"] || "unknown",
      });

      res.status(200).json({
        success: true, timesheet_id, new_state: newState, signature_hash: signatureHash,
        message: decision === "SIGN" ? "Timesheet signed. Finance will prepare invoice." : "Timesheet rejected. Engineer will be notified.",
      });
    } catch (err) { console.error("clientSignTimesheet error:", err); res.status(500).json({ error: "Internal server error", detail: err.message }); }
  }
);

// ============================================================
// HTTP endpoint: recordTimesheetSignLinkOpen  (PUBLIC — token is the auth)
// Called by the unauthenticated client sign page when the link is opened, so we
// have auditable proof the client actually received & opened it. Admin SDK write
// bypasses Firestore rules (the page has no Firebase user). Idempotent-ish: first
// open is stamped once; every open increments a counter + updates last-opened.
// ============================================================
exports.recordTimesheetSignLinkOpen = onRequest(
  { invoker: "public", region: "me-central2", memory: "256MiB", timeoutSeconds: 15, cors: true },
  async (req, res) => {
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    try {
      const token = (req.body && req.body.token) || req.query.token;
      if (!token) { res.status(400).json({ error: "Missing token" }); return; }
      const snap = await db.collection("timesheets").where("client_sign_token", "==", token).limit(1).get();
      if (snap.empty) { res.status(404).json({ error: "Invalid or expired token" }); return; }
      const ref = snap.docs[0].ref;
      const data = snap.docs[0].data();
      const nowTS = admin.firestore.FieldValue.serverTimestamp();
      const patch = {
        sign_link_last_opened_at: nowTS,
        sign_link_open_count: admin.firestore.FieldValue.increment(1),
      };
      if (!data.sign_link_first_opened_at) patch.sign_link_first_opened_at = nowTS;
      await ref.update(patch);
      await db.collection("audit_log").add({
        event: "TIMESHEET_SIGN_LINK_OPENED",
        timesheet_id: data.timesheet_id || ref.id,
        ip_address: req.ip || req.headers["x-forwarded-for"] || "unknown",
        user_agent: req.headers["user-agent"] || "unknown",
        timestamp: nowTS,
      });
      res.status(200).json({ success: true });
    } catch (err) {
      console.error("recordTimesheetSignLinkOpen error:", err);
      res.status(500).json({ error: "Internal error" });
    }
  }
);

// ============================================================
// HTTP endpoint: resendTimesheetSignLink
// Re-sends the EXISTING client sign-link to the timesheet's client_approver_email
// and logs a fresh email_log row. Reuses the original token (resend, not re-issue)
// and NEVER returns the token/URL to the caller — staff can trigger a resend but
// can't see or forge the link. Authed staff only (CEO/CTO/finance/HR).
// ============================================================
exports.resendTimesheetSignLink = onRequest(
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 30, cors: ALLOWED_ORIGINS },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "https://datalake-production-sa.web.app");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") { res.set("Access-Control-Max-Age", "3600"); return res.status(204).send(""); }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) { res.status(401).json({ error: "Missing authorization" }); return; }
    let decodedToken;
    try { decodedToken = await admin.auth().verifyIdToken(authHeader.split("Bearer ")[1]); } catch { res.status(401).json({ error: "Invalid token" }); return; }

    // Staff-only — resolve the caller's role from their own record (CEO/CTO/finance/HR).
    let callerRole = null;
    try {
      const ud = await db.collection("users").doc(decodedToken.uid).get();
      if (ud.exists) callerRole = ud.data().role_id || null;
      else {
        const q = await db.collection("users").where("email", "==", (decodedToken.email || "").toLowerCase()).limit(1).get();
        if (!q.empty) callerRole = q.docs[0].data().role_id || null;
      }
    } catch { /* role stays null → denied below unless CEO */ }
    const isCeo = decodedToken.email === "m.alqumri@datalake.sa";
    if (!(isCeo || decodedToken.email === "cto@datalake.sa" || ["ceo", "cto", "finance", "hr"].includes(callerRole))) {
      res.status(403).json({ error: "Only CEO/CTO/finance/HR can resend a sign link." }); return;
    }

    try {
      const { timesheet_id } = req.body || {};
      if (!timesheet_id) { res.status(400).json({ error: "Missing timesheet_id" }); return; }
      const tsRef = db.collection("timesheets").doc(timesheet_id);
      const tsDoc = await tsRef.get();
      if (!tsDoc.exists) { res.status(404).json({ error: "Timesheet not found" }); return; }
      const ts = tsDoc.data();

      if (ts.state === "CLIENT_SIGNED") { res.status(400).json({ error: "Timesheet is already signed — nothing to resend." }); return; }
      if (ts.state !== "CTO_APPROVED") { res.status(400).json({ error: `Sign link can only be resent while awaiting signature; current state: ${ts.state}.` }); return; }
      const clientTo = ts.client_approver_email || null;
      if (!clientTo) { res.status(400).json({ error: "No client approver email on this timesheet — add a client contact to the project and re-approve." }); return; }
      if (!ts.client_sign_token) { res.status(400).json({ error: "No sign token on this timesheet — re-approve to generate one." }); return; }

      // Reuse the EXISTING token (resend, not re-issue) — never returned to the caller.
      const signUrl = `https://datalake-production-sa.web.app/client/timesheet/${ts.client_sign_token}`;
      const nowTS = admin.firestore.FieldValue.serverTimestamp();
      const { getGmailClient, sendEmailRaw } = require("./lib/gmail");
      const logRef = db.collection("email_log").doc();
      const emailSubject = `Reminder: sign ${ts.engineer_name}'s timesheet — ${ts.period_label}`;
      const emailBody = [
        `Dear ${ts.client_approver_name || "Client Approver"},`,
        ``,
        `This is a reminder that ${ts.engineer_name}'s timesheet for ${ts.period_label} on ${ts.project_name} is approved and awaiting your signature.`,
        `Total: ${ts.total_hours || 0} hours.`,
        ``,
        `Review and sign here (no login required):`,
        signUrl,
        ``,
        `This link is unique to you — please do not forward it.`,
        ``,
        LEGAL_EMAIL_FOOTER,
      ].join("\n");

      await logRef.set({
        log_id: logRef.id, to: clientTo, subject: emailSubject,
        template_id: "timesheet_client_sign", related_entity_type: "TIMESHEET", related_entity_id: timesheet_id,
        sign_url: signUrl, sent_by: decodedToken.email, created_at: nowTS, status: "PENDING", resend: true,
      });

      try {
        const gmail = await getGmailClient();
        const result = await sendEmailRaw(gmail, clientTo, emailSubject, emailBody);
        const messageId = result?.data?.id || null;
        await logRef.update({ status: "SENT", gmail_message_id: messageId, sent_at: nowTS });
        await tsRef.update({
          sign_link_status: "SENT", sign_link_url: signUrl, sign_link_to: clientTo,
          sign_link_sent_at: nowTS, sign_link_email_log_id: logRef.id, sign_link_message_id: messageId,
          sign_link_resend_count: admin.firestore.FieldValue.increment(1),
          sign_link_last_resent_by: decodedToken.email,
          // Re-extend the token TTL by another 30 days on resend.
          sign_token_expires_at: admin.firestore.Timestamp.fromMillis(Date.now() + 30 * 24 * 3600 * 1000),
        });
        await db.collection("audit_log").add({
          event: "TIMESHEET_SIGN_LINK_RESENT", timesheet_id, to: clientTo,
          email_log_id: logRef.id, resent_by: decodedToken.email, status: "SENT", timestamp: nowTS,
        });
        res.status(200).json({ success: true, status: "SENT", message_id: messageId, to: clientTo });
      } catch (sendErr) {
        console.error(`[resendTimesheetSignLink] Gmail send failed for ${clientTo}:`, sendErr.message);
        await logRef.update({ status: "FAILED", error: String(sendErr.message || sendErr).slice(0, 500), failed_at: nowTS });
        await tsRef.update({
          sign_link_status: "SEND_FAILED", sign_link_to: clientTo, sign_link_email_log_id: logRef.id,
          sign_link_send_error: String(sendErr.message || sendErr).slice(0, 300),
        });
        await db.collection("audit_log").add({
          event: "TIMESHEET_SIGN_LINK_RESENT", timesheet_id, to: clientTo,
          email_log_id: logRef.id, resent_by: decodedToken.email, status: "FAILED", timestamp: nowTS,
        });
        res.status(502).json({ error: "Email send failed", detail: String(sendErr.message || sendErr).slice(0, 300) });
      }
    } catch (err) {
      console.error("resendTimesheetSignLink error:", err);
      res.status(500).json({ error: "Internal server error", detail: err.message });
    }
  }
);

// ============================================================
// HTTP endpoint: getTimesheetsByToken  (PUBLIC — token is the auth)
// Returns the sanitized timesheet(s) for a client sign token so the
// unauthenticated client page can render what it's signing. Admin SDK read
// (bypasses the auth-required firestore.rules read). The token was emailed only
// to the client approver, so possession is the client's credential.
// ============================================================
exports.getTimesheetsByToken = onRequest(
  { invoker: "public", region: "me-central2", memory: "256MiB", timeoutSeconds: 15, cors: true },
  async (req, res) => {
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    try {
      const token = (req.body && req.body.token) || req.query.token;
      if (!token) { res.status(400).json({ error: "Missing token" }); return; }
      const snap = await db.collection("timesheets").where("client_sign_token", "==", token).get();
      if (snap.empty) { res.status(404).json({ error: "Invalid or expired sign link" }); return; }
      if (snap.docs.some(d => { const e = d.data().sign_token_expires_at; return e && e.toMillis && e.toMillis() < Date.now(); })) {
        res.status(410).json({ error: "Sign link expired — request a new one." }); return;
      }
      const items = snap.docs.map(d => {
        const x = d.data();
        return {
          id: d.id, engineer_name: x.engineer_name, engineer_email: x.engineer_email,
          project_name: x.project_name, client_name: x.client_name, po_number: x.po_number,
          client_approver_name: x.client_approver_name,
          period_label: x.period_label, period_year: x.period_year, period_month: x.period_month,
          total_hours: x.total_hours, in_house_hours: x.in_house_hours, remote_hours: x.remote_hours, leave_hours: x.leave_hours,
          days: x.days || {}, state: x.state, status: x.status,
          client_action_at: x.client_action_at || null, client_signature_method: x.client_signature_method || null,
        };
      });
      res.status(200).json({ success: true, timesheets: items });
    } catch (err) { console.error("getTimesheetsByToken error:", err); res.status(500).json({ error: "Internal error" }); }
  }
);

// ============================================================
// HTTP endpoint: signTimesheetByToken  (PUBLIC — token is the auth)
// The client's INDEPENDENT attestation. Token possession (emailed only to the
// client approver) is the credential — NO staff/CEO session can produce this.
// Batch-signs every CTO_APPROVED timesheet carrying the token. Admin SDK write,
// so firestore.rules can deny all direct CLIENT_SIGNED transitions. The token is
// burned on use.
// ============================================================
exports.signTimesheetByToken = onRequest(
  { invoker: "public", region: "me-central2", memory: "256MiB", timeoutSeconds: 30, cors: true },
  async (req, res) => {
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
    try {
      const { token, decision, signature_method, signature_data, rejection_reason, signed_pdf_url } = req.body || {};
      if (!token || !decision) { res.status(400).json({ error: "token and decision required" }); return; }
      if (!["SIGN", "REJECT"].includes(decision)) { res.status(400).json({ error: "decision must be SIGN or REJECT" }); return; }
      if (decision === "SIGN" && (!signature_method || !signature_data)) { res.status(400).json({ error: "signature_method and signature_data required" }); return; }
      if (decision === "REJECT" && !rejection_reason) { res.status(400).json({ error: "rejection_reason required" }); return; }

      const snap = await db.collection("timesheets").where("client_sign_token", "==", token).get();
      if (snap.empty) { res.status(404).json({ error: "Invalid or expired sign link" }); return; }
      if (snap.docs.some(d => { const e = d.data().sign_token_expires_at; return e && e.toMillis && e.toMillis() < Date.now(); })) {
        res.status(410).json({ error: "Sign link expired — request a new one." }); return;
      }
      const targets = snap.docs.filter(d => d.data().state === "CTO_APPROVED");
      if (!targets.length) {
        const states = [...new Set(snap.docs.map(d => d.data().state))];
        res.status(409).json({ error: `Nothing to sign — current state(s): ${states.join(", ")}` }); return;
      }

      const nowTS = admin.firestore.FieldValue.serverTimestamp();
      const ip = req.ip || req.headers["x-forwarded-for"] || "unknown";
      const ua = req.headers["user-agent"] || "unknown";
      const crypto = require("crypto");
      const ids = [];
      for (const docSnap of targets) {
        const ts = docSnap.data();
        if (decision === "SIGN") {
          const signatureHash = crypto.createHash("sha256").update(`${docSnap.id}|${ts.client_approver_email}|${signature_method}|${Date.now()}`).digest("hex");
          await docSnap.ref.update({
            state: "CLIENT_SIGNED", status: "CLIENT_SIGNED",
            client_action_at: nowTS, client_signed_at: nowTS,
            client_signature_hash: signatureHash, client_signature_method: signature_method,
            client_signature_image: (signature_method === "draw" || signature_method === "upload") ? signature_data : null,
            client_signature_text: signature_method === "type" ? signature_data : null,
            client_action_ip: ip, client_signed_by: ts.client_approver_email || null,
            signed_pdf_url: signed_pdf_url || ts.signed_pdf_url || null,
            client_sign_token: admin.firestore.FieldValue.delete(),
            sign_token_expires_at: admin.firestore.FieldValue.delete(),
            updated_at: nowTS,
            audit_trail: admin.firestore.FieldValue.arrayUnion({ timestamp: new Date().toISOString(), event: "CLIENT_SIGNED", actor: ts.client_approver_email || "client_token", signature_hash: signatureHash, via: "sign_token" }),
          });
          await db.collection("finance_notifications").add({
            type: "INVOICE_READY_TO_PREPARE", timesheet_id: docSnap.id, project_id: ts.project_id,
            project_name: ts.project_name, client_name: ts.client_name, engineer_name: ts.engineer_name,
            period_label: ts.period_label, total_hours: ts.total_hours, created_at: nowTS, processed: false,
          });
        } else {
          await docSnap.ref.update({
            state: "REJECTED_BY_CLIENT", status: "REJECTED_BY_CLIENT",
            rejection_reason, client_action_at: nowTS, client_action_ip: ip,
            client_sign_token: admin.firestore.FieldValue.delete(),
            sign_token_expires_at: admin.firestore.FieldValue.delete(), updated_at: nowTS,
            audit_trail: admin.firestore.FieldValue.arrayUnion({ timestamp: new Date().toISOString(), event: "REJECTED_BY_CLIENT", actor: ts.client_approver_email || "client_token", rejection_reason, via: "sign_token" }),
          });
        }
        await db.collection("task_audit_log").add({
          event: decision === "SIGN" ? "TIMESHEET_CLIENT_SIGNED" : "TIMESHEET_CLIENT_REJECTED",
          timesheet_id: docSnap.id, action_by: ts.client_approver_email || "client_token", action_at: nowTS,
          details: { via: "sign_token", signature_method: signature_method || null, rejection_reason: rejection_reason || null },
          ip_address: ip, user_agent: ua,
        });
        ids.push(docSnap.id);
      }
      res.status(200).json({ success: true, decision, timesheet_ids: ids, count: ids.length });
    } catch (err) { console.error("signTimesheetByToken error:", err); res.status(500).json({ error: "Internal server error", detail: err.message }); }
  }
);

// ============================================================
// Scheduled: escalateStaleTimesheets
// Runs hourly, escalates SUBMITTED timesheets older than 48hrs to CEO
// ============================================================
exports.escalateStaleTimesheets = onSchedule(
  { schedule: "every 60 minutes", region: "me-central2", memory: "256MiB", timeoutSeconds: 60, timeZone: "Asia/Riyadh" },
  async () => {
    const cutoff = new Date(Date.now() - 48 * 3600000);
    const stale = await db.collection("timesheets")
      .where("state", "==", "SUBMITTED")
      .where("submitted_at", "<", admin.firestore.Timestamp.fromDate(cutoff))
      .get();

    if (stale.empty) { console.log("No stale timesheets"); return; }
    const nowTS = admin.firestore.FieldValue.serverTimestamp();

    for (const doc of stale.docs) {
      const ts = doc.data();
      await doc.ref.update({
        state: "CEO_ESCALATED", ceo_escalated_at: nowTS, updated_at: nowTS,
        audit_trail: admin.firestore.FieldValue.arrayUnion({
          timestamp: new Date().toISOString(), event: "CEO_ESCALATED",
          actor: "system:escalateStaleTimesheets", reason: "CTO did not act within 48 hours",
        }),
      });

      const taskId = `TSK-ESC-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      await db.collection("tasks").doc(taskId).set({
        task_id: taskId, title: `ESCALATED: Approve timesheet ${ts.engineer_name} — ${ts.period_label}`,
        description: `CTO did not review in 48 hours. Total hours: ${ts.total_hours}. Project: ${ts.project_name}.`,
        task_type: "APPROVE_REJECT", creation_method: "ESCALATION", created_by: "system:escalateStaleTimesheets", created_at: nowTS,
        assigned_to_type: "INDIVIDUAL", assigned_to_id: "m.alqumri@datalake.sa", assigned_to_role: "CEO",
        priority: "HIGH", escalation_type: "HARD_DEADLINE",
        due_at: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 24*3600000)),
        related_entity_type: "TIMESHEET", related_entity_id: doc.id, state: "OPEN",
        completed_at: null, completed_by: null, completion_action: null, completion_reason_codes: [],
        completion_notes: null, verification_status: "PENDING_VERIFICATION", recurrence: "ONE_TIME", notes: null,
      });

      await db.collection("task_audit_log").add({
        event: "TIMESHEET_ESCALATED_TO_CEO", timesheet_id: doc.id,
        action_by: "system:escalateStaleTimesheets", action_at: nowTS,
        details: { reason: "CTO 48-hour SLA exceeded" },
      });
    }
    console.log(`Escalated ${stale.size} stale timesheets`);
  }
);

// ============================================================
// HTTP endpoint: getMyTimesheets
// Returns engineer's own timesheets (no rates, no days detail)
// ============================================================
exports.getMyTimesheets = onRequest(
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 20, cors: ALLOWED_ORIGINS },
  async (req, res) => {
    // CORS headers
    res.set("Access-Control-Allow-Origin", "https://datalake-production-sa.web.app");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Max-Age", "3600");
      return res.status(204).send("");
    }
    // CORS headers
    res.set("Access-Control-Allow-Origin", "https://datalake-production-sa.web.app");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) { res.status(401).json({ error: "Missing auth" }); return; }
    let decodedToken;
    try { decodedToken = await admin.auth().verifyIdToken(authHeader.split("Bearer ")[1]); } catch { res.status(401).json({ error: "Invalid token" }); return; }

    try {
      // No composite (engineer_email + submitted_at) index required: filter by
      // engineer, then sort/limit in memory (an engineer has at most a handful).
      const snapshot = await db.collection("timesheets")
        .where("engineer_email", "==", decodedToken.email)
        .get();

      const timesheets = snapshot.docs
        .map(d => d.data())
        .sort((a, b) => (b.submitted_at?.toMillis?.() || 0) - (a.submitted_at?.toMillis?.() || 0))
        .slice(0, 12)
        .map(t => ({
          timesheet_id: t.timesheet_id, project_name: t.project_name, client_name: t.client_name,
          period_label: t.period_label, total_hours: t.total_hours, state: t.state,
          submitted_at: t.submitted_at, rejection_reason: t.rejection_reason,
          // NO days detail, NO rates, NO client approver email
        }));
      res.status(200).json({ timesheets });
    } catch (err) {
      console.error("getMyTimesheets error:", err);
      res.status(500).json({ error: "Could not load timesheets" });
    }
  }
);

// ============================================================
// HTTP endpoint: getClientTimesheets
// Returns CTO-approved timesheets for an authenticated client user
// Requires Firebase Auth + client role in RBAC system
// ============================================================
exports.getClientTimesheets = onRequest(
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 20, cors: ALLOWED_ORIGINS },
  async (req, res) => {
    // CORS headers
    res.set("Access-Control-Allow-Origin", "https://datalake-production-sa.web.app");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Max-Age", "3600");
      return res.status(204).send("");
    }
    // CORS headers
    res.set("Access-Control-Allow-Origin", "https://datalake-production-sa.web.app");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    // Verify Firebase Auth token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing authorization. Please sign in." });
      return;
    }

    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(authHeader.split("Bearer ")[1]);
    } catch (err) {
      res.status(401).json({ error: "Invalid or expired token. Please sign in again." });
      return;
    }

    try {
      const clientEmail = decodedToken.email;

      // Look up user in RBAC system to verify client role
      const userDoc = await db.collection("users").doc(decodedToken.uid).get();
      if (userDoc.exists) {
        const userData = userDoc.data();
        if (userData.status === "disabled") {
          res.status(403).json({ error: "Account is disabled. Contact support." });
          return;
        }
        // If user exists in RBAC, verify they have client role
        if (userData.role_id !== "client") {
          res.status(403).json({ error: "Access denied. Client role required." });
          return;
        }
      }
      // If user not in RBAC system, allow by email match (backward compat)
      // — the query below will only return timesheets where they are the approver

      // Find timesheets where this user is the client approver
      const snapshot = await db.collection("timesheets")
        .where("client_approver_email", "==", clientEmail)
        .where("state", "==", "CTO_APPROVED").get();

      const timesheets = snapshot.docs.map(d => {
        const t = d.data();
        return {
          timesheet_id: t.timesheet_id, project_name: t.project_name, engineer_name: t.engineer_name,
          period_label: t.period_label, total_hours: t.total_hours, in_house_hours: t.in_house_hours,
          remote_hours: t.remote_hours, leave_hours: t.leave_hours, days: t.days, cto_action_at: t.cto_action_at,
          // NO: rates, PO values, engineer email, CTO notes
        };
      });
      res.status(200).json({ timesheets, client_email: clientEmail });
    } catch (err) {
      console.error("getClientTimesheets error:", err);
      res.status(500).json({ error: "Internal server error", detail: err.message });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════
// extractCVData — Self-hosted AI CV Extractor (KSA Sovereign)
// DTLK-PROMPT-AI-001: NO Gemini / VertexAI / external APIs.
// Pipeline: datalake-ocr (PaddleOCR) → datalake-ai-inference (Qwen 2.5 7B)
// Both services run in me-central2 (Dammam). No data leaves GCP KSA.
// ═══════════════════════════════════════════════════════════════════
exports.extractCVData = onRequest(
  {
    region: "me-central2",
    memory: "512MiB",
    timeoutSeconds: 300, // 5 minutes: Accounts for AI cold-start + OCR + LLM inference
    cors: ALLOWED_ORIGINS,
    
    
  },
  async (req, res) => {
    // CORS headers
    res.set("Access-Control-Allow-Origin", "https://datalake-production-sa.web.app");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Max-Age", "3600");
      return res.status(204).send("");
    }
    // CORS headers
    res.set("Access-Control-Allow-Origin", "https://datalake-production-sa.web.app");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    try {
      // ── Step 1: Parse the incoming CV file via Busboy ──
      const busboy = Busboy({ headers: req.headers });
      const fileBuffers = [];
      let fileMimeType = null;
      let fileName = null;

      await new Promise((resolve, reject) => {
        busboy.on("file", (name, stream, info) => {
          if (name !== "cv") { stream.resume(); return; }
          fileMimeType = info.mimeType;
          fileName = info.filename;
          stream.on("data", (chunk) => fileBuffers.push(chunk));
          stream.on("end", () => {});
        });
        busboy.on("finish", resolve);
        busboy.on("error", reject);
        busboy.end(req.rawBody || req.body);
      });

      if (fileBuffers.length === 0) {
        res.status(400).json({ error: "No CV file received. Send file with field name 'cv'." });
        return;
      }

      const cvBuffer = Buffer.concat(fileBuffers);

      if (cvBuffer.length > 10 * 1024 * 1024) {
        res.status(400).json({ error: "CV file too large (max 10MB)" });
        return;
      }

      const supportedTypes = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
      if (!supportedTypes.includes(fileMimeType)) {
        res.status(400).json({
          error: `Unsupported file type: ${fileMimeType}. Please upload PDF, PNG, or JPG.`,
        });
        return;
      }

      const triggeredBy = req.headers.authorization ? "authenticated_user" : "anonymous";

      // ── Step 2+3: Extract with Gemma 3 on the in-KSA GPU. Images go straight
      //    to Gemma VISION (OCR + extraction in ONE pass); digital PDFs are read
      //    with pdf-parse (milliseconds, no service call) and the text goes to
      //    Gemma. PaddleOCR is no longer used on the CV path. ──
      const CV_SYSTEM_PROMPT = `You are the Datalake Gatekeeper AI. Extract structured data from this CV.

GROUNDING: Extract ONLY information actually present in the CV. If a field is not present, use null. Never invent names, employers, dates, emails, phone numbers, certifications, or skills.

Return ONLY a valid JSON object with these exact fields (use null for any not found):
{
  "full_name": "candidate full name",
  "email": "email address",
  "phone": "phone number with country code",
  "location": "city and country",
  "nationality": "nationality if mentioned",
  "years_experience": "one of: 0-2 years, 3-5 years, 6-10 years, 10+ years",
  "current_employer": "current or most recent company",
  "current_role": "current or most recent job title",
  "linkedin_url": "LinkedIn URL or null",
  "skills": ["skill1", "skill2"],
  "certifications": ["cert1"],
  "education": [{"degree": "", "institution": "", "year": ""}],
  "work_history": [{"company": "", "role": "", "from": "", "to": "", "description": ""}],
  "languages": ["English", "Arabic"],
  "notice_period": "Immediate | 1 month | 2 months | 3+ months or null",
  "salary_expectation": "amount or null",
  "role_interest": "type of role or null",
  "match_summary": "Brief 2-sentence candidate summary"
}
Rules: extract ALL skills; prefer +966 for Saudi phones; keep work_history descriptions short; return valid JSON only, no markdown.`;

      const isImage = (fileMimeType || "").startsWith("image/");
      let fullText = "";
      let extractionMethod;
      let pageCount = 0;
      let llmResult;

      if (isImage) {
        // Photo / scan of a CV — Gemma vision reads it directly.
        extractionMethod = "gemma-vision";
        llmResult = await callLLM({
          agent: "gatekeeper",
          type: "cv_extract",
          triggeredBy,
          promptTemplateId: "GATEKEEPER_CV_EXTRACT_V2_VISION",
          systemPrompt: CV_SYSTEM_PROMPT,
          userPrompt: "Read this CV image and extract the candidate data as JSON.",
          jsonMode: true,
          images: [{ base64: cvBuffer.toString("base64"), mimeType: fileMimeType }],
        });
      } else {
        // PDF — read the embedded text layer (digital PDF). No OCR service call.
        try {
          const pdfData = await pdfParse(cvBuffer);
          fullText = (pdfData.text || "").trim();
          pageCount = pdfData.numpages || 0;
        } catch (e) {
          console.warn("pdf-parse failed:", e.message);
        }
        if (!fullText) {
          // Scanned/image-only PDF with no text layer — we no longer OCR PDFs.
          res.status(422).json({
            error: "This looks like a scanned PDF with no text. Please upload it as an image (PNG/JPG), or a text-based PDF.",
            fallback: true,
          });
          return;
        }
        extractionMethod = "pdf-parse+gemma";
        llmResult = await callLLM({
          agent: "gatekeeper",
          type: "cv_extract",
          triggeredBy,
          promptTemplateId: "GATEKEEPER_CV_EXTRACT_V2",
          systemPrompt: CV_SYSTEM_PROMPT,
          userPrompt: fullText,
          jsonMode: true,
        });
      }

      if (!llmResult.success) {
        console.error("CV extraction failed:", llmResult.error);
        res.status(503).json({
          error: "AI extraction temporarily unavailable. Please fill the form manually.",
          detail: llmResult.error,
          fallback: true,
        });
        return;
      }

      // ── Step 4: Parse LLM JSON output ──
      const parsed = parseJsonOutput(llmResult.output);
      let extracted = parsed.success ? parsed.data : {};

      if (!parsed.success) {
        console.warn("CV JSON parse failed — returning partial data:", parsed.error);
      }

      // Normalise skills to array
      if (extracted.skills && typeof extracted.skills === "string") {
        extracted.skills = extracted.skills.split(",").map((s) => s.trim());
      }
      if (!Array.isArray(extracted.skills)) extracted.skills = [];

      // Regex fallback for email/phone — only when we have a text layer (PDF path).
      if (fullText) {
        if (!extracted.email) {
          const m = fullText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
          if (m) extracted.email = m[0];
        }
        if (!extracted.phone) {
          const m = fullText.match(/\+966\s?[-.]?\s?5\d{8}|05\d{8}/);
          if (m) extracted.phone = m[0];
        }
      }

      // ── Step 5: Firestore audit log (no PII — metadata only) ──
      await db.collection("task_audit_log").add({
        event: "CV_EXTRACTED",
        action_by: "system:extractCVData",
        action_at: admin.firestore.FieldValue.serverTimestamp(),
        details: {
          file_name: fileName,
          file_size_bytes: cvBuffer.length,
          file_type: fileMimeType,
          extraction_method: extractionMethod,
          pdf_text_chars: fullText.length,
          pages: pageCount,
          fields_extracted: Object.keys(extracted).filter(
            (k) => extracted[k] !== null && extracted[k] !== ""
          ).length,
          // AI engine detail — no Gemini, self-hosted only
          ai_engine: MODEL_NAME,
          ai_region: "me-central2",
          inference_ms: llmResult.inferenceMs,
          // DO NOT log candidate name, email, phone, or raw text
        },
        ip_address: req.ip || req.headers["x-forwarded-for"] || "unknown",
      });

      res.status(200).json({
        success: true,
        extracted,
        confidence_note:
          "Fields auto-extracted from your CV using Datalake AI. Please review and correct before submitting.",
        sovereignty:
          "All processing performed in me-central2 (Dammam, KSA). No data left the Kingdom. Self-hosted model only.",
      });
    } catch (err) {
      console.error("extractCVData error:", err);
      res.status(500).json({
        error: "CV extraction failed",
        detail: err.message,
        fallback: "Please fill the form manually.",
      });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════
// RBAC Cloud Functions — CEO Admin Portal
// All functions: verify ID token → check CEO role → execute → audit log
// ═══════════════════════════════════════════════════════════════════

/** Helper: verify Firebase ID token from Authorization header.
 *
 *  ⚠️ STAFF-ONLY. This helper enforces the @datalake.sa domain and is intended
 *  ONLY for internal/staff endpoints. Do NOT wire client- or external-facing
 *  functions through it — external users (clients, candidates) are not on the
 *  @datalake.sa domain and would be rejected with AUTH_DOMAIN.
 *
 *  Client-authenticated endpoints (clientSignTimesheet, getClientTimesheets)
 *  instead call admin.auth().verifyIdToken() directly and gate by provisioned
 *  role / record ownership (role_id==='client', client_approver_email) — NOT by
 *  email domain. Token-gated flows (clientApproveLeave, submitClientScorecard)
 *  and public endpoints (submitCareerApplication) do not authenticate at all.
 *
 *  Domain enforcement is the server-side complement to the Firebase Console
 *  provider restrictions (Google hd=datalake.sa, Microsoft tenant GUID). Even if
 *  a rogue SSO token is crafted, it is rejected here before any data access. */
async function verifyAuth(req) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    const err = new Error("Missing Authorization header");
    err.code = "AUTH_MISSING";
    throw err;
  }
  const token = authHeader.split("Bearer ")[1];
  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(token);
  } catch (e) {
    const err = new Error("Invalid or expired token");
    err.code = "AUTH_INVALID";
    throw err;
  }
  // Domain enforcement — @datalake.sa only
  const email = (decoded.email || "").toLowerCase();
  if (!email.endsWith("@datalake.sa")) {
    const err = new Error("Access restricted to @datalake.sa accounts");
    err.code = "AUTH_DOMAIN";
    throw err;
  }
  return decoded;
}

/** Wraps verifyAuth for HTTP handlers — returns null and sends 401/403 on auth failure,
 *  returns the decoded token on success. Callers should `if (!decoded) return;`. */
async function requireAuthOrReject(req, res) {
  try {
    return await verifyAuth(req);
  } catch (e) {
    if (e.code === "AUTH_MISSING" || e.code === "AUTH_INVALID") {
      res.status(401).json({ error: e.message });
      return null;
    }
    if (e.code === "AUTH_DOMAIN") {
      res.status(403).json({ error: e.message });
      return null;
    }
    throw e; // re-throw unexpected errors
  }
}

/** Helper: verify CEO role */
async function requireCeo(req) {
  const decoded = await verifyAuth(req);
  const profile = await getUserAccessProfile(decoded.uid);
  if (profile.role_id !== "ceo") throw new Error("Forbidden: CEO role required");
  return profile;
}

// ── 1. getRBACState ──
exports.getRBACState = onRequest(
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 30, cors: ALLOWED_ORIGINS },
  async (req, res) => {
    // CORS headers
    res.set("Access-Control-Allow-Origin", "https://datalake-production-sa.web.app");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Max-Age", "3600");
      return res.status(204).send("");
    }
    // CORS headers
    res.set("Access-Control-Allow-Origin", "https://datalake-production-sa.web.app");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    try {
      const profile = await requireCeo(req);
      const [usersSnap, rolesSnap, matrixSnap, clientsSnap] = await Promise.all([
        db.collection("users").get(),
        db.collection("roles").get(),
        db.collection("access_matrix").get(),
        db.collection("clients").get(),
      ]);
      res.status(200).json({
        users: usersSnap.docs.map(d => ({ id: d.id, ...d.data() })),
        roles: rolesSnap.docs.map(d => ({ id: d.id, ...d.data() })),
        access_matrix: matrixSnap.docs.reduce((acc, d) => { acc[d.id] = d.data(); return acc; }, {}),
        clients: clientsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
      });
    } catch (err) {
      console.error("getRBACState error:", err.message);
      res.status(err.message.includes("Forbidden") ? 403 : 401).json({ error: err.message });
    }
  }
);

// ── 2. addUser ──
exports.addUser = onRequest(
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 30, cors: ALLOWED_ORIGINS },
  async (req, res) => {
    // CORS headers
    res.set("Access-Control-Allow-Origin", "https://datalake-production-sa.web.app");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Max-Age", "3600");
      return res.status(204).send("");
    }
    // CORS headers
    res.set("Access-Control-Allow-Origin", "https://datalake-production-sa.web.app");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    try {
      const profile = await requireCeo(req);
      const { role_id, display_name, client_id } = req.body;
      const email = req.body.email ? req.body.email.toLowerCase() : null;
      if (!email || !role_id || !display_name) {
        return res.status(400).json({ error: "email, role_id, and display_name are required" });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: "Invalid email format" });
      }
      const roleDoc = await db.collection("roles").doc(role_id).get();
      if (!roleDoc.exists) return res.status(400).json({ error: `Role '${role_id}' does not exist` });
      if (role_id === "client" && !client_id) {
        return res.status(400).json({ error: "client_id required when role is 'client'" });
      }
      // Create Firebase Auth user (or get existing)
      let authUser;
      let isNewAccount = false;
      try {
        authUser = await admin.auth().getUserByEmail(email);
      } catch (_) {
        authUser = await admin.auth().createUser({ email, displayName: display_name });
        isNewAccount = true;
      }
      // Create users record
      await db.collection("users").doc(authUser.uid).set({
        uid: authUser.uid,
        email,
        display_name,
        role_id,
        status: "active",
        client_id: client_id || null,
        assigned_projects: [],
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        last_login_at: null,
        created_by: profile.email,
      });
      await logAccessEvent("USER_CREATED", profile, {
        target_uid: authUser.uid, target_email: email, role_id,
        ip_address: req.ip || req.headers["x-forwarded-for"] || "unknown",
      });
      // New accounts have no password — email a set-password link (best-effort,
      // non-blocking). Existing accounts are left alone (no unsolicited resets).
      let setup_email = { sent: false };
      if (isNewAccount) {
        const { sendAccountSetupEmail } = require("./passwordReset");
        setup_email = await sendAccountSetupEmail(email, display_name)
          .catch((e) => ({ sent: false, error: e.message }));
      }
      res.status(200).json({ success: true, uid: authUser.uid, setup_email });
    } catch (err) {
      console.error("addUser error:", err.message);
      res.status(httpErrorStatus(err)).json({ error: err.message });
    }
  }
);

// ── 3. updateUserRole ──
exports.updateUserRole = onRequest(
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 30, cors: ALLOWED_ORIGINS },
  async (req, res) => {
    // CORS headers
    res.set("Access-Control-Allow-Origin", "https://datalake-production-sa.web.app");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Max-Age", "3600");
      return res.status(204).send("");
    }
    // CORS headers
    res.set("Access-Control-Allow-Origin", "https://datalake-production-sa.web.app");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    try {
      const profile = await requireCeo(req);
      const { uid, new_role_id, client_id } = req.body;
      if (!uid || !new_role_id) return res.status(400).json({ error: "uid and new_role_id required" });
      const roleDoc = await db.collection("roles").doc(new_role_id).get();
      if (!roleDoc.exists) return res.status(400).json({ error: `Role '${new_role_id}' does not exist` });
      const userDoc = await db.collection("users").doc(uid).get();
      if (!userDoc.exists) return res.status(404).json({ error: "User not found" });
      const oldRole = userDoc.data().role_id;
      const updateData = { role_id: new_role_id };
      if (new_role_id === "client" && client_id) updateData.client_id = client_id;
      if (new_role_id !== "client") updateData.client_id = null;
      await db.collection("users").doc(uid).update(updateData);
      await logAccessEvent("USER_ROLE_CHANGED", profile, {
        target_uid: uid, old_role: oldRole, new_role: new_role_id,
        ip_address: req.ip || req.headers["x-forwarded-for"] || "unknown",
      });
      res.status(200).json({ success: true, old_role: oldRole, new_role: new_role_id });
    } catch (err) {
      console.error("updateUserRole error:", err.message);
      res.status(err.message.includes("Forbidden") ? 403 : 500).json({ error: err.message });
    }
  }
);

// ── 4. disableUser ──
exports.disableUser = onRequest(
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 30, cors: ALLOWED_ORIGINS },
  async (req, res) => {
    // CORS headers
    res.set("Access-Control-Allow-Origin", "https://datalake-production-sa.web.app");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Max-Age", "3600");
      return res.status(204).send("");
    }
    // CORS headers
    res.set("Access-Control-Allow-Origin", "https://datalake-production-sa.web.app");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    try {
      const profile = await requireCeo(req);
      const { uid } = req.body;
      if (!uid) return res.status(400).json({ error: "uid required" });
      if (uid === profile.uid) return res.status(400).json({ error: "Cannot disable your own account" });
      const userDoc = await db.collection("users").doc(uid).get();
      if (!userDoc.exists) return res.status(404).json({ error: "User not found" });
      const newStatus = userDoc.data().status === "active" ? "disabled" : "active";
      await db.collection("users").doc(uid).update({ status: newStatus });
      await logAccessEvent(newStatus === "disabled" ? "USER_DISABLED" : "USER_ENABLED", profile, {
        target_uid: uid, target_email: userDoc.data().email, new_status: newStatus,
        ip_address: req.ip || req.headers["x-forwarded-for"] || "unknown",
      });
      res.status(200).json({ success: true, new_status: newStatus });
    } catch (err) {
      console.error("disableUser error:", err.message);
      res.status(err.message.includes("Forbidden") ? 403 : 500).json({ error: err.message });
    }
  }
);

// ── 5. createCustomRole ──
exports.createCustomRole = onRequest(
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 30, cors: ALLOWED_ORIGINS },
  async (req, res) => {
    // CORS headers
    res.set("Access-Control-Allow-Origin", "https://datalake-production-sa.web.app");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Max-Age", "3600");
      return res.status(204).send("");
    }
    // CORS headers
    res.set("Access-Control-Allow-Origin", "https://datalake-production-sa.web.app");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    try {
      const profile = await requireCeo(req);
      const { role_name, description, base_role_id } = req.body;
      if (!role_name || !description || !base_role_id) {
        return res.status(400).json({ error: "role_name, description, and base_role_id required" });
      }
      const slug = role_name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
      const existing = await db.collection("roles").doc(slug).get();
      if (existing.exists) return res.status(400).json({ error: `Role '${slug}' already exists` });
      const baseMatrix = await db.collection("access_matrix").doc(base_role_id).get();
      if (!baseMatrix.exists) return res.status(400).json({ error: `Base role '${base_role_id}' has no matrix` });
      await db.collection("roles").doc(slug).set({
        role_id: slug, role_name, role_type: "custom", description,
        is_deletable: true,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        created_by: profile.email,
      });
      await db.collection("access_matrix").doc(slug).set({
        role_id: slug,
        data_classes: { ...baseMatrix.data().data_classes },
        last_updated_by: profile.email,
        last_updated_at: admin.firestore.FieldValue.serverTimestamp(),
      });
      await logAccessEvent("ROLE_CREATED", profile, {
        role_id: slug, role_name, base_role_id,
        ip_address: req.ip || req.headers["x-forwarded-for"] || "unknown",
      });
      res.status(200).json({ success: true, role_id: slug });
    } catch (err) {
      console.error("createCustomRole error:", err.message);
      res.status(err.message.includes("Forbidden") ? 403 : 500).json({ error: err.message });
    }
  }
);

// ── 6. deleteCustomRole ──
exports.deleteCustomRole = onRequest(
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 30, cors: ALLOWED_ORIGINS },
  async (req, res) => {
    // CORS headers
    res.set("Access-Control-Allow-Origin", "https://datalake-production-sa.web.app");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Max-Age", "3600");
      return res.status(204).send("");
    }
    // CORS headers
    res.set("Access-Control-Allow-Origin", "https://datalake-production-sa.web.app");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    try {
      const profile = await requireCeo(req);
      const { role_id } = req.body;
      if (!role_id) return res.status(400).json({ error: "role_id required" });
      const roleDoc = await db.collection("roles").doc(role_id).get();
      if (!roleDoc.exists) return res.status(404).json({ error: "Role not found" });
      if (!roleDoc.data().is_deletable) return res.status(400).json({ error: "Cannot delete system role" });
      const usersWithRole = await db.collection("users").where("role_id", "==", role_id).get();
      if (!usersWithRole.empty) {
        return res.status(400).json({ error: `Cannot delete: ${usersWithRole.size} user(s) still assigned this role` });
      }
      await db.collection("roles").doc(role_id).delete();
      await db.collection("access_matrix").doc(role_id).delete();
      await logAccessEvent("ROLE_DELETED", profile, {
        role_id, role_name: roleDoc.data().role_name,
        ip_address: req.ip || req.headers["x-forwarded-for"] || "unknown",
      });
      res.status(200).json({ success: true });
    } catch (err) {
      console.error("deleteCustomRole error:", err.message);
      res.status(err.message.includes("Forbidden") ? 403 : 500).json({ error: err.message });
    }
  }
);

// ── 7. updateAccessMatrix ──
exports.updateAccessMatrix = onRequest(
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 30, cors: ALLOWED_ORIGINS },
  async (req, res) => {
    // CORS headers
    res.set("Access-Control-Allow-Origin", "https://datalake-production-sa.web.app");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Max-Age", "3600");
      return res.status(204).send("");
    }
    // CORS headers
    res.set("Access-Control-Allow-Origin", "https://datalake-production-sa.web.app");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    try {
      const profile = await requireCeo(req);
      const { role_id, data_classes_diff } = req.body;
      if (!role_id || !data_classes_diff) return res.status(400).json({ error: "role_id and data_classes_diff required" });
      const matrixDoc = await db.collection("access_matrix").doc(role_id).get();
      if (!matrixDoc.exists) return res.status(404).json({ error: `Matrix for role '${role_id}' not found` });
      const oldClasses = matrixDoc.data().data_classes;
      const newClasses = { ...oldClasses };
      const changes = {};
      for (const [field, value] of Object.entries(data_classes_diff)) {
        if (value !== "read" && value !== "hidden") {
          return res.status(400).json({ error: `Invalid value '${value}' for ${field}. Must be 'read' or 'hidden'.` });
        }
        if (oldClasses[field] !== value) {
          changes[field] = { from: oldClasses[field], to: value };
          newClasses[field] = value;
        }
      }
      if (Object.keys(changes).length === 0) {
        return res.status(200).json({ success: true, message: "No changes detected" });
      }
      await db.collection("access_matrix").doc(role_id).update({
        data_classes: newClasses,
        last_updated_by: profile.email,
        last_updated_at: admin.firestore.FieldValue.serverTimestamp(),
      });
      await logAccessEvent("ACCESS_MATRIX_UPDATED", profile, {
        role_id, changes,
        ip_address: req.ip || req.headers["x-forwarded-for"] || "unknown",
      });
      res.status(200).json({ success: true, changes });
    } catch (err) {
      console.error("updateAccessMatrix error:", err.message);
      res.status(err.message.includes("Forbidden") ? 403 : 500).json({ error: err.message });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════
// Interview CV Preparation & Dispatch
// prepareInterviewCV — HR/CEO: reformat candidate CV via cv-agent
// sendInterviewCV   — CEO only: dispatch formatted CV to client
// ═══════════════════════════════════════════════════════════════════
exports.syncZohoFinance = require('./syncZohoFinance').syncZohoFinance;
const { handler: prepareInterviewCVHandler } = require("./prepareInterviewCV");
const { handler: sendInterviewCVHandler } = require("./sendInterviewCV");
const { handler: sendInterviewInviteHandler } = require("./sendInterviewInvite");

const interviewCVHelpers = { verifyAuth, getUserAccessProfile, ALLOWED_ORIGINS };

exports.prepareInterviewCV = onRequest(
  {
    region: "me-central2",
    memory: "1GiB",
    timeoutSeconds: 300,
    cors: ALLOWED_ORIGINS,
    
    
  },
  (req, res) => prepareInterviewCVHandler(req, res, interviewCVHelpers)
);

exports.sendInterviewCV = onRequest(
  {
    region: "me-central2",
    memory: "512MiB",
    timeoutSeconds: 120,
    cors: ALLOWED_ORIGINS,


  },
  (req, res) => sendInterviewCVHandler(req, res, interviewCVHelpers)
);

// sendInterviewInvite — HR/CEO: email a calendar (.ics) interview invite with
// date+time to the candidate + client approver (+ CC); moves to INTERVIEW_SCHEDULED.
exports.sendInterviewInvite = onRequest(
  {
    region: "me-central2",
    memory: "512MiB",
    timeoutSeconds: 120,
    cors: ALLOWED_ORIGINS,
  },
  (req, res) => sendInterviewInviteHandler(req, res, interviewCVHelpers)
);

// ═══════════════════════════════════════════════════════════════════
// Interview Scorecard System
// getClientScorecardForm     — public, token-gated: returns scorecard form
// submitClientScorecard      — public, token-gated: submits client scores
// getCandidateInterviewSummary — CEO only: combined HR + client scores
// ═══════════════════════════════════════════════════════════════════
const {
  getClientScorecardFormHandler,
  submitClientScorecardHandler,
  getCandidateInterviewSummaryHandler,
} = require("./interviewScorecard");

const scorecardHelpers = { verifyAuth, getUserAccessProfile, ALLOWED_ORIGINS };

exports.getClientScorecardForm = onRequest({
    invoker: 'public',
    region: "me-central2",
    memory: "256MiB",
    timeoutSeconds: 30,
    cors: true, // Public endpoint — any origin
  },
  (req, res) => getClientScorecardFormHandler(req, res, scorecardHelpers)
);

exports.submitClientScorecard = onRequest({
    invoker: 'public',
    region: "me-central2",
    memory: "256MiB",
    timeoutSeconds: 30,
    cors: true, // Public endpoint — any origin
  },
  (req, res) => submitClientScorecardHandler(req, res, scorecardHelpers)
);

exports.getCandidateInterviewSummary = onRequest(
  {
    region: "me-central2",
    memory: "256MiB",
    timeoutSeconds: 30,
    cors: ALLOWED_ORIGINS,
    
    
  },
  (req, res) => getCandidateInterviewSummaryHandler(req, res, scorecardHelpers)
);

// ═══════════════════════════════════════════════════════════════════
// Hire Sequence — DTLK-PROC-HRM-001
// ═══════════════════════════════════════════════════════════════════
const {
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
} = require("./hireSequence");

const hireHelpers = { verifyAuth, getUserAccessProfile, ALLOWED_ORIGINS };

// CRM — send + log an email from a deal (reuses the CRM role-gate + gmail DWD).
const { sendDealEmailHandler } = require("./deals");
exports.sendDealEmail = onRequest(
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 30, cors: ALLOWED_ORIGINS },
  (req, res) => sendDealEmailHandler(req, res, hireHelpers)
);

// CRM — quote/discount approval gates (server-side). financeReviewDealQuote moves
// PENDING_FINANCE→PENDING_CEO; approveDealQuote moves PENDING_CEO→APPROVED. Clients
// cannot write those states directly (firestore.rules + these Admin-SDK handlers).
const { financeReviewDealQuoteHandler, approveDealQuoteHandler } = require("./dealQuotes");
exports.financeReviewDealQuote = onRequest(
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 30, cors: ALLOWED_ORIGINS },
  (req, res) => financeReviewDealQuoteHandler(req, res, hireHelpers)
);
exports.approveDealQuote = onRequest(
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 30, cors: ALLOWED_ORIGINS },
  (req, res) => approveDealQuoteHandler(req, res, hireHelpers)
);

// CRM — hardened import + bulk soft-delete (DTLK-UI-CRM-001 §3, P0.0). Server is
// the validation + PDPL + audit boundary; deletes are soft (archived flag); undo
// works by import_batch_id. 512MiB/120s to absorb multi-hundred-row chunks.
const { crmImportLeadsHandler, crmArchiveDealsHandler } = require("./crmImport");
exports.crmImportLeads = onRequest(
  { region: "me-central2", memory: "512MiB", timeoutSeconds: 120, cors: ALLOWED_ORIGINS },
  (req, res) => crmImportLeadsHandler(req, res, hireHelpers)
);
exports.crmArchiveDeals = onRequest(
  { region: "me-central2", memory: "512MiB", timeoutSeconds: 120, cors: ALLOWED_ORIGINS },
  (req, res) => crmArchiveDealsHandler(req, res, hireHelpers)
);

// Universal SERVER-SIDE approval/sign recorder (replaces the client-side
// approval-evidence write for every ApprovalButton). Writes the signature +
// signed doc to WORM, the immutable evidence row, flips the parent status per a
// server-validated policy, and appends a BigQuery audit row with before/after
// SHA-256. The client can no longer self-write signed/approved state.
const { recordApprovalHandler } = require("./recordApproval");
exports.recordApproval = onRequest(
  { region: "me-central2", memory: "512MiB", timeoutSeconds: 60, cors: ALLOWED_ORIGINS },
  (req, res) => recordApprovalHandler(req, res, hireHelpers)
);

exports.initiateHire = onRequest(
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 30, cors: ALLOWED_ORIGINS },
  (req, res) => initiateHireHandler(req, res, hireHelpers)
);

exports.generateContract = onMessagePublished(
  { topic: "datalake.hire.initiated", region: "me-central2" },
  (event) => generateContractHandler(event)
);

exports.dispatchContractForSignature = onMessagePublished(
  { topic: "datalake.contract.generated", region: "me-central2" },
  (event) => dispatchContractHandler(event)
);

exports.recordSignature = onRequest(
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 30, cors: true },
  (req, res) => recordSignatureHandler(req, res, hireHelpers)
);

exports.provisionEngineer = onMessagePublished(
  { topic: "datalake.contract.signed", region: "me-central2" },
  (event) => provisionEngineerHandler(event)
);

// CEO uploads signed contract PDF → triggers Gatekeeper AI extraction
exports.uploadContractPDF = onRequest(
  { region: "me-central2", memory: "512MiB", timeoutSeconds: 60, cors: ALLOWED_ORIGINS },
  (req, res) => uploadContractPDFHandler(req, res, hireHelpers)
);

// Gatekeeper AI extracts fields from uploaded contract PDF.
// pdf-parse runs first (digital PDF text layer, milliseconds, no service call);
// PaddleOCR is only used as fallback for image-only scans. Memory bumped to
// 1Gi because pdf-parse loads pdfjs; timeout = 2nd-gen max so a slow cold
// LLM call doesn't get killed mid-inference.
exports.gatekeeperContractExtract = onMessagePublished(
  { topic: "datalake.contract.uploaded", region: "me-central2", memory: "1GiB", timeoutSeconds: 540 },
  (event) => gatekeeperContractExtractHandler(event)
);

// Sync contract extracted fields to employee document when reviewed
exports.syncContractToEmployee = onDocumentUpdated(
  { document: "contracts/{contractId}", region: "me-central2" },
  (event) => syncContractToEmployeeHandler(event)
);

// Manual retry — re-publishes Pub/Sub for an existing contract PDF
exports.retryContractExtraction = onRequest(
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 30, cors: ALLOWED_ORIGINS },
  (req, res) => retryContractExtractionHandler(req, res, hireHelpers)
);

// ═══════════════════════════════════════════════════════════════════
// AGENT: GATEKEEPER — Contract Draft (DTLK-PROMPT-AI-001)
// Self-hosted Qwen 2.5 7B. Output = DRAFT, requires CEO approval.
// ═══════════════════════════════════════════════════════════════════
exports.gatekeeperContractDraft = onRequest(
  { region: "me-central2", memory: "512MiB", timeoutSeconds: 180, cors: ALLOWED_ORIGINS },
  (req, res) => gatekeeperContractDraftHandler(req, res, hireHelpers)
);

// ═══════════════════════════════════════════════════════════════════
// AGENT: AUDITOR — Contract Risk Review + Monthly Compliance Check
// (DTLK-PROMPT-AI-001)
// ═══════════════════════════════════════════════════════════════════
const {
  auditorContractReviewHandler,
  auditorComplianceCheckHandler,
  getContractReviewsHandler,
  getComplianceReportsHandler,
  aiAuditorMonthlyCronHandler,
  checkEvidenceIntegrityHandler,
  trackCAPAStatusHandler
} = require("./auditor");

exports.auditorContractReview = onMessagePublished(
  { topic: "datalake.grc.uploaded", region: "me-central2" },
  (event) => auditorContractReviewHandler(event)
);

exports.getContractReviews = onRequest(
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 30, cors: ALLOWED_ORIGINS },
  (req, res) => getContractReviewsHandler(req, res, hireHelpers)
);

exports.getComplianceReports = onRequest(
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 30, cors: ALLOWED_ORIGINS },
  (req, res) => getComplianceReportsHandler(req, res, hireHelpers)
);

// Monthly compliance check — scheduled. Read-only, no CEO gate required (per DTLK-PROMPT-AI-001 Rule 4 exception).
exports.auditorComplianceCheck = onSchedule(
  {
    schedule: "0 7 1 * *", // 07:00 Riyadh on the 1st of each month
    timeZone: "Asia/Riyadh",
    region: "me-central2",
    memory: "512MiB",
    timeoutSeconds: 300,
  },
  async () => { await auditorComplianceCheckHandler(); }
);

// ═══════════════════════════════════════════════════════════════════
// AGENT: CONTROLLER — Timesheet + Invoice Validation
// (DTLK-PROMPT-AI-001)
// ═══════════════════════════════════════════════════════════════════
const {
  controllerTimesheetValidateHandler,
  controllerInvoiceValidateHandler,
} = require("./controller");

exports.controllerTimesheetValidate = onMessagePublished(
  { topic: "datalake.timesheet.cto_approved", region: "me-central2" },
  (event) => controllerTimesheetValidateHandler(event)
);

exports.controllerInvoiceValidate = onMessagePublished(
  { topic: "datalake.invoice.generated", region: "me-central2" },
  (event) => controllerInvoiceValidateHandler(event)
);

// ═══════════════════════════════════════════════════════════════════
// Offboarding — DTLK-PROC-HRM-002
// ═══════════════════════════════════════════════════════════════════
const { dailyOffboardingSweepHandler, offboardEngineerHandler } = require("./offboarding");

exports.dailyOffboardingSweep = onSchedule(
  { schedule: "every day 08:00", region: "me-central2", memory: "512MiB", timeoutSeconds: 120 },
  async () => { await dailyOffboardingSweepHandler(); }
);

exports.offboardEngineer = onRequest(
  { region: "me-central2", memory: "512MiB", timeoutSeconds: 60, cors: ALLOWED_ORIGINS },
  (req, res) => offboardEngineerHandler(req, res, hireHelpers)
);

// ═══════════════════════════════════════════════════════════════════
// Compliance Calendar — NCA ECC-1:2018
// ═══════════════════════════════════════════════════════════════════
const { complianceCalendarRunnerHandler, approveDraftComplianceHandler } = require("./complianceCalendar");

exports.complianceCalendarRunner = onSchedule(
  { schedule: "every day 07:00", region: "me-central2", memory: "512MiB", timeoutSeconds: 300 },
  async () => { await complianceCalendarRunnerHandler(); }
);

exports.approveDraftCompliance = onRequest(
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 30, cors: ALLOWED_ORIGINS },
  (req, res) => approveDraftComplianceHandler(req, res, hireHelpers)
);

// ═══════════════════════════════════════════════════════════════════
// Phase 3 — Invoicing, Zoho Books, ZATCA e-Invoicing
// ═══════════════════════════════════════════════════════════════════
const {
  generateInvoiceHandler,
  ceoApproveInvoiceHandler,
  syncToZohoBooksHandler,
  generateZatcaXmlHandler,
  getInvoiceDashboardHandler,
  zohoPaymentWebhookHandler
} = require("./invoicing");

// Re-using hireHelpers since it exposes verifyAuth and getUserAccessProfile
exports.generateInvoice = onRequest(
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 60, cors: ALLOWED_ORIGINS },
  (req, res) => generateInvoiceHandler(req, res, hireHelpers)
);

// SoD gate — CEO must approve before invoice can be dispatched / ZATCA-stamped / Zoho-synced
exports.ceoApproveInvoice = onRequest(
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 30, cors: ALLOWED_ORIGINS },
  (req, res) => ceoApproveInvoiceHandler(req, res, hireHelpers)
);

exports.syncToZohoBooks = onRequest(
  { region: "me-central2", memory: "512MiB", timeoutSeconds: 60, cors: ALLOWED_ORIGINS,
    
     secrets: ["zoho_api_credentials"] },
  (req, res) => syncToZohoBooksHandler(req, res, hireHelpers)
);

exports.generateZatcaXml = onRequest(
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 60, cors: ALLOWED_ORIGINS },
  (req, res) => generateZatcaXmlHandler(req, res, hireHelpers)
);

exports.getInvoiceDashboard = onRequest(
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 30, cors: ALLOWED_ORIGINS },
  (req, res) => getInvoiceDashboardHandler(req, res, hireHelpers)
);

// Webhook is public (cors: true) so Zoho can call it
exports.zohoPaymentWebhook = onRequest({
    invoker: 'public', region: "me-central2", memory: "256MiB", timeoutSeconds: 30, cors: true },
  (req, res) => zohoPaymentWebhookHandler(req, res)
);

// ═══════════════════════════════════════════════════════════════════
// Phase 6 — GRC Document Library
// ═══════════════════════════════════════════════════════════════════
const {
  uploadGrcDocumentHandler,
  listGrcDocumentsHandler,
  downloadGrcDocumentHandler,
  getGrcChangeLogHandler
} = require("./grcLibrary");

exports.uploadGrcDocument = onRequest(
  { region: "me-central2", memory: "512MiB", timeoutSeconds: 120, cors: ALLOWED_ORIGINS },
  (req, res) => uploadGrcDocumentHandler(req, res, hireHelpers)
);

exports.listGrcDocuments = onRequest(
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 30, cors: ALLOWED_ORIGINS },
  (req, res) => listGrcDocumentsHandler(req, res, hireHelpers)
);

exports.downloadGrcDocument = onRequest(
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 30, cors: ALLOWED_ORIGINS },
  (req, res) => downloadGrcDocumentHandler(req, res, hireHelpers)
);

exports.getGrcChangeLog = onRequest(
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 30, cors: ALLOWED_ORIGINS },
  (req, res) => getGrcChangeLogHandler(req, res, hireHelpers)
);

const { backfillEmployeeHandler, recordLeaverHandler, getBackfillConsentFormHandler, submitBackfillConsentHandler } = require("./backfill");

exports.backfillEmployee = onRequest(
  { region: "me-central2", memory: "512MiB", timeoutSeconds: 60, cors: ALLOWED_ORIGINS },
  (req, res) => backfillEmployeeHandler(req, res, { verifyAuth, getUserAccessProfile })
);

// PARKED (DTLK T9 — pending CEO park-vs-kill): the server-side photo/print card.
// The shipped card is QR-only and fully client-side (src/pages/employee/BusinessCard.jsx).
// This export is intentionally commented out so it is NOT deployed (incl. on a full
// functions deploy) and `sharp` is never loaded. Do NOT delete — un-comment to revive.
// const { generateBusinessCardHandler } = require("./businessCard");
// exports.generateBusinessCard = onRequest(
//   { region: "me-central2", memory: "512MiB", timeoutSeconds: 30, cors: ALLOWED_ORIGINS },
//   (req, res) => generateBusinessCardHandler(req, res, hireHelpers)
// );

exports.recordLeaver = onRequest(
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 30, cors: ALLOWED_ORIGINS },
  (req, res) => recordLeaverHandler(req, res, { verifyAuth, getUserAccessProfile })
);

exports.getBackfillConsentForm = onRequest({
    invoker: 'public', region: "me-central2", memory: "256MiB", timeoutSeconds: 30, cors: true },
  (req, res) => getBackfillConsentFormHandler(req, res)
);

exports.submitBackfillConsent = onRequest({
    invoker: 'public', region: "me-central2", memory: "256MiB", timeoutSeconds: 30, cors: true },
  (req, res) => submitBackfillConsentHandler(req, res)
);

// ═══════════════════════════════════════════════════════════════════
// Phase 7 — AI Agents (Controller & Auditor)
// ═══════════════════════════════════════════════════════════════════

exports.aiControllerTimesheetTrigger = onDocumentCreated(
  { document: "timesheets/{timesheetId}", region: "me-central2", memory: "512MiB" },
  async (event) => {
    const tsSnap = event.data;
    if (!tsSnap) return;
    const ts = tsSnap.data();

    const systemPrompt = `You are the Datalake AI Controller. You are reviewing a submitted timesheet.
Your job is to validate the hours. 
RULES:
1. If remote hours > 0 and the project does not allow remote work, or if leave hours > 0 but there is no approved leave request, return FAILED. 
2. Ensure the total hours make sense (usually 160-184 hours per month). If > 200, return FAILED.
3. Otherwise return PASSED.
YOU MUST RETURN STRICT JSON ONLY, EXACTLY IN THIS FORMAT: {"status": "PASSED" | "FAILED", "reason": "Explanation"}
DO NOT RETURN ANY OTHER TEXT OR MARKDOWN.`;

    const userPrompt = JSON.stringify({
      engineer: ts.engineer_name,
      total_hours: ts.total_hours,
      remote_hours: ts.remote_hours,
      in_house_hours: ts.in_house_hours,
      leave_hours: ts.leave_hours
    });

    try {
      const res = await callLLM({
        agent: "controller",
        type: "VALIDATE_TIMESHEET",
        systemPrompt,
        userPrompt,
        triggeredBy: "system:onDocumentCreated"
      });

      let parsed = { status: "PASSED", reason: "Validation successful" };
      try {
        let jsonStr = res.output;
        if (jsonStr.includes("\`\`\`json")) {
          jsonStr = jsonStr.split("\`\`\`json")[1].split("\`\`\`")[0];
        } else if (jsonStr.includes("{")) {
          jsonStr = "{" + jsonStr.split("{")[1].split("}")[0] + "}";
        }
        parsed = JSON.parse(jsonStr.trim());
      } catch (e) {
        console.warn("Failed to parse AI Controller output:", res.output);
        parsed = { status: "PASSED", reason: "Auto-passed due to AI parser error." };
      }

      await tsSnap.ref.update({
        ai_validation_status: parsed.status,
        ai_validation_reason: parsed.reason,
      });

    } catch (err) {
      console.error("AI Controller Failed:", err);
      await tsSnap.ref.update({
        ai_validation_status: "FAILED",
        ai_validation_reason: "AI Service Error: " + err.message,
      });
    }
  }
);

exports.aiAuditorMonthlyCron = onMessagePublished(
  { topic: "datalake.monthly.trigger", region: "me-central2", memory: "512MiB", timeoutSeconds: 300 },
  async (event) => { await aiAuditorMonthlyCronHandler(event); }
);

exports.checkEvidenceIntegrityWeekly = onSchedule(
  { schedule: "0 3 * * 0", timeZone: "Asia/Riyadh", region: "me-central2", memory: "256MiB" },
  async (event) => { await checkEvidenceIntegrityHandler(); }
);

exports.checkEvidenceIntegrityMonthly = onMessagePublished(
  { topic: "datalake.monthly.trigger", region: "me-central2", memory: "256MiB" },
  async (event) => { await checkEvidenceIntegrityHandler(); }
);

exports.trackCAPAStatus = onSchedule(
  { schedule: "0 4 * * 0", timeZone: "Asia/Riyadh", region: "me-central2", memory: "256MiB" },
  async (event) => { await trackCAPAStatusHandler(); }
);

// ═══════════════════════════════════════════════════════════════════
// Phase 11 — Financial Forecasting
// ═══════════════════════════════════════════════════════════════════

const { recalculateForecastHandler, calculateForecasts } = require("./forecasting");

exports.recalculateForecast = onRequest(
  { region: "me-central2", memory: "512MiB", timeoutSeconds: 60, cors: ALLOWED_ORIGINS },
  (req, res) => recalculateForecastHandler(req, res, { verifyAuth: admin.auth().verifyIdToken.bind(admin.auth()), getUserAccessProfile, ALLOWED_ORIGINS })
);

exports.forecastDailyCron = onSchedule(
  { schedule: "0 2 * * *", timeZone: "Asia/Riyadh", region: "me-central2", memory: "512MiB" },
  async (event) => {
    console.log("Running daily forecast calculation...");
    await calculateForecasts();
    console.log("Daily forecast calculation completed.");
  }
);

// ═══════════════════════════════════════════════════════════════════
// Phase 12 — BigQuery Finance Export
// ═══════════════════════════════════════════════════════════════════

const { exportInvoiceToBQ, exportExpenseToBQ } = require("./financeExport");

exports.exportInvoiceToBQ = exportInvoiceToBQ;
exports.exportExpenseToBQ = exportExpenseToBQ;

// ═══════════════════════════════════════════════════════════════════
// Phase 13 — IT Admin Functions
// ═══════════════════════════════════════════════════════════════════
const { adminsetpassword, assignrole, getmypasswordstatus, changemypassword, setpasswordchangerequired } = require('./adminAuth');
exports.adminsetpassword = adminsetpassword;
exports.assignrole = assignrole;
exports.getmypasswordstatus = getmypasswordstatus;
exports.changemypassword = changemypassword;
exports.setpasswordchangerequired = setpasswordchangerequired;

// ═══════════════════════════════════════════════════════════════════
// Phase 5: CONTROLLER AI — FINANCE CHAIN
// ═══════════════════════════════════════════════════════════════════
const {
  calculatePayrollHandler, generateWPSFileHandler, generateGOSIReportHandler,
  controllerMonthlyOpsHandler, createPayrollRunHandler, publishPayrollApprovedHandler,
  listMyPayslipsHandler,
} = require("./finance");

exports.calculatePayroll = onSchedule(
  {
    schedule: "0 0 25 * *", // 25th of each month at midnight
    timeZone: "Asia/Riyadh",
    region: "me-central2",
    memory: "512MiB",
    timeoutSeconds: 300,
  },
  async () => { await calculatePayrollHandler(); }
);

// CEO / Finance "Create Payroll Run" — UI-driven, parameterized by month.
exports.createPayrollRun = onRequest(
  { region: "me-central2", memory: "512MiB", timeoutSeconds: 300, cors: ALLOWED_ORIGINS },
  (req, res) => createPayrollRunHandler(req, res, hireHelpers),
);

// Firestore trigger: payroll_runs/{id} DRAFT → APPROVED → publish Pub/Sub
// so WPS + GOSI generators run.
exports.publishPayrollApproved = onDocumentUpdated(
  { document: "payroll_runs/{payrollRunId}", region: "me-central2" },
  (event) => publishPayrollApprovedHandler(event),
);

// /employee/documents → "My Payslips" feed.
exports.listMyPayslips = onRequest(
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 30, cors: ALLOWED_ORIGINS },
  (req, res) => listMyPayslipsHandler(req, res),
);

// Payroll deductions (one-off / installment) — HR/Finance/CEO manage.
const { createDeductionHandler, listDeductionsHandler, cancelDeductionHandler } = require("./deductions");
exports.createDeduction = onRequest(
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 30, cors: ALLOWED_ORIGINS },
  (req, res) => createDeductionHandler(req, res, hireHelpers),
);
exports.listDeductions = onRequest(
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 30, cors: ALLOWED_ORIGINS },
  (req, res) => listDeductionsHandler(req, res, hireHelpers),
);
exports.cancelDeduction = onRequest(
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 30, cors: ALLOWED_ORIGINS },
  (req, res) => cancelDeductionHandler(req, res, hireHelpers),
);

// ── Password reset (Gmail DWD path, bypasses Firebase default sender) ──
const { generateAndSendPasswordResetHandler } = require("./passwordReset");
exports.generateAndSendPasswordReset = onRequest(
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 30, cors: true },
  (req, res) => generateAndSendPasswordResetHandler(req, res),
);

// ── Reset onboarding (HR/CEO) — flips onboarding_complete back to false
//    on users + employees so the next sign-in restarts the onboarding gate.
const { resetOnboardingHandler } = require("./resetOnboarding");
exports.resetOnboarding = onRequest(
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 30, cors: ALLOWED_ORIGINS },
  (req, res) => resetOnboardingHandler(req, res, hireHelpers),
);

// ── Auth account audit + provision (HR/CEO) ──
const { auditAuthAccountsHandler, provisionMissingAuthAccountHandler } = require("./authAccountAudit");
exports.auditAuthAccounts = onRequest(
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 120, cors: ALLOWED_ORIGINS },
  (req, res) => auditAuthAccountsHandler(req, res, hireHelpers),
);
exports.provisionMissingAuthAccount = onRequest(
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 60, cors: ALLOWED_ORIGINS },
  (req, res) => provisionMissingAuthAccountHandler(req, res, hireHelpers),
);

// ── HR Send Email ──
const { sendHrEmailHandler, listEmailTemplatesHandler } = require("./hrEmail");

exports.sendHrEmail = onRequest(
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 60, cors: ALLOWED_ORIGINS },
  (req, res) => sendHrEmailHandler(req, res, hireHelpers),
);
exports.listEmailTemplates = onRequest(
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 30, cors: ALLOWED_ORIGINS },
  (req, res) => listEmailTemplatesHandler(req, res),
);

// ── Iqama lifecycle ──
const { advanceIqamaStageHandler, scanIqamaExpiriesHandler } = require("./iqama");

exports.advanceIqamaStage = onRequest(
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 60, cors: ALLOWED_ORIGINS },
  (req, res) => advanceIqamaStageHandler(req, res, hireHelpers),
);

exports.scanIqamaExpiries = onSchedule(
  {
    schedule: "0 6 * * *", // Daily at 06:00 Riyadh
    timeZone: "Asia/Riyadh",
    region: "me-central2",
    memory: "256MiB",
    timeoutSeconds: 300,
  },
  async () => { await scanIqamaExpiriesHandler(); },
);

exports.generateWPSFile = onMessagePublished(
  { topic: "datalake.payroll.approved", region: "me-central2", memory: "256MiB" },
  async (event) => { await generateWPSFileHandler(event); }
);

exports.generateGOSIReport = onMessagePublished(
  { topic: "datalake.payroll.approved", region: "me-central2", memory: "256MiB" },
  async (event) => { await generateGOSIReportHandler(event); }
);

// ═══════════════════════════════════════════════════════════════════
// Phase 9: INTELLIGENCE PLATFORM (Multi-Tenant Integrations)
// ═══════════════════════════════════════════════════════════════════
const { saveIntegrationConfigHandler, getIntegrationConfigHandler } = require("./integrations");

exports.saveIntegrationConfig = onRequest(
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 60, cors: ALLOWED_ORIGINS },
  (req, res) => saveIntegrationConfigHandler(req, res, hireHelpers)
);

exports.getIntegrationConfig = onRequest(
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 30, cors: ALLOWED_ORIGINS },
  (req, res) => getIntegrationConfigHandler(req, res, hireHelpers)
);

// ═══════════════════════════════════════════════════════════════════
// Phase 9: TELEPHONY ENGINE
// ═══════════════════════════════════════════════════════════════════
const { handleIncomingCallHandler, handleCallCompletedHandler, transcribeCallHandler, analyzeCallHandler } = require("./telephony");

exports.handleIncomingCall = onRequest(
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 30, cors: true }, // Webhooks need open cors
  (req, res) => handleIncomingCallHandler(req, res)
);

exports.handleCallCompleted = onRequest(
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 30, cors: true },
  (req, res) => handleCallCompletedHandler(req, res)
);

exports.transcribeCall = onMessagePublished(
  { topic: "datalake.call.completed", region: "me-central2", memory: "1GiB" },
  async (event) => { await transcribeCallHandler(event); }
);

exports.analyzeCall = onMessagePublished(
  { topic: "datalake.call.transcribed", region: "me-central2", memory: "512MiB" },
  async (event) => { await analyzeCallHandler(event); }
);

// ═══════════════════════════════════════════════════════════════════
// Phase 9: EMAIL SYNC ENGINE
// ═══════════════════════════════════════════════════════════════════
const { syncEmailsHandler, analyzeEmailHandler } = require("./email");

exports.syncEmails = onSchedule(
  {
    schedule: "every 5 minutes",
    region: "me-central2",
    memory: "512MiB",
    timeoutSeconds: 300,
  },
  async () => { await syncEmailsHandler(); }
);

exports.analyzeEmail = onMessagePublished(
  { topic: "datalake.email.synced", region: "me-central2", memory: "512MiB" },
  async (event) => { await analyzeEmailHandler(event); }
);

// ═══════════════════════════════════════════════════════════════════
// Phase 9: WHATSAPP ENGINE
// ═══════════════════════════════════════════════════════════════════
const { whatsappWebhookHandler } = require("./whatsapp");

exports.whatsappWebhook = onRequest(
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 30, cors: true }, // Open cors for Meta
  (req, res) => whatsappWebhookHandler(req, res)
);



// ==============================================================================
// APPROVAL ROUTING AND NOTIFICATIONS
// ==============================================================================
const { validateLeaveRequestHandler, clientApproveLeaveHandler, approveLeaveHandler, controllerAdjustPayrollHandler } = require("./leave");
const { validateExpenseHandler, routeTicketHandler } = require("./requests");
const { resetLeaveBalancesHandler, pdplCandidatePurgeHandler, pdplCandidatePurgeOnRequestHandler, scanContractExpiryHandler, validateHireBudgetHandler, gatekeeperMonthlyOpsHandler } = require("./hr");

exports.clientApproveLeave = onRequest(
  { region: "me-central2", memory: "256MiB" },
  (req, res) => clientApproveLeaveHandler(req, res)
);

exports.approveLeave = onRequest(
  { region: "me-central2", memory: "256MiB" },
  (req, res) => approveLeaveHandler(req, res, { verifyAuth, getUserAccessProfile, ALLOWED_ORIGINS })
);

exports.validateLeaveRequest = onDocumentCreated(
  { document: "leave_requests/{docId}", region: "me-central2", memory: "256MiB" },
  async (event) => { await validateLeaveRequestHandler(event); }
);

exports.controllerAdjustPayroll = onMessagePublished(
  { topic: "datalake.leave.approved", region: "me-central2", memory: "256MiB" },
  async (event) => { await controllerAdjustPayrollHandler(event); }
);

exports.validateExpense = onDocumentCreated(
  { document: "expenses/{docId}", region: "me-central2", memory: "256MiB" },
  async (event) => { await validateExpenseHandler(event); }
);

exports.routeTicket = onDocumentCreated(
  { document: "support_tickets/{docId}", region: "me-central2", memory: "256MiB" },
  async (event) => { await routeTicketHandler(event); }
);

// ==============================================================================
// GATEKEEPER HR CHAIN (PHASE 6)
// ==============================================================================
exports.resetLeaveBalances = onSchedule(
  { schedule: "0 0 1 1 *", timeZone: "Asia/Riyadh", region: "me-central2", memory: "256MiB" },
  async (event) => { await resetLeaveBalancesHandler(); }
);

exports.pdplCandidatePurge = onSchedule(
  { schedule: "0 3 * * *", timeZone: "Asia/Riyadh", region: "me-central2", memory: "256MiB", timeoutSeconds: 300 },
  async (event) => { await pdplCandidatePurgeHandler(); }
);

// CEO / HR "Run PDPL Purge" button — same logic as the scheduler, but
// callable from the UI with real-time feedback (purged count + audit log ID).
exports.runPdplPurgeCEO = onRequest(
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 300, cors: ALLOWED_ORIGINS },
  (req, res) => pdplCandidatePurgeOnRequestHandler(req, res, { verifyAuth, getUserAccessProfile })
);

// Real hires live in pending_hires (initiateHire), NOT hire_requests — the old
// path meant this trigger never fired. The primary block is the synchronous
// gate in initiateHire; this trigger is defence-in-depth (marks BUDGET_BLOCKED).
exports.validateHireBudget = onDocumentCreated(
  { document: "pending_hires/{hireId}", region: "me-central2", memory: "256MiB" },
  async (event) => { await validateHireBudgetHandler(event); }
);

// Audit every change to the timesheet gate flag to BigQuery control_events
// (evidence of who enabled/disabled the control, when, and the effective date).
// CEO writes platform_settings/timesheet_gate from the admin UI; this trigger
// records it. Matches the existing control_events schema (gate_enabled BOOL,
// effective_date STRING, missing_modules REPEATED).
exports.onTimesheetGateChange = onDocumentWritten(
  { document: "platform_settings/timesheet_gate", region: "me-central2", memory: "256MiB" },
  async (event) => {
    try {
      const after = event.data && event.data.after && event.data.after.data();
      if (!after) return; // deletion — nothing to log
      const eff = after.effective_date
        ? String(after.effective_date.toDate ? after.effective_date.toDate().toISOString() : after.effective_date)
        : null;
      const { BigQuery } = require("@google-cloud/bigquery");
      await new BigQuery().dataset("datalake_audit").table("control_events").insert([{
        event_id: require("crypto").randomUUID(),
        control_name: "TIMESHEET_GATE",
        outcome: after.enabled === true ? "ENABLED" : "DISABLED",
        actor_email: after.updated_by || "unknown",
        actor_uid: null,
        missing_onboarding: null,
        missing_modules: [],
        gate_enabled: after.enabled === true,
        effective_date: eff,
        timestamp: new Date(),
      }]);
    } catch (e) { console.error("onTimesheetGateChange audit insert failed:", e.message); }
  }
);

// ==============================================================================
// CONTRACT MIRROR + UNIVERSAL EVIDENCE ENFORCEMENT (from feature/gatekeeper-hr)
// ==============================================================================
exports.mirrorContractExtraction = onDocumentUpdated(
  { document: 'pending_hires/{hireId}', region: "me-central2", memory: "256MiB" },
  async (event) => {
    const after = event.data.after.data();
    if (after.contract_extracted_fields && after.contract_extraction_status === 'EXTRACTED') {
      await db.collection('contracts').doc(event.params.hireId).update({
        contract_extracted_fields: after.contract_extracted_fields,
        contract_extraction_status: 'EXTRACTED',
        contract_extracted_at: after.contract_extracted_at
      });
    }
  }
);

const enforceEvidence = async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();
  if (before.status !== 'APPROVED' && after.status === 'APPROVED') {
    const snap = await event.data.after.ref.collection('approval_evidence').get();
    const hasEvidence = snap.docs.some(doc => doc.data().evidence_url);
    if (!hasEvidence) {
      console.log(`[Evidence] Rejected APPROVED status for ${event.data.after.ref.path}`);
      await event.data.after.ref.update({
        status: before.status,
        approval_error: 'Missing required approval evidence document'
      });
    }
  }
};

exports.enforceEvidenceInvoices = onDocumentUpdated({ document: 'invoices/{docId}', region: "me-central2" }, enforceEvidence);
exports.enforceEvidencePayroll = onDocumentUpdated({ document: 'payroll/{docId}', region: "me-central2" }, enforceEvidence);
exports.enforceEvidenceContracts = onDocumentUpdated({ document: 'contracts/{docId}', region: "me-central2" }, enforceEvidence);
exports.enforceEvidenceVendorAgreements = onDocumentUpdated({ document: 'vendor_agreements/{docId}', region: "me-central2" }, enforceEvidence);

// ==============================================================================
// PHASE 8: MONTHLY OPERATIONS ENGINE
// ==============================================================================
const { monthlyOperationsTriggerHandler } = require("./ops");
const { generateMonthlyReportHandler } = require("./reports");

exports.monthlyOperationsTrigger = onSchedule(
  { schedule: "0 0 1 * *", timeZone: "Asia/Riyadh", region: "me-central2", memory: "256MiB" },
  async (event) => { await monthlyOperationsTriggerHandler(); }
);

exports.gatekeeperMonthlyOps = onMessagePublished(
  { topic: "datalake.monthly.trigger", region: "me-central2", memory: "256MiB", timeoutSeconds: 300 },
  async (event) => { await gatekeeperMonthlyOpsHandler(event); }
);

exports.controllerMonthlyOps = onMessagePublished(
  { topic: "datalake.monthly.trigger", region: "me-central2", memory: "512MiB", timeoutSeconds: 300 },
  async (event) => { await controllerMonthlyOpsHandler(event); }
);

exports.generateMonthlyReport = onMessagePublished(
  { topic: "datalake.monthly.trigger", region: "me-central2", memory: "512MiB", timeoutSeconds: 300 },
  async (event) => { await generateMonthlyReportHandler(event); }
);

// ==============================================================================
// BUILD 1: PDF Generation Engine
// ==============================================================================
const { generatePDFHandler } = require("./pdfEngine");

exports.generatePDF = onRequest(
  { region: "me-central2", memory: "1GiB", timeoutSeconds: 120, cors: ALLOWED_ORIGINS },
  async (req, res) => { await generatePDFHandler(req, res, { verifyAuth, getUserAccessProfile, ALLOWED_ORIGINS }); }
);

// ==============================================================================
// DTLK-ARCH-AI-002: AI Service Health — real Cloud Run + Monitoring data
// CEO-only. No mocking, no setTimeout, no hardcoded status.
// ==============================================================================
const { getAiServiceHealth } = require("./aiHealth");
exports.getAiServiceHealth = getAiServiceHealth;

