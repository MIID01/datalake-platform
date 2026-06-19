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

// Canonical multi-line postal address, built from governed COMPANY fields.
// NOTE: no building number is held in the canonical record. The Outbound Comms
// Standard footer draft referenced "Building 7822" — that is NOT yet in this
// governed source, so it is intentionally omitted. To add it, introduce a
// governed COMPANY.building field (and mirror it to the frontend copy) rather
// than hardcoding it into the footer string.
const POSTAL_ADDRESS_EN =
  `${COMPANY.street}, ${COMPANY.district}, ${COMPANY.city} ${COMPANY.postal_code}, ${COMPANY.country}`;

const DPO_CONTACT = `DPO@${COMPANY.domain}`;

/**
 * STANDARD_EMAIL_FOOTER — the authoritative (English) footer block for every
 * platform-sent message that routes through the comms gateway (DTLK-STD-COMMS-001).
 * English is authoritative. All legal identity is pulled from the governed COMPANY
 * object — never hand-typed.
 *
 * @param {object} o
 * @param {string} o.messageRef  unique outbound message ref (e.g. DLK-INV-20260620-a1b2c3)
 * @param {string} o.teamLabel   monitored team that replies route to (e.g. "HR")
 */
function STANDARD_EMAIL_FOOTER({ messageRef, teamLabel }) {
  const team = teamLabel || "team";
  const ref = messageRef || "(unassigned)";
  return [
    `This message was sent automatically by the Datalake platform. You may reply to this`,
    `email — replies reach our ${team} team and are monitored.`,
    ``,
    `${COMPANY.legal_name_en} · CR ${COMPANY.cr_number} · Unified Number ${COMPANY.nun}`,
    POSTAL_ADDRESS_EN,
    ``,
    `Your personal data is processed in line with the Saudi Personal Data Protection Law`,
    `(PDPL) and our Privacy Policy. To exercise your data rights or raise a privacy query,`,
    `contact ${DPO_CONTACT}.`,
    ``,
    `This email and any attachments are confidential and intended only for the named`,
    `recipient. If received in error, please delete it and notify the sender.`,
    ``,
    `Ref: ${ref}`,
  ].join("\n");
}

// ARABIC — DRAFT, REQUIRES NATIVE/LEGAL REVIEW.
// NOT wired into live sends: an unreviewed translation must not reach recipients
// as if official (No-Fabricated-Data). Uses ONLY the canonical Arabic legal name
// (COMPANY.legal_name_ar). The Arabic National Address is NOT transliterated here
// — it must come from the official CR / National Address document. Leaving an
// explicit placeholder rather than inventing it.
function STANDARD_EMAIL_FOOTER_AR_DRAFT({ messageRef, teamLabel }) {
  const team = teamLabel || "";
  const ref = messageRef || "(غير محدد)";
  return [
    `أُرسلت هذه الرسالة آليًا من منصة بحيرة البيانات. يمكنكم الرد على هذا البريد —`,
    `وتصل الردود إلى فريق ${team} وتتم مراقبتها.`,
    ``,
    `${COMPANY.legal_name_ar}`,
    `السجل التجاري ${COMPANY.cr_number} · الرقم الموحّد ${COMPANY.nun}`,
    `[العنوان الوطني — يُدرج من وثيقة العنوان الوطني الرسمية — PLACEHOLDER]`,
    ``,
    `تُعالَج بياناتكم الشخصية وفقًا لنظام حماية البيانات الشخصية (PDPL) وسياسة الخصوصية.`,
    `لممارسة حقوقكم المتعلقة بالبيانات، يُرجى التواصل مع ${DPO_CONTACT}.`,
    ``,
    `هذا البريد ومرفقاته سرّية ومخصّصة للمستلم المعني فقط.`,
    ``,
    `المرجع: ${ref}`,
  ].join("\n");
}

module.exports = {
  COMPANY,
  LEGAL_FOOTER_EN,
  LEGAL_EMAIL_FOOTER,
  POSTAL_ADDRESS_EN,
  DPO_CONTACT,
  STANDARD_EMAIL_FOOTER,
  STANDARD_EMAIL_FOOTER_AR_DRAFT,
};
