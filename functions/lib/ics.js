"use strict";

/**
 * ics.js — RFC 5545 calendar (.ics) + MIME assembly for the Google/.ics transport.
 *
 * Extracted from sendInterviewInvite.js so the comms gateway (lib/comms-gateway.js)
 * is the single owner of the .ics send path. No function should build a calendar
 * email outside the gateway.
 */

// UTC stamp for .ics: 20260620T113000Z
function icsStampUtc(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

// RFC 5545 text escaping.
function icsEscape(s) {
  return String(s || "").replace(/[\\;,]/g, (c) => "\\" + c).replace(/\n/g, "\\n");
}

// RFC 2047 subject encoding for any non-ASCII bytes.
function mimeEncodeSubject(s) {
  const str = String(s || "");
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(str)) return str;
  return "=?UTF-8?B?" + Buffer.from(str, "utf8").toString("base64") + "?=";
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

// multipart/mixed → [ alternative(text + branded html + inline calendar) , .ics attachment , file attachments… ]
function buildRawWithIcs({ from, to, cc, subject, bodyText, bodyHtml, ics, attachments }) {
  const mixed = `mixed_${Date.now().toString(16)}`;
  const alt = `alt_${Date.now().toString(16)}`;
  const ccHeader = Array.isArray(cc) && cc.length ? [`Cc: ${cc.join(", ")}`] : [];
  const icsB64 = Buffer.from(ics, "utf8").toString("base64");
  const htmlB64 = bodyHtml ? Buffer.from(bodyHtml, "utf8").toString("base64") : null;

  const htmlPart = htmlB64 ? [
    `--${alt}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    htmlB64,
    "",
  ] : [];

  // Extra file attachments (e.g. the prepared CV), each a multipart/mixed part.
  const fileParts = (Array.isArray(attachments) ? attachments : []).flatMap((a) => [
    `--${mixed}`,
    `Content-Type: ${a.mimeType}; name="${a.filename}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${a.filename}"`,
    "",
    (Buffer.isBuffer(a.data) ? a.data : Buffer.from(a.data, "base64")).toString("base64"),
    "",
  ]);

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
    ...htmlPart,
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
    ...fileParts,
    `--${mixed}--`,
  ].join("\r\n");

  return Buffer.from(msg).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

module.exports = { icsStampUtc, icsEscape, mimeEncodeSubject, buildIcs, buildRawWithIcs };
