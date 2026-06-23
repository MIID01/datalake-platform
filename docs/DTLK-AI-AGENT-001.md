# DTLK-AI-AGENT-001 — First real agent: CRM Stuck-Deal Follow-up Assistant

_Status: **P0 + P1 DEPLOYED 2026-06-21 to datalake-production-sa (functions + rules +
hosting, build-green, 25/25 logic tests, Cloud Run URLs verified) — but NOT yet run
against the live model.** The one open gate: does Qwen 2.5 14B reliably emit the
tool-selection JSON the loop drives on? First live run is the test. Decisions locked:
P0+P1 · manual trigger · CEO+business only · 14-day expiry. Per CRM build-governance
(gated phases, server-side audit/PDPL)._
_Author handoff: 2026-06-21._

## BUILD LOG (2026-06-21)

Implemented P0 (read-only proposer) **and** P1 (Approve → creates `crm_task`):
- `functions/crmAgent.js` — tool catalog (`listStuckDeals`/`getDeal`/`draftFollowUp`/
  `proposeTask`), the structured-JSON tool-selection loop (allow-list enforced, step +
  proposal caps), `runFollowupAgent` (proposes only) and `approveAgentProposal` (the
  human-in-the-loop write boundary; transactional; rejects expired/non-PENDING).
- Wired in `functions/index.js` (both `invoker:"public"`, me-central2, 540s/30s).
- `firestore.rules` — `agent_runs` / `agent_proposals` / `agent_action_log`:
  CEO/business **read**, `write:if false` (Admin-SDK only — the trust boundary).
- Frontend: `src/pages/crm/CRMAgentPanel.jsx` (Run button + proposal queue with
  Approve/Reject), gated into `CRMDashboard.jsx` for CEO/business; URLs in
  `src/lib/firebase.js`.

**Not done / honest gaps:**
- **Not deployed** (`firebase deploy --only functions,firestore:rules,hosting`).
- **Not yet run against the live Qwen model** — the orchestration loop's reliability
  (model emitting valid tool-selection JSON) is unverified end-to-end. Build-green only.
- Latency: each run is multiple sequential `callLLM` calls on the in-KSA model; expect
  ~1 min+, more on a GPU cold start. The 540s function timeout covers this.
- No cron yet (manual button only, by design). P2/P3 (email draft / supervised send)
  not started.

## 1. Why this use case first

- **Low blast radius**: the worst an agent can do in Phase 0 is *propose* a draft. No
  send, no state change, no money, no PII leaves KSA.
- **Real, already-computed signal**: the CRM dashboard already surfaces "stuck deals
  >30d". We are automating the *follow-up drafting*, not inventing a new fact.
- **Exercises the whole agent spine** (loop + tool registry + guardrails + agent-identity
  audit) on a safe surface, so the pattern is proven before anything can write or send.

## 2. Honest technical constraint (drives the whole design)

`functions/lib/ai-client.js#callLLM` has **no native tool/function-calling** — it is an
OpenAI-compatible chat endpoint (Qwen 2.5 14B, in-KSA GPU) with optional JSON-schema
`response_format`. Therefore the agent loop does **structured-JSON tool selection**, not
native function-calling:

1. Orchestrator sends the model the goal + the tool catalog + observations so far.
2. Model returns JSON: `{ "thought": "...", "tool": "<name>", "args": {...} }` **or**
   `{ "done": true, "summary": "..." }`.
3. Orchestrator validates the tool is on the allow-list, executes it, appends the
   observation, loops. Hard cap on steps.

This is more constrained (and therefore safer) than native tool-calling — the model can
only ever name a tool from a fixed catalog we control server-side.

## 3. Canonical sources reused (New-page connection rule)

No new parallel store. The agent reads/writes only existing canonical sources:

| Fact / action | Canonical source (reused) |
|---|---|
| Open deals + stage + value | `deals` (`stage`, `value_sar`, open = `NEW/CONTACTED/PROPOSAL` per `src/lib/deals.js`) |
| Deal activity / staleness | `deals/{id}/activities` (`ACTIVITY_TYPES`), `last_activity_at` |
| Follow-up task | `crm_tasks` (existing Phase-2 store) |
| Send an email from a deal | `sendDealEmail` CF (`functions/deals.js`) — **only** path, human-triggered |
| LLM inference | `callLLM` (`functions/lib/ai-client.js`) — self-hosted, in-region |
| AI audit | `logAiAction` → BigQuery `datalake_audit.ai_actions` (SHA-256 input hash) |
| Approval evidence | existing `ApprovalButton` / `approval_evidence` pattern |

**New stores introduced (one each, canonical for all future agents):**
- `agent_runs/{run_id}` — one document per agent invocation (goal, status, actor, steps[]).
- `agent_proposals/{id}` — an agent's *proposed* action awaiting human decision
  (PENDING → APPROVED/REJECTED/EXPIRED). This is the human-in-the-loop queue.
- `agent_action_log` (append-only, `write:false` from clients) — every tool call the
  agent makes, attributable and immutable. Mirrors the `task_audit_log` posture.

## 4. Tool catalog (Phase 0 — read + propose only)

Each tool is a server-side function with a declared JSON-schema for its args. The model
never calls a Cloud Function directly; it names a tool, the orchestrator dispatches.

| Tool | Class | Side effect | Phase |
|---|---|---|---|
| `crm.listStuckDeals({ min_days })` | READ | none | P0 |
| `crm.getDeal({ deal_id })` | READ | none (deal + recent activities) | P0 |
| `crm.draftFollowUp({ deal_id })` | AI | none — returns draft text only | P0 |
| `crm.proposeTask({ deal_id, title, due })` | PROPOSE | writes `agent_proposals` (PENDING), **not** `crm_tasks` | P0 |
| `crm.createTask({ proposal_id })` | WRITE | writes `crm_tasks` — **only after human APPROVE** | P1 |
| `crm.proposeEmail({ deal_id, subject, body })` | PROPOSE | writes `agent_proposals` (PENDING) | P2 |
| `crm.sendDealEmail({ proposal_id })` | EXTERNAL | calls `sendDealEmail` — **only after human APPROVE** | P3 (explicit sign-off) |

A tool's `class` is the guardrail: `READ`/`AI`/`PROPOSE` may run autonomously; `WRITE`/
`EXTERNAL` are **never** reachable by the model — only by a human clicking Approve in the
proposal queue, which then invokes the write CF directly (not via the loop).

## 5. Guardrails (defense in depth)

1. **Allow-list per agent.** `agent:crm-followup` may only see P0 tools. Model output
   naming any other tool → rejected, logged, step fails closed.
2. **Read-only by default.** No tool in the model's catalog mutates business data. Writes
   live behind the human proposal queue.
3. **Agent identity, never impersonation.** The agent acts as the system principal
   `agent:crm-followup`. It does **not** borrow a user's Firebase ID token. Every
   `agent_action_log` row carries `actor:"agent:crm-followup"`, `run_id`, `triggered_by`
   (the human/scheduler that started it), `tool`, `args_sha256`, `result_summary`.
4. **Step + token + time caps.** Max 25 tool steps/run; `callLLM` already caps 2000
   tokens; run hard-timeout. Runaway → run marked FAILED, logged.
5. **Stop-and-ask on anything irreversible.** Email send and any external action require
   a human APPROVE on `agent_proposals`. Proposals EXPIRE after N days.
6. **No-Fabricated-Data.** Drafts are grounded in the deal's real activities; if a deal
   has no usable context the agent proposes nothing and says so (no invented "per our
   last call"). Empty/uncertain → surfaced as such, never padded.
7. **PDPL / residency.** Inference is `callLLM` (in-region, self-hosted). Lead PII never
   leaves KSA and is never sent to an external API. Proposals inherit deal retention.
8. **Audit-fail = compliance violation.** Same posture as `ai-client.js`: an
   `agent_action_log` insert failure is logged loudly; a write tool aborts if it can't
   audit.

## 6. Trigger & surface

- **Trigger (P0):** manual "Run follow-up assistant" button on `/crm/dashboard` (CEO/
  business/sales). No cron until the pattern is trusted. (Later: `onSchedule` nightly.)
- **Surface:** a "Agent proposals" panel — each card shows the deal, the drafted task/
  email, the agent's stated reason, and **Approve / Edit / Reject**. Approve is the only
  thing that writes. This *is* the human-in-the-loop boundary.

## 7. Phasing (gated — each phase shipped + trusted before the next)

- **P0 — Proposer (read-only).** Loop + tool registry + `agent_runs`/`agent_proposals`/
  `agent_action_log` + proposals UI. Agent can only *suggest* a follow-up task. Human does
  everything. **← build this first, prove it, stop.**
- **P1 — One safe write.** Approve a proposal → agent's `crm.createTask` writes a
  `crm_tasks` row (already a low-risk, human-owned store).
- **P2 — Email drafting.** Agent drafts the follow-up email into the existing deal
  composer; **human still presses send.**
- **P3 — Supervised send (explicit CEO sign-off required).** Per-proposal Approve invokes
  `sendDealEmail`. Still one human click per email. No unattended sending in this spec.

## 8. Out of scope (this spec)

Unattended/autonomous sending, agents that move deal stage or touch quotes/finance/
payroll, multi-agent orchestration, and any agent with a write tool in its model-visible
catalog. Those are separate specs after P0–P3 are proven.

## 9. Open decisions for CEO

- **D-1**: Approve building **P0 only** now (read-only proposer), then review? _(Recommended.)_
- **D-2**: Trigger — manual button first (rec.), or straight to nightly cron?
- **D-3**: Who may run/approve agent proposals — CEO+business+sales, or CEO+business only?
- **D-4**: Proposal expiry window (default 7 days)?
