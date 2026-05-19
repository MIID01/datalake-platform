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

// [TODO: deploy cv-agent to Cloud Run in me-central2, set CV_AGENT_URL env var]
// [TODO: create BigQuery dataset datalake_audit and table system_events with schema:
//   event_type STRING, actor STRING, candidate_id STRING, project_id STRING,
//   pdpl_consent_verified BOOL, regulatory_basis STRING, timestamp TIMESTAMP,
//   details JSON]

const admin = require("firebase-admin");
const FormData = require("form-data");

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

    // ── 7. Extract text via OCR ──
    const { callOCR, callLLM } = require("./lib/ai-client");
    const cvBase64 = cvBuffer.toString("base64");
    const ocrResult = await callOCR({
      fileBase64: cvBase64,
      agent: "gatekeeper",
      type: "cv_extraction",
      triggeredBy: profile.email,
    });

    if (!ocrResult.success) {
      return res.status(502).json({
        error: `OCR extraction failed: ${ocrResult.error}`,
      });
    }

    const cvText = ocrResult.lines.map(l => l.text || l).join("\n");
    
    if (!cvText.trim()) {
      return res.status(502).json({
        error: "OCR extracted no readable text from the candidate's CV file.",
      });
    }

    // ── 8. Reformat via LLM ──
    const systemPrompt = `You are a senior technical recruiter at Datalake Information Technology, a Saudi staff augmentation company deploying data engineers to enterprise financial clients (banks, fintech, government).

You are reading a candidate's raw CV text extracted via OCR. Your job is to extract their real data and present it in a way that sells them to a client hiring manager.

CRITICAL RULES:
1. Use ONLY information present in the CV text. NEVER invent, assume, or embellish any skill, role, company, or achievement. If something is not in the CV, do not include it.
2. PDPL COMPLIANCE: Remove all personal contact information — phone numbers, email addresses, home addresses, dates of birth, nationality, marital status, religion, Iqama/ID numbers, photos. Only professional qualifications and experience.
3. This is a SALES document. Present the candidate positively. Highlight strengths. Do not mention weaknesses, gaps, or concerns — those stay in internal HR notes only.
4. If a skill or certification is mentioned in the CV, include it. If the CV text is unclear or garbled from OCR, do your best to interpret it accurately.
5. Quantify wherever the CV provides numbers — years, percentages, volumes, team sizes.

Return ONLY a JSON object with these exact fields. No markdown wrapping. No explanation. Pure JSON:

{
  "candidate_name": "Full name exactly as it appears in the CV",
  "professional_summary": "2-3 sentences selling this candidate to a client. What makes them valuable? What's their strongest expertise? Write as if recommending them to a banking CTO.",
  "best_fit_role": "The job title that best matches their experience.",
  "seniority": "One of: Junior, Mid, Senior, Lead, Principal — based on years of experience and role progression",
  "years_experience": "Total years of relevant professional experience as a number",
  "skills_cloud": "Comma-separated cloud platform skills found in CV. Only include what is actually in the CV text. Write 'Not specified' if none found.",
  "skills_data_eng": "Comma-separated data engineering tools found in CV. Only what is in the CV. Write 'Not specified' if none found.",
  "skills_programming": "Comma-separated languages found in CV. Only what is in the CV. Write 'Not specified' if none found.",
  "skills_databases": "Comma-separated database technologies found in CV. Only what is in the CV. Write 'Not specified' if none found.",
  "skills_bi": "Comma-separated BI and Visualization tools found in CV. Only what is in the CV. Write 'Not specified' if none found.",
  "skills_devops": "Comma-separated DevOps tools found in CV. Only what is in the CV. Write 'Not specified' if none found.",
  "skills_regulatory": "Any compliance, regulatory, or domain expertise mentioned in the CV. Write 'Not specified' if none found.",
  "experience_content": "Full work history formatted as plain text. For each role write on separate lines:\\n\\nROLE TITLE — Company Name\\nMonth Year – Month Year (X years Y months)\\n• Achievement or responsibility with quantified impact\\n• Achievement or responsibility\\n• Achievement or responsibility\\n\\nMost recent role first. 3-5 bullets per role. Start each bullet with a strong verb. Preserve all numbers and metrics exactly as stated in the CV.",
  "certifications_content": "List each certification on a new line:\\n• Certification Name — Issuing Body — Year\\nMost recent first. Write 'No certifications listed' if none found.",
  "education_content": "List each degree on a new line:\\n• Degree — Institution — Year\\nMost recent first. Write 'Not specified' if not found.",
  "key_achievements": "3-5 bullet points highlighting the candidate's most impressive accomplishments from across their career. These should be the achievements that would make a client say 'I want this person on my team'. Quantify everything possible. Format as:\\n• Achievement one\\n• Achievement two\\n• Achievement three",
  "fit_score": "Score out of 10 for fit based on JD",
  "red_flags": ["Any gaps or concerns"],
  "interview_questions": ["Suggested question 1"]
}`;

    const llmResult = await callLLM({
      agent: "gatekeeper",
      type: "cv_reformat",
      triggeredBy: profile.email,
      promptTemplateId: "GATEKEEPER_CV_REFORMAT_V2",
      systemPrompt: systemPrompt,
      userPrompt: cvText
    });

    if (!llmResult.success) {
      return res.status(502).json({
        error: `LLM formatting failed: ${llmResult.error}`,
      });
    }

    // ── 9. Parse JSON from LLM ──
    let cvData;
    try {
      const cleaned = llmResult.output.replace(/```json|```/g, "").trim();
      cvData = JSON.parse(cleaned);
    } catch (err) {
      console.error("Failed to parse JSON:", llmResult.output);
      return res.status(502).json({
        error: `AI returned invalid JSON: ${err.message}`,
      });
    }

    // ── 10. Load Template & Render ──
    const PizZip = require("pizzip");
    const Docxtemplater = require("docxtemplater");
    
    let templateBuffer;
    try {
      const templateFile = admin.storage().bucket("datalake-grc-library").file("templates/DTLK-FORM-HR-CV-002_v1.1.docx");
      const [buffer] = await templateFile.download();
      templateBuffer = buffer;
    } catch (err) {
      console.error("Failed to load template from GCS", err);
      return res.status(500).json({ error: "Failed to load master template from GCS. Make sure DTLK-FORM-HR-CV-002_v1.1.docx is uploaded." });
    }

    let outputBuffer;
    try {
      const zip = new PizZip(templateBuffer);
      const docx = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
        delimiters: { start: "{", end: "}" }
      });

      const formatMultiline = (val) => {
        if (!val) return "";
        let str = Array.isArray(val) ? val.join("\n\n") : String(val);
        // Force inline bullets to start on a new line
        str = str.replace(/([^\n])\s*•\s*/g, "$1\n• ");
        return str.trim();
      };

      docx.render({
        prepared_date: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
        candidate_name: cvData.candidate_name || "Unknown",
        professional_summary: cvData.professional_summary || "",
        best_fit_role: cvData.best_fit_role || "",
        seniority: cvData.seniority || "",
        years_experience: cvData.years_experience || "",
        skills_cloud: cvData.skills_cloud || "Not specified",
        skills_data_eng: cvData.skills_data_eng || "Not specified",
        skills_programming: cvData.skills_programming || "Not specified",
        skills_databases: cvData.skills_databases || "Not specified",
        skills_bi: cvData.skills_bi || "Not specified",
        skills_devops: cvData.skills_devops || "Not specified",
        skills_regulatory: cvData.skills_regulatory || "Not specified",
        experience_content: formatMultiline(cvData.experience_content),
        certifications_content: formatMultiline(cvData.certifications_content || "No certifications listed"),
        education_content: formatMultiline(cvData.education_content || "Not specified"),
        key_achievements: formatMultiline(cvData.key_achievements)
      });

      outputBuffer = docx.getZip().generate({ type: "nodebuffer" });
    } catch (err) {
      console.error("Docxtemplater error:", err);
      if (err.properties && err.properties.errors) {
         err.properties.errors.forEach(e => console.error("Docxtemplater issue:", e));
      }
      return res.status(500).json({ error: "Failed to render DOCX template. Check the template tags." });
    }

    // ── 11. Store output in WORM bucket ──
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeName = (cvData.candidate_name || candidate.full_name).replace(/[^a-zA-Z0-9\s]/g, "").replace(/\s+/g, "_");
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
        fit_score: cvData.fit_score || null,
        red_flags: cvData.red_flags || [],
        interview_questions: cvData.interview_questions || []
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
        candidate_name: cvData.candidate_name || candidate.full_name,
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
      candidate_name: cvData.candidate_name || candidate.full_name,
      client_approver_email: project.client_approver_email || null,
      client_approver_name: project.client_approver_name || null,
    });
  } catch (err) {
    console.error("prepareInterviewCV error:", err);
    return res.status(500).json({ error: "Internal server error", detail: err.message });
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
    `This is an outsourcing engagement managed by Datalake Information Technology.`,
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
