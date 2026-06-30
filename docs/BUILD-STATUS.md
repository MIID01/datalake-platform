# Datalake Platform — Build Status

_Single place to see what's built, what's live, and what's still open._
_Last updated: 2026-06-30. Ground truth is always `git log` + the code; this is the human summary._

## 📌 2026-06-30 deploy — GRC/CRM consolidation is now LIVE (read this first)
The committed consolidation at `main`==`origin/main`==`0ed677e` was **deployed to production**
(functions + firestore rules + storage + hosting) from a re-authenticated local session
(`m.alqumri@datalake.sa`). Root build green; deploy clean.
- **NOW LIVE (this deploy):** GRC Document Library + GRC Compliance Agent (all 10 fns:
  uploadGrcDocument, listGrcDocuments, downloadGrcDocument, getGrcChangeLog, extractGrcMetadata,
  reindexGrcEmbeddings, grcAssistantChat, grcAuditReadiness, approveGrcProposal, grcReviewSweep —
  all `me-central2`), plus the soft-delete/recycle-bin backend + WORM recovery and timesheet
  validation that rode in the same 4 commits (`98476b6`, `cb9af26`, `19e855a`, `0ed677e`).
- **Smoke-verified (honest signals, not assumed):** `listGrcDocuments` no-token → 401 (auth-gated);
  `grcAssistantChat`/`reindexGrcEmbeddings` GET → 405 (POST-only handlers reached); `uploadGrcDocument`
  OPTIONS → 204 (CORS preflight). No 404/500.
- **DEFERRED manual step:** `reindexGrcEmbeddings` (one-time RAG index build) was **NOT run** — it
  requires a CEO **Firebase ID token** (a gcloud OAuth token can't satisfy `verifyIdToken`), and there
  are no GRC docs to index until the bulk upload happens. **Run it from the deployed GRC UI as CEO
  AFTER uploading the GRC files.**
- **NOT in this deploy (intentionally held):** the 7 newer timesheet/contract commits on
  `feature/crm-phase-1` (`8b536b7 1103dd9 e15ca37 1e2bbae` + 3) — they post-date the approved scope and
  await their own review/deploy. `main` was deployed, not the feature branch tip.
- **Excluded from git:** `docs/interview-invite-abdullah-fauzy.html` (candidate PII), still untracked.

## 📌 2026-06-23 consolidation (superseded by the 2026-06-30 deploy above)
All in-flight work across sessions was **committed in 2 clean commits** and **pushed to
`origin/feature/crm-phase-1`** (backup only — **NOT merged to `main`, so NOT auto-deployed**).
- **LIVE in production now** (hosting + the two agent functions + agent rules): CRM **P1**
  (activity timeline/logging + contact detail), CRM **P2** (explainable lead scoring),
  pipeline **search**, campaigner **honesty + link-privacy** fixes, follow-up **agent** +
  stuck-window selector, Careers footer → `LEGAL_FOOTER_EN`.
- **Committed but NOT deployed** (need your review, then deploy): recycle-bin/soft-delete
  backend + WORM recovery, GRC agent/library, timesheet validation + CTO project-sign,
  MFA enrollment, invoice-validate, session-timeout, misc.
- ⚠️ **Caveat to fix when back:** the hosting deploys shipped the **frontend** for those
  not-yet-deployed backend features (recycle-bin, GRC panels, MFA, CTO timesheets). Those
  pages are **live but their Cloud Functions are not deployed**, so they will **error if
  used** until you `firebase deploy --only functions` (after reviewing them). They're
  otherwise inert. I did **not** deploy unverified backend while you were away.
- **Excluded from git:** `docs/interview-invite-abdullah-fauzy.html` (candidate PII).


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
  **landscape PDF** matching the layout with the **corrected** legal footer. **Client sign-off live both
  ways** — emailed secure token link (`/sign-timesheet/:id`) **and** client portal (`/client/timesheets`),
  typed-name+affirmation e-signature → immutable evidence → `CLIENT_SIGNED`. **All increments live.**
  *Remaining:* generate the invoice from a `CLIENT_SIGNED` timesheet (ties into the invoice close-out gap).

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

### CRM · First real agent (DTLK-AI-AGENT-001) — **built local, not deployed**
- **Stuck-Deal Follow-up assistant** — the platform's first agent. Scans deals open >30d
  and **proposes** a grounded follow-up task each; nothing is created until a human
  **Approves** (then it writes a `crm_task`). Manual "Run follow-up assistant" button on
  `/crm/dashboard`; **CEO/business only**; proposals expire in **14 days**.
- Agent drives a fixed server-side tool catalog via structured-JSON tool-selection
  (`callLLM` has no native tool-calling). WRITE tools are never in the model's catalog —
  only a human click invokes them. Acts as principal `agent:crm-followup` (no token
  impersonation); every step → immutable `agent_action_log`. New CF-write-only stores:
  `agent_runs` / `agent_proposals` / `agent_action_log`.
- Files: `functions/crmAgent.js`, `runFollowupAgent`/`approveAgentProposal` in
  `functions/index.js`, rules block, `src/pages/crm/CRMAgentPanel.jsx`.
- ✅ **DEPLOYED 2026-06-21** (functions `runFollowupAgent`/`approveAgentProposal` +
  rules + hosting; build-green; **25/25 local logic tests**; Cloud Run URLs verified).
- ⚠️ **NOT yet run against the live model** — loop reliability (Qwen emitting valid
  tool-selection JSON) is the one unverified gate; first live run is the test. Spec +
  build log: `docs/DTLK-AI-AGENT-001.md`.

### CRM · Enterprise program (DTLK-CRM-ENT-001) — **P1 built local, not deployed**
- **Honest framing:** not claiming to beat Salesforce on breadth; building the real
  enterprise capabilities that matter, on real data, in-region. One phase at a time.
- **P1 — Activity timeline + logging (BUILT):** enterprise activity logger
  (Note/Call/Meeting/Task, back-datable `occurred_at`, outcome, "schedule follow-up" →
  linked `crm_tasks`), unified timeline + Next-steps on the **deal** page, and a new
  **contact detail** (`/crm/contacts/:email`) aggregating activity across a contact's
  deals. Reuses `deal_activities` + `crm_tasks` (no new store/rules/functions).
  Components: `src/lib/activity.js`, `src/components/crm/{ActivityTimeline,LogActivity,NextSteps}.jsx`.
- ✅ **DEPLOYED 2026-06-22** (hosting); build-green + lint-clean; review gate before P2.
- ✅ **Pipeline search bar** also deployed (search deals by title/company/contact/email/owner).
- **P2 — Lead/deal scoring ✅ DEPLOYED 2026-06-22:** explainable deterministic score
  (stage 40 + value 25 + recency 35), "low signal" when never contacted; score card +
  factor breakdown on the deal page, chip + hottest-first sort on the pipeline.
  `src/lib/scoring.js`. No AI/no fabrication (in-KSA Gemma rationale = later P2.5).
- Next phases: P3 workflow automation/SLAs · P4 saved views/filters/bulk · P5 reporting
  + dedupe. Spec: `docs/DTLK-CRM-ENT-001.md`.
- ✅ **Campaigner honesty fix deployed 2026-06-22** — blunt "Datalake does not run ads"
  banner; "Active/Stopped" relabeled as a user tracking label (not a live-ad control);
  only the link-attributed applicant/hired counts are presented as real. (Was the
  "running with zero connection" fabrication.)
- ✅ **Agent stuck-window selector deployed** — `runFollowupAgent` accepts `min_days`;
  panel selector 3/7/14/30/60 (default 14). NOTE: deals are ~5 days old, so use the
  3-day window to surface/test them today; longer windows populate as deals age.
- ✅ **Campaign-link privacy fix deployed** — public tracked link now uses the opaque
  `campaign_id` in `utm_campaign`, never the human name/slug (was exposing client
  "Emkan" in a public LinkedIn URL). Attribution unchanged; readable name stays internal.

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
