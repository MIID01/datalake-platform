import { initializeApp } from "firebase/app";
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

export const CLIENT_SIGN_TIMESHEET_URL =
  "https://clientsigntimesheet-ifzodp5svq-wx.a.run.app";

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
export const DOWNLOAD_CANDIDATE_CV_URL =
  "https://downloadcandidatecv-ifzodp5svq-wx.a.run.app";
export const UPDATE_CANDIDATE_STAGE_URL =
  "https://updatecandidatestage-ifzodp5svq-wx.a.run.app";

// Backfill & GRC APIs
export const BACKFILL_EMPLOYEE_URL = 
  "https://backfillemployee-ifzodp5svq-wx.a.run.app";
export const RECORD_LEAVER_URL = 
  "https://recordleaver-ifzodp5svq-wx.a.run.app";
export const GET_BACKFILL_CONSENT_URL =
  "https://getbackfillconsentform-ifzodp5svq-wx.a.run.app";
export const SUBMIT_BACKFILL_CONSENT_URL = 
  "https://submitbackfillconsent-ifzodp5svq-wx.a.run.app";
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

// Multi-Tenant Integration Config (Phase 9)
export const SAVE_INTEGRATION_CONFIG_URL =
  "https://saveintegrationconfig-ifzodp5svq-wx.a.run.app";
export const GET_INTEGRATION_CONFIG_URL =
  "https://getintegrationconfig-ifzodp5svq-wx.a.run.app";
