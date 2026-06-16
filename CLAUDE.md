# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Datalake Platform is a single-page React app (Vite) backed by Firebase. It serves a Saudi data-consulting business as several **role-based portals** (CEO, CTO, HR, Employee, Client) over one Firestore database, with heavy server-side workflows (recruitment, hiring, timesheets, invoicing, GRC/compliance) implemented as Google Cloud Functions. Everything is region-locked to **`me-central2`** (Saudi Arabia) for ZATCA (e-invoicing) and PDPL (data-privacy) compliance.

## Commands

Frontend (repo root):
- `npm run dev` — Vite dev server at `http://localhost:5173`
- `npm run build` — production build to `dist/` (this is what Hosting serves)
- `npm run lint` — ESLint over the repo
- `npm run preview` — serve the built `dist/`

E2E (Cypress, baseUrl `http://localhost:5173` — start `npm run dev` first):
- `npx cypress open` — interactive runner
- `npx cypress run` — headless, all specs
- `npx cypress run --spec "cypress/e2e/<file>.cy.js"` — single spec
- Test users/secrets come from `cypress.env.json` (gitignored; see `cypress.env.json.template`)

There is **no unit-test runner** — `functions/` `npm test` is a stub. "Tests" means Cypress E2E.

Deploy (project `datalake-production-sa`):
- `npm run build && firebase deploy --only hosting --project=datalake-production-sa`
- `firebase deploy --only functions --project=datalake-production-sa`
- `firebase deploy --only firestore:rules` / `--only storage`
- Deploying requires interactive `firebase login` / `gcloud auth` — ask the user to run auth commands via the `!` prefix rather than attempting it yourself.

## Architecture

### Auth & routing (the core flow)
1. `src/pages/LandingPage.jsx` — Google sign-in. On auth change it calls `resolveUserRole()` and `navigate(homePathForRole(role))`. **LandingPage owns post-login navigation.**
2. `src/components/AuthGate.jsx` wraps all routes (`src/App.jsx`). It resolves the user, renders Access-Denied / Disabled / consent-pending screens, and enforces portal boundaries: a user whose path falls outside `portalPrefixForRole(role)` is redirected to `homePathForRole(role)`.
3. `src/lib/routes.js` is the **single source of truth** for role→path mapping (`homePathForRole`, `portalPrefixForRole`). Do not hardcode portal paths elsewhere — add/extend cases here.
4. `src/lib/auth.js` holds `signIn`, `resolveUserRole(uid, email)`, and `CEO_EMAIL`.

Role resolution precedence (used identically in `resolveUserRole` and AuthGate): **UID-keyed `users` doc → `users` query by `email` → email fallbacks**. Two emails are hardcoded bypasses on both client and in `firestore.rules`: `m.alqumri@datalake.sa` (=`CEO_EMAIL`, always `ceo`) and `hr@datalake.sa` (always `hr`). Keep these in sync across `src/lib/auth.js`, `AuthGate.jsx`, and `firestore.rules` if changed.

Roles: `ceo`, `cto`, `hr`, `employee`, `client`, `finance`.

**Portal segregation** (enforced in AuthGate; `firestore.rules` is the real boundary):
- `/ceo/*` — **CEO only** (`m.alqumri@datalake.sa`); any other role is redirected to its own home.
- `/finance/*` — `finance` role + CEO. `FinanceLayout` (Dashboard/Invoices/Payroll/Expenses/Reports) reuses the CEO finance components (`src/pages/ceo/finance/*`, `CEOPayroll`) via Outlet context. `finance` home/prefix is now `/finance` (was `/ceo/finance`).
- `/hr/*` → `hr` + CEO · `/admin/*` → `it_admin` + CEO · `/employee/*` → **all roles** (everyone is also an employee).
- The CEO sidebar has a **Switch Portal** dropdown (CEO/Finance/HR/Admin/Employee views).

### CI/CD
`.github/workflows/deploy.yml`: on push to `main`, build → deploy to a Firebase **preview channel** → run Cypress against the preview URL → **promote to live only if green** (failing tests leave live untouched) → tag `v{date}-{time}`. Secrets: `FIREBASE_TOKEN`, `CYPRESS_ENV_JSON`. `.github/dependabot.yml` runs weekly npm vulnerability scans (root + `functions/` + actions). Rollback runbook: `docs/rollback.md`.

### Frontend data model
- **No global state library.** State is local `useState` plus live Firestore `onSnapshot` listeners. Layouts (`src/layouts/*Layout.jsx`) own the user-data subscription and the sidebar/onboarding/theme shell; pages own their own queries.
- **Hybrid backend access:** read/realtime data goes **directly through the Firestore SDK** from the client; mutations with side effects (email, document generation, external sync, AI) go through **Cloud Functions** via `fetch(URL, { headers: { Authorization: \`Bearer ${idToken}\` }})`. All function URLs are exported as constants from `src/lib/firebase.js` (Cloud Run `*-ifzodp5svq-wx.a.run.app`).
- `src/hooks/useAccessProfile.js` resolves RBAC permissions from the `users`/`roles`/`access_matrix` collections for fine-grained UI gating.

### Backend (`functions/`, Node 22, Firebase Functions v2)
~60+ functions exported from `functions/index.js`, all pinned to `me-central2`: mostly `onRequest` HTTP endpoints, plus a few `onSchedule` crons and Firestore triggers. Domains: recruitment/CV, hiring & contracts, timesheets/projects, finance/invoicing, RBAC admin, GRC/compliance, offboarding, forecasting.

Shared library in `functions/lib/`:
- `access.js` — RBAC: `getUserAccessProfile`, data-class `canRead`/`filterByAccess`, audit logging.
- `ai-client.js` — the AI path for Cloud Functions: LLM (**Gemma 3** — open-weight — via Ollama → `datalake-ai-inference`; model id from the `LLM_MODEL` env var so the deployed model and the audit label never drift) and OCR (PaddleOCR → `datalake-ocr`), **100% self-hosted on Cloud Run in `me-central2`, no external AI APIs**. (Qwen 2.5 3B was retired — it confabulated sample data on contract extraction.) Every call is logged append-only to BigQuery with a SHA-256 input hash (no raw prompts stored). The CV-reformatting **`cv-agent`** service (a separate Cloud Run service) uses the **same self-hosted stack** — PaddleOCR for text + Gemma 3 for structured extraction — also region-locked to `me-central2`. It previously used Vertex AI Gemini; that was **removed 2026-06-08** after a residency probe proved Gemini isn't reachable in `me-central2` for this project (`gemini-2.5-flash` 404s in me-central2, only us-central1 serves it). **There is no Vertex / Gemini / external-AI inference path anywhere.** (Known exception, flagged separately: `telephony.js` call-transcription is a non-functional *mock* that names "gemini" and fabricates a transcript — it makes **no** real API call; it needs a real self-hosted audio model and violates the No-Fabricated-Data rule until fixed.)
- `gmail.js` — transactional email via Workspace domain-wide delegation (IAM `signJwt`, no key files).
- `zoho-connector.js` / `accounting-connector.js` — Zoho Books OAuth/sync; credentials from Secret Manager.
- `invoicing.js` — invoice lifecycle + ZATCA Phase-2 UBL XML (15% VAT).

Auth in functions: verify `Authorization: Bearer <idToken>` with `admin.auth().verifyIdToken()`, then gate by role. Public exceptions: `submitCareerApplication`, `zohoPaymentWebhook`.

External services: **BigQuery** (`datalake_audit`, `datalake_finance` — immutable/append-only audit), **Cloud Storage** (`datalake-cv-uploads`, WORM `datalake-worm-hr`, `datalake-grc-library`), **Secret Manager**, **Google Workspace Directory** (provision/offboard accounts), **Zoho Books**.

### Authorization layers (defense in depth)
`firestore.rules` is the real security boundary for direct client reads/writes (CEO-only writes on RBAC collections, role checks via `getUserRole()`, `client_id` scoping). Cloud Functions re-verify role for privileged operations. AuthGate / `routes.js` are **UX routing only** — never the trust boundary.

## Security Controls

Quick reference for the security posture. Full auditor-facing detail in `docs/SECURITY.md`.
**Be accurate when editing this section or SECURITY.md — both are handed to bank security
teams and ISO auditors. Never document a control as built unless it actually is.**

- **Password policy** — min 12 chars, ≥1 uppercase / lowercase / number / special.
  - *Client-side validation is built & deployed*: shared rules in `src/lib/password-policy.js`,
    live checkmarks via `src/components/PasswordChecklist.jsx`, on the public `/reset-password`
    page (`src/pages/ResetPassword.jsx`) and the employee Profile "Change Password" card.
  - *Server-side enforcement* is a Firebase Auth password policy (`functions/set-password-policy.js`,
    `enforcementState: ENFORCE`). **It is code-complete but ACTIVATED ONLY by running that
    one-time script** (`gcloud` ADC). Until run, the client rules are advisory, not enforced.
  - No periodic forced rotation (`forceUpgradeOnSignin: false`) — aligns with NIST 800-63B.
  - **Gaps (not enforced):** "force change of temp password on first login" — IT-Admin reset
    writes a `force_reset`/`must_change` flag (`password_policies/{uid}`) that is only *displayed*
    in `/admin/credentials`; login does not gate on it. Account lockout is Firebase's built-in
    anti-abuse throttling (`auth/too-many-requests`), **not** a fixed 5-attempt policy.
- **MFA** — **NOT implemented in the platform.** Onboarding asks staff to enable MFA on their
  Google Workspace account (org-level), but the app enforces no second factor. Planned (see TODO).
- **Auth** — Firebase Auth email/password only; Google SSO was removed (commit `9532297`). Sessions
  use Firebase's default ID-token model (≈1 h token, silent refresh, `browserLocalPersistence`).
  Two hardcoded role bypasses kept in sync across `auth.js` / `AuthGate.jsx` / `firestore.rules`:
  `m.alqumri@datalake.sa` (ceo), `hr@datalake.sa` (hr).
- **Firestore rules** (`firestore.rules` — the real boundary) — role-based via `getUserRole()`,
  default-deny catch-all. Payroll (`payroll_runs`) is read-restricted to CEO/finance/HR with
  segregation of duties: finance/HR prepare the DRAFT, **only the CEO** transitions DRAFT→APPROVED;
  employees read payslips only through the `listMyPayslips` function (caller==subject). Approval-
  evidence subcollections are CEO-only create and immutable (`update, delete: if false`). RBAC
  collections (`roles`, `access_matrix`, `users.role_id`) are CEO-write-only; the CEO cannot change
  their own role.
- **Storage rules** (`storage.rules`) — `approval-evidence/**` is read/write for any authenticated
  user (Firestore rules gate which evidence rows are valid); `employee-photos` writes are scoped to
  the owning employee; default-deny catch-all (CEO read-only).
- **Data residency** — everything region-locked to `me-central2` (Dammam, KSA) for PDPL + ZATCA.
  Encryption at rest (AES-256) and in transit (TLS 1.2+) are Google Cloud platform defaults.
- **Audit logging** — AI calls are logged append-only to BigQuery (`datalake_audit`) with a SHA-256
  input hash and no raw prompts (`functions/lib/ai-client.js`). Every material approval writes an
  immutable evidence row (approver identity, `approved_at`, `ip_address`, `user_agent`, signature,
  and file SHA-256 when a document is required), enforced immutable by `firestore.rules`. HR/email
  actions append to `email_log` (`write: if false` from clients); credential actions write admin
  audit rows.

## Conventions
- ESM throughout (`"type": "module"`). React 19, React Router 7.
- Styling: CSS custom-property design tokens in `src/index.css`, per-portal stylesheets in `src/styles/` (`ceo.css` dark navy `#010e2b`/accent `#1598CC`; `engineer.css` light). Inline styles only for dynamic values.
- Hosting is a SPA: `firebase.json` rewrites all paths to `/index.html`. New top-level routes must be registered in `src/App.jsx`; client-side navigation must target paths that exist there (a missing route renders a blank page).
- Lifecycle data uses explicit state machines (e.g. candidate `APPLIED → … → ACTIVE_EMPLOYEE`, timesheet `SUBMITTED → CTO_APPROVED → CLIENT_SIGNED`); transitions are validated server-side — follow the existing allowed-transition maps rather than setting states ad hoc.

## Business Context & Rules

### Active Employees (12)
Mohammed Alqumri (CEO, m.alqumri@datalake.sa), Khalid Mohammed (Finance / Accountant, DLSA1003, khaled@datalake.sa), Mahmoud Abdelghany (mah.abdelghany@datalake.sa), Mohamed Dahas (moh.dahas@datalake.sa), Marwen Benalayat (mar.benalayat@datalake.sa), Salaheddine Gragba (saleh.gragba@datalake.sa), Marwan Ayoub (mar.ayoub@datalake.sa), Alaa Alkattan (alaa.alkattan@datalake.sa), Bassam Soliman (Technical Director NOT CTO, bassam.soliman@datalake.sa), Mohamed Ashraf (moh.ashraf@datalake.sa), Mahmoud Metawea (mah.metawea@datalake.sa), Marwan Mohsen (mohamed.mohsen@datalake.sa)

### CTO Role
VACANT. CEO acts as CTO for timesheet approval. CTO portal stays built but unused.

### Design System
Navy #022873, Sky Blue #1598CC, Orange #EF5829, Green #34BF3A. Background #F4F6F9, Cards #FFFFFF, Border #E5E7EB. Sidebar 260px fixed left navy. Font DM Sans fallback Arial. Icons Lucide React.

### Company legal details (single source of truth)
All footers, PDPL notices, contracts, and any printed/PDF surface must read from `src/lib/company-legal.js` (frontend) or its verbatim backend mirror `functions/lib/company-legal.js` — never hardcode the name / CR / address inline. The two `company-legal.js` files MUST stay in sync. Canonical values (CEO-locked 2026-06-06):
- Legal name (EN): **Datalake Saudi Arabia LLC** (always WITH "LLC")
- Legal name (AR): **شركة بحيرة البيانات للاستشارات في مجال الاتصالات وتقنية المعلومات**
- Entity type (AR): **شركة ذات مسؤولية محدودة (LLC)**
- CR: **1009194773** · Unified Number (NUN): **7048904952**
- Address: **Rajiyah Street, Al Yarmuk District, Riyadh 13243, Kingdom of Saudi Arabia** (street = `Rajiyah Street`; district = `Al Yarmuk District`)
- Canonical English footer (use `LEGAL_FOOTER_EN`): `Datalake Saudi Arabia LLC · Rajiyah Street, Al Yarmuk District, Riyadh 13243, Kingdom of Saudi Arabia · CR 1009194773 · Unified Number 7048904952`
- Wrong-and-must-never-be-reintroduced: CR `109194773` (missing leading zero), street misspellings `Rajeh Street` / `Rajeeh Street` (correct is `Rajiyah Street`), names `Datalake Saudi Arabia` (no LLC) / `Datalake Information Technology`, field label `UEN` (should be `NUN` / "Unified Number"), and `Al-Yarmouk`/`Al Yarmuk` used as the STREET (it is the DISTRICT).
- **Held for a dedicated ZATCA/legal review (NOT yet switched to the new address):** the ZATCA e-invoice seller fields (`functions/invoicing.js`) and the employment-contract employer identity + AI drafting prompts (`functions/hireSequence.js`, `functions/complianceCalendar.js`) still carry `Riyadh Al-Yarmouk 13243`. Update those only with explicit CEO/ZATCA sign-off.

### Approval evidence pattern
Every material approval (invoice, payroll, contract, …) must capture an evidence row. Use the universal components, do not roll your own:
- `<ApprovalButton parentCollection parentId requiresDocument label onApproved variant identity? extra? />` — `requiresDocument=true` enforces a signed-PDF upload; the modal then forces a signature (Draw / Upload / Type) before `recordApproval` runs. The button's `done` state shows a `SignedBadge` with the signature thumbnail.
- `<SignedBadgeList parentCollection parentId compact />` — drop this on any parent-doc page (invoice / payroll run / contract) to surface every prior approval on that doc with click-to-expand `EvidenceTrailModal`.
- Evidence row shape (under `<parent>/<id>/approval_evidence/<auto-id>`): `approver_{uid,email,name,role}`, `approved_at`, `ip_address`, `user_agent`, `evidence_{url,filename,size_bytes,mime_type,sha256,storage_path}` (when `requiresDocument`), `signature_{url,storage_path,method,size_bytes,typed_name}`, `requires_document`, `label`, `action`, `parent_{collection,id}`, plus any caller-supplied `extra` keys. PDF + signature are uploaded to `approval-evidence/<col>/<id>/<ts>_…` as separate objects.
- Token-based flows (external counsel, etc.) pass `identity={ email, name, role }` so the evidence row attributes the action correctly when there's no Firebase Auth user.

### Approval routing pattern
- Routine leave / expense / ticket flows route through PM → Finance → HR (never CEO) per the DOA matrix at `approval_routing/config` (CEO-editable at `/ceo/admin/delegation`).
- Use the shared helpers in `src/lib/approval-routing.js`: `loadApprovalContext({ email })`, `describeLeaveApprover`, `describeExpenseApprover`, `describeTicketAssignee`, `formatApprovalChain`. They resolve the user's active project assignment → PM, fall back to CEO with `isCeoFallback: true` when no PM, and merge `approval_routing/config` over defaults.
- Forms must show the resolved approver inline ("This will be sent to [Name]…") and stamp `routing{}` + top-level `client_pm_email` on the submitted doc so downstream filters work without nested-map queries.
- CEO `CommandCenter` "Items Needing Your Decision" only surfaces invoices/payroll/hires/critical tickets/unpaid-or-hajj leave. Do not pipe routine items into the CEO surface.

### Schema-drift watchlist (Antigravity backend has tripped on these repeatedly)
- `leave_requests`: frontend writes `leave_type` + `working_days`. Not `type` / `days`.
- `invoices`: frontend uses `total`, `period_start`, `period_end`. Not `amount` / `period`.
- `employees`: has `employment_status`, NOT `role_id` (that's on `users`).
- `talent_pool`: filter on `state` (e.g. `ACTIVE_POOL_YEAR_1`, `REJECTED`), NOT `status`.
- `timesheets`: filter on `state` (per the chain SUBMITTED → CTO_APPROVED → CLIENT_SIGNED → INVOICED), NOT `status`.
- `users`: `onboarding_complete` (no `-d`). `last_password_change` does not exist in the frontend write path; do not query it for "password expired" rules.
- `approval_evidence.evidence_url`: a Firebase Storage **download URL** (https://). The `gs://`-prefixed bucket path is in `evidence_storage_path` — that's what integrity scans must read.

### Status vocabulary (canonical — standardize, do not re-fork)
The field-name + casing split was the root cause of the dashboard "0 vs real" drift (Active Projects/Employees). Canonical rules — every query must obey:
- **Employees**: use `employment_status` (NOT `status`), values **UPPERCASE** (`ACTIVE`, `ONBOARDING`, `PENDING_APPROVAL`, `PENDING_OFFBOARDING`, `TERMINATED`). Every employee query = `employment_status == 'ACTIVE'`. (`users` is a separate collection that legitimately uses `status` = `active`/`disabled`.)
- **All entity status enum values are UPPERCASE** (`ACTIVE`, `PAID`, `SUBMITTED`, `OPEN`, `DRAFT`, …). Never `'active'` / `'Active'` / `'Paid'` / `'open'`.
- **Data dependency:** the 11 pre-platform employee records still carry legacy `status:'active'` and need `employment_status:'ACTIVE'` backfilled for the canonical query to return them (migration handoff).
- Known stragglers on the wrong convention (fix per-collection, data-check first): `job_listings` uses lowercase `'open'` (Careers.jsx, HRJobListings.jsx); the **client portal** uses capitalized `'Active'`/`'Paid'`/`'Pending'` (ClientPOs/ClientInvoices/ClientEngineers); some ticket/contract client-side filters use `'Resolved'`/`'Closed'`/`'Expiring'`.
- Lifecycle collections key on `state`, not `status`: `talent_pool`, `timesheets`.

### New-page connection rule (single source of truth)
No new page or view may introduce its own copy of a fact, data source, or feature that already
exists. Before building or editing any page:
1. Enumerate the facts/data/features it reads or writes.
2. Locate the existing canonical source for each (**search first**).
3. Read/write THAT source only — no parallel field, collection, or store.
4. If none exists, create ONE canonical source future pages reuse.
5. Report the connections made BEFORE writing code.
A new page that duplicates an existing store is rejected.
- ✅ Model: the business-card photo step — searched, found canonical `employees/{id}.photo_url`,
  reused it, reported the connection.
- ❌ Anti-pattern: the free-text `employees.assigned_project` field built in parallel to the
  canonical `engineer_project_assignments` collection — caused cross-view drift (Directory vs
  Talent vs Projects showed different answers); now retired in favour of the one canonical store.

### No-Fabricated-Data rule (extends status-integrity)
- The platform **NEVER** displays or stores placeholder / dummy / sample / invented values as if
  they were real. A field with no real data shows **"Unknown" / "Not connected" / "No data"** —
  never a fabricated value, never a positive default (no green-by-default, no fake "Running", no
  sample/seed row shown as live).
- When a feature needs real data or a connection that doesn't exist yet, **STOP and ASK the CEO**
  for the reference (source collection / API / link / credential). Do not invent data to fill a
  screen.
- **Allowed and required:** synthetic inputs used ONLY for self-tests / health probes that are
  **never displayed and never stored** as real records — they verify the truth, they don't fake it
  (e.g. the cv-agent `/health` dummy fixture; `getAiServiceHealth` showing "Not checked" grey, and
  IDLE/BROKEN instead of a green default).

### Hard Rules
- Every page: loading, error, empty states. Never blank.
- No mock data. No hardcoded values. Read from Firestore.
- IAM invoker: browser-facing HTTP Cloud Functions (called from the React app with a Firebase ID token) MUST grant `allUsers` the `roles/run.invoker` role and enforce auth in-code via `admin.auth().verifyIdToken()` — a Firebase ID token is not a Google OIDC token, so a `domain:datalake.sa`-restricted invoker returns a platform 403 before the code runs and breaks the feature. Reserve `domain:datalake.sa` / service-account invoker restrictions for service-to-service (non-browser) functions only.
- No min-instances on Cloud Run.
- Timesheet chain: SUBMITTED > CTO_APPROVED > CLIENT_SIGNED > INVOICED
- All data in me-central2.
- Test with npm run build not just dev.
- Do not add features not in the master tracker.

### Status Integrity Rule (CEO-mandated — applies to every status surface)
**No status indicator may render a healthy / passed / compliant / running / green state unless
derived from a real, verifiable signal queried at render time.**

Specific enforcement:
- **Unverified or uncheckable states MUST show "Unknown / Not checked" (grey/neutral) — NEVER a green/positive default.**
- A `setTimeout` that sets status to "Running" after a delay is fabrication, not a health check. Forbidden.
- Hardcoded `status: 'Running'`, `errorCount: 0`, or a client-stamped `new Date()` as "last invocation" are all fabrication. Forbidden.
- A service that does not exist (absent from Cloud Run) MUST show "Not deployed" — never "Running" or "Healthy".
- The check MUST be server-side (Cloud Function querying Cloud Run API / Cloud Monitoring) to avoid browser→Cloud Run CORS and IAM blockers.

Surfaces this applies to (non-exhaustive):
- **AI Operations dashboard** (`/ceo/ai-ops`, DTLK-ARCH-AI-002) — now backed by `getAiServiceHealth` CF.
- **PDPL "Passed" audit badge** — must reflect actual evidence records, not a hardcoded pass.
- **Onboarding / consent flags** — must be read from Firestore, not assumed complete.
- **Every status column, badge, or pill** in the CEO Command Center, HR, Finance, and Compliance surfaces.
- **GRC document status** — APPROVED/COMPLIANT requires a real approval_evidence row, not a flag set client-side.

### AI Cloud Run Service Registry (DTLK-ARCH-AI-002 ground truth)
Three Cloud Run services are deployed in `me-central2`. **Do not list others as deployed — they exist only in planning docs.**

| Service name | Role | URL pattern |
|---|---|---|
| `datalake-ai-inference` | LLM (**Gemma 3**, self-hosted Ollama; Qwen 2.5 3B retired — confabulated) | `datalake-ai-inference-808056940626.me-central2.run.app` |
| `datalake-ocr` | OCR (PaddleOCR) | `datalake-ocr-808056940626.me-central2.run.app` |
| `datalake-cv-agent` | CV reformatter — **self-hosted** PaddleOCR (`datalake-ocr`) + Gemma 3 (`datalake-ai-inference`), in-region me-central2, no external AI | `datalake-cv-agent-808056940626.me-central2.run.app` |

`gatekeeper-ai-service`, `controller-ai-service`, `auditor-ai-service`, `qwen-inference-service` — **not deployed**. The agents named gatekeeper/controller/auditor in `ai-client.js` are logical roles (the `agent:` field in LLM calls), not separate Cloud Run services. All three logical agents call `datalake-ai-inference` via `callLLM()`.
