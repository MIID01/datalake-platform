# TODO

Priority order. "Active" = work on these now; "Parked" = blocked on a dependency; "Done" = completed.

## Active Tasks (work on these)

### T2: Remaining mock-data cleanup (most done — see Done)
- **Finance Cash Flow** — replace `baseCash=0` with a real forecast from the `recalculateForecast` function. ⏸ deferred: overlaps the in-flight finance backend work on `feature/controller-finance`.
- **AI Operations** — replace the `setTimeout` fake "Running" status with real Cloud Run health pings. ⏸ deferred: browser→Cloud Run health pings need an unauthenticated health endpoint + CORS; random errorCount already removed.

## Parked (waiting on dependencies)

### T5: Zoho Invoice Push
Needs Invoice Builder (T1) first. Wire `syncToZohoBooks` after invoice approval.

### T6: ZATCA XML Generation
Needs Invoice Builder (T1) first. Wire `generateZatcaXml` after approval.

### T7: WPS Payroll File Generation
Needs the Payroll Procedure document (Phase 6) first. Build the WPS file format for bank submission.

## Done (completed)
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

