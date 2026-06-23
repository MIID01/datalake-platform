# Datalake Platform — Security Architecture

**Entity:** Datalake Saudi Arabia LLC — شركة بحيرة البيانات للاستشارات في مجال الاتصالات وتقنية المعلومات
**CR:** 1009194773 · **Unified Number (NUN):** 7048904952 · **Address:** Rajiyah Street, Al Yarmuk District, Riyadh 13243, Kingdom of Saudi Arabia
**Platform:** `datalake-production-sa` (Google Cloud / Firebase), region `me-central2` (Dammam, KSA)
**Document owner:** CEO (acting CISO) · **Last updated:** 2026-06-01

> **Accuracy statement.** This document describes controls **as actually implemented in the
> codebase as of the date above**. Controls that are planned, partially built, or not yet
> activated are marked as such. It contains no aspirational claims. Where a stated objective
> is not yet met, it is listed explicitly under "Known gaps".

### Control status legend
| Symbol | Meaning |
|---|---|
| ✅ | Implemented and active in production |
| ⏳ | Code complete, **activation pending** an operational step |
| 🔧 | In progress / partially built |
| ❌ | Not implemented (planned or out of scope) |

---

## 1. Authentication model

| Control | Status | Detail |
|---|---|---|
| Identity provider | ✅ | Firebase Authentication (Google Identity Platform), email/password. |
| Federated SSO | ❌ (by decision) | Google SSO was **removed** (commit `9532297`). Email/password is the only sign-in method. |
| Credential storage | ✅ | Passwords are never stored by the application. Firebase Auth holds salted+hashed credentials (scrypt) server-side. Admin-issued temporary passwords are returned to IT once and never persisted in plaintext (`functions/adminAuth.js`). |
| Session management | ✅ | Firebase ID tokens (~1 h lifetime) with silent refresh tokens; `browserLocalPersistence` (default). Sign-out (`src/lib/auth.js`) revokes the local session. |
| Token verification (backend) | ✅ | Every privileged Cloud Function verifies `Authorization: Bearer <idToken>` via `admin.auth().verifyIdToken()` and re-checks role server-side. Public exceptions: `submitCareerApplication`, `zohoPaymentWebhook`, and the unauthenticated password-reset request endpoint. |
| Password reset | ✅ | `generatePasswordResetLink` (Firebase, 1 h expiry) delivered from `hr@datalake.sa` via Workspace domain-wide delegation for inbox deliverability; the link lands on the in-app `/reset-password` handler. Always returns HTTP 200 to prevent account enumeration (`functions/passwordReset.js`). |
| Hardcoded role bypasses | ✅ (intentional) | Two addresses resolve to fixed roles in client and rules: `m.alqumri@datalake.sa` → `ceo`, `hr@datalake.sa` → `hr`. Kept in sync across `src/lib/auth.js`, `src/components/AuthGate.jsx`, `firestore.rules`. |

**Defense in depth.** `firestore.rules` and Cloud Function role checks are the trust boundary.
The client-side `AuthGate` / `routes.js` portal routing is **UX only** and is never relied on for
authorization.

---

## 2. Authorization model (RBAC)

Roles: **`ceo`, `cto`, `hr`, `employee`, `client`, `finance`** (+ `it_admin`, `business`/`sales`,
`auditor` read-only roam). Role resolution precedence (identical in `resolveUserRole` and rules):
UID-keyed `users` doc → `users` query by email → hardcoded email fallbacks.

### What each role can access
| Role | Access |
|---|---|
| **CEO** (`m.alqumri@datalake.sa`) | Full access to every portal; the **final** approver for payroll (`FINANCE_APPROVED → APPROVED`) and the only approver for RBAC role assignment. Cannot change their **own** role (segregation of duties, enforced in `firestore.rules`). |
| **finance** | `/finance/*` (dashboard, invoices, payroll, expenses, reports). Reads payroll; prepares payroll DRAFTs and gives the **first approval** (`DRAFT → FINANCE_APPROVED`, signature) — but **cannot** give final approval (a signer distinct from the CEO, enforced server-side). |
| **hr** | `/hr/*` (talent, employees, contracts, Iqama, scoring). Manages employee records; prepares payroll DRAFTs but cannot approve. |
| **it_admin** | `/admin/*` credential & access management. **Explicitly not the CEO** — credential reset is gated to `it_admin` only (`functions/adminAuth.js`). |
| **employee** | `/employee/*` — own profile, timesheets, leave, expenses, documents, training, support. Every authenticated user is also an employee. |
| **client** | `/client/*` — scoped by `client_id` to their own engagement’s timesheets/leave approvals. |
| **cto** | Portal built but role is **VACANT**; CEO acts as CTO for timesheet approval. |
| **auditor** | Read-only roam of all portals; every write path in `firestore.rules` excludes `auditor`. |

### Enforcement layers (defense in depth)
1. **`firestore.rules`** — the real boundary for all direct client reads/writes. Role checks via
   `getUserRole()`, `client_id` scoping, and a **default-deny** catch-all (`match /{document=**} { allow read, write: if false; }`).
2. **Cloud Functions** — re-verify the Firebase ID token and role for every privileged mutation
   (email, payroll, document generation, RBAC admin, external sync).
3. **Client routing** — UX convenience only; not a security control.

### Notable rule-enforced controls
- **RBAC collections** (`roles`, `access_matrix`, role field on `users`) are **CEO-write-only**.
- **`email_log`** is `write: if false` from clients — written only by the `sendHrEmail` /
  password-reset functions, so the audit log cannot be forged or amended.
- **Token-gated public flows** (client hire acknowledgement, timesheet signing, consent, legal
  review) read via opaque cryptographically-random tokens and may write only a constrained,
  explicitly-whitelisted set of audit fields.

---

## 3. Password policy

**Policy:** minimum **12 characters**, with at least one **uppercase**, one **lowercase**, one
**number**, and one **special character**. No periodic forced rotation.

| Layer | Status | Detail |
|---|---|---|
| Client-side validation | ✅ | Single source of truth `src/lib/password-policy.js` drives live requirement checkmarks (`PasswordChecklist.jsx`) on the `/reset-password` page and the employee Profile "Change Password" form. Submit is blocked until all rules pass. |
| Server-side enforcement | ⏳ | `functions/set-password-policy.js` sets the Firebase Auth password policy (`enforcementState: ENFORCE`, the five constraints above) via `projectConfigManager().updateProjectConfig`. **Activated only by running the one-time script** — until then, Firebase still accepts non-compliant passwords and the client rules are advisory. This is the authoritative boundary once active: `confirmPasswordReset` / `updatePassword` reject weak passwords regardless of the UI. |
| Forced rotation | ✅ (none, by design) | `forceUpgradeOnSignin: false`. |
| Reauthentication for change | ✅ | In-app password change requires `reauthenticateWithCredential` (recent-login) before `updatePassword` (`src/pages/employee/Profile.jsx`). |

### Standards alignment
- **NIST SP 800-63B (Digital Identity — Authentication):**
  - §5.1.1.2 length: our 12-character minimum **exceeds** the 8-character floor.
  - Rotation: 800-63B advises **against** mandatory periodic rotation absent evidence of
    compromise — our "no forced rotation" stance **aligns**.
  - *Note:* 800-63B de-emphasises composition complexity rules; our complexity requirements are a
    stricter overlay retained to satisfy NCA ECC and common banking-counterparty expectations.
  - **Gap vs 800-63B §5.1.1.2:** we do **not** yet screen new passwords against a breached-password
    blocklist (e.g. HaveIBeenPwned). See Known gaps.
- **NCA ECC (Saudi National Cybersecurity Authority — Essential Cybersecurity Controls), Domain 2
  "Cybersecurity Defence", subdomain 2-2 "Identity and Access Management":** strong-password
  requirements are met; the **MFA** requirement (2-2 IAM) is currently a gap (see §4).

### Known gaps (password / account)
- ❌ **Server policy not yet activated** — see ⏳ above; run `functions/set-password-policy.js`.
- ❌ **Forced change of admin-issued temporary passwords on first login.** IT-Admin reset
  (`functions/adminAuth.js`) issues a temp password and writes `force_reset` / `must_change` to
  `password_policies/{uid}`, **but login does not gate on this flag** — it is only *displayed* in
  `/admin/credentials`. Treat temp-password rotation as an operational/manual step today.
- ❌ **Fixed-threshold account lockout.** There is **no** custom "5 failed attempts → lock" policy.
  Brute-force protection relies on Firebase Authentication’s built-in anti-abuse throttling, which
  returns `auth/too-many-requests` and temporarily blocks further attempts.

---

## 4. Multi-Factor Authentication (MFA)

**Status: ❌ Not implemented in the platform (🔧 in progress).**

- The application enforces **no second factor** on sign-in today. There is no TOTP enrolment,
  SMS OTP, or WebAuthn flow in the codebase.
- The employee **onboarding** checklist (`src/pages/employee/Onboarding.jsx`) instructs staff to
  enable MFA on their **Google Workspace account** (organisation-level control outside the app),
  but this is an acknowledgement, not a platform-enforced control.
- **Planned design** (not yet built): TOTP via authenticator app (e.g. Google Authenticator),
  optional per user with the ability to enforce globally or per role, using Google Identity
  Platform multi-factor enrolment. This section will be updated to ✅ with implementation detail
  once delivered. **No MFA claim should be made to counterparties until then.**

---

## 5. Data protection

| Control | Status | Detail |
|---|---|---|
| Data residency | ✅ | All compute and storage are region-locked to **`me-central2` (Dammam, Saudi Arabia)** — Firestore, Cloud Functions, Cloud Run AI services, Cloud Storage, BigQuery. Mandated for PDPL and ZATCA. |
| PDPL alignment | ✅ | Saudi Personal Data Protection Law: in-app **Right to Access** (Art. 15 — "Download My Data" export) and **Right to Erasure** (Art. 18 — deletion request to HR with 30-day SLA) in `src/pages/employee/Profile.jsx`; PDPL consent captured at onboarding with IP + user-agent. |
| Encryption at rest | ✅ (platform) | Google Cloud default **AES-256** encryption on Firestore, Cloud Storage, and BigQuery. |
| Encryption in transit | ✅ (platform) | **TLS 1.2+** for all client↔Firebase, client↔Cloud Run, and service↔service traffic. |
| Self-hosted AI (no external APIs) | ✅ | LLM (**Gemma 3** via Ollama — open-weight, self-hosted; model id from the `LLM_MODEL` env so the deployed model and audit label never drift; Qwen 2.5 was retired), OCR (PaddleOCR), and CV reformatting (`cv-agent`: PaddleOCR + Gemma 3) all run on self-hosted Cloud Run in `me-central2`. No prompt or candidate data leaves Google Cloud / `me-central2`; **no third-party AI API (Vertex, Gemini, OpenAI, etc.) is called.** cv-agent's prior Vertex-Gemini path was removed 2026-06-08 (Gemini is not reachable in me-central2). |
| Secrets management | ✅ | Credentials (Zoho OAuth, etc.) in Google Secret Manager. Gmail uses IAM `signJwt` domain-wide delegation — **no service-account key files**. Integration secrets are masked (`********`) on read in the Admin UI. |
| WORM storage | ✅ | HR documents in a Write-Once-Read-Many bucket (`datalake-worm-hr`); object delete/overwrite restricted to CEO in `storage.rules`. |
| Tier-1 PII (salary) | ✅ | No blanket read on `payroll_runs` (see §2 / CAPA-PAY-001). |

---

## 6. Audit trail

| Stream | Where | Immutability |
|---|---|---|
| AI inference calls | BigQuery `datalake_audit` | **Append-only** (insert-only writes), SHA-256 hash of input, **no raw prompts stored** (`functions/lib/ai-client.js`). |
| Approval evidence | Firestore `<parent>/<id>/approval_evidence/<id>` + `approval-evidence/**` in Storage | **Immutable** — `update, delete: if false` in `firestore.rules`. Each row captures approver `{uid,email,name,role}`, `approved_at` timestamp, `ip_address`, `user_agent`, a signature (draw/upload/type) image, and — when a signed document is required — the file’s **SHA-256**, size, and storage path. |
| HR / transactional email | Firestore `email_log` | Client `write: if false`; rows written only by Cloud Functions (`PENDING → SENT/FAILED`) with `gmail_message_id`, IP, user-agent, employee link. |
| Credential / RBAC admin actions | Admin audit logs (`logAdminAudit`) | Records actor, actor role, target, action (e.g. `PASSWORD_RESET`, `PASSWORD_GENERATED`, `PASSWORD_EXPIRY_FORCED`). |
| Financial audit data | BigQuery `datalake_finance` | Append-only. |
| Compliance CAPAs | Firestore `capas` (+ `trackCAPAStatus` scheduled function) | Status lifecycle tracking (OPEN → IMPLEMENTED → VERIFIED/OVERDUE). |

**What is logged:** authentication-adjacent admin actions, every material business approval
(invoice, payroll, contract, hire, Iqama stage), all AI usage, and all outbound HR email.
**Integrity:** evidence and email logs are enforced immutable by security rules; BigQuery streams
are insert-only with no application update/delete path.

---

## 7. Incident response

> Datalake has no 24/7 SOC. The CEO is the escalation point and acting CISO. The procedures below
> are operational runbooks; supporting platform actions exist where noted.

### 7.1 Suspected password / account compromise
1. **Contain** — IT Admin disables the account: set `users/{uid}.status = "disabled"` (AuthGate
   immediately serves the "Account Disabled" screen and blocks all portals) and/or
   `admin.auth().updateUser(uid, { disabled: true })`.
2. **Reset** — IT Admin issues a new temporary password via the credential function
   (`action: "reset"`), delivered out-of-band. *(Note the first-login-rotation gap in §3 — instruct
   the user to immediately set their own password via "Forgot password".)*
3. **Investigate** — review `email_log`, admin audit logs, and BigQuery `datalake_audit` for the
   actor’s recent activity; review approval-evidence rows for any approvals in the exposure window.
4. **Eradicate / recover** — reverse unauthorised changes; affected approvals are traceable via the
   immutable evidence trail.
5. **Notify** — assess PDPL breach-notification obligations (notify SDAIA / data subjects as
   required by PDPL for personal-data breaches).

### 7.2 Account lockout (legitimate user)
- Firebase throttling (`auth/too-many-requests`) auto-clears after a cool-down; the sign-in page
  shows a friendly "Too many attempts — try again in a minute" message (`LandingPage.jsx`).
- If persistent, IT Admin issues a password reset. There is no manual unlock control because there
  is no custom lockout store (see §3 gap).

### 7.3 General escalation
- Platform outage / bad deploy → **`docs/rollback.md`** (hosting, Cloud Run, rules, and git-tag
  rollback procedures). CI/CD deploys to a preview channel and **only promotes to live if Cypress
  E2E passes**, limiting blast radius.

---

## 8. The three payroll CAPAs

Salary is Tier-1 PII; a payroll-rules review raised three corrective actions, all resolved in
`firestore.rules` (commit `77431b9`) and the `generatePDF` / `listMyPayslips` functions. *(The
`CAPA-PAY-00x` identifiers are the internal audit-tracking references; the technical fixes below
are what is implemented and verifiable in code.)*

| CAPA | Finding | Resolution | Status |
|---|---|---|---|
| **CAPA-PAY-001** | Blanket read exposed all salaries. | `payroll_runs` read restricted to **CEO / finance / HR**. Employees cannot read the collection directly — they retrieve only their own payslip via the `listMyPayslips` Cloud Function, which derives `employee_id` from the verified auth-token email (**caller == subject**, else 403). | ✅ Resolved |
| **CAPA-PAY-002** | No separation between preparer and approver. | **Segregation of duties (multi-stage chain):** HR/finance prepare the run while `status == DRAFT`; **Finance** gives the first approval `DRAFT → FINANCE_APPROVED` (signature); the **CEO** gives final approval `FINANCE_APPROVED → APPROVED` (requires the signed payroll register). Each stage is a **distinct signer** and every transition is written **only** by the `recordApproval` Cloud Function (Admin SDK) — no client SDK path can flip status. | ✅ Resolved |
| **CAPA-PAY-003** | Approval evidence could be altered. | Per-run `approval_evidence` rows are **CEO-only create** and **immutable** (`update, delete: if false`). | ✅ Resolved |

**Verification:** an anonymous REST read of `/payroll_runs` returns `403 PERMISSION_DENIED` after
deploy; preparer/approver transitions are covered by the rule branches above and exercised through
the Finance/CEO payroll UI.

---

## 9. Open items / roadmap (security)

| Item | Status |
|---|---|
| Activate server-side password policy (`set-password-policy.js`) | ⏳ Pending one-time run |
| MFA (TOTP, per-user, role-enforceable) | 🔧 In progress |
| Enforce first-login change of admin temp passwords | ❌ Not built |
| Breached-password blocklist screening | ❌ Not built |
| Custom failed-attempt lockout policy | ❌ Not built (Firebase throttling only) |
| Third-party penetration test | ❌ Not conducted |
| ISO/IEC 27001 certification | ❌ Not pursued |

---

*Prepared for security due-diligence and audit purposes. For questions contact the CEO /
acting CISO (`m.alqumri@datalake.sa`) or the Data Protection Officer (`dpo@datalake.sa`).*
