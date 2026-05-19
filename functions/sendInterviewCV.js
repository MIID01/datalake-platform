/**
 * sendInterviewCV — Cloud Function (onRequest)
 *
 * CEO-only gate. Downloads the prepared interview CV DOCX from the
 * WORM bucket, builds an RFC 2822 email with attachment, and sends
 * it to the client approver via Gmail API (domain delegation).
 *
 * Auth: role must be "ceo" — absolute, no bypass.
 * Sender: hr@datalake.sa (impersonated via ADC + domain delegation)
 *
 * DTLK-FORM-HR-CV-002-v2
 */

// [TODO: enable domain-wide delegation for the Cloud Functions service account
//   in Google Workspace Admin — scope: https://www.googleapis.com/auth/gmail.send,
//   subject: hr@datalake.sa]

const admin = require("firebase-admin");
const { google } = require("googleapis");
const { writeBigQueryAudit } = require("./prepareInterviewCV");
const { generateScorecardToken } = require("./interviewScorecard");

const db = admin.firestore();
const wormBucket = admin.storage().bucket("datalake-worm-hr");

/**
 * Handler for sendInterviewCV onRequest function.
 */
async function handler(req, res, { verifyAuth, getUserAccessProfile, ALLOWED_ORIGINS }) {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Origin", ALLOWED_ORIGINS.includes(req.headers.origin) ? req.headers.origin : "");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.set("Access-Control-Max-Age", "3600");
    return res.status(204).send("");
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // ── 1. Auth: CEO ONLY — absolute enforcement ──
    const decoded = await verifyAuth(req);
    const profile = await getUserAccessProfile(decoded.uid);
    if (profile.role_id !== "ceo") {
      return res.status(403).json({
        error: "Permission denied. Only the CEO can dispatch interview CVs to clients.",
      });
    }

    const { candidate_id, project_id, meeting_date } = req.body;
    if (!candidate_id || !project_id) {
      return res.status(400).json({ error: "candidate_id and project_id are required" });
    }

    // ── 2. Load candidate — verify interview CV exists ──
    const candidateDoc = await db.collection("talent_pool").doc(candidate_id).get();
    if (!candidateDoc.exists) {
      return res.status(404).json({ error: "Candidate not found" });
    }
    const candidate = candidateDoc.data();

    // PDPL re-verification
    if (candidate.state === "PURGED") {
      return res.status(403).json({
        error: "Candidate data has been purged per PDPL. Cannot send CV.",
      });
    }
    if (!candidate.consent_granted_at) {
      return res.status(403).json({
        error: "Candidate PDPL consent not on record. Cannot dispatch personal data.",
      });
    }

    // Verify interview CV was prepared
    if (!candidate.interview_cv_path) {
      return res.status(400).json({
        error: "Interview CV has not been prepared yet. Run prepareInterviewCV first.",
      });
    }
    if (candidate.interview_cv_project_id !== project_id) {
      return res.status(400).json({
        error: `Interview CV was prepared for project ${candidate.interview_cv_project_id}, not ${project_id}. Prepare a new CV for this project.`,
      });
    }

    // ── 3. Load project — get client contact ──
    const projectDoc = await db.collection("projects").doc(project_id).get();
    if (!projectDoc.exists) {
      return res.status(404).json({ error: "Project not found" });
    }
    const project = projectDoc.data();

    if (!project.client_approver_email) {
      return res.status(400).json({
        error: "No client approver email on project. Cannot send CV.",
      });
    }

    // ── 4. Download DOCX from WORM bucket ──
    const wormFile = wormBucket.file(candidate.interview_cv_path);
    const [fileExists] = await wormFile.exists();
    if (!fileExists) {
      return res.status(404).json({
        error: `Prepared CV not found in WORM storage at: ${candidate.interview_cv_path}`,
      });
    }
    const [docxBuffer] = await wormFile.download();

    // ── 5. Build Gmail client via ADC + domain delegation ──
    const gmail = await getGmailClient();

    // ── 5b. Generate one-time scorecard token ──
    const scorecardToken = await generateScorecardToken(
      candidate_id, project_id, project.client_approver_email, project.client_approver_name
    );
    const scorecardUrl = `https://datalake-production-sa.web.app/client/scorecard/${scorecardToken}`;

    // ── 6. Build RFC 2822 email with DOCX attachment ──
    const safeName = candidate.full_name.replace(/[^a-zA-Z0-9\s]/g, "").replace(/\s+/g, "_");
    const attachmentFilename = `DTLK-FORM-HR-CV-002-v2_${safeName}.docx`;

    const emailBody = buildEmailBody({
      candidateName: candidate.full_name,
      roleInterest: candidate.role_interest,
      projectName: project.project_name,
      clientName: project.client_name,
      clientApproverName: project.client_approver_name,
      meetingDate: meeting_date,
      scorecardUrl,
    });

    const rawEmail = buildRawEmail({
      from: "Datalake HR <hr@datalake.sa>",
      to: `${project.client_approver_name} <${project.client_approver_email}>`,
      subject: `Candidate Profile: ${candidate.full_name} — ${project.project_name}`,
      body: emailBody,
      attachment: {
        filename: attachmentFilename,
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        data: docxBuffer,
      },
    });

    // ── 7. Send via Gmail API ──
    const sendResult = await gmail.users.messages.send({
      userId: "hr@datalake.sa",
      requestBody: {
        raw: rawEmail,
      },
    });

    const gmailMessageId = sendResult.data.id;
    const sentAt = new Date().toISOString();

    // ── 8. Update talent_pool doc ──
    const now = admin.firestore.FieldValue.serverTimestamp();
    await db.collection("talent_pool").doc(candidate_id).update({
      interview_cv_sent_at: now,
      interview_cv_sent_to: project.client_approver_email,
      interview_cv_sent_by: profile.email,
      interview_cv_gmail_id: gmailMessageId,
    });

    // ── 9. BigQuery audit ──
    await writeBigQueryAudit({
      event_type: "INTERVIEW_CV_DISPATCHED",
      actor: profile.email,
      candidate_id,
      project_id,
      pdpl_consent_verified: true,
      regulatory_basis: "PDPL Art. 4, 5; NCA ECC-1:2018",
      recipient_email: project.client_approver_email,
      gmail_message_id: gmailMessageId,
    });

    // ── 10. Firestore audit log ──
    await db.collection("task_audit_log").add({
      event: "INTERVIEW_CV_DISPATCHED",
      action_by: profile.email,
      action_at: now,
      details: {
        candidate_id,
        candidate_name: candidate.full_name,
        project_id,
        project_name: project.project_name,
        client_name: project.client_name,
        sent_to: project.client_approver_email,
        sent_to_name: project.client_approver_name,
        gmail_message_id: gmailMessageId,
      },
      ip_address: req.ip || req.headers["x-forwarded-for"] || "unknown",
    });

    return res.status(200).json({
      success: true,
      sent_to: project.client_approver_email,
      sent_to_name: project.client_approver_name,
      gmail_message_id: gmailMessageId,
      sent_at: sentAt,
    });
  } catch (err) {
    console.error("sendInterviewCV error:", err);
    return res.status(500).json({ error: "Internal server error", detail: err.message });
  }
}

/**
 * Get authenticated Gmail client using Application Default Credentials
 * with domain-wide delegation impersonating hr@datalake.sa.
 */
async function getGmailClient() {
  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/gmail.send"],
  });
  const client = await auth.getClient();
  // Domain delegation: impersonate hr@datalake.sa
  client.subject = "hr@datalake.sa";
  return google.gmail({ version: "v1", auth: client });
}

/**
 * Build the email body text.
 */
function buildEmailBody({ candidateName, roleInterest, projectName, clientName, clientApproverName, meetingDate, scorecardUrl }) {
  const greeting = clientApproverName ? `Dear ${clientApproverName},` : "Dear Hiring Manager,";
  const role = roleInterest || "Engineering Consultant";
  const meetingLine = meetingDate
    ? `\nA meeting has been scheduled for ${meetingDate}. Please confirm your availability at your earliest convenience.\n`
    : "";

  return [
    greeting,
    "",
    `Please find attached the Skills Portfolio for ${candidateName}, submitted for your review in connection with the ${projectName} engagement.`,
    "",
    `Role: ${role}`,
    `Project: ${projectName}`,
    `Client: ${clientName}`,
    meetingLine,
    "The attached document follows the Datalake Skills Portfolio format (DTLK-FORM-HR-CV-002-v2) and contains the candidate's professional summary, technical competencies, and relevant project experience.",
    "",
    "Please review at your convenience and advise on next steps.",
    "",
    "────────────────────────────────────────",
    "INTERVIEW SCORECARD",
    "",
    "After the interview, please submit your evaluation using the secure link below:",
    scorecardUrl,
    "",
    "This is a one-time link that expires in 14 days.",
    "────────────────────────────────────────",
    "",
    "────────────────────────────────────────",
    "PRIVATE & CONFIDENTIAL",
    "This document contains personal data processed under PDPL Art. 5 (candidate consent).",
    "Do not forward or share without authorization from Datalake HR.",
    "────────────────────────────────────────",
    "",
    "Best regards,",
    "Datalake HR Team",
    "hr@datalake.sa",
    "",
    "Datalake Information Technology",
    "CR: 109194773 | UEN: 7048904952",
    "www.datalake.sa",
  ].join("\n");
}

/**
 * Build a base64url-encoded RFC 2822 MIME email with DOCX attachment.
 */
function buildRawEmail({ from, to, subject, body, attachment }) {
  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const mimeMessage = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    body,
    "",
    `--${boundary}`,
    `Content-Type: ${attachment.mimeType}; name="${attachment.filename}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${attachment.filename}"`,
    "",
    attachment.data.toString("base64"),
    "",
    `--${boundary}--`,
  ].join("\r\n");

  // Gmail API requires URL-safe base64
  return Buffer.from(mimeMessage)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

module.exports = { handler };
