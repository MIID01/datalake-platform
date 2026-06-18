/**
 * prepareInterviewCV — Cloud Function (onRequest)
 *
 * Reformats a candidate's CV into Datalake's "Skills Portfolio" interview form
 * by FILLING the agreed DOCX template (DTLK-FORM-HR-CV-002 v1.1) with extracted,
 * role-tailored data. Runs on the in-KSA GPU model (callLLM → Qwen/Gemma on the
 * VM) — NO external cv-agent. The candidate's CV is already structured in
 * talent_pool.ai_extracted_data; if absent we pdf-parse the raw CV. Output is a
 * DOCX stored in the main (erasable) bucket per PDPL Art.18 retention.
 *
 * Auth: role must be "hr" or "ceo".  PDPL: blocks PURGED / no-consent candidates.
 * DTLK-FORM-HR-CV-002 v1.1
 */

const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const PizZip = require("pizzip");
const Docxtemplater = require("docxtemplater");
const { httpErrorStatus } = require("./lib/httpErrors");
const { callLLM, parseJsonOutput } = require("./lib/ai-client");
let pdfParse;
try { pdfParse = require("pdf-parse"); } catch (_) { /* optional fallback */ }

// The agreed client-facing form. We FILL this docxtemplater template ({placeholder}
// tags) — we do not generate our own layout — so the output is exactly the form HR
// signed off on (DTLK-FORM-HR-CV-002 v1.1).
const CV_TEMPLATE_PATH = path.join(__dirname, "assets", "DTLK-FORM-HR-CV-002_v1.1.docx");

const db = admin.firestore();
// Careers uploads land in datalake-cv-uploads; some older/manual CVs are in the
// main bucket. Try the upload bucket first, then fall back.
const CV_SOURCE_BUCKETS = ["datalake-cv-uploads", "datalake-production-sa.firebasestorage.app"];
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
        for (const b of CV_SOURCE_BUCKETS) {
          const cvFile = admin.storage().bucket(b).file(candidate.cv_path);
          const [exists] = await cvFile.exists();
          if (exists) {
            const [buf] = await cvFile.download();
            cvRawText = ((await pdfParse(buf)).text || "").slice(0, 12000);
            break;
          }
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
      promptTemplateId: "INTERVIEW_CV_PREP_V2_FORM",
      jsonMode: true,
      systemPrompt: `You fill Datalake Saudi Arabia LLC's "Skills Portfolio" form for a candidate, tailored to a client role.

GROUNDING (critical): Use ONLY facts present in the candidate CV data. NEVER invent experience, skills, employers, job titles, dates, numbers, certifications or education. If a field is not supported by the CV, return an empty string "" — do NOT guess and do NOT fill a category just to look complete.

Categorise the candidate's REAL skills into the fixed buckets below (leave a bucket "" if the CV shows nothing for it). Write experience/education/certifications as readable multi-line text using \\n between lines and a blank line between entries.

Return ONLY this JSON object (all values strings unless noted):
{
  "professional_summary": "3-4 sentence summary tailored to the role, only from the CV",
  "best_fit_role": "the role title this candidate best fits for this client",
  "seniority": "Junior / Mid / Senior / Lead — only if evident, else \\"\\"",
  "years_experience": "integer years of professional experience, or \\"\\" if unclear",
  "skills_cloud": "comma-separated cloud platforms present in the CV (AWS, Azure, GCP...)",
  "skills_data_eng": "data engineering (Spark, Kafka, ETL, Airflow, dbt...)",
  "skills_programming": "languages (Python, Java, Scala, SQL...)",
  "skills_databases": "databases (PostgreSQL, Oracle, MongoDB, BigQuery...)",
  "skills_bi": "BI & visualization (Power BI, Tableau, Looker...)",
  "skills_devops": "DevOps/MLOps (Docker, Kubernetes, CI/CD, Terraform...)",
  "skills_regulatory": "regulatory/domain (SAMA, PDPL, banking, finance, healthcare...)",
  "experience_content": "each role as 'Title — Company (period)' then bullet lines starting with '• ', entries separated by a blank line",
  "certifications_content": "one certification per line, or \\"\\" if none in the CV",
  "education_content": "'Degree, Institution (year)' per line",
  "key_achievements": "notable, quantified achievements from the CV as '• ' bullet lines, or \\"\\""
}`,
      userPrompt: `JOB DESCRIPTION:\n${jdContent}\n\nCANDIDATE CV DATA:\n${cvData ? JSON.stringify(cvData) : cvRawText}`,
    });
    if (!llm.success) return res.status(503).json({ error: "CV preparation unavailable (model)", detail: llm.error });
    const parsed = parseJsonOutput(llm.output);
    const portfolio = parsed.success ? parsed.data : {};

    // ── 6. Fill the agreed Skills Portfolio form (DOCX) ──
    const preparedDate = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    const outputBuffer = fillInterviewCvDocx({ portfolio, candidate, preparedDate });
    // Tamper-evident fingerprint of the exact artifact — recomputed at dispatch
    // time so we can prove what was prepared and that it was unchanged when sent.
    const cvSha256 = crypto.createHash("sha256").update(outputBuffer).digest("hex");
    const cvBytes = outputBuffer.length;

    // ── 7. Store in the main (erasable) bucket with PDPL retention metadata ──
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeName = String(candidate.full_name || "candidate").replace(/[^a-zA-Z0-9\s]/g, "").replace(/\s+/g, "_");
    const interviewCvPath = `interview-cvs/${project_id}/${candidate_id}/${timestamp}_DTLK-FORM-HR-CV-002_${safeName}.docx`;
    const pdplPurgeAfter = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

    const interviewCvFile = interviewCvBucket.file(interviewCvPath);
    await interviewCvFile.save(outputBuffer, {
      metadata: {
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        metadata: {
          candidate_id, project_id, prepared_by: profile.email,
          sha256: cvSha256,
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
      interview_cv_format: "docx",
      interview_cv_sha256: cvSha256,
      interview_cv_bytes: cvBytes,
    });

    await writeBigQueryAudit({
      event_type: "INTERVIEW_CV_PREPARED", actor: profile.email,
      candidate_id, project_id, pdpl_consent_verified: true,
      artifact_path: interviewCvPath, artifact_sha256: cvSha256, artifact_bytes: cvBytes,
      regulatory_basis: "PDPL Art. 4, 5; NCA ECC-1:2018",
    });

    const [signedUrl] = await interviewCvFile.getSignedUrl({ action: "read", expires: Date.now() + 60 * 60 * 1000 });

    // PDPL: no IP / user-agent on the audit row.
    await db.collection("task_audit_log").add({
      event: "INTERVIEW_CV_PREPARED", action_by: profile.email, action_at: now,
      details: {
        candidate_id, candidate_name: candidate.full_name, project_id,
        project_name: project.project_name, client_name: project.client_name,
        path: interviewCvPath, format: "docx", model: llm.modelName || null,
        sha256: cvSha256, bytes: cvBytes, pdpl_consent_verified: true,
      },
    });

    return res.status(200).json({
      success: true, signed_url: signedUrl, worm_path: interviewCvPath, format: "docx",
      candidate_name: candidate.full_name,
      client_approver_email: project.client_approver_email || null,
      client_approver_name: project.client_approver_name || null,
    });
  } catch (err) {
    console.error("prepareInterviewCV error:", err);
    return res.status(httpErrorStatus(err)).json({ error: err.message });
  }
}

// ── Fill the agreed Skills Portfolio form (DTLK-FORM-HR-CV-002 v1.1) ──
// We fill the real template's {placeholder} tags rather than drawing our own
// layout, so the client receives exactly the signed-off form. Word inserts
// <w:proofErr/> spell/grammar markers mid-text that split tags (e.g.
// {prepared_date}); we strip them from the document part before rendering.
function fillInterviewCvDocx({ portfolio, candidate, preparedDate }) {
  const templateBinary = fs.readFileSync(CV_TEMPLATE_PATH, "binary");
  const zip = new PizZip(templateBinary);

  const DOC_XML = "word/document.xml";
  const cleanedXml = zip.file(DOC_XML).asText().replace(/<w:proofErr[^>]*\/>/g, "");
  zip.file(DOC_XML, cleanedXml);

  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
  const str = (v) => (v == null ? "" : String(v));
  doc.render({
    prepared_date: preparedDate,
    candidate_name: str(candidate.full_name),
    professional_summary: str(portfolio.professional_summary),
    best_fit_role: str(portfolio.best_fit_role || candidate.role_interest),
    seniority: str(portfolio.seniority),
    years_experience: str(portfolio.years_experience),
    skills_cloud: str(portfolio.skills_cloud),
    skills_data_eng: str(portfolio.skills_data_eng),
    skills_programming: str(portfolio.skills_programming),
    skills_databases: str(portfolio.skills_databases),
    skills_bi: str(portfolio.skills_bi),
    skills_devops: str(portfolio.skills_devops),
    skills_regulatory: str(portfolio.skills_regulatory),
    experience_content: str(portfolio.experience_content),
    certifications_content: str(portfolio.certifications_content),
    education_content: str(portfolio.education_content),
    key_achievements: str(portfolio.key_achievements),
  });

  return doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" });
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
    // ignoreUnknownValues: a caller adding a new field (e.g. artifact_sha256)
    // must NOT silently drop the whole audit row when the table lacks that
    // column — keep the row, ignore the extra field. The full immutable record
    // (with hashes/recipients) always lands in Firestore task_audit_log.
    await bq.dataset("datalake_audit").table("system_events").insert(
      [{ ...eventData, timestamp: new Date().toISOString() }],
      { ignoreUnknownValues: true },
    );
  } catch (err) {
    console.warn("BigQuery audit write failed (non-blocking):", err.message);
  }
}

module.exports = { handler, writeBigQueryAudit };
