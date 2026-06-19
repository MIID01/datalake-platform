"use strict";

// Backend mirror of src/lib/company-legal.js — the single source of truth for
// Datalake's legal/commercial details on the server side (PDF exports, the GRC
// DOCX export, and transactional emails). Functions cannot import the frontend
// (src/) module, so this CommonJS copy must be kept VERBATIM in sync with it.
//
// LEGAL_FOOTER_EN is CEO-locked — do not reword per-file.

const COMPANY = {
  legal_name_en: "Datalake Saudi Arabia LLC",
  legal_name_ar: "شركة بحيرة البيانات للاستشارات في مجال الاتصالات وتقنية المعلومات",
  entity_type_en: "Limited Liability Company (LLC)",
  cr_number: "1009194773",
  nun: "7048904952", // National Unified Number — shown as "Unified Number"
  mol_number: null, // Ministry of Labour establishment number for WPS/SIF. MUST be
  // set to the real value before WPS files can be generated — never a placeholder.
  street: "Rajiyah Street",
  district: "Al Yarmuk District",
  city: "Riyadh",
  postal_code: "13243",
  country: "Kingdom of Saudi Arabia",
  domain: "datalake.sa",
};

// Canonical single-line footer for PDFs / letterhead / DOCX.
const LEGAL_FOOTER_EN =
  `${COMPANY.legal_name_en} · ${COMPANY.street}, ${COMPANY.district}, ${COMPANY.city} ${COMPANY.postal_code}, ${COMPANY.country} · CR ${COMPANY.cr_number} · Unified Number ${COMPANY.nun}`;

// Email footer = canonical line + website (kept as one source so emails never
// carry a hand-typed legal string).
const LEGAL_EMAIL_FOOTER = `${LEGAL_FOOTER_EN} · www.${COMPANY.domain}`;

module.exports = { COMPANY, LEGAL_FOOTER_EN, LEGAL_EMAIL_FOOTER };
