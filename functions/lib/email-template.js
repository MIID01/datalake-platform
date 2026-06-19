"use strict";

/**
 * email-template.js — the one branded HTML skin for every gateway-sent message
 * (DTLK-STD-COMMS-001). Centralised so "on-brand" is structural, not per-feature.
 *
 * Email-client-safe: table layout + inline styles only, web-safe fonts, no
 * external CSS/JS. Design tokens mirror the platform design system.
 */

const { COMPANY } = require("./company-legal");

const BRAND = {
  navy: "#022873",
  sky: "#1598CC",
  orange: "#EF5829",
  bg: "#F4F6F9",
  card: "#FFFFFF",
  border: "#E5E7EB",
  text: "#1F2937",
  muted: "#6B7280",
};

// Hosted white logo (PNG — email-client-safe; SVG is stripped by Gmail/Outlook).
// Served from Firebase Hosting public root. alt falls back to the company name
// when a client blocks images.
const LOGO_URL = "https://datalake-production-sa.web.app/logo-white.png";

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Render one plain-text block into HTML: blank lines become spacing, and
// "Label: value" lines get a bold label. No names are added — content in, content out.
function renderLines(text, { color, size }) {
  const lines = String(text || "").split("\n");
  return lines.map((line) => {
    if (line.trim() === "") return '<div style="height:10px;line-height:10px;">&nbsp;</div>';
    const m = /^(\s*[^:]{1,40}:)(\s.*)$/.exec(line);
    const inner = m
      ? `<strong style="color:${BRAND.navy};">${esc(m[1])}</strong>${esc(m[2])}`
      : esc(line);
    return `<div style="margin:0 0 2px 0;color:${color};font-size:${size}px;line-height:1.6;">${inner}</div>`;
  }).join("");
}

/**
 * renderBrandedEmail — wrap a message + standard footer in the branded shell.
 * @param {object} o
 * @param {string} o.heading     headline shown in the navy header (e.g. "Interview Invitation")
 * @param {string} o.bodyText    the message body WITHOUT footer (plain text; newlines preserved)
 * @param {string} o.footerText  the STANDARD_EMAIL_FOOTER plain text (rendered small/muted)
 * @returns {string} full HTML document
 */
function renderBrandedEmail({ heading, bodyText, footerText }) {
  const brandMark = esc(COMPANY.legal_name_en);
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${BRAND.bg};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};padding:24px 0;font-family:'DM Sans',Arial,Helvetica,sans-serif;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:${BRAND.card};border:1px solid ${BRAND.border};border-radius:10px;overflow:hidden;">
      <!-- header -->
      <tr><td style="background:${BRAND.navy};padding:20px 28px;">
        <img src="${LOGO_URL}" alt="${brandMark}" height="34" style="height:34px;width:auto;display:block;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;" />
        <div style="height:3px;width:46px;background:${BRAND.sky};margin-top:12px;border-radius:2px;"></div>
      </td></tr>
      <!-- heading -->
      <tr><td style="padding:26px 28px 4px 28px;">
        <h1 style="margin:0;color:${BRAND.navy};font-size:22px;font-weight:700;">${esc(heading || "")}</h1>
      </td></tr>
      <!-- body -->
      <tr><td style="padding:8px 28px 24px 28px;">
        ${renderLines(bodyText, { color: BRAND.text, size: 15 })}
      </td></tr>
      <!-- divider -->
      <tr><td style="padding:0 28px;"><div style="border-top:1px solid ${BRAND.border};"></div></td></tr>
      <!-- footer -->
      <tr><td style="padding:18px 28px 24px 28px;background:#FBFCFD;">
        ${renderLines(footerText, { color: BRAND.muted, size: 12 })}
      </td></tr>
    </table>
    <div style="color:${BRAND.muted};font-size:11px;margin-top:14px;font-family:'DM Sans',Arial,sans-serif;">${brandMark}</div>
  </td></tr>
</table>
</body></html>`;
}

module.exports = { renderBrandedEmail, BRAND };
