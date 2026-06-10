// Single source of truth for Datalake legal/commercial details.
// Every footer, PDPL notice, contract page, and PDF must source from here so a
// future change to the CR / address / entity name lands in one place.
//
// The CEO-locked canonical footer line (LEGAL_FOOTER_EN) is mirrored verbatim
// for the backend in functions/lib/company-legal.js — keep the two in sync.
//
// If you change anything here, also update:
//   - functions/lib/company-legal.js (backend mirror used by PDFs/emails)
//   - The HR-facing Privacy / Code of Conduct / IT Acceptable Use policy text
//     in src/pages/employee/Onboarding.jsx (the literal copy is regulator-
//     reviewed and intentionally not pulled from these constants)

export const COMPANY = {
  legal_name_en: 'Datalake Saudi Arabia LLC',
  legal_name_ar: 'شركة بحيرة البيانات للاستشارات في مجال الاتصالات وتقنية المعلومات',
  entity_type_en: 'Limited Liability Company (LLC)',
  entity_type_ar: 'شركة ذات مسؤولية محدودة (LLC)',
  cr_number: '1009194773',
  nun: '7048904952',                 // National Unified Number — shown as "Unified Number"
  street: 'Rajiyah Street',
  district: 'Al Yarmuk District',
  city: 'Riyadh',
  postal_code: '13243',
  country: 'Kingdom of Saudi Arabia',
  domain: 'datalake.sa',
}

// CEO-locked canonical English footer. Single source for the letterhead, all PDF
// exports, the GRC DOCX export, and emails. Must match the registered details
// verbatim — do not reword per-file.
export const LEGAL_FOOTER_EN =
  `${COMPANY.legal_name_en} · ${COMPANY.street}, ${COMPANY.district}, ${COMPANY.city} ${COMPANY.postal_code}, ${COMPANY.country} · CR ${COMPANY.cr_number} · Unified Number ${COMPANY.nun}`

// Arabic footer counterpart for bilingual legal documents.
export const LEGAL_FOOTER_AR =
  `${COMPANY.legal_name_ar} · ${COMPANY.entity_type_ar} · س.ت: ${COMPANY.cr_number}`

// Convenience for "Data Controller" lines in PDPL notices.
export const DATA_CONTROLLER_LINE_EN =
  `Data Controller: ${COMPANY.legal_name_en}, CR: ${COMPANY.cr_number}, ${COMPANY.street}, ${COMPANY.district}, ${COMPANY.city} ${COMPANY.postal_code}`
