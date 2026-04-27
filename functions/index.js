const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const { v4: uuidv4 } = require("uuid");
const Busboy = require("busboy");
const { VertexAI } = require("@google-cloud/vertexai");

admin.initializeApp();
const db = admin.firestore();
const bucket = admin.storage().bucket("datalake-cv-uploads");
const { getUserAccessProfile, logAccessEvent } = require("./lib/access");

// HTTP endpoint: submitCareerApplication
// Accepts multipart/form-data: candidate fields + cv file
// Writes to Firestore talent_pool collection with state=PENDING_CONSENT
exports.submitCareerApplication = onRequest(
  {
    region: "me-central2",
    memory: "512MiB",
    timeoutSeconds: 60,
    cors: true,
  },
  async (req, res) => {
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
          state: "PENDING_CONSENT",
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

// HTTP endpoint: createTask
// Creates a new task in Firestore tasks collection
// Requires Google SSO auth (CEO only in v1)
exports.createTask = onRequest(
  {
    region: "me-central2",
    memory: "512MiB",
    timeoutSeconds: 30,
    cors: true,
  },
  async (req, res) => {
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
    cors: true,
  },
  async (req, res) => {
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
      const { candidate_id, scores } = body;

      if (!candidate_id || !scores || !Array.isArray(scores)) {
        res
          .status(400)
          .json({ error: "Missing candidate_id or scores array" });
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

      // Update candidate record with HR score
      await candidateRef.update({
        hr_score: hrScore,
        hr_passed: passed,
        hr_hard_fail: hardFail,
        hr_hard_fail_reason: hardFailReason,
        hr_evaluated_by: decodedToken.email,
        hr_evaluated_at: now,
        state: passed ? "HR_SCREENED" : candidateDoc.data().state,
        scoring_stage: passed ? "S3_CLIENT_EVAL" : "S2_HR_REJECTED",
        updated_at: now,
      });

      // Audit log
      await db.collection("task_audit_log").add({
        event: "HR_SCORE_SUBMITTED",
        candidate_id: candidate_id,
        action_by: decodedToken.email,
        action_at: now,
        details: {
          hr_score: hrScore,
          passed: passed,
          hard_fail: hardFail,
          hard_fail_reason: hardFailReason,
        },
        ip_address: req.ip || "unknown",
        user_agent: req.headers["user-agent"] || "unknown",
      });

      res.status(200).json({
        success: true,
        candidate_id: candidate_id,
        hr_score: hrScore,
        passed: passed,
        hard_fail: hardFail,
        hard_fail_reason: hardFailReason,
        message: passed
          ? `Score ${hrScore}/100 — Candidate advances to Stage 3 (Client Evaluation)`
          : hardFail
            ? `Hard fail on ${hardFailReason} — Candidate archived`
            : `Score ${hrScore}/100 (below 70) — Candidate archived`,
      });
    } catch (err) {
      console.error("submitHRScore error:", err);
      res
        .status(500)
        .json({ error: "Internal server error", detail: err.message });
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
    cors: true,
  },
  async (req, res) => {
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
    cors: true,
  },
  async (req, res) => {
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
    cors: true,
  },
  async (req, res) => {
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
  { region: "me-central2", memory: "512MiB", timeoutSeconds: 30, cors: true },
  async (req, res) => {
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) { res.status(401).json({ error: "Missing authorization" }); return; }
    let decodedToken;
    try { decodedToken = await admin.auth().verifyIdToken(authHeader.split("Bearer ")[1]); } catch { res.status(401).json({ error: "Invalid token" }); return; }

    try {
      const { project_id, period_month, period_year, days } = req.body;
      if (!project_id || !period_month || !period_year || !days) { res.status(400).json({ error: "Missing required fields" }); return; }

      // Enforce 18th-25th window (Riyadh UTC+3)
      const now = new Date();
      const riyadhTime = new Date(now.getTime() + (3 * 60 + now.getTimezoneOffset()) * 60000);
      const currentDay = riyadhTime.getDate();
      if (currentDay < 18 || currentDay > 25) {
        res.status(403).json({ error: "Submission window closed", detail: "Timesheets can only be submitted between the 18th and 25th of each month (Riyadh time).", current_day: currentDay });
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
        period_month, period_year, period_label, days, total_hours, in_house_hours, remote_hours, leave_hours,
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
    } catch (err) { console.error("submitTimesheet error:", err); res.status(500).json({ error: "Internal server error", detail: err.message }); }
  }
);

// ============================================================
// HTTP endpoint: ctoApproveTimesheet
// CTO (or CEO for escalated) approves/rejects a timesheet
// ============================================================
exports.ctoApproveTimesheet = onRequest(
  { region: "me-central2", memory: "512MiB", timeoutSeconds: 30, cors: true },
  async (req, res) => {
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
      if (ts.engineer_email === decodedToken.email) { res.status(403).json({ error: "Cannot approve your own timesheet" }); return; }

      const nowTS = admin.firestore.FieldValue.serverTimestamp();
      const newState = decision === "APPROVE" ? "CTO_APPROVED" : "REJECTED_BY_CTO";

      await tsRef.update({
        state: newState, cto_action_at: nowTS, cto_action_by: decodedToken.email, cto_decision: decision,
        cto_notes: notes || null, rejection_reason: decision === "REJECT" ? notes : null, updated_at: nowTS,
        audit_trail: admin.firestore.FieldValue.arrayUnion({
          timestamp: new Date().toISOString(), event: newState, actor: decodedToken.email, notes: notes || null,
        }),
      });

      if (decision === "APPROVE") {
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
// No Firebase auth — uses email verification against approver
// ============================================================
exports.clientSignTimesheet = onRequest(
  { region: "me-central2", memory: "512MiB", timeoutSeconds: 30, cors: true },
  async (req, res) => {
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
    try {
      const { timesheet_id, client_email, signature_method, signature_data, decision, rejection_reason } = req.body;
      if (!timesheet_id || !client_email || !decision) { res.status(400).json({ error: "Missing required fields" }); return; }
      if (!["SIGN", "REJECT"].includes(decision)) { res.status(400).json({ error: "Decision must be SIGN or REJECT" }); return; }
      if (decision === "SIGN" && (!signature_method || !signature_data)) { res.status(400).json({ error: "Signature method and data required" }); return; }
      if (decision === "REJECT" && !rejection_reason) { res.status(400).json({ error: "Rejection reason required" }); return; }

      const tsRef = db.collection("timesheets").doc(timesheet_id);
      const tsDoc = await tsRef.get();
      if (!tsDoc.exists) { res.status(404).json({ error: "Timesheet not found" }); return; }
      const ts = tsDoc.data();

      if (ts.client_approver_email !== client_email) { res.status(403).json({ error: "Not authorized to sign this timesheet" }); return; }
      if (ts.state !== "CTO_APPROVED") { res.status(400).json({ error: `Cannot sign timesheet in state: ${ts.state}` }); return; }

      const nowTS = admin.firestore.FieldValue.serverTimestamp();
      const newState = decision === "SIGN" ? "CLIENT_SIGNED" : "REJECTED_BY_CLIENT";

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
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 20, cors: true },
  async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) { res.status(401).json({ error: "Missing auth" }); return; }
    let decodedToken;
    try { decodedToken = await admin.auth().verifyIdToken(authHeader.split("Bearer ")[1]); } catch { res.status(401).json({ error: "Invalid token" }); return; }

    const snapshot = await db.collection("timesheets")
      .where("engineer_email", "==", decodedToken.email)
      .orderBy("submitted_at", "desc").limit(12).get();

    const timesheets = snapshot.docs.map(d => {
      const t = d.data();
      return {
        timesheet_id: t.timesheet_id, project_name: t.project_name, client_name: t.client_name,
        period_label: t.period_label, total_hours: t.total_hours, state: t.state,
        submitted_at: t.submitted_at, rejection_reason: t.rejection_reason,
        // NO days detail, NO rates, NO client approver email
      };
    });
    res.status(200).json({ timesheets });
  }
);

// ============================================================
// HTTP endpoint: getClientTimesheets
// Returns CTO-approved timesheets for a client (via demo token)
// ============================================================
exports.getClientTimesheets = onRequest(
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 20, cors: true },
  async (req, res) => {
    const token = req.query.token || req.body?.token;
    if (!token) { res.status(400).json({ error: "Missing token" }); return; }

    // v1 demo token mapping — replace with OTP auth in v2
    const tokenMap = { "DEMO_EMKAN_001": "ahmad@emkan.com" };
    const clientEmail = tokenMap[token];
    if (!clientEmail) { res.status(403).json({ error: "Invalid token" }); return; }

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
  }
);

// ═══════════════════════════════════════════════════════════════════
// extractCVData — Vertex AI Gemini CV Extractor (KSA Sovereign)
// Uses Gemini Flash in me-central2 to extract structured candidate
// data from uploaded CV files. No cross-region data transfer.
// ═══════════════════════════════════════════════════════════════════
exports.extractCVData = onRequest(
  {
    region: "me-central2",
    memory: "1GiB",
    timeoutSeconds: 120,
    cors: true,
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    try {
      // Parse the incoming CV file via Busboy
      const busboy = Busboy({ headers: req.headers });
      const fileBuffers = [];
      let fileMimeType = null;
      let fileName = null;

      await new Promise((resolve, reject) => {
        busboy.on("file", (name, stream, info) => {
          if (name !== "cv") {
            stream.resume();
            return;
          }
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

      // Size limit: 10MB
      if (cvBuffer.length > 10 * 1024 * 1024) {
        res.status(400).json({ error: "CV file too large (max 10MB)" });
        return;
      }

      // Supported MIME types for Gemini
      const supportedTypes = [
        "application/pdf",
        "image/png",
        "image/jpeg",
        "image/webp",
      ];
      if (!supportedTypes.includes(fileMimeType)) {
        res.status(400).json({
          error: `Unsupported file type: ${fileMimeType}. Please upload PDF, PNG, or JPG.`,
        });
        return;
      }

      // Initialize Vertex AI — me-central2 (Dammam, KSA sovereign)
      // All candidate PII stays in KSA per PDPL consent
      const AI_LOCATION = "me-central2";
      const vertexAI = new VertexAI({
        project: "datalake-production-sa",
        location: AI_LOCATION,
      });

      const model = vertexAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 2048,
          responseMimeType: "application/json",
        },
      });

      const extractionPrompt = `You are a CV/resume parser. Extract structured candidate data from this document.

Return ONLY a JSON object with these exact fields (use null for any field you cannot find):
{
  "full_name": "candidate's full name",
  "email": "email address",
  "phone": "phone number with country code",
  "location": "city and country",
  "years_experience": "one of: 0-2 years, 3-5 years, 6-10 years, 10+ years",
  "current_employer": "current or most recent company name",
  "current_role": "current or most recent job title",
  "linkedin_url": "LinkedIn profile URL",
  "skills": ["skill1", "skill2", "skill3"],
  "notice_period": "one of: Immediate, 1 month, 2 months, 3+ months (or null if not stated)",
  "salary_expectation": "salary expectation if mentioned (or null)",
  "role_interest": "the type of role they seem suited for based on their experience (or null)"
}

Rules:
- Extract ALL skills mentioned anywhere in the document (technical and soft skills)
- For phone numbers, prefer +966 format for Saudi numbers
- For years_experience, calculate from their work history dates if not explicitly stated
- For location, include both city and country
- Return valid JSON only, no markdown or explanation`;

      // Send CV to Gemini
      const cvBase64 = cvBuffer.toString("base64");
      const result = await model.generateContent({
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  mimeType: fileMimeType,
                  data: cvBase64,
                },
              },
              { text: extractionPrompt },
            ],
          },
        ],
      });

      const response = result.response;
      const responseText =
        response.candidates?.[0]?.content?.parts?.[0]?.text || "{}";

      // Parse Gemini's JSON response
      let extracted;
      try {
        // Strip markdown code fences if present
        const cleaned = responseText
          .replace(/```json\s*/gi, "")
          .replace(/```\s*/g, "")
          .trim();
        extracted = JSON.parse(cleaned);
      } catch (parseErr) {
        console.warn("Gemini response parse failed, using regex fallback:", parseErr.message);
        extracted = {};
      }

      // Regex fallbacks for critical fields Gemini might miss
      const fullText = responseText; // Use for fallback only if extracted is empty
      if (!extracted.email) {
        const emailMatch = (req.rawBody || "").toString().match(
          /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/
        );
        if (emailMatch) extracted.email = emailMatch[0];
      }
      if (!extracted.phone) {
        const phoneMatch = (req.rawBody || "").toString().match(
          /\+966\s?[-.]?\s?5\d{8}|05\d{8}/
        );
        if (phoneMatch) extracted.phone = phoneMatch[0];
      }

      // Normalize skills to array
      if (extracted.skills && typeof extracted.skills === "string") {
        extracted.skills = extracted.skills.split(",").map((s) => s.trim());
      }
      if (!Array.isArray(extracted.skills)) {
        extracted.skills = [];
      }

      // Audit log (no PII beyond metadata)
      await db.collection("task_audit_log").add({
        event: "CV_EXTRACTED",
        action_by: "system:extractCVData",
        action_at: admin.firestore.FieldValue.serverTimestamp(),
        details: {
          file_name: fileName,
          file_size_bytes: cvBuffer.length,
          file_type: fileMimeType,
          fields_extracted: Object.keys(extracted).filter(
            (k) => extracted[k] !== null && extracted[k] !== ""
          ).length,
          ai_engine: "vertex-ai-gemini-2.5-flash",
          ai_region: AI_LOCATION,
          // DO NOT log candidate name, email, phone, or raw text
        },
        ip_address: req.ip || req.headers["x-forwarded-for"] || "unknown",
      });

      res.status(200).json({
        success: true,
        extracted: extracted,
        confidence_note:
          "These fields were auto-extracted from your CV using AI. Please review and correct before submitting.",
        sovereignty: "All processing performed in me-central2 (Dammam, KSA). No data left the Kingdom.",
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
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 30, cors: true, invoker: "public" },
  async (req, res) => {
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
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 30, cors: true, invoker: "public" },
  async (req, res) => {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    try {
      const profile = await requireCeo(req);
      const { email, role_id, display_name, client_id } = req.body;
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
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 30, cors: true, invoker: "public" },
  async (req, res) => {
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
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 30, cors: true, invoker: "public" },
  async (req, res) => {
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
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 30, cors: true, invoker: "public" },
  async (req, res) => {
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
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 30, cors: true, invoker: "public" },
  async (req, res) => {
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
  { region: "me-central2", memory: "256MiB", timeoutSeconds: 30, cors: true, invoker: "public" },
  async (req, res) => {
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
