import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider, getToken as getAppCheckToken } from "firebase/app-check";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
const firebaseConfig = {
  apiKey: "AIzaSyCTtKUiMS1eByd_ttHBkTF13S7EDggXvmg",
  authDomain: "datalake-production-sa.firebaseapp.com",
  projectId: "datalake-production-sa",
  storageBucket: "datalake-production-sa.firebasestorage.app",
  messagingSenderId: "808056940626",
  appId: "1:808056940626:web:7aee4d64f616554c39d78b",
  measurementId: "G-C00D870R71"
};

export const app = initializeApp(firebaseConfig);

// Firebase App Check (reCAPTCHA v3) — app-attestation, so only the genuine app
// (not curl/scripts) can call our public-invoker Cloud Functions. Defense-in-depth
// on top of the Bearer ID-token + role gates. Guarded on the build-time site key so
// a build without it never crashes (the backend runs in monitor mode until enforced).
// In dev, a debug token is logged to the console — register it under
// Firebase Console → App Check → Manage debug tokens so `npm run dev` attests.
const RECAPTCHA_SITE_KEY = import.meta.env.VITE_RECAPTCHA_SITE_KEY;
let appCheck = null;
if (RECAPTCHA_SITE_KEY) {
  if (import.meta.env.DEV) self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  appCheck = initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
    isTokenAutoRefresh: true,
  });
}

// Returns the App Check header to spread into fetch() calls that hit App-Check-gated
// functions. Empty object when App Check isn't initialized or a token can't be minted
// (monitor mode tolerates this; under enforcement the call is rejected server-side).
export async function appCheckHeader() {
  if (!appCheck) return {};
  try { const { token } = await getAppCheckToken(appCheck, false); return { "X-Firebase-AppCheck": token }; }
  catch { return {}; }
}

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.addScope("https://www.googleapis.com/auth/userinfo.email");

export const CLOUD_FUNCTION_URL =
  "https://submitcareerapplication-ifzodp5svq-wx.a.run.app";

export const CREATE_TASK_URL =
  "https://createtask-ifzodp5svq-wx.a.run.app";

export const SUBMIT_HR_SCORE_URL =
  "https://submithrscore-ifzodp5svq-wx.a.run.app";

export const CREATE_PROJECT_URL =
  "https://createproject-ifzodp5svq-wx.a.run.app";

// CRM — send + log an email from a deal (functions/deals.js sendDealEmail).
export const SEND_DEAL_EMAIL_URL =
  "https://senddealemail-ifzodp5svq-wx.a.run.app";

// CRM — quote/discount approval gates (functions/dealQuotes.js). Server-side
// enforced: finance review (PENDING_FINANCE→PENDING_CEO) then CEO approval.
export const FINANCE_REVIEW_QUOTE_URL =
  "https://financereviewdealquote-ifzodp5svq-wx.a.run.app";
export const APPROVE_DEAL_QUOTE_URL =
  "https://approvedealquote-ifzodp5svq-wx.a.run.app";

// CRM — hardened import + bulk soft-delete/undo (functions/crmImport.js, P0.0).
// Server-side validated, PDPL-gated, audited; deletes are soft (archived flag);
// undo by import_batch_id.
export const CRM_IMPORT_LEADS_URL =
  "https://crmimportleads-ifzodp5svq-wx.a.run.app";
export const CRM_ARCHIVE_DEALS_URL =
  "https://crmarchivedeals-ifzodp5svq-wx.a.run.app";

// Universal server-side approval/sign recorder (functions/recordApproval.js).
// Every ApprovalButton signs through this — WORM + immutable evidence + audit.
export const RECORD_APPROVAL_URL =
  "https://recordapproval-ifzodp5svq-wx.a.run.app";

export const ASSIGN_ENGINEER_URL =
  "https://assignengineertoproject-ifzodp5svq-wx.a.run.app";

export const GET_ENGINEER_PROJECT_VIEW_URL =
  "https://getengineerprojectview-ifzodp5svq-wx.a.run.app";

export const SUBMIT_TIMESHEET_URL =
  "https://submittimesheet-ifzodp5svq-wx.a.run.app";

export const EXTRACT_TIMESHEET_URL =
  "https://extracttimesheetai-ifzodp5svq-wx.a.run.app";

export const CTO_APPROVE_TIMESHEET_URL =
  "https://ctoapprovetimesheet-ifzodp5svq-wx.a.run.app";

// CEO Approvals Hub — atomic invoice approve/reject (SoD gate).
export const CEO_APPROVE_INVOICE_URL =
  "https://ceoapproveinvoice-ifzodp5svq-wx.a.run.app";

export const CLIENT_SIGN_TIMESHEET_URL =
  "https://clientsigntimesheet-ifzodp5svq-wx.a.run.app";

// Public endpoint — pinged when a client opens the sign link, for auditable
// proof of receipt (the page is unauthenticated; token is the auth).
export const RECORD_SIGN_LINK_OPEN_URL =
  "https://recordtimesheetsignlinkopen-ifzodp5svq-wx.a.run.app";

// Staff-triggered resend of the client sign-link (reuses existing token; never
// exposes it). CEO/CTO/finance/HR only — enforced in-code.
export const RESEND_SIGN_LINK_URL =
  "https://resendtimesheetsignlink-ifzodp5svq-wx.a.run.app";

// Token-as-credential client sign flow (public; token was emailed only to the
// client). Read + sign by token — no staff/CEO session can produce a client
// sign-off. firestore.rules denies all direct CLIENT_SIGNED writes.
export const GET_TIMESHEETS_BY_TOKEN_URL =
  "https://gettimesheetsbytoken-ifzodp5svq-wx.a.run.app";
export const SIGN_TIMESHEET_BY_TOKEN_URL =
  "https://signtimesheetbytoken-ifzodp5svq-wx.a.run.app";

export const GET_MY_TIMESHEETS_URL =
  "https://getmytimesheets-ifzodp5svq-wx.a.run.app";

export const GET_CLIENT_TIMESHEETS_URL =
  "https://getclienttimesheets-ifzodp5svq-wx.a.run.app";

export const EXTRACT_CV_URL =
  "https://extractcvdata-ifzodp5svq-wx.a.run.app";

// RBAC Admin APIs
export const GET_RBAC_STATE_URL =
  "https://getrbacstate-ifzodp5svq-wx.a.run.app";
export const ADD_USER_URL =
  "https://adduser-ifzodp5svq-wx.a.run.app";
export const UPDATE_USER_ROLE_URL =
  "https://updateuserrole-ifzodp5svq-wx.a.run.app";
export const DISABLE_USER_URL =
  "https://disableuser-ifzodp5svq-wx.a.run.app";
// Full de-provisioning (auth disable, Workspace offboard, cert) — CEO only.
export const OFFBOARD_ENGINEER_URL =
  "https://offboardengineer-ifzodp5svq-wx.a.run.app";
export const CREATE_CUSTOM_ROLE_URL =
  "https://createcustomrole-ifzodp5svq-wx.a.run.app";
export const DELETE_CUSTOM_ROLE_URL =
  "https://deletecustomrole-ifzodp5svq-wx.a.run.app";
export const UPDATE_ACCESS_MATRIX_URL =
  "https://updateaccessmatrix-ifzodp5svq-wx.a.run.app";

// Recruitment Pipeline APIs
export const PREPARE_INTERVIEW_CV_URL =
  "https://prepareinterviewcv-ifzodp5svq-wx.a.run.app";
export const SEND_INTERVIEW_CV_URL =
  "https://sendinterviewcv-ifzodp5svq-wx.a.run.app";
export const SEND_INTERVIEW_INVITE_URL =
  "https://sendinterviewinvite-ifzodp5svq-wx.a.run.app";
export const DOWNLOAD_CANDIDATE_CV_URL =
  "https://downloadcandidatecv-ifzodp5svq-wx.a.run.app";
export const UPDATE_CANDIDATE_STAGE_URL =
  "https://updatecandidatestage-ifzodp5svq-wx.a.run.app";

// Payroll deductions (one-off / installment)
export const CREATE_DEDUCTION_URL =
  "https://creatededuction-ifzodp5svq-wx.a.run.app";
export const LIST_DEDUCTIONS_URL =
  "https://listdeductions-ifzodp5svq-wx.a.run.app";
export const CANCEL_DEDUCTION_URL =
  "https://canceldeduction-ifzodp5svq-wx.a.run.app";
export const VERIFY_EMPLOYEE_SALARY_URL =
  "https://verifyemployeesalary-ifzodp5svq-wx.a.run.app";
export const CANCEL_PAYROLL_RUN_URL =
  "https://cancelpayrollrun-ifzodp5svq-wx.a.run.app";
export const SAVE_PAYROLL_SETTINGS_URL =
  "https://savepayrollsettings-ifzodp5svq-wx.a.run.app";
export const SAVE_OPERATIONS_SETTINGS_URL =
  "https://saveoperationssettings-ifzodp5svq-wx.a.run.app";

// Backfill & GRC APIs
export const BACKFILL_EMPLOYEE_URL = 
  "https://backfillemployee-ifzodp5svq-wx.a.run.app";
export const RECORD_LEAVER_URL = 
  "https://recordleaver-ifzodp5svq-wx.a.run.app";
export const GET_BACKFILL_CONSENT_URL =
  "https://getbackfillconsentform-ifzodp5svq-wx.a.run.app";
export const SUBMIT_BACKFILL_CONSENT_URL =
  "https://submitbackfillconsent-ifzodp5svq-wx.a.run.app";
// PARKED (DTLK T9): server-side photo/print card — NOT deployed. The shipped card
// is QR-only and client-side. Un-comment + un-park the function to revive.
// export const GENERATE_BUSINESS_CARD_URL =
//   "https://generatebusinesscard-ifzodp5svq-wx.a.run.app";
export const UPLOAD_GRC_DOC_URL =
  "https://uploadgrcdocument-ifzodp5svq-wx.a.run.app";
export const LIST_GRC_DOCUMENTS_URL =
  "https://listgrcdocuments-ifzodp5svq-wx.a.run.app";
export const GET_GRC_CHANGELOG_URL =
  "https://getgrcchangelog-ifzodp5svq-wx.a.run.app";
export const DOWNLOAD_GRC_DOCUMENT_URL =
  "https://downloadgrcdocument-ifzodp5svq-wx.a.run.app";

// Invoicing APIs
export const GENERATE_INVOICE_URL =
  "https://generateinvoice-ifzodp5svq-wx.a.run.app";
export const SYNC_TO_ZOHO_BOOKS_URL =
  "https://synctozohobooks-ifzodp5svq-wx.a.run.app";
export const GENERATE_ZATCA_XML_URL =
  "https://generatezatcaxml-ifzodp5svq-wx.a.run.app";

// HR Contract upload (Qiwa-signed PDF → Gatekeeper OCR + LLM extraction)
export const UPLOAD_CONTRACT_PDF_URL =
  "https://uploadcontractpdf-ifzodp5svq-wx.a.run.app";
export const RETRY_CONTRACT_EXTRACTION_URL =
  "https://retrycontractextraction-ifzodp5svq-wx.a.run.app";

// PDF engine (templates: invoice, payslip, timesheet, monthly_report, contract_summary, pdpl_consent)
export const GENERATE_PDF_URL =
  "https://generatepdf-ifzodp5svq-wx.a.run.app";

// Payroll
export const CREATE_PAYROLL_RUN_URL =
  "https://createpayrollrun-ifzodp5svq-wx.a.run.app";
export const LIST_MY_PAYSLIPS_URL =
  "https://listmypayslips-ifzodp5svq-wx.a.run.app";

// Iqama lifecycle
export const ADVANCE_IQAMA_STAGE_URL =
  "https://advanceiqamastage-ifzodp5svq-wx.a.run.app";

// HR Send Email
export const SEND_HR_EMAIL_URL =
  "https://sendhremail-ifzodp5svq-wx.a.run.app";
export const LIST_EMAIL_TEMPLATES_URL =
  "https://listemailtemplates-ifzodp5svq-wx.a.run.app";

// Password reset (Gmail-DWD, replaces Firebase's default sender)
export const GENERATE_PASSWORD_RESET_URL =
  "https://generateandsendpasswordreset-ifzodp5svq-wx.a.run.app";

// Forced first-login password change (any authed user). The employee can't read
// or clear their own force_reset flag (it_admin-only in rules), so these run
// server-side: status check + policy-enforced self password change.
export const GET_MY_PASSWORD_STATUS_URL =
  "https://getmypasswordstatus-ifzodp5svq-wx.a.run.app";
export const CHANGE_MY_PASSWORD_URL =
  "https://changemypassword-ifzodp5svq-wx.a.run.app";

// Governed "require password change at next login" toggle (it_admin / CEO).
// Per-account or bulk; logs every toggle to admin_audit_log.
export const SET_PASSWORD_CHANGE_REQUIRED_URL =
  "https://setpasswordchangerequired-ifzodp5svq-wx.a.run.app";

// Auth account audit + provision (HR/CEO only)
export const AUDIT_AUTH_ACCOUNTS_URL =
  "https://auditauthaccounts-ifzodp5svq-wx.a.run.app";
export const PROVISION_MISSING_AUTH_ACCOUNT_URL =
  "https://provisionmissingauthaccount-ifzodp5svq-wx.a.run.app";

// Reset onboarding (HR/CEO only)
export const RESET_ONBOARDING_URL =
  "https://resetonboarding-ifzodp5svq-wx.a.run.app";

// Multi-Tenant Integration Config (Phase 9)
export const SAVE_INTEGRATION_CONFIG_URL =
  "https://saveintegrationconfig-ifzodp5svq-wx.a.run.app";
export const GET_INTEGRATION_CONFIG_URL =
  "https://getintegrationconfig-ifzodp5svq-wx.a.run.app";

// DTLK-ARCH-AI-002: Real AI service health (server-side Cloud Run + Monitoring query)
// URL pattern: lowercase function name + project suffix. Update after first deploy.
export const GET_AI_SERVICE_HEALTH_URL =
  "https://getaiservicehealth-ifzodp5svq-wx.a.run.app";
