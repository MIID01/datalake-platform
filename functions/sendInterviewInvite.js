/**
 * sendInterviewInvite — Cloud Function (onRequest)
 *
 * HR/CEO: schedule a candidate interview and send a calendar invite (Teams via
 * MS Graph when configured, else .ics over Gmail). Moves the candidate to
 * INTERVIEW_SCHEDULED.
 *
 * Outbound Communications Standard (DTLK-STD-COMMS-001): this function does NOT
 * send mail directly. It builds the content and hands it to the single send
 * gateway (lib/comms-gateway.js), which owns sender identity, the standard
 * footer, the PDPL consent gate, the append-only outbound_comms_log, and the
 * choice of transport. Both transports share that one path.
 *
 * Times are entered as Riyadh wall-clock (Asia/Riyadh is a fixed UTC+3, no DST).
 *
 * Auth: role must be "hr" or "ceo".  PDPL: blocks PURGED / no-consent candidates,
 * and a client approver is disclosed candidate data ONLY with a consent_basis_ref.
 */

const admin = require("firebase-admin");
const crypto = require("crypto");
const { COMPANY } = require("./lib/company-legal");
const { writeBigQueryAudit } = require("./prepareInterviewCV");
const { sendStandardMessage } = require("./lib/comms-gateway");

const db = admin.firestore();
const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000; // Asia/Riyadh = UTC+3, no DST.
const DEFAULT_INTERVIEW_CV_BUCKET = "datalake-production-sa.firebasestorage.app";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

async function handler(req, res, { verifyAuth, getUserAccessProfile }) {
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

    const { candidate_id, project_id, start_datetime, duration_minutes, location, mode, cc, notes, host_email, consent_basis_ref } = req.body;
    if (!candidate_id || !project_id || !start_datetime) {
      return res.status(400).json({ error: "candidate_id, project_id and start_datetime are required" });
    }

    const start = parseRiyadhLocal(start_datetime);
    if (!start) return res.status(400).json({ error: "Invalid start_datetime (expected 'YYYY-MM-DDTHH:mm')" });
    const durMin = Number(duration_minutes) > 0 ? Number(duration_minutes) : 45;
    const end = new Date(start.getTime() + durMin * 60 * 1000);

    // ── 2. Candidate + PDPL gate ──
    const candidateDoc = await db.collection("talent_pool").doc(candidate_id).get();
    if (!candidateDoc.exists) return res.status(404).json({ error: "Candidate not found" });
    const candidate = candidateDoc.data();
    if (candidate.state === "PURGED") return res.status(403).json({ error: "Candidate data has been purged per PDPL." });
    if (!candidate.consent_granted_at) return res.status(403).json({ error: "Candidate has not granted PDPL consent." });
    if (!candidate.email) return res.status(400).json({ error: "No candidate email on file — cannot send invite." });

    // ── 3. Project / client ──
    const projectDoc = await db.collection("projects").doc(project_id).get();
    if (!projectDoc.exists) return res.status(404).json({ error: "Project not found" });
    const project = projectDoc.data();
    const clientEmail = project.client_approver_email || null; // gated below by consent_basis_ref

    // ── 3b. Prepared CV (Skills Portfolio) — attach if one exists for THIS project ──
    // The same canonical artifact sendInterviewCV dispatches: a DOCX at
    // candidate.interview_cv_path, integrity-checked against interview_cv_sha256.
    const attachments = [];
    let cvAttached = false;
    if (candidate.interview_cv_path && candidate.interview_cv_project_id === project_id) {
      const cvBucket = admin.storage().bucket(candidate.interview_cv_bucket || DEFAULT_INTERVIEW_CV_BUCKET);
      const cvFile = cvBucket.file(candidate.interview_cv_path);
      const [cvExists] = await cvFile.exists();
      if (cvExists) {
        const [cvBuffer] = await cvFile.download();
        const sha256 = crypto.createHash("sha256").update(cvBuffer).digest("hex");
        // Tamper-evidence: refuse to disclose an artifact that no longer matches
        // the hash captured at preparation time.
        if (candidate.interview_cv_sha256 && candidate.interview_cv_sha256 !== sha256) {
          return res.status(409).json({ error: "Prepared CV failed integrity check (sha256 mismatch) — not attached. Re-prepare the CV." });
        }
        attachments.push({ filename: "Datalake-Skills-Portfolio.docx", mimeType: DOCX_MIME, data: cvBuffer, sha256 });
        cvAttached = true;
      }
    }

    // ── 4. Recipients: candidate + internal host always; client gated by consent ──
    const internalHost = isEmail(host_email) ? host_email.trim() : profile.email;
    const toList = [...new Set([candidate.email, internalHost].filter(Boolean))];
    const ccRaw = Array.isArray(cc) ? cc : String(cc || "").split(/[,;]/);
    const ccList = [...new Set(ccRaw.map((e) => String(e).trim()).filter(isEmail))];

    const locStr = location || (mode === "online" ? "Online — Microsoft Teams" : `${COMPANY.legal_name_en}, Riyadh`);

    // Subject disambiguator: date only, never names/PII.
    const subjectDate = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Riyadh", day: "2-digit", month: "short", year: "numeric",
    }).format(start);
    const summary = `Interview Invitation — ${subjectDate}`;

    const bodyText = buildInviteBody({ start, durMin, locStr, notes });

    // ── 5. Send via the single gateway (it picks Teams vs .ics, appends footer,
    //       runs the consent gate, writes the fail-closed audit) ──
    let result;
    try {
      result = await sendStandardMessage({
        profileKey: "hr",
        type: "INV",
        subject: summary,
        heading: "Interview Invitation",
        bodyText,
        to: toList,
        cc: ccList,
        gatedClientEmail: clientEmail,           // added ONLY with a consent_basis_ref
        consentBasisRef: consent_basis_ref,
        triggeredBy: profile.email,
        relatedRecord: { collection: "talent_pool", id: candidate_id },
        // NOTE: the CV is NOT attached to the calendar invite — Outlook/Graph
        // events don't deliver attachments to attendees. It goes as a companion
        // email below, through the same consent gate.
        kind: "calendar_invite",
        calendar: {
          startUtc: start,
          endUtc: end,
          startLocal: `${start_datetime}:00`,
          endLocal: addMinutesToLocalString(start_datetime, durMin),
          timeZone: "Asia/Riyadh",
          location: locStr,
          icsDescription: [
            `Interview arranged by ${COMPANY.legal_name_en}.`,
            notes ? `Notes: ${notes}` : "",
          ].filter(Boolean).join("\n"),
          uid: `interview-${candidate_id}-${start.getTime()}@datalake.sa`,
        },
      });
    } catch (gateErr) {
      // Consent gate / unverified-profile failures are client-correctable → 422.
      const msg = String(gateErr.message || gateErr);
      if (/consent|not verified/i.test(msg)) {
        return res.status(422).json({ error: msg });
      }
      throw gateErr;
    }

    const meetingProvider = result.transport === "m365_graph" ? "teams" : "ics";

    // ── 5b. Companion CV email ── Outlook/Graph calendar invites do NOT deliver
    // attachments to attendees, so the prepared Skills Portfolio is sent as a
    // separate gateway email (real attachment) to the SAME recipients, through
    // the SAME consent gate (the CV is the disclosed personal data).
    let cvEmail = { sent: false, message_ref: null, error: null };
    if (cvAttached && attachments.length) {
      try {
        const cvRes = await sendStandardMessage({
          profileKey: "hr",
          type: "CVP",
          subject: `Candidate Skills Portfolio — ${subjectDate}`,
          heading: "Candidate Skills Portfolio",
          bodyText: buildCvEmailBody({ start, joinUrl: result.join_url }),
          to: toList,
          cc: ccList,
          gatedClientEmail: clientEmail,
          consentBasisRef: consent_basis_ref,
          triggeredBy: profile.email,
          relatedRecord: { collection: "talent_pool", id: candidate_id },
          attachments,
          kind: "email",
        });
        cvEmail = { sent: true, message_ref: cvRes.message_ref, error: null };
      } catch (cvErr) {
        // The invite already went out; don't fail the whole request. Surface it.
        console.error("companion CV email failed:", cvErr);
        cvEmail = { sent: false, message_ref: null, error: String(cvErr.message || cvErr) };
      }
    }

    // ── 6. Move candidate to INTERVIEW_SCHEDULED + record ──
    const now = admin.firestore.FieldValue.serverTimestamp();
    await db.collection("talent_pool").doc(candidate_id).update({
      state: "INTERVIEW_SCHEDULED",
      interview_datetime: start.toISOString(),
      interview_duration_minutes: durMin,
      interview_location: locStr,
      interview_meeting_provider: meetingProvider,
      interview_join_url: result.join_url || null,
      interview_invited_to: result.to,
      interview_invited_cc: ccList,
      interview_client_present: result.client_present,
      interview_cv_attached: cvEmail.sent,
      interview_cv_message_ref: cvEmail.message_ref,
      interview_message_ref: result.message_ref,
      interview_invited_by: profile.email,
      interview_invited_at: now,
    });

    await db.collection("task_audit_log").add({
      event: "INTERVIEW_INVITE_SENT",
      action_by: profile.email,
      action_at: now,
      details: {
        candidate_id, candidate_name: candidate.full_name, project_id,
        project_name: project.project_name, client_name: project.client_name,
        start: start.toISOString(), duration_minutes: durMin, location: locStr,
        to: result.to, cc: ccList, pdpl_consent_verified: true,
        client_present: result.client_present, consent_basis_ref: consent_basis_ref || null,
        cv_attached: cvEmail.sent, cv_message_ref: cvEmail.message_ref, cv_email_error: cvEmail.error,
        meeting_provider: meetingProvider, join_url: result.join_url || null,
        message_ref: result.message_ref,
        graph_event_id: result.graph_event_id, gmail_message_id: result.gmail_message_id,
      },
    });

    await writeBigQueryAudit({
      event_type: "INTERVIEW_INVITE_SENT",
      actor: profile.email,
      candidate_id, project_id,
      pdpl_consent_verified: true,
      regulatory_basis: "PDPL Art. 4, 5; NCA ECC-1:2018",
      recipient_email: result.to.join(", "),
      cc: ccList.join(", "),
      interview_start: start.toISOString(),
      meeting_provider: meetingProvider,
      message_ref: result.message_ref,
      client_present: result.client_present,
    });

    return res.status(200).json({
      success: true,
      sent_to: result.to,
      cc: ccList,
      start: start.toISOString(),
      duration_minutes: durMin,
      meeting_provider: meetingProvider,
      join_url: result.join_url || null,
      message_ref: result.message_ref,
      client_present: result.client_present,
      cv_attached: cvEmail.sent,
      cv_message_ref: cvEmail.message_ref,
    });
  } catch (err) {
    console.error("sendInterviewInvite error:", err);
    return res.status(500).json({ error: err.message });
  }
}

// ── Helpers ──

function isEmail(e) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || "").trim()); }

// "2026-06-20T14:30" is Riyadh wall-clock. Build the real UTC instant by taking
// the components as UTC then subtracting the +3 offset.
function parseRiyadhLocal(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(s || ""));
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, 0);
  if (Number.isNaN(asUtc)) return null;
  return new Date(asUtc - RIYADH_OFFSET_MS);
}

// Add minutes to a wall-clock "YYYY-MM-DDTHH:mm" string, returning the same
// local format with seconds (for Graph's start/end dateTime, which carry their
// own timeZone field so no UTC conversion is wanted).
function addMinutesToLocalString(s, minutes) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(s || ""));
  if (!m) return s;
  const [, y, mo, d, h, mi] = m.map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi) + minutes * 60000);
  const p = (n) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}T${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:00`;
}

// Generic, no-names body. The gateway appends the STANDARD_EMAIL_FOOTER (legal
// identity + PDPL block + Ref), so this body carries no legal footer of its own.
function buildInviteBody({ start, durMin, locStr, notes }) {
  const when = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Riyadh", weekday: "long", day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  }).format(start);

  return [
    "Hello,",
    "",
    `You are invited to an interview with ${COMPANY.legal_name_en}.`,
    "",
    `Date & time: ${when} (Riyadh time)`,
    `Duration: ${durMin} minutes`,
    `Location: ${locStr}`,
    notes ? `\nNotes: ${notes}` : "",
    "",
    "Please accept this invitation to confirm your attendance.",
    "",
    "Best regards,",
    "Datalake HR",
  ].filter((l) => l !== null && l !== undefined).join("\n");
}

// Companion CV email body (generic, no names). The gateway appends the standard
// footer. Includes the Teams join link when present so this one email carries
// both the document and the meeting link.
function buildCvEmailBody({ start, joinUrl }) {
  const when = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Riyadh", weekday: "long", day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  }).format(start);

  return [
    "Hello,",
    "",
    "Please find attached the candidate Skills Portfolio for the upcoming interview.",
    "",
    `Interview: ${when} (Riyadh time)`,
    joinUrl ? `Join Microsoft Teams: ${joinUrl}` : null,
    "",
    "This document contains personal data processed under the Saudi Personal Data",
    "Protection Law (PDPL). Please treat it as confidential and do not forward it",
    "without authorisation.",
    "",
    "Best regards,",
    "Datalake HR",
  ].filter((l) => l !== null && l !== undefined).join("\n");
}

module.exports = { handler };
