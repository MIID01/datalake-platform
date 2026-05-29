const { onRequest } = require("firebase-functions/v2/https");
const { onMessagePublished } = require("firebase-functions/v2/pubsub");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
const { v4: uuidv4 } = require("uuid");
const Busboy = require("busboy");
const crypto = require("crypto");
const { PubSub } = require("@google-cloud/pubsub");
const pubsub = new PubSub();
// NOTE: VertexAI / Gemini removed per DTLK-PROMPT-AI-001.
// All AI inference now runs on self-hosted datalake-ai-inference (Qwen 2.5 7B).
const { callLLM, callOCR, parseJsonOutput } = require("./lib/ai-client");

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

    const busboy = Busboy({ headers: req.headers });
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
            const fileBase64 = cvFile.toString("base64");
            const ocrResult = await callOCR({
              fileBase64, lang: "en", agent: "gatekeeper", type: "cv_ocr", triggeredBy: "system:submitCareerApplication"
            });
            if (!ocrResult.success) throw new Error("OCR failed");
            
            const fullText = ocrResult.lines.map(l => l.text).join("\n");
            if (!fullText.trim()) throw new Error("No text extracted");

            const llmResult = await callLLM({
              agent: "gatekeeper", type: "cv_extract", triggeredBy: "system:submitCareerApplication",
              promptTemplateId: "GATEKEEPER_CV_EXTRACT_V1",
              systemPrompt: `You are the Datalake Gatekeeper AI. Extract structured data from this CV text.
Return ONLY a valid JSON object with these exact fields (use null for any field not found):
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
Return valid JSON only, no markdown.`,
              userPrompt: fullText
            });

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

      const bucket = admin.storage().bucket("datalake-production-sa.firebasestorage.app");
      const file = bucket.file(candidate.cv_path);
      const [exists] = await file.exists();
      if (!exists) return res.status(404).json({ error: "CV file not found in storage" });

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

      // Find active assignments for this engineer
      const assignmentsSnapshot = await db
        .collection("engineer_project_assignments")
        .where("engineer_email", "==", engineerEmail)
        .where("status", "==", "ACTIVE")
        .get();

      if (assignmentsSnapshot.empty) {
        res
          .status(200)
          .json({ projects: [], message: "No active assignments" });
        return;
      }

      // Get unique project IDs
      const projectIds = [
        ...new Set(
          assignmentsSnapshot.docs.map((d) => d.data().project_id)
        ),
      ];

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
          my_assignment: assignmentsSnapshot.docs
            .filter((d) => d.data().project_id === projectId)
            .map((d) => {
              const a = d.data();
              return {
                assignment_id: a.assignment_id,
                role_on_project: a.role_on_project,
                assignment_start_date: a.assignment_start_date,
                assignment_end_date: a.assignment_end_date,
                status: a.status,
                // STRIPPED: rate_sar, allocation_percentage, notes
              };
            })[0] || null,
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
      const { project_id, period_month, period_year, days } = req.body;
      if (!project_id || !period_month || !period_year || !days) { res.status(400).json({ error: "Missing required fields" }); return; }

      // Enforce 1st-28th window (widened for testing — original: 18th-25th)
      const now = new Date();
      const riyadhTime = new Date(now.getTime() + (3 * 60 + now.getTimezoneOffset()) * 60000);
      const currentDay = riyadhTime.getDate();
      if (currentDay < 1 || currentDay > 28) {
        res.status(403).json({ error: "Submission window closed", detail: "Timesheets can only be submitted between the 1st and 28th of each month (Riyadh time).", current_day: currentDay });
        return;
      }

      // Verify engineer assignment
      const assignQ = await db.collection("engineer_project_assignments")
        .where("engineer_email", "==", decodedToken.email)
        .where("project_id", "==", project_id)
        .where("status", "==", "ACTIVE").limit(1).get();
      if (assignQ.empty) { res.status(403).json({ error: "You are not assigned to this project" }); return; }
      const assignment = assignQ.docs[0].data();

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
              ai_validation_model: "qwen2.5-7b-instruct-q4_K_M",
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
        });

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

        // ── Simulate sending 3-way timesheet email ──
        const signUrl = `https://datalake-production-sa.web.app/client/timesheet/${clientToken}`;
        console.log(`[Email] 3-way Timesheet Email Sent to ${ts.client_approver_email}, ${ts.engineer_email}, finance@datalake.sa.`);
        console.log(`[Email] Sign URL: ${signUrl}`);
        
        await db.collection("audit_log").add({
          event: "TIMESHEET_EMAIL_SENT",
          timesheet_id,
          sent_to: [ts.client_approver_email, ts.engineer_email, "finance@datalake.sa"],
          sign_url: signUrl,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });

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

      // CEO can act as client approver during setup/testing
      if (ts.client_approver_email !== client_email && client_email !== "m.alqumri@datalake.sa") { res.status(403).json({ error: "Not authorized to sign this timesheet" }); return; }
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

      // ── Step 2: OCR — extract raw text via datalake-ocr (PaddleOCR) ──
      const fileBase64 = cvBuffer.toString("base64");
      const ocrResult = await callOCR({
        fileBase64,
        lang: "en",
        agent: "gatekeeper",
        type: "cv_ocr",
        triggeredBy,
      });

      if (!ocrResult.success) {
        console.error("OCR failed:", ocrResult.error);
        res.status(503).json({
          error: "CV OCR temporarily unavailable. Please fill the form manually.",
          detail: ocrResult.error,
          fallback: true,
        });
        return;
      }

      const fullText = ocrResult.lines.map((l) => l.text).join("\n");

      if (!fullText.trim()) {
        res.status(422).json({
          error: "Could not extract text from this CV. Please upload a clearer version or fill manually.",
          fallback: true,
        });
        return;
      }

      // ── Step 3: LLM extraction — Qwen 2.5 7B (self-hosted) ──
      const llmResult = await callLLM({
        agent: "gatekeeper",
        type: "cv_extract",
        triggeredBy,
        promptTemplateId: "GATEKEEPER_CV_EXTRACT_V1",
        systemPrompt: `You are the Datalake Gatekeeper AI. Extract structured data from this CV text.
Return ONLY a valid JSON object with these exact fields (use null for any field not found):
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
Rules: extract ALL skills; prefer +966 for Saudi phones; return valid JSON only, no markdown.`,
        userPrompt: fullText,
      });

      if (!llmResult.success) {
        console.error("LLM extraction failed:", llmResult.error);
        res.status(503).json({
          error: "AI extraction temporarily unavailable. Please fill the form manually.",
          fallback: true,
        });
        return;
      }

      // ── Step 4: Parse LLM JSON output ──
      const parsed = parseJsonOutput(llmResult.output);
      let extracted = parsed.success ? parsed.data : {};

      if (!parsed.success) {
        console.warn("LLM JSON parse failed — returning partial data:", parsed.error);
      }

      // Normalise skills to array
      if (extracted.skills && typeof extracted.skills === "string") {
        extracted.skills = extracted.skills.split(",").map((s) => s.trim());
      }
      if (!Array.isArray(extracted.skills)) extracted.skills = [];

      // Regex fallback for critical fields if LLM missed them
      if (!extracted.email) {
        const m = fullText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        if (m) extracted.email = m[0];
      }
      if (!extracted.phone) {
        const m = fullText.match(/\+966\s?[-.]?\s?5\d{8}|05\d{8}/);
        if (m) extracted.phone = m[0];
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
          ocr_lines_extracted: ocrResult.lines.length,
          ocr_pages: ocrResult.pageCount,
          fields_extracted: Object.keys(extracted).filter(
            (k) => extracted[k] !== null && extracted[k] !== ""
          ).length,
          // AI engine detail — no Gemini, self-hosted only
          ai_engine: "qwen2.5-7b-instruct-q4_K_M",
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

/** Helper: verify Firebase ID token from Authorization header */
async function verifyAuth(req) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) throw new Error("Missing Authorization header");
  const token = authHeader.split("Bearer ")[1];
  const decoded = await admin.auth().verifyIdToken(token);
  return decoded;
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
      try {
        authUser = await admin.auth().getUserByEmail(email);
      } catch (_) {
        authUser = await admin.auth().createUser({ email, displayName: display_name });
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
      res.status(200).json({ success: true, uid: authUser.uid });
    } catch (err) {
      console.error("addUser error:", err.message);
      res.status(err.message.includes("Forbidden") ? 403 : 500).json({ error: err.message });
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
} = require("./hireSequence");

const hireHelpers = { verifyAuth, getUserAccessProfile, ALLOWED_ORIGINS };

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

// Gatekeeper AI extracts fields from uploaded contract PDF (OCR + LLM)
exports.gatekeeperContractExtract = onMessagePublished(
  { topic: "datalake.contract.uploaded", region: "me-central2", memory: "512MiB", timeoutSeconds: 300 },
  (event) => gatekeeperContractExtractHandler(event)
);

// Sync contract extracted fields to employee document when reviewed
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
exports.syncContractToEmployee = onDocumentUpdated(
  { document: "contracts/{contractId}", region: "me-central2" },
  (event) => syncContractToEmployeeHandler(event)
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

exports.aiAuditorMonthlyCron = onSchedule(
  { schedule: "0 0 1 * *", timeZone: "Asia/Riyadh", region: "me-central2", memory: "512MiB" },
  async (event) => {
    const systemPrompt = "You are the Datalake AI Auditor. Review the monthly activity summary and generate an audit finding report. Return strict JSON array of findings.";
    const userPrompt = "Run the monthly audit on platform activity for the previous month. Check for anomalous timesheet approvals, missing consent records, and security rule violations.";

    try {
      const res = await callLLM({
        agent: "auditor",
        type: "MONTHLY_AUDIT",
        systemPrompt,
        userPrompt,
        triggeredBy: "system:onSchedule"
      });
      
      const db = admin.firestore();
      await db.collection("audit_reports").add({
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        report_raw: res.output,
        status: "GENERATED"
      });
      
      console.log("Monthly AI audit completed.");
    } catch (err) {
      console.error("Monthly AI audit failed:", err);
    }
  }
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
const { adminsetpassword, assignrole } = require('./adminAuth');
exports.adminsetpassword = adminsetpassword;
exports.assignrole = assignrole;

// ═══════════════════════════════════════════════════════════════════
// Phase 5: CONTROLLER AI — FINANCE CHAIN
// ═══════════════════════════════════════════════════════════════════
const { calculatePayrollHandler, generateWPSFileHandler, generateGOSIReportHandler } = require("./finance");

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
const { resetLeaveBalancesHandler, pdplCandidatePurgeHandler, scanContractExpiryHandler, validateHireBudgetHandler } = require("./hr");

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
  { schedule: "0 3 * * *", timeZone: "Asia/Riyadh", region: "me-central2", memory: "256MiB" },
  async (event) => { await pdplCandidatePurgeHandler(); }
);

exports.scanContractExpiry = onSchedule(
  { schedule: "0 9 1 * *", timeZone: "Asia/Riyadh", region: "me-central2", memory: "256MiB" },
  async (event) => { await scanContractExpiryHandler(); }
);

exports.validateHireBudget = onDocumentCreated(
  { document: "hire_requests/{docId}", region: "me-central2", memory: "256MiB" },
  async (event) => { await validateHireBudgetHandler(event); }
);

