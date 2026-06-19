# Datalake Platform — Build Status

_Single place to see what's built, what's live, and what's still open._
_Last updated: 2026-06-19. Ground truth is always `git log` + the code; this is the human summary._

---

## 🚀 Live in production
- **Deploy tag:** `v20260619-deploy` — everything below is deployed to
  `https://datalake-production-sa.web.app` (functions + firestore rules + storage + hosting).
- **Deploy mechanism:** manual `firebase deploy` (CI does **not** auto-promote). Needs
  `firebase login --reauth` first; gcloud token also expires separately. New browser-facing
  functions use `invoker:"public"` in code (Firebase-native grant — no gcloud needed).

---

## ✅ Built & shipped this cycle

### HR · Interview CV Prep
- Fills the agreed **DTLK-FORM-HR-CV-002 v1.1 DOCX** template (docxtemplater), grounded — no
  fabricated fields. (Was generating a from-scratch PDF — wrong.)
- "View Original CV" bucket fix (was looking in the wrong bucket → "CV file not found").
- Sends the prepared file to client + CC; tamper-evident SHA-256 on the artifact.
- **Interview invite**: date/time → `.ics` calendar invite (Teams via MS Graph if configured;
  else Google `.ics`). Sends to candidate + client + CC.

### Timesheets
- Fixed the blocker where **all employees** saw "no active project assignment" (case-sensitive
  email match → now matches email any-case + engineer_id fallback). Engineer-view now agrees with HR.
- Rule intact: an engineer not on a project **can't** submit (UI + server 403).
- ⚠️ **GAP:** invoice close-out — signed timesheets never reach `INVOICED` / no `invoice_id`
  backlink → double-invoice risk. **Not built.**
- **Client project-timesheet (new, DTLK-HR-TS-002)** — replaces the Emkan Excel. `/crm/timesheets`:
  monthly grid (roles × days, In-house/Remote/Leave, weekends auto + editable holiday list),
  **CEO/CTO review before client** with a **labeled "additional-billable"** section (travel/
  client-requested — never disguised as attendance), client-logo upload on the client page, and a
  **landscape PDF** matching the layout with the **corrected** legal footer. **Live (increments 1–3).**
  *Remaining:* client sign-off (`CLIENT_SIGNED`) + invoice hand-off.

### Payroll (Zoho-like suite)
- **Deductions & Bonuses** (`/hr/deductions`): per-employee, categories (loan/advance/fine/
  absence/damage/GOSI-adj/**bonus**/other), one-off or N-month **installments** with running
  balance; bonus = positive adjustment. Consumed on approval (idempotent), reversed on cancel.
- **3-stage approval** (CAPA-PAY-002, changed from CEO-only): HR prepares → **Finance** signs
  (DRAFT→FINANCE_APPROVED) → **CEO** signs (→APPROVED). Server-enforced; signed evidence per stage.
- **Payslips**: auto-emailed to each employee on final approval **and** in the portal.
  Itemized deductions + bonuses + legal footer.
- **Currency-safe salary**: SAR-only writes SAR fields; foreign held for Finance conversion;
  auto-mapped salaries flagged ⚠UNVERIFIED until HR confirms.
- **Cancel/undo** an approved run (CEO-only) → re-credits consumed deductions.
- **Config-driven settings** (`/ceo` payroll page → "Payroll & Operations Settings"):
  GOSI rates, MOL number, timesheet window, escalation SLA, payroll auto-run day.

### HR · Employee Directory
- Per-employee **project assign dropdown** (writes canonical `engineer_project_assignments`),
  ⚠Unassigned + salary-readiness flags, and a banner counting who's not ready for timesheets/payroll.

### CRM
- **Phase 1** (pre-existing): pipeline/Kanban, CSV import, quote→Finance→CEO approval, soft-delete.
- **Phase 2 (new, live):** `/crm/dashboard` (pipeline value by stage, win rate, avg deal, deals by
  owner, stuck-deals >30d) · `/crm/contacts` (people derived from `deals`, dedup by email) ·
  `/crm/tasks` (new `crm_tasks` store — add/assign/due, open/mine/overdue/done, mark done).
- **Phase 3 (new, live):** weighted forecast on the dashboard (`STAGE_PROBABILITY` in lib/deals) +
  pipeline **CSV export** · **quote PDFs** (pdfEngine `quote` template, download per quote on the
  deal page) · 4 reusable **email templates** in the deal composer.
- **E2E:** `cypress/e2e/crm-phase2-3.cy.js` + `hr-payroll-flows.cy.js` (run needs `cypress.env.json`).

### Security / compliance
- **Data-leak sweep: clean** — AI 100% self-hosted in me-central2 (no external LLM), audit logs
  = SHA-256 hashes only, no hardcoded secrets, CORS whitelisted.
- **Fixed: Zoho was leaking finance data out of KSA** — `invoicing.js` used global `.com`
  endpoints → switched all to `.sa` (Saudi region). PDPL residency restored.
- Hardened a CORS `"*"` fallback on the signature-accept endpoint.
- `task_audit_log` made genuinely append-only (create-only, no update/delete).

### Data
- **Full Firestore backup** before any CRM migration →
  `gs://datalake-production-sa.firebasestorage.app/firestore-backups/pre-twenty-migration-2026-06-19`.

---

## 🟡 Open — needs your input
- **GOSI rates + MOL number**: enter the *real* verified values in the Payroll Settings panel
  (current defaults are placeholders — confirm with Khalid/accountant).
- **Arabic payslip template**: you're building a placeholder DOCX; send it and I wire the fill
  (PDFKit can't shape Arabic — template approach chosen).
- **ipify decision**: frontend calls `api.ipify.org` (US) for IP capture in consent evidence —
  (A) move server-side, (B) drop IP, (C) leave. *(Recommended A.)*

## 🔵 Open — build queue (tasks)
- **Run the Cypress specs** — written + committed; need `cypress.env.json` test creds (or CI) to execute.
- **Timesheet invoice close-out** (double-invoice protection).
- **White-label config** (5 tasks): make company-specific values configurable for another company.
- _Parked:_ **Twenty CRM adoption** — superseded by building CRM natively (residency + AGPL +
  separate-app reasons). Runbook kept at `infra/twenty/README.md`.

---

## 🧭 Key facts to remember
- **Region-locked** me-central2 (PDPL/ZATCA). AI is **self-hosted** (Gemma/Qwen + PaddleOCR) — no external LLM.
- **Single source of truth**: project assignment = `engineer_project_assignments` (not the retired
  `employees.assigned_project`); CRM deal = `deals`; client = `clients`.
- **Legal identity** is CEO-locked + dual-mirrored (`src` + `functions` `company-legal.js`).
- This file is a summary — **`git log` and the code are authoritative.**
