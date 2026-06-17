/**
 * prepareInterviewCV — Cloud Function (onRequest)
 *
 * Reformats a candidate's CV into a Datalake "Skills Portfolio" interview PDF,
 * tailored to a client job description. Runs on the in-KSA GPU model (callLLM →
 * Qwen/Gemma on the VM) — NO external cv-agent. The candidate's CV is already
 * structured in talent_pool.ai_extracted_data; if absent we pdf-parse the raw CV.
 * Output is stored in the main (erasable) bucket per PDPL Art.18 retention.
 *
 * Auth: role must be "hr" or "ceo".  PDPL: blocks PURGED / no-consent candidates.
 * DTLK-FORM-HR-CV-002-v3 (GPU)
 */

const admin = require("firebase-admin");
const PDFDocument = require("pdfkit");
const { httpErrorStatus } = require("./lib/httpErrors");
const { callLLM, parseJsonOutput } = require("./lib/ai-client");
const { LEGAL_FOOTER_EN } = require("./lib/company-legal");
let pdfParse;
try { pdfParse = require("pdf-parse"); } catch (_) { /* optional fallback */ }

const db = admin.firestore();
const cvBucket = admin.storage().bucket("datalake-cv-uploads");
// Interview CVs go to the main bucket (NOT WORM) so the PDPL purge cycle can
// delete them when the candidate's retention window expires (PDPL Art.18).
const interviewCvBucket = admin.storage().bucket("datalake-production-sa.firebasestorage.app");

async function handler(req, res, { verifyAuth, getUserAccessProfile, ALLOWED_ORIGINS }) {
  res.set("Access-Control-Allow-Origin", "https://datalake-production-sa.web.app");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") { res.set("Access-Control-Max-Age", "3600"); return res.status(204).send(""); }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    // ── 1. Auth ──
    const decoded = await verifyAuth(req);
    const profile = await getUserAccessProfile(decoded.uid);
    if (!["hr", "ceo"].includes(profile.role_id)) {
      return res.status(403).json({ error: "Forbidden: requires HR or CEO role" });
    }

    const { candidate_id, project_id, jd_text } = req.body;
    if (!candidate_id || !project_id) return res.status(400).json({ error: "candidate_id and project_id are required" });

    // ── 2. Candidate + PDPL gate ──
    const candidateDoc = await db.collection("talent_pool").doc(candidate_id).get();
    if (!candidateDoc.exists) return res.status(404).json({ error: "Candidate not found" });
    const candidate = candidateDoc.data();
    if (candidate.state === "PURGED") return res.status(403).json({ error: "Candidate data has been purged per PDPL retention policy." });
    if (!candidate.consent_granted_at) return res.status(403).json({ error: "Candidate has not granted PDPL consent." });

    // ── 3. Project ──
    const projectDoc = await db.collection("projects").doc(project_id).get();
    if (!projectDoc.exists) return res.status(404).json({ error: "Project not found" });
    const project = projectDoc.data();

    // ── 4. CV source: prefer the already-extracted structured data; else
    //      pdf-parse the raw CV. (No cv-agent — runs on our GPU model.) ──
    let cvData = candidate.ai_extracted_data || candidate.extracted_data || null;
    let cvRawText = "";
    if (!cvData && candidate.cv_path && pdfParse) {
      try {
        const cvFile = cvBucket.file(candidate.cv_path);
        const [exists] = await cvFile.exists();
        if (exists) {
          const [buf] = await cvFile.download();
          cvRawText = ((await pdfParse(buf)).text || "").slice(0, 12000);
        }
      } catch (e) { console.warn("CV pdf-parse fallback failed:", e.message); }
    }
    if (!cvData && !cvRawText) {
      return res.status(400).json({ error: "No CV data available (no extracted data and no readable CV file)." });
    }

    const jdContent = (jd_text && jd_text.trim()) ? jd_text.trim() : buildDefaultJD(project, candidate);

    // ── 5. GPU reformat — tailor the CV to the role. GROUNDED, no fabrication. ──
    const llm = await callLLM({
      agent: "gatekeeper",
      type: "interview_cv_prepare",
      triggeredBy: profile.email,
      promptTemplateId: "INTERVIEW_CV_PREP_V1_GPU",
      jsonMode: true,
      systemPrompt: `You prepare a candidate's CV into a Datalake Saudi Arabia LLC interview "Skills Portfolio" tailored to a client role.

GROUNDING (critical): Use ONLY facts present in the candidate CV data. NEVER invent experience, skills, employers, job titles, dates, certifications or education. Reorganise and summarise honestly to highlight relevance to the job description — if something is not in the CV, leave it out.

Return ONLY a JSON object:
{
  "headline": "one-line professional headline grounded in the CV",
  "summary": "3-4 sentence professional summary tailored to the role, only from the CV",
  "key_skills": ["a skill present in the CV that is relevant to the role"],
  "experience": [{"role":"","company":"","period":"","highlights":["",""]}],
  "education": [{"degree":"","institution":"","year":""}],
  "certifications": [""]
}`,
      userPrompt: `JOB DESCRIPTION:\n${jdContent}\n\nCANDIDATE CV DATA:\n${cvData ? JSON.stringify(cvData) : cvRawText}`,
    });
    if (!llm.success) return res.status(503).json({ error: "CV preparation unavailable (model)", detail: llm.error });
    const parsed = parseJsonOutput(llm.output);
    const portfolio = parsed.success ? parsed.data : {};

    // ── 6. Render the branded interview-CV PDF ──
    const outputBuffer = await renderInterviewCvPdf({ portfolio, candidate, project });

    // ── 7. Store in the main (erasable) bucket with PDPL retention metadata ──
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeName = String(candidate.full_name || "candidate").replace(/[^a-zA-Z0-9\s]/g, "").replace(/\s+/g, "_");
    const interviewCvPath = `interview-cvs/${project_id}/${candidate_id}/${timestamp}_DTLK-FORM-HR-CV-002_${safeName}.pdf`;
    const pdplPurgeAfter = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

    const interviewCvFile = interviewCvBucket.file(interviewCvPath);
    await interviewCvFile.save(outputBuffer, {
      metadata: {
        contentType: "application/pdf",
        metadata: {
          candidate_id, project_id, prepared_by: profile.email,
          regulatory_basis: "PDPL Art. 4, 5, 18; NCA ECC-1:2018",
          pdpl_purge_after: pdplPurgeAfter.toISOString(),
          retention_note: "Candidate interview CV reformat — erasable per PDPL Art.18 retention policy",
        },
      },
    });

    const now = admin.firestore.FieldValue.serverTimestamp();
    await db.collection("talent_pool").doc(candidate_id).update({
      portfolio_generated: true,
      portfolio_path: interviewCvPath,
      portfolio_bucket: "datalake-production-sa.firebasestorage.app",
      portfolio_generated_at: now,
      portfolio_pdpl_purge_after: admin.firestore.Timestamp.fromDate(pdplPurgeAfter),
      interview_cv_path: interviewCvPath,
      interview_cv_bucket: "datalake-production-sa.firebasestorage.app",
      interview_cv_prepared_at: now,
      interview_cv_prepared_by: profile.email,
      interview_cv_project_id: project_id,
      interview_cv_format: "pdf",
    });

    await writeBigQueryAudit({
      event_type: "INTERVIEW_CV_PREPARED", actor: profile.email,
      candidate_id, project_id, pdpl_consent_verified: true,
      regulatory_basis: "PDPL Art. 4, 5; NCA ECC-1:2018",
    });

    const [signedUrl] = await interviewCvFile.getSignedUrl({ action: "read", expires: Date.now() + 60 * 60 * 1000 });

    // PDPL: no IP / user-agent on the audit row.
    await db.collection("task_audit_log").add({
      event: "INTERVIEW_CV_PREPARED", action_by: profile.email, action_at: now,
      details: {
        candidate_id, candidate_name: candidate.full_name, project_id,
        project_name: project.project_name, client_name: project.client_name,
        path: interviewCvPath, format: "pdf", model: llm.modelName || null,
      },
    });

    return res.status(200).json({
      success: true, signed_url: signedUrl, worm_path: interviewCvPath, format: "pdf",
      candidate_name: candidate.full_name,
      client_approver_email: project.client_approver_email || null,
      client_approver_name: project.client_approver_name || null,
    });
  } catch (err) {
    console.error("prepareInterviewCV error:", err);
    return res.status(httpErrorStatus(err)).json({ error: err.message });
  }
}

// ── Branded interview-CV PDF (PDFKit) ──
function renderInterviewCvPdf({ portfolio, candidate, project }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4", bufferPages: true });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const navy = "#022873", sky = "#1598CC";
    doc.rect(0, 0, doc.page.width, 72).fill(navy);
    doc.fillColor("#ffffff").fontSize(19).text("Datalake Saudi Arabia LLC", 50, 22);
    doc.fontSize(10).fillColor("#cfe3f5").text("Candidate Skills Portfolio — Interview", 50, 48);

    doc.fillColor(navy).fontSize(18).text(candidate.full_name || "Candidate", 50, 92);
    if (portfolio.headline) doc.fillColor(sky).fontSize(11).text(String(portfolio.headline));
    doc.moveDown(0.4).fillColor("#444").fontSize(9)
      .text(`Prepared for ${project.client_name || ""}${project.project_name ? " · " + project.project_name : ""}`);
    doc.moveDown(0.8).fillColor("#111");

    const section = (title) => {
      doc.moveDown(0.6).fillColor(navy).fontSize(12).text(title);
      doc.moveTo(50, doc.y + 2).lineTo(doc.page.width - 50, doc.y + 2).strokeColor(sky).lineWidth(1).stroke();
      doc.moveDown(0.4).fillColor("#222").fontSize(10);
    };

    if (portfolio.summary) { section("Professional Summary"); doc.text(String(portfolio.summary)); }
    if (Array.isArray(portfolio.key_skills) && portfolio.key_skills.filter(Boolean).length) {
      section("Key Skills"); doc.text(portfolio.key_skills.filter(Boolean).join("   ·   "));
    }
    if (Array.isArray(portfolio.experience) && portfolio.experience.length) {
      section("Experience");
      portfolio.experience.forEach((x) => {
        doc.fillColor(navy).fontSize(10).text(`${x.role || ""}${x.company ? " — " + x.company : ""}`);
        if (x.period) doc.fillColor("#777").fontSize(8.5).text(String(x.period));
        (x.highlights || []).filter(Boolean).forEach((h) => doc.fillColor("#222").fontSize(9.5).text("•  " + h, { indent: 8 }));
        doc.moveDown(0.4);
      });
    }
    if (Array.isArray(portfolio.education) && portfolio.education.length) {
      section("Education");
      portfolio.education.forEach((e) =>
        doc.fillColor("#222").fontSize(9.5).text(`${e.degree || ""}${e.institution ? ", " + e.institution : ""}${e.year ? " (" + e.year + ")" : ""}`));
    }
    if (Array.isArray(portfolio.certifications) && portfolio.certifications.filter(Boolean).length) {
      section("Certifications");
      portfolio.certifications.filter(Boolean).forEach((c) => doc.fillColor("#222").fontSize(9.5).text("•  " + c));
    }

    doc.fontSize(7).fillColor("#888")
      .text(LEGAL_FOOTER_EN, 50, doc.page.height - 58, { width: doc.page.width - 100, align: "center" });
    doc.end();
  });
}

function buildDefaultJD(project, candidate) {
  return [
    `Position: ${candidate.role_interest || candidate.current_role || "Engineering Consultant"}`,
    `Client: ${project.client_name}`,
    `Project: ${project.project_name}`,
    `Work Location: ${project.work_location_type || "On-site"} ${project.work_location_address ? "— " + project.work_location_address : ""}`,
    ``,
    `Requirements:`,
    `- Relevant experience in ${candidate.role_interest || "software engineering"}`,
    `- Strong communication skills (English and Arabic preferred)`,
    `- KSA work authorization required`,
    candidate.skills && candidate.skills.length > 0 ? `- Key skills: ${candidate.skills.join(", ")}` : "",
    ``,
    `This is an outsourcing engagement managed by Datalake Saudi Arabia LLC; the candidate will be deployed to ${project.client_name} under project ${project.project_name}.`,
  ].filter(Boolean).join("\n");
}

async function writeBigQueryAudit(eventData) {
  try {
    const { BigQuery } = require("@google-cloud/bigquery");
    const bq = new BigQuery({ projectId: "datalake-production-sa", location: "me-central2" });
    await bq.dataset("datalake_audit").table("system_events").insert([{ ...eventData, timestamp: new Date().toISOString() }]);
  } catch (err) {
    console.warn("BigQuery audit write failed (non-blocking):", err.message);
  }
}

module.exports = { handler, writeBigQueryAudit };
