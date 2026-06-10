# TODO

Priority order. "Active" = work on these now; "Parked" = blocked on a dependency; "Done" = completed.

## Active Tasks (work on these)

### T9: Employee digital card — SHIPPED (QR-only) + PARKED (photo/print)
CEO trimmed scope to JUST the QR, residency-locked (no photo, no .vcf-with-photo, no print, no automation).

**SHIPPED (hosting only):** `/employee/card` (`src/pages/employee/BusinessCard.jsx`) — QR-only,
fully client-side. The vCard is assembled in-browser from the employee's Firestore record (photo-free);
the QR is rendered by the LOCAL `qrcode` lib (**no external QR API** — confirmed: no qrserver/goqr/
quickchart/etc. anywhere); an optional `.vcf` download is built client-side. No photo, no print, no
automation, **no call to generateBusinessCard**. Meets the residency rule (nothing leaves the platform).

**PARKED — pending CEO park-vs-kill (built, NOT deployed, DO NOT DELETE):**
- `functions/businessCard.js` (`generateBusinessCard`) — server-side card that resizes the canonical
  `employees/{employee_id}.photo_url` via `sharp` (~400px) and embeds it as `PHOTO;ENCODING=b` in the
  `.vcf` only (opt-in, no public URL), plus the `processing_activities/employee-photo` RoPA writer.
- Its `index.js` export, the `sharp` functions dep, and `GENERATE_BUSINESS_CARD_URL` (firebase.js) are
  **commented out** so nothing ships until the CEO decides.
- **To REVIVE:** un-comment the export in `index.js` + the URL in `firebase.js`, then deploy
  `functions:generateBusinessCard`. **To KILL:** delete `functions/businessCard.js`, remove `sharp`
  from `functions/package.json`, and drop the commented blocks.

### T2: Remaining mock-data cleanup (most done — see Done)
- **Finance Cash Flow** — replace `baseCash=0` with a real forecast from the `recalculateForecast` function. ⏸ deferred: overlaps the in-flight finance backend work on `feature/controller-finance`.
- **AI Operations** — replace the `setTimeout` fake "Running" status with real Cloud Run health pings. ⏸ deferred: browser→Cloud Run health pings need an unauthenticated health endpoint + CORS; random errorCount already removed.

### T3: DTLK-SPEC-GRC-002 — GRC document approvals/attestation (SANCTIONED — spec pending CEO sign-off)
Adds a genuine-review approval/attestation workflow over the existing GRC document library
(`functions/grcLibrary.js`). **Sequence: full spec → plan → CEO sign-off → build.** Not yet
built. Build guardrails (corrections agreed with CEO):
- **auth_method** is DERIVED from the verified Firebase token (`sign_in_provider`, plus
  `sign_in_second_factor` when present) — never hardcoded (today's real value: `password`).
- **DOCX export footer** uses `LEGAL_FOOTER_EN` (`src/lib/company-legal.js`) — NUN, CR 1009194773,
  correct address. The spec's `UEN`/`Rajeeh` footer is BANNED. Footer stays GATED until the CEO
  confirms the canonical line.
- **Branding** reuses `src/lib/pdf-letterhead.js` + `src/components/Letterhead.jsx` +
  `functions/assets/letterhead-logo.png` for the DOCX cover/header/footer.
- **`grc_change_log`** is Admin-SDK-write only — `firestore.rules` denies client `create`.
- **Lane:** this repo builds functions + frontend + rules. **Antigravity** creates the BigQuery
  `grc_approvals` table + append-only IAM; we hand them the exact write-schema.
- **UX:** build the approve modal with the consequences-list design (genuine review, not a bulk stamp).

## Security Controls (status)

Auditor-facing detail in `docs/SECURITY.md`. Status reflects what is **actually built** — keep it honest; this list is read alongside the security doc by external reviewers.

- ✅ **Strong password policy — client** — min 12 + upper/lower/number/special, live checkmarks on `/reset-password` and the employee Profile "Change Password" card (`src/lib/password-policy.js`, `src/components/PasswordChecklist.jsx`).
- ⏳ **Strong password policy — server enforcement** — `functions/set-password-policy.js` (Firebase Auth `ENFORCE`) is committed but **NOT yet activated**. Run the one-time script (needs `gcloud` ADC) to switch it on; until then the client rules are advisory only.
- ✅ **Password reset via Gmail API** — branded link sent from `hr@datalake.sa` via Workspace domain-wide delegation (inbox delivery, SPF/DKIM/DMARC pass), plus a custom in-app `/reset-password` handler (`functions/passwordReset.js`, `src/pages/ResetPassword.jsx`).
- ✅ **Firestore security rules — payroll segregation of duties** (commit `77431b9`). Resolves the three payroll CAPAs:
  - **CAPA-PAY-001** — no blanket salary read: `payroll_runs` read restricted to CEO/finance/HR; employees fetch only their own payslip via `listMyPayslips` (caller==subject).
  - **CAPA-PAY-002** — preparer ≠ approver: finance/HR may only create/edit a DRAFT; **only the CEO** transitions DRAFT→APPROVED.
  - **CAPA-PAY-003** — immutable approval evidence: per-run evidence rows are CEO-only create, `update/delete: false`.
- ✅ **Storage rules for approval evidence** — `approval-evidence/**` authenticated read/write, gated by the Firestore evidence rules (`storage.rules`).
- 🔧 **MFA** — building now. **Not yet enforced** by the platform (only Google-account MFA is requested at onboarding).
- ❌ **Account lockout / forced first-login password change** — not enforced. Firebase built-in throttling only; the `force_reset` flag is displayed in `/admin/credentials` but not gated at login.
- ❌ **Penetration test** — not yet conducted.
- ❌ **ISO 27001 certification** — not yet pursued.

## Parked (waiting on dependencies)

### T5: Zoho Invoice Push
Needs Invoice Builder (T1) first. Wire `syncToZohoBooks` after invoice approval.

### T6: ZATCA XML Generation
Needs Invoice Builder (T1) first. Wire `generateZatcaXml` after approval.

### T7: WPS Payroll File Generation
Needs the Payroll Procedure document (Phase 6) first. Build the WPS file format for bank submission.

### T8: Canonical employer address in the hiring contract flow (DEFERRED — pipeline not live)
The employment-contract **employer identity/address** still carries the OLD address
`Riyadh Al-Yarmouk 13243` in `functions/hireSequence.js`:
- `generateContractWithAI` system prompt (~L193: `CR: 1009194773, NUN: 7048904952, Riyadh Al-Yarmouk 13243`)
- the `employer:` strings (~L214 and ~L309)
Left unchanged ON PURPOSE — the contract-issuing pipeline is **not live**: `initiateHire` →
`generateContract` → `dispatchContractForSignature` → offer-letter email has **no UI trigger**
(`initiateHire` is never called from the frontend; `src/lib/firebase.js` has no URL for it; the
`/ceo/hire-request` page only tracks `hire_requests` statuses and never issues a contract). So no
offer/contract can be issued to anyone today.
**When the hiring pipeline goes live, before issuing any contract:**
1. Update those strings to the canonical registered address
   `Rajiyah Street, Al Yarmuk District, Riyadh 13243, Kingdom of Saudi Arabia`.
2. **Decide registered legal name vs trading name** for the contract employer line — a Saudi
   employment contract should carry the **registered legal name** (`Datalake Saudi Arabia LLC`);
   confirm with CEO/legal before first issuance.
Separate from this: the **ZATCA e-invoice seller address** (`functions/invoicing.js`) is deferred
to the final ZATCA/FATOORA phase — do NOT touch it.

## Done (completed)
- **cv-agent → 100% self-hosted, in-region** (2026-06-08): removed Vertex AI Gemini / `@google/genai`
  from `cv-agent/server.js`; CV reformatting now uses PaddleOCR (`datalake-ocr`) + Qwen
  (`datalake-ai-inference`), me-central2. Residency probe proved Gemini unreachable in me-central2
  (`gemini-2.5-flash` 404 in me-central2, 200 only in us-central1), so the in-region Gemini path
  the CEO asked for can't exist here → CEO decision: stay 100% self-hosted. Also shipped the held
  `prepareInterviewCV` fix (undici-native FormData + arrayBuffer) — the original cv-agent 500s
  ("Unexpected end of form") were node `form-data` truncating under global undici fetch.

## No-Fabricated-Data — telephony transcript (RESOLVED + deferred)
- **FIXED (2026-06-08): `functions/telephony.js` fabricated transcript removed.** Deleted the
  `"gemini"` default and the fabricated-transcript code path. `transcribeCall` now stores NO invented
  text — it writes `transcript: null` + `transcription_status: "NOT_AVAILABLE"` (+ a note) and does
  NOT trigger call analysis (nothing real to analyse). No frontend ever displayed the transcript, so
  nothing showed a fake; the fake is no longer written or stored.
- **DEFERRED — self-hosted in-region call transcription (STT):** call audio + transcripts are personal
  data, so if ever built it MUST be a self-hosted, in-region model in `me-central2` (same constraint as
  the rest of the AI layer — no external/managed STT). Until then, transcripts stay `NOT_AVAILABLE`.

- Routing fix (`homePathForRole`); TaskInbox persistence; Policies page; 13 Cloud Function IAM fixes; full 64-function audit; git history security audit; DNS docs
- **Onboarding gate** centralized in `AuthGate` (all roles incl. CEO); 4-policy acknowledgment page at `/employee/onboarding` writing real consent
- **White-page fix**: `firebase.json` serves `index.html` `no-cache` + hashed assets `immutable`; app-level `ErrorBoundary` surfaces real errors instead of blanking
- **Timesheet 500 fix**: `getMyTimesheets` no longer needs a composite index (in-memory sort) + try/catch returns JSON; frontend parses responses safely
- **Employee profile**: reads `employees` by `employee_id`, correct field mapping; working photo upload to Storage (`employee-photos/`); editable phone + emergency contact (limited self-service fields)
- **Mock data removed**: employee Dashboard contract card (real assignment via `getEngineerProjectView` or empty state); AIOps random errorCount; FinanceExpenses budget→real actual-by-category; SystemHealth random sparklines→real history/empty state
- **Portal segregation**: `/ceo/*` CEO-only; new **Finance portal** `/finance/*` (`FinanceLayout`) reusing CEO finance components; `/employee/*` open to all roles; CEO **Switch Portal** dropdown; `routes.js` finance → `/finance`
- **CI/CD**: `.github/workflows/deploy.yml` (preview → Cypress → promote-on-green → tag `v{date}-{time}`); `.github/dependabot.yml` (weekly npm scans)
- **Firebase Storage enabled**; `storage.rules` deployed (incl. `employee-photos/`)
- **Security**: rotated all account passwords to unique values after a leaked shared password; purged the secret from git history
- **Docs**: `docs/rollback.md` (hosting / Cloud Run / rules / git-tag rollback)
- **Storage scoping**: `employee-photos` writes scoped to the owning employee (filename `{employee_id}` must match the caller's record; CEO/HR override)
- **More mock removed**: Compliance "Upcoming Deadlines" → real `compliance.deadlines` field + empty state; Contracts "Proposal Audit Trail" → real `proposal_reviews` collection (rules added) + empty state
- **T1 — Invoice Builder**: `/finance/invoices/new` composition page (timesheet picker → editable line items, live 15% VAT) calling `generateInvoice` with the Phase-5 composed payload (`client_id`, `po_number`, `timesheet_ids[]`); new `/finance/invoices/:invoiceId` detail page with live Firestore subscription and Zoho/ZATCA status badges (those fire automatically via Pub/Sub on `datalake.invoice.approved` — T5/T6 wiring lives in `11a7f0f`). FinanceInvoices "New Invoice" button + row click route to the real pages; placeholder modals removed. Backend role check is still CEO-only — Finance role gets a clear 403 message until the check widens.

### 2026-05-28 shipped (one long working session)

- **Admin / IT Integrations**: `/admin/integrations` accordion page on the IT Administration portal — six sections (Telephony, Email, WhatsApp, SMS, Calendar, AI) with form fields per provider, secret-detection (password inputs auto-mask as `********` on read), per-section Save calling `saveIntegrationConfig`, Test Connection calling `getIntegrationConfig` and reflecting Connected/Disconnected. ceo / it_admin role check in-page (firestore.rules + backend `validateTenantAccess` are the real boundaries). `X-Tenant-ID` header pulled from `users/{uid}.tenant_id`.

- **Approval routing redesign — A through H** (`feature/approval-routing` → main):
  - `src/lib/approval-routing.js` resolves PM / Finance / HR / CEO from a requester's active `engineer_project_assignment` → `projects` doc → users-by-role. Reads CEO-tunable overrides from `approval_routing/config`.
  - **A. Leave form** live hint: deployed engineers → "sent to [Client PM]", internal → "sent to HR", unpaid/hajj → CEO. Submits with status `CLIENT_PENDING` / `SUBMITTED` / `APPROVED` + a routing snapshot (chain, client_pm, datalake_pm, project_id).
  - **B. Expense form** live hint by amount: <SAR 200 communication = auto, <1000 = PM, 1000–5000 = Finance, >5000 = CEO. Drops the hard-coded SAR-500 threshold.
  - **C. Ticket form** assignee hint by category (IT / Finance / HR / PM / HR+CEO).
  - **D. `/client/leave-approvals`** in ClientLayout — Pending + History tabs, Approve/Reject with comment, filtered by `client_pm_email == currentUser.email`. Token-based timesheet/scorecard routes stay outside the layout.
  - **E. CEO dashboard** "Items Needing Your Decision" — 5 live filtered subscriptions (DRAFT invoices, DRAFT payroll, OFFER_PENDING candidates, CRITICAL tickets, unpaid/hajj leave). Routine leave / expenses / IT tickets are filtered out at query time.
  - **F. Real approver names** — `formatApprovalChain(approval_history)` column on Leave + Expense history ("Ahmed (Client PM) approved → Bassam (PM) approved"); ticket list shows assigned team; replaced hardcoded "Approved by CEO" in CEO Approvals with `auth.displayName (acting PM)`.
  - **G. PM role foundation** — `homePathForRole('pm') = '/pm'`, `portalPrefixForRole('pm') = '/pm'`. When `project_manager_id` is null, helper falls back to CEO with `isCeoFallback: true` so the UI says "(acting PM)".
  - **H. `/ceo/admin/delegation`** — CEO-editable DOA matrix (expense thresholds, leave types needing CEO, HR/sick day thresholds, ticket routing per category). Saves to `approval_routing/config`.

- **Hire flow + budget validation** (`feature/hire-flow` → main):
  - `src/lib/hire-budget.js` — `evaluateHireBudget()` returns monthly_cost, annual_cost, monthly_revenue, monthly_margin, margin_pct, po_value/used/remaining, traffic light. Thresholds 40% green / 20% amber; PO budget checked against annual cost. Handles HOURLY × 160, MONTHLY, FIXED (PO ÷ months).
  - `/ceo/talent` Section B gains a **"Hire Requests"** tab — form (client → project/PO dropdowns, role, salary, housing, transport, GOSI %), live budget breakdown updates as you type. `po_used` derived from existing hire_requests on the same project past `BUDGET_CHECKED` so back-to-back hires compound correctly. Submits to `hire_requests` with `status_history[]`. Initial status `BUDGET_CHECKED` when green/amber, `DRAFT` when red. Full lifecycle: `DRAFT → BUDGET_CHECKED → CEO_APPROVED → RECRUITING → CANDIDATE_SELECTED → OFFER_SENT → CONTRACT_PENDING → LEGAL_REVIEW → SIGNED → PROVISIONING → ONBOARDED → DEPLOYED`.
  - CEO **Command Center** surfaces `hire_requests where status==BUDGET_CHECKED` with the budget summary card rendered inline (margin %, annual cost, PO remaining).
  - **`/hr/contracts`** — drag-and-drop signed Qiwa PDF, calls `uploadContractPDF` (creates `contracts/{id}` shell, posts multipart, mirrors `storage_path`). Gatekeeper-extracted fields shown in 15-field editable review form. "Send to Legal Review" mints a UUID token, sets `legal_status: LEGAL_PENDING`, surfaces the token URL. Status flow: `PENDING_EXTRACTION → EXTRACTED → LEGAL_PENDING → LEGAL_APPROVED → ACTIVE`. Sidebar entry added with Scale icon.
  - **`/legal/review/:token`** public, token-gated (added to `PUBLIC_PATHS`) — verified terms read-only + comment + Approve / Flag Issues. On submit token is burned, approve flips `status=ACTIVE`, decision logged to `legal_review_log/` with user-agent since counsel has no Firebase Auth identity.
  - **Consent copy cleanup** — `Consent.jsx` no longer claims AI drafts documents ("…document drafting" → "extracting fields from documents you upload").

- **Universal approval evidence** (`feature/approval-evidence` → `feature/signatures`):
  - `src/lib/approval-evidence.js` — `sha256Hex()`, `tryGetIp()` (best-effort with 2 s abort, fails open), `resolveIdentity()` (prefers explicit `{ email, name, role }` for token flows, else `auth.currentUser` + `users/{uid}.role_id`), `recordApproval()` (upload-first sequence: storage → Firestore so no phantom "approved" rows on storage failure).
  - `src/components/ApprovalButton.jsx` — three render states (idle / working / done), drop-zone or paperclip chip when `requiresDocument`, evidence card with SHA-256 fingerprint on success. Variants: primary / success / ceo / legal.
  - **Wired into Invoice approval** (`InvoiceDetail.jsx`, DRAFT invoices only), **Payroll approval** (`CEOPayroll.jsx`, new `payroll_runs where status==DRAFT` subscription), **Legal contract review** (`LegalReview.jsx`, replaces the old Approve button, identity pinned for external counsel).
  - **Signature modal** (this session): `src/components/SignatureModal.jsx` — three tabs (Draw / Upload / Type). Draw uses pointer events so mouse + touch + pen all work on mobile; canvas DPR-scaled to stay crisp; resizes responsively with ink preserved. Upload accepts PNG/JPG/WEBP ≤5MB with preview. Type renders the name on an off-screen canvas in a cursive font stack (`'Brush Script MT', 'Segoe Script', 'Lucida Handwriting', cursive`) with auto-shrink to fit. Returns a PNG Blob.
  - **Signature → evidence**: `recordApproval` now requires a signatureBlob, uploads it separately to `approval-evidence/<col>/<id>/<ts>_signature.png`, and records `signature_url`, `signature_storage_path`, `signature_method`, `signature_typed_name` on the evidence row.
  - **`SignedBadge` / `SignedBadgeList` / `EvidenceTrailModal`** (`src/components/SignedBadge.jsx`) — reusable signed pill showing signature thumbnail + signer name + role + timestamp; click opens a full evidence trail modal (signature image, approver, IP, UA, document link with SHA-256, storage paths, extras). Wired into InvoiceDetail, CEOPayroll DRAFT panel, and the LegalReview success page so every approved doc carries its audit chain on the surface.

### 2026-05-29 shipped

- **Legal-details fix across the entire platform** (`fix/company-legal-details` → main, commit `ee972e0`):
  - CR `109194773` → **`1009194773`** everywhere
  - District `Rajeh Street` / `Rajeeh Street` → **`Al-Yarmouk`** (both spellings caught)
  - Entity name `Datalake Saudi Arabia` / `Datalake Information Technology` / `Datalake IT` (footer context) → **`Datalake Saudi Arabia LLC`**
  - Footer field `UEN:7048904952` → **`NUN:7048904952`**
  - Canonical English footer (now used on every public/legal page): `Datalake Saudi Arabia LLC, Riyadh Al-Yarmouk 13243, CR:1009194773 NUN:7048904952`
  - Arabic legal name + entity type added to legal-document surfaces (`ContractAcceptance`, `LegalReview`, `Onboarding` PDPL consent + Privacy Notice "About" + Data Controller line) — RTL block with `lang="ar"`.
  - New `src/lib/company-legal.js` — `COMPANY` const, `LEGAL_FOOTER_EN`, `LEGAL_FOOTER_AR`, `DATA_CONTROLLER_LINE_EN`. Header comment lists every place that must be updated when the canonical values change.
  - Files touched: `Careers.jsx`, `ClientDashboard.jsx`, `ClientScorecard.jsx`, `ContractAcceptance.jsx`, `LegalReview.jsx`, `Onboarding.jsx` (10 occurrences), `docs/DTLK-OPS-PLN-001-fix-plan.md`.
  - Verified clean: `CLAUDE.md`, `firestore.rules`, `storage.rules` only reference the `@datalake.sa` email domain — no legal-detail strings.

### 2026-05-29 — Antigravity Phase 7-8 audit (no fixes applied, findings only)

`feature/monthly-ops`: commits `0439316` (Phase 7 Auditor) + `f228024` (Phase 8 Monthly Ops). Same pattern as the Phase-5 audit — code is real, Pub/Sub wiring is correct, but **field/collection names drift from what the frontend actually writes**.

Pub/Sub fan-out is sound: `monthlyOperationsTrigger` (cron `0 0 1 * *` Asia/Riyadh) publishes `datalake.monthly.trigger` to 5 consumers: `generateMonthlyReport`, `gatekeeperMonthlyOps`, `controllerMonthlyOps`, `aiAuditorMonthlyCron`, `checkEvidenceIntegrityMonthly` — all topic strings match.

Per-handler issues to fix before any of this hits production:

- **`checkEvidenceIntegrityHandler` (CRITICAL)** — parses `gs://…` out of `data.evidence_url`, but my helper writes the `evidence_url` as a Firebase Storage **download URL** (`https://firebasestorage.googleapis.com/…`). The `gs://` path is in **`evidence_storage_path`**. Result: the WORM-bucket file-existence scan silently reports "PASS" on every row. **Swap to iterate `evidence_storage_path` and split on `/` from there.**
- **`aiAuditorMonthlyCronHandler`** — `u.onboarding_completed` is wrong; frontend writes `onboarding_complete`. `u.last_password_change` is never written by the frontend at all. Every active user gets flagged for both. `talent_pool.where('status', '==', 'REJECTED')` uses the wrong field — frontend uses `state`. `timesheets where t.status` ditto — CLAUDE.md mandates `state` on the timesheet chain.
- **`generateMonthlyReportHandler`** — `invoices where period == year_month` (frontend has `period_start` + `period_end`, no `period`), `inv.amount` (frontend uses `total`), `employees where role_id == 'engineer'` (employees collection doesn't carry `role_id` — that's on `users`), `leave_requests.days` + `leave_requests.type` (frontend writes `working_days` + `leave_type`). All four return zero/empty.
- **`auditorComplianceCheckHandler`** — filters engineers by `role_id == 'engineer' && status == 'active'`; the `users` collection mixes `role_id` (`employee`, `pm`, `engineer`). PDPL-consent stats under-count anyone whose `role_id` isn't `engineer`.
- **`trackCAPAStatusHandler`** — operates on `capas` collection that has no frontend writer. Dead until someone seeds it.

Two cross-cutting gaps:
1. **No `logToBigQuery` calls in any of the four files audited.** The header comment in `auditor.js` promises it; the code doesn't. Only `callOCR` / `callLLM` log themselves through `ai-client.js`.
2. **The same `state` vs `status` drift my Phase-5 audit caught** — the schema-fix commit `834cc36` only touched leave/expense/ticket. Payroll/invoice/talent_pool/timesheet are still on the old names.

Action: leave Antigravity to land their fix commit (they've followed this loop before — see `834cc36` "fix schema names" and `d9d46eb` "contract mirror"). When that lands, re-grep for any remaining `gs://` URL parsing.
