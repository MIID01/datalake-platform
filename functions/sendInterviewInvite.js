/**
 * sendInterviewInvite — Cloud Function (onRequest)
 *
 * HR/CEO: schedule a candidate interview and email a REAL calendar invite
 * (.ics, METHOD:REQUEST) with date + time to the client approver AND the
 * candidate, plus any CC. Moves the candidate to INTERVIEW_SCHEDULED.
 *
 * Times are entered as Riyadh wall-clock (Asia/Riyadh is a fixed UTC+3, no DST)
 * and emitted to the .ics in UTC. Reuses the canonical Workspace domain-wide-
 * delegation Gmail client (functions/lib/gmail.js).
 *
 * Auth: role must be "hr" or "ceo".  PDPL: blocks PURGED / no-consent candidates.
 */

const admin = require("firebase-admin");
const { getGmailClient } = require("./lib/gmail");
const { COMPANY, LEGAL_EMAIL_FOOTER } = require("./lib/company-legal");
const { writeBigQueryAudit } = require("./prepareInterviewCV");
const { isGraphConfigured, createTeamsCalendarEvent } = require("./lib/msgraph");

const db = admin.firestore();
const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000; // Asia/Riyadh = UTC+3, no DST.

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

    const { candidate_id, project_id, start_datetime, duration_minutes, location, mode, cc, notes } = req.body;
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
    const clientEmail = project.client_approver_email || null;

    // ── 4. Recipients: candidate + client approver + CC ──
    const ccRaw = Array.isArray(cc) ? cc : String(cc || "").split(/[,;]/);
    const ccList = [...new Set(ccRaw.map((e) => String(e).trim()).filter(isEmail))];
    const toList = [...new Set([candidate.email, clientEmail].filter(Boolean))];

    const locStr = location || (mode === "online" ? "Online — meeting link to follow" : `${COMPANY.legal_name_en}, Riyadh`);
    const summary = `Interview Invitation — ${COMPANY.legal_name_en}`;

    // Prepared Skills Portfolio CV — the CANONICAL artifact from prepareInterviewCV
    // (talent_pool.interview_cv_path). Auto-attached so HR never hand-attaches it.
    const cvAttachment = await loadPreparedCv(candidate);

    // ── 5. Create the meeting + send the invite ──
    // Full-Outlook path: when M365/Graph is configured, create the event on the
    // organizer's mailbox — Outlook auto-sends the invite to attendees and Teams
    // mints the join link. Otherwise fall back to the Google .ics path so the
    // feature still works before M365 is wired up.
    const bodyText = buildInviteBody({ start, durMin, locStr, notes, isTeams: isGraphConfigured() });
    let meetingProvider, joinUrl = null, graphEventId = null, gmailMessageId = null;

    if (isGraphConfigured()) {
      meetingProvider = "teams";
      const startLocal = `${start_datetime}:00`;
      const endLocal = addMinutesToLocalString(start_datetime, durMin);
      const result = await createTeamsCalendarEvent({
        organizer: process.env.MS_INTERVIEW_ORGANIZER,
        subject: summary,
        bodyHtml: bodyText.replace(/\n/g, "<br>"),
        startLocal, endLocal, timeZone: "Asia/Riyadh",
        location: locStr,
        attendees: [
          ...toList.map((e) => ({ email: e, optional: false })),
          ...ccList.map((e) => ({ email: e, optional: true })),
        ],
        attachments: cvAttachment
          ? [{ name: cvAttachment.filename, contentType: cvAttachment.contentType, contentBytes: cvAttachment.buffer.toString("base64") }]
          : [],
      });
      joinUrl = result.joinUrl;
      graphEventId = result.id;
    } else {
      meetingProvider = "ics";
      const ics = buildIcs({
        uid: `interview-${candidate_id}-${start.getTime()}@datalake.sa`,
        start, end, summary,
        description: [
          `Interview for ${candidate.full_name}${candidate.role_interest ? " (" + candidate.role_interest + ")" : ""}.`,
          `Client: ${project.client_name || ""}  |  Project: ${project.project_name || ""}`,
          notes ? `Notes: ${notes}` : "",
          `Arranged by Datalake Saudi Arabia LLC.`,
        ].filter(Boolean).join("\n"),
        location: locStr,
        organizerName: "Datalake HR", organizerEmail: "hr@datalake.sa",
        attendees: toList,
      });
      const gmail = await getGmailClient();
      const raw = buildRawWithIcs({
        from: "Datalake HR <hr@datalake.sa>",
        to: toList.join(", "),
        cc: ccList,
        subject: summary,
        bodyText,
        ics,
        attachment: cvAttachment,
      });
      const sendResult = await gmail.users.messages.send({ userId: "hr@datalake.sa", requestBody: { raw } });
      gmailMessageId = sendResult.data.id;
    }

    // ── 6. Move candidate to INTERVIEW_SCHEDULED + record ──
    const now = admin.firestore.FieldValue.serverTimestamp();
    await db.collection("talent_pool").doc(candidate_id).update({
      state: "INTERVIEW_SCHEDULED",
      interview_datetime: start.toISOString(),
      interview_duration_minutes: durMin,
      interview_location: locStr,
      interview_meeting_provider: meetingProvider,
      interview_join_url: joinUrl,
      interview_invited_to: toList,
      interview_invited_cc: ccList,
      interview_invited_by: profile.email,
      interview_invited_at: now,
      interview_cv_attached: !!cvAttachment,
    });

    await db.collection("task_audit_log").add({
      event: "INTERVIEW_INVITE_SENT",
      action_by: profile.email,
      action_at: now,
      details: {
        candidate_id, candidate_name: candidate.full_name, project_id,
        project_name: project.project_name, client_name: project.client_name,
        start: start.toISOString(), duration_minutes: durMin, location: locStr,
        to: toList, cc: ccList, pdpl_consent_verified: true,
        meeting_provider: meetingProvider, join_url: joinUrl,
        graph_event_id: graphEventId, gmail_message_id: gmailMessageId,
      },
    });

    await writeBigQueryAudit({
      event_type: "INTERVIEW_INVITE_SENT",
      actor: profile.email,
      candidate_id, project_id,
      pdpl_consent_verified: true,
      regulatory_basis: "PDPL Art. 4, 5; NCA ECC-1:2018",
      recipient_email: toList.join(", "),
      cc: ccList.join(", "),
      interview_start: start.toISOString(),
      meeting_provider: meetingProvider,
      gmail_message_id: gmailMessageId,
    });

    return res.status(200).json({
      success: true,
      sent_to: toList,
      cc: ccList,
      start: start.toISOString(),
      duration_minutes: durMin,
      meeting_provider: meetingProvider,
      join_url: joinUrl,
      gmail_message_id: gmailMessageId,
    });
  } catch (err) {
    console.error("sendInterviewInvite error:", err);
    return res.status(500).json({ error: err.message });
  }
}

// ── Helpers ──

function isEmail(e) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e); }

// Load the candidate's prepared Skills Portfolio CV — the CANONICAL artifact from
// prepareInterviewCV (talent_pool.interview_cv_path, erasable bucket per PDPL). Used
// to auto-attach it to the invite. Returns null if none prepared / on read error so
// the invite still sends.
async function loadPreparedCv(candidate) {
  const cvPath = candidate.interview_cv_path || candidate.portfolio_path;
  if (!cvPath) return null;
  try {
    const bucketName = candidate.interview_cv_bucket || candidate.portfolio_bucket || "datalake-production-sa.firebasestorage.app";
    const file = admin.storage().bucket(bucketName).file(cvPath);
    const [exists] = await file.exists();
    if (!exists) return null;
    const [buffer] = await file.download();
    const safeName = String(candidate.full_name || "candidate").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    return {
      buffer,
      filename: `DTLK-FORM-HR-CV-002_${safeName}.docx`,
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
  } catch (e) {
    console.warn("loadPreparedCv failed (invite will send without attachment):", e.message);
    return null;
  }
}

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

// UTC stamp for .ics: 20260620T113000Z
function icsStampUtc(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

// RFC 5545 text escaping.
function icsEscape(s) {
  return String(s || "").replace(/[\\;,]/g, (c) => "\\" + c).replace(/\n/g, "\\n");
}

function buildIcs({ uid, start, end, summary, description, location, organizerName, organizerEmail, attendees }) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Datalake Saudi Arabia LLC//Recruitment//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${icsStampUtc(new Date())}`,
    `DTSTART:${icsStampUtc(start)}`,
    `DTEND:${icsStampUtc(end)}`,
    `SUMMARY:${icsEscape(summary)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    `LOCATION:${icsEscape(location)}`,
    `ORGANIZER;CN=${icsEscape(organizerName)}:mailto:${organizerEmail}`,
    ...attendees.map((e) => `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${e}`),
    "STATUS:CONFIRMED",
    "SEQUENCE:0",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n");
}

function buildInviteBody({ start, durMin, locStr, notes, isTeams }) {
  // Human-readable Riyadh local time for the body.
  const when = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Riyadh", weekday: "long", day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  }).format(start);

  // Teams path: the meeting itself carries the join link, so don't claim an
  // attachment. .ics path: a calendar file is attached.
  const confirmLine = isTeams
    ? "Please accept this invitation to confirm your attendance. The meeting join details are included above."
    : "A calendar invitation is attached — please Accept to confirm your attendance.";

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
    confirmLine,
    "",
    "Best regards,",
    "Datalake HR Team",
    "hr@datalake.sa",
    "",
    LEGAL_EMAIL_FOOTER,
  ].filter((l) => l !== null && l !== undefined).join("\n");
}

function mimeEncodeSubject(s) {
  const str = String(s || "");
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(str)) return str;
  return "=?UTF-8?B?" + Buffer.from(str, "utf8").toString("base64") + "?=";
}

// multipart/mixed → [ alternative(text + inline calendar) , .ics attachment ]
function buildRawWithIcs({ from, to, cc, subject, bodyText, ics, attachment }) {
  const mixed = `mixed_${Date.now().toString(16)}`;
  const alt = `alt_${Date.now().toString(16)}`;
  const ccHeader = Array.isArray(cc) && cc.length ? [`Cc: ${cc.join(", ")}`] : [];
  const icsB64 = Buffer.from(ics, "utf8").toString("base64");

  const msg = [
    `From: ${from}`,
    `To: ${to}`,
    ...ccHeader,
    `Subject: ${mimeEncodeSubject(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    "",
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    "",
    `--${alt}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    bodyText,
    "",
    `--${alt}`,
    'Content-Type: text/calendar; charset="UTF-8"; method=REQUEST; component=VEVENT',
    "Content-Transfer-Encoding: base64",
    "",
    icsB64,
    "",
    `--${alt}--`,
    "",
    `--${mixed}`,
    'Content-Type: application/ics; name="interview.ics"',
    "Content-Transfer-Encoding: base64",
    'Content-Disposition: attachment; filename="interview.ics"',
    "",
    icsB64,
    "",
    // Prepared Skills Portfolio CV (DTLK-FORM-HR-CV-002), if one is prepared.
    ...(attachment ? [
      `--${mixed}`,
      `Content-Type: ${attachment.contentType}; name="${attachment.filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${attachment.filename}"`,
      "",
      attachment.buffer.toString("base64"),
      "",
    ] : []),
    `--${mixed}--`,
  ].join("\r\n");

  return Buffer.from(msg).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

module.exports = { handler };
