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
const { LEGAL_EMAIL_FOOTER } = require("./lib/company-legal");

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
    const clientName = project.client_approver_name || project.client_name || "Client";

    // ── 4. Recipients: candidate + client approver + CC ──
    const ccRaw = Array.isArray(cc) ? cc : String(cc || "").split(/[,;]/);
    const ccList = [...new Set(ccRaw.map((e) => String(e).trim()).filter(isEmail))];
    const toList = [...new Set([candidate.email, clientEmail].filter(Boolean))];

    const locStr = location || (mode === "online" ? "Online — meeting link to follow" : "Datalake Saudi Arabia LLC, Riyadh");
    const summary = `Interview: ${candidate.full_name} — ${project.project_name || project.client_name || ""}`.trim();

    // ── 5. Build the .ics invite ──
    const ics = buildIcs({
      uid: `interview-${candidate_id}-${start.getTime()}@datalake.sa`,
      start, end,
      summary,
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

    // ── 6. Send via Gmail (DWD as hr@datalake.sa) with .ics ──
    const gmail = await getGmailClient();
    const bodyText = buildInviteBody({ candidate, project, start, durMin, locStr, clientName, notes });
    const raw = buildRawWithIcs({
      from: "Datalake HR <hr@datalake.sa>",
      to: toList.join(", "),
      cc: ccList,
      subject: summary,
      bodyText,
      ics,
    });
    const sendResult = await gmail.users.messages.send({ userId: "hr@datalake.sa", requestBody: { raw } });
    const gmailMessageId = sendResult.data.id;

    // ── 7. Move candidate to INTERVIEW_SCHEDULED + record ──
    const now = admin.firestore.FieldValue.serverTimestamp();
    await db.collection("talent_pool").doc(candidate_id).update({
      state: "INTERVIEW_SCHEDULED",
      interview_datetime: start.toISOString(),
      interview_duration_minutes: durMin,
      interview_location: locStr,
      interview_invited_to: toList,
      interview_invited_cc: ccList,
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
        to: toList, cc: ccList, gmail_message_id: gmailMessageId,
      },
    });

    return res.status(200).json({
      success: true,
      sent_to: toList,
      cc: ccList,
      start: start.toISOString(),
      duration_minutes: durMin,
      gmail_message_id: gmailMessageId,
    });
  } catch (err) {
    console.error("sendInterviewInvite error:", err);
    return res.status(500).json({ error: err.message });
  }
}

// ── Helpers ──

function isEmail(e) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e); }

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

function buildInviteBody({ candidate, project, start, durMin, locStr, clientName, notes }) {
  // Human-readable Riyadh local time for the body.
  const when = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Riyadh", weekday: "long", day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  }).format(start);

  return [
    `Dear ${candidate.full_name} and ${clientName},`,
    "",
    `This is to confirm an interview for the ${project.project_name || project.client_name || "engagement"}.`,
    "",
    `Candidate: ${candidate.full_name}${candidate.role_interest ? " — " + candidate.role_interest : ""}`,
    `Date & time: ${when} (Riyadh time)`,
    `Duration: ${durMin} minutes`,
    `Location: ${locStr}`,
    notes ? `\nNotes: ${notes}` : "",
    "",
    "A calendar invitation is attached — please Accept to confirm.",
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
function buildRawWithIcs({ from, to, cc, subject, bodyText, ics }) {
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
    `--${mixed}--`,
  ].join("\r\n");

  return Buffer.from(msg).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

module.exports = { handler };
