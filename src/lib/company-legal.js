// Single source of truth for Datalake legal/commercial details.
// Every footer, PDPL notice, contract page, and PDF must source from here so a
// future change to the CR / address / entity name lands in one place.
//
// If you change anything here, also update:
//   - Any printed PDF templates served from the backend
//   - The HR-facing Privacy / Code of Conduct / IT Acceptable Use policy text
//     in src/pages/employee/Onboarding.jsx (the literal copy is regulator-
//     reviewed and intentionally not pulled from these constants)

export const COMPANY = {
  legal_name_en: 'Datalake Saudi Arabia LLC',
  legal_name_ar: 'شركة بحيرة البيانات للاستشارات في مجال الاتصالات وتقنية المعلومات',
  entity_type_en: 'Limited Liability Company (LLC)',
  entity_type_ar: 'شركة ذات مسؤولية محدودة (LLC)',
  cr_number: '1009194773',
  nun: '7048904952',
  city: 'Riyadh',
  district: 'Al-Yarmouk',
  postal_code: '13243',
  country: 'Saudi Arabia',
  domain: 'datalake.sa',
}

// Canonical English footer string used on every public page, PDF, and printed
// document. Must match the regulator-reviewed wording verbatim.
export const LEGAL_FOOTER_EN =
  `${COMPANY.legal_name_en}, ${COMPANY.city} ${COMPANY.district} ${COMPANY.postal_code}, CR:${COMPANY.cr_number} NUN:${COMPANY.nun}`

// Arabic footer counterpart for bilingual legal documents.
export const LEGAL_FOOTER_AR =
  `${COMPANY.legal_name_ar} · ${COMPANY.entity_type_ar} · س.ت: ${COMPANY.cr_number}`

// Convenience for "Data Controller" lines in PDPL notices.
export const DATA_CONTROLLER_LINE_EN =
  `Data Controller: ${COMPANY.legal_name_en}, CR: ${COMPANY.cr_number}, ${COMPANY.city} ${COMPANY.district} ${COMPANY.postal_code}`
