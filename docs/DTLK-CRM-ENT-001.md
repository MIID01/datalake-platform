# DTLK-CRM-ENT-001 — CRM → Enterprise-grade (honest, gated program)

_Goal: close the real capability gap with enterprise CRMs (Salesforce/HubSpot/Dynamics)
with REAL features only — no fabricated status, no invented metrics. Built one phase at
a time, each reviewed before the next (CEO directive 2026-06-22)._

**Honest framing (locked):** we do NOT claim to beat Salesforce on breadth — that would be
the same fakery as the "running campaign with zero connection." We build the enterprise
capabilities that matter, on real data, in-region, integrated with the HR/Finance/Payroll
spine — where Datalake already wins (residency, cost, sovereignty, one data model).

## Connections rule (every phase obeys)
Reuse canonical stores, never fork: deal = `deals`, activity = `deals/{id}/deal_activities`,
task = `crm_tasks`, contact = derived from `deals` by `contact_email`, client = `clients`.

## Phases
- **P1 — Activity timeline + logging ✅ BUILT + DEPLOYED 2026-06-22 (hosting; build-green, lint-clean). Review gate before P2.**
- **P2 — Lead/deal scoring ✅ BUILT + DEPLOYED 2026-06-22.** Built deterministic +
  EXPLAINABLE (not opaque AI) — every point traces to a real signal: stage intent
  (40), deal value (25), recency (35). "Low signal" when never contacted; null for
  WON/LOST. `src/lib/scoring.js`. Score card on deal detail (factor breakdown);
  chip + hottest-first sort on the pipeline board. No AI/no fabrication; the in-KSA
  Gemma "recommended next action" rationale is a later increment (P2.5).
- P3 — Workflow automation + SLAs (stage-change → auto task/reminder; extends the follow-up agent).
- P4 — Saved views / advanced filters / bulk actions.
- P5 — Reporting builder; duplicate detection & merge.
- Out of scope: native mobile app, 1000s of marketplace integrations (not worth it).

---

## P1 — Activity timeline + logging (BUILT)

The backbone every enterprise CRM is built on. Everything in P2–P5 consumes this real
interaction data.

**Connections (no new store):**
- Activities → `deals/{id}/deal_activities` (extended with optional `subject` / `occurred_at`
  / `outcome`; existing fields + EMAIL-via-send untouched).
- Next-step tasks → `crm_tasks` (linked by `deal_id`/`deal_title`; same store the Tasks page
  and the follow-up agent use). `source:'activity-followup'` tags ones scheduled from a log.
- Contacts → derived from `deals` by `contact_email` (existing logic); a contact's timeline =
  union of its deals' activities. No contacts collection invented.
- No new Cloud Functions, no rules change (these collections already permit CEO/business).

**What shipped:**
- `src/lib/activity.js` — canonical activity metadata + normalization (single source so deal
  & contact timelines can't drift).
- `src/components/crm/ActivityTimeline.jsx` — reusable feed (icons, real event time,
  outcome, author, source-deal label for the contact view).
- `src/components/crm/LogActivity.jsx` — enterprise logger: Note/Call/Meeting/Task, optional
  **back-date** (`occurred_at` — log a call from yesterday at its real time), outcome, and
  **"schedule a follow-up task"** → writes a linked `crm_tasks` row. Deal picker for the
  contact view.
- `src/components/crm/NextSteps.jsx` — open follow-ups for a deal/contact, overdue flag,
  complete-in-place.
- **Deal page** (`CRMDealDetail.jsx`) — replaced the one-line logger with NextSteps + the
  enterprise logger + unified Timeline.
- **Contact page** (`CRMContactDetail.jsx`, new, route `/crm/contacts/:email`) — aggregates a
  contact's activity + next-steps across all their deals; name links from the Contacts
  directory. Log against any of the contact's deals via the picker.

**Honesty:** no fabricated state — empty deal shows "No activity logged yet."; no invented
"last contacted" or fake engagement. Times are real (occurred or logged). Reuses real stores.

**Status:** build-green + lint-clean. **Deploy = hosting only** (no functions/rules).
**Not yet exercised against real user clicks** — review gate before P2.
