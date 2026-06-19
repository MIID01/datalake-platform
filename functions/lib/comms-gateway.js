"use strict";

/**
 * comms-gateway.js — Platform Outbound Communications Standard (DTLK-STD-COMMS-001).
 *
 * THE ONLY path that sends platform mail. No function may call getGmailClient,
 * gmail.users.messages.send, sendMail, or createTeamsCalendarEvent directly — they
 * route through sendStandardMessage() here. That makes four things structurally
 * unavoidable on every send:
 *   1. Sender identity  — resolved from the governed profile registry (refuses unverified).
 *   2. Standard footer  — STANDARD_EMAIL_FOOTER with the PDPL block + message Ref.
 *   3. Consent gate     — a client recipient is added ONLY with a consent_basis_ref.
 *   4. Audit record     — append-only outbound_comms_log, written PENDING *before* the
 *                         send (fail-closed: no log write ⇒ no send).
 *
 * ZATCA carve-out: this gateway has NO fiscal message type. A send flagged fiscal
 * throws — tax invoices route only through the EGS/FATOORA pipeline (invoicing.js),
 * never a shared code path.
 */

const crypto = require("crypto");
const admin = require("firebase-admin");

const { resolveSenderProfile } = require("./comms-profiles");
const { STANDARD_EMAIL_FOOTER } = require("./company-legal");
const { isGraphConfigured, createTeamsCalendarEvent } = require("./msgraph");
const { getGmailClient } = require("./gmail");
const { buildIcs, buildRawWithIcs, mimeEncodeSubject } = require("./ics");
const { renderBrandedEmail } = require("./email-template");

// Tax/fiscal types are forbidden here — they belong to the FATOORA/EGS pipeline.
const FISCAL_TYPES = new Set(["TAXINV", "ZATCA", "FATOORA", "CREDITNOTE", "DEBITNOTE", "EINVOICE"]);

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const isEmail = (e) => EMAIL_RE.test(String(e || "").trim());

// YYYYMMDD in Riyadh (the business day) for the message ref.
function riyadhYmd(d) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d).replace(/-/g, "");
}

function makeMessageRef(type) {
  const id = crypto.randomBytes(3).toString("hex"); // 6 hex chars
  return `DLK-${String(type).toUpperCase()}-${riyadhYmd(new Date())}-${id}`;
}

// Minimal multipart/alternative raw for the plain-email kind, honouring the
// profile's From + Reply-To, with the branded HTML alternative.
// (Calendar invites use buildRawWithIcs instead.)
function buildPlainEmailRaw({ from, replyTo, to, cc, subject, bodyText, bodyHtml, attachments }) {
  const alt = "alt_" + Date.now().toString(16);
  const ccHeader = Array.isArray(cc) && cc.length ? [`Cc: ${cc.join(", ")}`] : [];
  const files = Array.isArray(attachments) ? attachments : [];

  const altBlock = [
    `--${alt}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    bodyText,
    "",
    `--${alt}`,
    'Content-Type: text/html; charset="UTF-8"',
    "",
    bodyHtml,
    "",
    `--${alt}--`,
  ];

  let lines;
  if (files.length) {
    // multipart/mixed → [ alternative , attachments… ]
    const mixed = "mixed_" + Date.now().toString(16);
    const fileParts = files.flatMap((a) => [
      `--${mixed}`,
      `Content-Type: ${a.mimeType}; name="${a.filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${a.filename}"`,
      "",
      (Buffer.isBuffer(a.data) ? a.data : Buffer.from(a.data, "base64")).toString("base64"),
      "",
    ]);
    lines = [
      `From: ${from}`, `Reply-To: ${replyTo}`, `To: ${to}`, ...ccHeader,
      `Subject: ${mimeEncodeSubject(subject)}`, "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${mixed}"`, "",
      `--${mixed}`,
      `Content-Type: multipart/alternative; boundary="${alt}"`, "",
      ...altBlock, "",
      ...fileParts,
      `--${mixed}--`,
    ];
  } else {
    lines = [
      `From: ${from}`, `Reply-To: ${replyTo}`, `To: ${to}`, ...ccHeader,
      `Subject: ${mimeEncodeSubject(subject)}`, "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary="${alt}"`, "",
      ...altBlock,
    ];
  }
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}

// Best-effort append-only BigQuery mirror. Firestore outbound_comms_log is the
// authoritative immutable log; this mirror is non-blocking (table may need DDL).
async function mirrorToBigQuery(row) {
  try {
    const { BigQuery } = require("@google-cloud/bigquery");
    const bq = new BigQuery({ projectId: "datalake-production-sa", location: "me-central2" });
    await bq.dataset("datalake_audit").table("outbound_comms_log").insert(
      [{ ...row, mirrored_at: new Date().toISOString() }],
      { ignoreUnknownValues: true },
    );
  } catch (err) {
    console.warn("[comms-gateway] BigQuery mirror failed (non-blocking):", err.message);
  }
}

/**
 * sendStandardMessage — the single send path.
 *
 * @param {object} o
 * @param {string}   o.profileKey       sender profile key (must be verified) — e.g. "hr"
 * @param {string}   o.type             short type code for the ref/audit — e.g. "INV"
 * @param {string}   o.subject          subject / meeting title (no PII recommended)
 * @param {string}   o.bodyText         message body WITHOUT footer (gateway appends it)
 * @param {string[]} o.to               always-send recipients (e.g. candidate + internal host)
 * @param {string[]} [o.cc]             optional CC
 * @param {string}   [o.gatedClientEmail]  client recipient — added ONLY with a consent ref
 * @param {string}   [o.consentBasisRef]   pointer to the consent-to-client-disclosure record
 * @param {string}   o.triggeredBy      actor email (who triggered the send)
 * @param {object}   [o.relatedRecord]  { collection, id } pointer to the source record
 * @param {boolean}  [o.fiscal]         set true for tax docs → throws (ZATCA carve-out)
 * @param {"email"|"calendar_invite"} [o.kind]  default "email"
 * @param {object}   [o.calendar]       required for calendar_invite:
 *        { startUtc:Date, endUtc:Date, startLocal:str, endLocal:str, timeZone:str,
 *          location:str, icsDescription:str, uid:str }
 * @returns {Promise<object>} { message_ref, status, transport, to, client_present, join_url, graph_event_id, gmail_message_id }
 */
async function sendStandardMessage(o) {
  const {
    profileKey, type, subject, bodyText, to = [], cc = [],
    gatedClientEmail, consentBasisRef, triggeredBy, relatedRecord = null,
    fiscal = false, kind = "email", calendar = null, heading = null,
    attachments = [],
  } = o || {};

  // ── 0. ZATCA carve-out (before anything else) ──
  if (fiscal === true || FISCAL_TYPES.has(String(type).toUpperCase())) {
    throw new Error(
      "Fiscal/tax documents must NOT route through the comms gateway. " +
      "Tax invoices are emitted only by the EGS/FATOORA pipeline (invoicing.js)."
    );
  }

  // ── 1. Resolve sender identity (fail-closed on unverified) ──
  const profile = resolveSenderProfile(profileKey);
  const from = `${profile.displayName} <${profile.mailbox}>`;

  // ── 2. Validate inputs ──
  if (!type) throw new Error("sendStandardMessage: type is required");
  if (!subject) throw new Error("sendStandardMessage: subject is required");
  if (!bodyText) throw new Error("sendStandardMessage: bodyText is required");
  if (!triggeredBy) throw new Error("sendStandardMessage: triggeredBy is required");
  const baseTo = [...new Set((to || []).map((e) => String(e).trim()).filter(isEmail))];
  if (!baseTo.length && !gatedClientEmail) throw new Error("sendStandardMessage: no valid recipients");
  const ccList = [...new Set((cc || []).map((e) => String(e).trim()).filter(isEmail))];

  // ── 3. PDPL consent gate ── a client recipient is disclosed candidate data,
  // so it is added ONLY when a consent_basis_ref is present. No bypass.
  let clientPresent = false;
  let consentRef = null;
  const recipients = [...baseTo];
  if (gatedClientEmail) {
    const client = String(gatedClientEmail).trim();
    if (!isEmail(client)) throw new Error("sendStandardMessage: gatedClientEmail is not a valid email");
    if (!consentBasisRef || !String(consentBasisRef).trim()) {
      throw new Error(
        "candidate consent to client disclosure required: a consent_basis_ref must be supplied " +
        "before a client recipient can be added. Capture consent — do not bypass the gate."
      );
    }
    clientPresent = true;
    consentRef = String(consentBasisRef).trim();
    if (!recipients.includes(client)) recipients.push(client);
  }
  if (!recipients.length) throw new Error("sendStandardMessage: no recipients after consent gate");

  // ── 4. Message ref + bodies (plain + branded HTML) with the standard footer ──
  const messageRef = makeMessageRef(type);
  const footerText = STANDARD_EMAIL_FOOTER({ messageRef, teamLabel: profile.teamLabel });
  const plainBody = `${bodyText}\n\n${footerText}`;
  const htmlBody = renderBrandedEmail({ heading: heading || subject, bodyText, footerText });

  // ── 5. Choose transport ──
  const isCalendar = kind === "calendar_invite";
  const transport = isGraphConfigured() && isCalendar ? "m365_graph" : "google";
  if (isCalendar && !calendar) throw new Error("sendStandardMessage: calendar_invite requires a calendar object");

  // ── 6. Fail-closed audit: write PENDING *before* sending ──
  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const auditBase = {
    message_ref: messageRef,
    type: String(type).toUpperCase(),
    transport,
    profile_key: profile.key,
    from_mailbox: profile.mailbox,
    to: recipients,
    attendees: isCalendar ? recipients : [],
    client_present: clientPresent,
    subject,
    related_record: relatedRecord,
    graph_event_id: null,
    consent_basis_ref: consentRef,
    triggered_by: triggeredBy,
    // Attachment metadata only — never the file bytes. Records WHAT personal
    // data was disclosed (filename + sha256 + size) for the PDPL trail.
    attachments: (attachments || []).map((a) => ({
      filename: a.filename,
      mime_type: a.mimeType,
      bytes: Buffer.isBuffer(a.data) ? a.data.length : null,
      sha256: a.sha256 || null,
    })),
    status: "pending",
    error: null,
    created_at: now,
    sent_at: null,
    // Hard rule (DTLK-STD-COMMS-001): NO ip_address, NO user_agent in this log.
  };
  try {
    await db.collection("outbound_comms_log").doc(messageRef).set(auditBase);
  } catch (err) {
    // The pending record could not be written → abort. A sent email cannot be
    // un-sent, so we never send without an immutable log entry.
    throw new Error(`comms audit pre-write failed — send aborted (no log, no send): ${err.message}`);
  }
  mirrorToBigQuery({ ...auditBase, created_at: new Date().toISOString(), sent_at: null });

  // ── 7. Send ──
  let graphEventId = null, joinUrl = null, gmailMessageId = null;
  try {
    if (isCalendar && transport === "m365_graph") {
      const result = await createTeamsCalendarEvent({
        organizer: profile.mailbox,
        subject,
        bodyHtml: htmlBody,
        startLocal: calendar.startLocal,
        endLocal: calendar.endLocal,
        timeZone: calendar.timeZone,
        location: calendar.location,
        attendees: [
          ...recipients.map((e) => ({ email: e, optional: false })),
          ...ccList.map((e) => ({ email: e, optional: true })),
        ],
        attachments,
      });
      graphEventId = result.id;
      joinUrl = result.joinUrl;
    } else if (isCalendar) {
      // Google .ics fallback transport.
      const ics = buildIcs({
        uid: calendar.uid || `${messageRef}@datalake.sa`,
        start: calendar.startUtc,
        end: calendar.endUtc,
        summary: subject,
        description: calendar.icsDescription || subject,
        location: calendar.location,
        organizerName: profile.displayName,
        organizerEmail: profile.mailbox,
        attendees: recipients,
      });
      const raw = buildRawWithIcs({ from, to: recipients.join(", "), cc: ccList, subject, bodyText: plainBody, bodyHtml: htmlBody, ics, attachments });
      const gmail = await getGmailClient();
      const sendResult = await gmail.users.messages.send({ userId: profile.mailbox, requestBody: { raw } });
      gmailMessageId = sendResult.data.id;
    } else {
      // Plain email kind.
      const raw = buildPlainEmailRaw({ from, replyTo: profile.mailbox, to: recipients.join(", "), cc: ccList, subject, bodyText: plainBody, bodyHtml: htmlBody, attachments });
      const gmail = await getGmailClient();
      const sendResult = await gmail.users.messages.send({ userId: profile.mailbox, requestBody: { raw } });
      gmailMessageId = sendResult.data.id;
    }
  } catch (err) {
    // Send failed → mark the (already-immutable) record failed and rethrow.
    await db.collection("outbound_comms_log").doc(messageRef).update({
      status: "failed", error: String(err.message || err), sent_at: admin.firestore.FieldValue.serverTimestamp(),
    }).catch(() => {});
    mirrorToBigQuery({ ...auditBase, status: "failed", error: String(err.message || err), created_at: new Date().toISOString(), sent_at: new Date().toISOString() });
    throw err;
  }

  // ── 8. Mark sent ──
  const sentPatch = {
    status: "sent",
    sent_at: admin.firestore.FieldValue.serverTimestamp(),
    graph_event_id: graphEventId,
    gmail_message_id: gmailMessageId || null,
    join_url: joinUrl || null,
  };
  await db.collection("outbound_comms_log").doc(messageRef).update(sentPatch).catch((err) => {
    console.warn("[comms-gateway] sent-status update failed (mail already sent):", err.message);
  });
  mirrorToBigQuery({ ...auditBase, status: "sent", graph_event_id: graphEventId, created_at: new Date().toISOString(), sent_at: new Date().toISOString() });

  return {
    message_ref: messageRef,
    status: "sent",
    transport,
    to: recipients,
    client_present: clientPresent,
    join_url: joinUrl,
    graph_event_id: graphEventId,
    gmail_message_id: gmailMessageId,
  };
}

module.exports = { sendStandardMessage, FISCAL_TYPES };
