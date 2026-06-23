// functions/crmAgent.js — DTLK-AI-AGENT-001 — CRM Stuck-Deal Follow-up Assistant.
//
// The platform's FIRST real agent. It scans stuck deals and PROPOSES a follow-up
// task per deal. It cannot write business data or send anything: every proposal
// lands in `agent_proposals` (PENDING) and a human must APPROVE before a crm_task
// is created (P1). The model only ever orchestrates a fixed, server-side tool
// catalog — it never calls a Cloud Function directly and never touches WRITE tools.
//
// Honest constraint: lib/ai-client.js#callLLM has NO native function-calling, so the
// loop drives tools via STRUCTURED-JSON tool selection (model returns {action,tool,
// args}; the orchestrator validates against an allow-list and dispatches). This is
// more constrained — therefore safer — than native tool-calling.
//
// Guardrails (defense in depth):
//   • Allow-list per agent — the model can only name P0 tools (READ/AI/PROPOSE).
//     WRITE/EXTERNAL tools are NOT in the catalog; only a human Approve invokes them.
//   • Agent identity, never impersonation — acts as principal `agent:crm-followup`;
//     it does not borrow the caller's token. Every step → immutable agent_action_log.
//   • Caps — MAX_STEPS, MAX_PROPOSALS_PER_RUN, run timeout; callLLM caps 2000 tokens.
//   • No-Fabricated-Data — drafts are grounded in the deal's REAL activity; an empty
//     deal yields an honest "no logged activity" note, never an invented conversation.
//   • PDPL/residency — inference is callLLM (self-hosted, in me-central2). No PII
//     leaves KSA; no external AI API.

const admin = require("firebase-admin");
const crypto = require("crypto");
const { callLLM, parseJsonOutput } = require("./lib/ai-client");

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

const AGENT_NAME = "crm-followup";
const AGENT_PRINCIPAL = "agent:crm-followup";
// CEO + business only (per DTLK-AI-AGENT-001 D-3).
const AGENT_ROLES = ["ceo", "business"];
const OPEN_STAGES = ["NEW", "CONTACTED", "PROPOSAL"];

const STUCK_DAYS = 30;
const MAX_STEPS = 14;             // hard ceiling on tool steps per run
const MAX_PROPOSALS_PER_RUN = 5;  // bound latency + reviewer load
const PROPOSAL_TTL_DAYS = 14;     // D-4 — proposals expire if unactioned
const DEFAULT_DUE_IN_DAYS = 3;

const sha256 = (v) => crypto.createHash("sha256").update(JSON.stringify(v ?? "")).digest("hex");
const tsMillis = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : (typeof v === "number" ? v : null));
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
const clampInt = (n, lo, hi, dflt) => {
  const x = Math.round(Number(n));
  return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : dflt;
};

// ── Immutable audit row for every agent action (tool step or human decision) ──
async function logAgentAction(row) {
  try {
    await db.collection("agent_action_log").add({
      ...row,
      created_at: FieldValue.serverTimestamp(),
    });
  } catch (e) {
    // Audit-fail is a compliance signal — log loudly, never silently swallow.
    console.error("[crmAgent] agent_action_log insert FAILED:", e.message);
  }
}

// ════════════════════════════════════════════════════════════════════
// Tool catalog (P0 = READ / AI / PROPOSE only). The model can ONLY name
// these. No tool here mutates business data — proposeTask writes to the
// human-review queue (agent_proposals), not crm_tasks.
// ════════════════════════════════════════════════════════════════════
function buildTools(ctx) {
  return {
    listStuckDeals: {
      cls: "READ",
      async run(args) {
        const minDays = clampInt(args?.min_days, 1, 365, ctx.minDays ?? STUCK_DAYS);
        const snap = await db.collection("deals").where("stage", "in", OPEN_STAGES).get();
        // Deals that already have a PENDING proposal are skipped (no double-nudge).
        const pendSnap = await db.collection("agent_proposals").where("status", "==", "PENDING").get();
        const pendingDealIds = new Set(pendSnap.docs.map((d) => d.data().deal_id).filter(Boolean));
        const now = Date.now();
        const stuck = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((d) => !d.archived && !pendingDealIds.has(d.id))
          .map((d) => {
            const t = tsMillis(d.stage_updated_at) || tsMillis(d.updated_at) || tsMillis(d.created_at);
            return { d, ageDays: t ? Math.floor((now - t) / 86400000) : null };
          })
          .filter((x) => x.ageDays != null && x.ageDays > minDays)
          .sort((a, b) => b.ageDays - a.ageDays);
        const total = stuck.length;
        const shown = stuck.slice(0, MAX_PROPOSALS_PER_RUN).map(({ d, ageDays }) => ({
          deal_id: d.id,
          title: d.title || d.company_name || d.id,
          stage: d.stage,
          age_days: ageDays,
          owner_email: d.owner_email || null,
        }));
        ctx.stuckTotal = total;
        return {
          stuck_deals: shown,
          shown: shown.length,
          total_stuck: total,
          cap: MAX_PROPOSALS_PER_RUN,
          note: total > shown.length ? `${total - shown.length} more stuck deals not shown this run (cap ${MAX_PROPOSALS_PER_RUN}).` : "",
        };
      },
    },

    getDeal: {
      cls: "READ",
      async run(args) {
        const id = String(args?.deal_id || "");
        if (!id) return { error: "deal_id required" };
        const snap = await db.collection("deals").doc(id).get();
        if (!snap.exists) return { error: "deal not found" };
        const d = snap.data();
        const actsSnap = await db.collection("deals").doc(id).collection("deal_activities")
          .orderBy("created_at", "desc").limit(5).get().catch(() => null);
        const activities = actsSnap ? actsSnap.docs.map((a) => {
          const x = a.data();
          return { type: x.type || "NOTE", when: tsMillis(x.created_at) ? ymd(tsMillis(x.created_at)) : null, summary: String(x.body || x.email_subject || "").slice(0, 160) };
        }) : [];
        return {
          deal_id: id,
          title: d.title || d.company_name || id,
          company_name: d.company_name || null,
          contact_name: d.contact_name || null,
          stage: d.stage,
          value_sar: Number(d.value_sar || 0),
          owner_email: d.owner_email || null,
          recent_activities: activities,
          has_logged_activity: activities.length > 0,
        };
      },
    },

    draftFollowUp: {
      cls: "AI",
      async run(args) {
        const id = String(args?.deal_id || "");
        if (!id) return { error: "deal_id required" };
        const snap = await db.collection("deals").doc(id).get();
        if (!snap.exists) return { error: "deal not found" };
        const d = snap.data();
        const actsSnap = await db.collection("deals").doc(id).collection("deal_activities")
          .orderBy("created_at", "desc").limit(5).get().catch(() => null);
        const acts = actsSnap ? actsSnap.docs.map((a) => {
          const x = a.data();
          const when = tsMillis(x.created_at) ? ymd(tsMillis(x.created_at)) : "unknown date";
          return `- [${x.type || "NOTE"} ${when}] ${String(x.body || x.email_subject || "").slice(0, 200)}`;
        }) : [];

        const facts = [
          `Deal: ${d.title || d.company_name || id}`,
          d.company_name ? `Company: ${d.company_name}` : null,
          d.contact_name ? `Contact: ${d.contact_name}` : null,
          `Stage: ${d.stage}`,
          `Value: SAR ${Number(d.value_sar || 0)}`,
          acts.length ? `Recent activity:\n${acts.join("\n")}` : "Recent activity: NONE logged.",
        ].filter(Boolean).join("\n");

        const result = await callLLM({
          agent: AGENT_NAME,
          type: "crm_followup_draft",
          triggeredBy: ctx.triggeredBy,
          promptTemplateId: "DTLK-AI-AGENT-001/draft-v1",
          jsonSchema: {
            type: "object",
            properties: {
              task_title: { type: "string" },
              follow_up_note: { type: "string" },
              suggested_due_in_days: { type: "number" },
            },
            required: ["task_title", "follow_up_note"],
          },
          systemPrompt:
            "You are a B2B sales follow-up assistant for Datalake Saudi Arabia LLC. " +
            "You are given a stalled sales deal and its REAL recent activity. Propose the single best next follow-up step as a short internal task. " +
            "STRICT GROUNDING: use ONLY the facts provided. Never invent names, prices, prior conversations, or commitments. " +
            "If there is NO logged activity, say so plainly and suggest a neutral re-engagement check-in. " +
            "Keep task_title under 80 chars and follow_up_note 1-2 sentences. Output JSON only.",
          userPrompt: facts,
        });

        if (!result.success) return { error: `draft failed: ${result.error || "inference unavailable"}` };
        const parsed = parseJsonOutput(result.output);
        if (!parsed.success) return { error: "draft not valid JSON" };
        const draft = {
          task_title: String(parsed.data.task_title || "").slice(0, 120) || `Follow up: ${d.title || id}`,
          follow_up_note: String(parsed.data.follow_up_note || "").slice(0, 500),
          due_in_days: clampInt(parsed.data.suggested_due_in_days, 1, 30, DEFAULT_DUE_IN_DAYS),
          grounded: acts.length > 0,
        };
        // Stash so proposeTask uses the EXACT grounded draft (no model re-typing drift).
        ctx.drafts[id] = draft;
        return { deal_id: id, ...draft };
      },
    },

    proposeTask: {
      cls: "PROPOSE",
      async run(args) {
        if (ctx.proposalsCreated >= MAX_PROPOSALS_PER_RUN) {
          return { error: `proposal cap reached (${MAX_PROPOSALS_PER_RUN}) — finish now` };
        }
        const id = String(args?.deal_id || "");
        if (!id) return { error: "deal_id required" };
        const snap = await db.collection("deals").doc(id).get();
        if (!snap.exists) return { error: "deal not found" };
        const d = snap.data();
        // Prefer the stashed grounded draft over anything the model re-typed.
        const draft = ctx.drafts[id] || {};
        const title = String(draft.task_title || args?.title || `Follow up: ${d.title || id}`).slice(0, 120);
        const note = String(draft.follow_up_note || args?.note || "").slice(0, 500);
        const dueInDays = clampInt(draft.due_in_days ?? args?.due_in_days, 1, 30, DEFAULT_DUE_IN_DAYS);
        const dueDate = ymd(Date.now() + dueInDays * 86400000);
        const owner = d.owner_email || ctx.triggeredByEmail;

        const ref = await db.collection("agent_proposals").add({
          run_id: ctx.runId,
          agent: AGENT_NAME,
          kind: "crm_task",
          status: "PENDING",
          deal_id: id,
          deal_title: d.title || d.company_name || id,
          payload: { title, assignee_email: owner, due_date: dueDate, note },
          reason: note || "Stuck deal — no recent activity logged.",
          grounded: !!draft.grounded,
          model_name: ctx.modelName,
          created_at: FieldValue.serverTimestamp(),
          expires_at: Timestamp.fromMillis(Date.now() + PROPOSAL_TTL_DAYS * 86400000),
          triggered_by_uid: ctx.triggeredBy,
          triggered_by_email: ctx.triggeredByEmail,
        });
        ctx.proposalsCreated += 1;
        ctx.proposalIds.push(ref.id);
        return { proposed: true, proposal_id: ref.id, deal_id: id, title, due_date: dueDate, remaining_quota: MAX_PROPOSALS_PER_RUN - ctx.proposalsCreated };
      },
    },
  };
}

const TOOL_CATALOG_TEXT =
  "TOOLS (you may ONLY use these):\n" +
  "- listStuckDeals({min_days?}) → list of stuck open deals to work (already de-duped against pending proposals).\n" +
  "- getDeal({deal_id}) → one deal's facts + recent activity (optional; draftFollowUp also reads it).\n" +
  "- draftFollowUp({deal_id}) → grounded follow-up draft (task_title, follow_up_note, due_in_days).\n" +
  "- proposeTask({deal_id}) → queue the drafted follow-up for human approval (uses the grounded draft).\n";

const DECISION_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["use_tool", "finish"] },
    tool: { type: ["string", "null"] },
    args: { type: "object" },
    summary: { type: ["string", "null"] },
  },
  required: ["action"],
};

async function decide(ctx, transcript) {
  const sys =
    "You are the orchestrator of the CRM Stuck-Deal Follow-up agent for Datalake Saudi Arabia LLC. " +
    "GOAL: for each stuck deal, produce ONE grounded follow-up proposal for a human to approve. " +
    "PLAN: call listStuckDeals once; then for each returned deal call draftFollowUp then proposeTask; then finish. " +
    `Do not exceed ${MAX_PROPOSALS_PER_RUN} proposals. When every listed deal has a proposal (or the list was empty), action=finish with a short summary. ` +
    "Return JSON only: {action:'use_tool'|'finish', tool, args, summary}.\n" + TOOL_CATALOG_TEXT;
  const user = transcript.length
    ? "Progress so far:\n" + transcript.join("\n") + "\n\nNext step?"
    : "No steps yet. Start by listing stuck deals.";

  const res = await callLLM({
    agent: AGENT_NAME,
    type: "crm_followup_orchestrate",
    triggeredBy: ctx.triggeredBy,
    promptTemplateId: "DTLK-AI-AGENT-001/orchestrate-v1",
    jsonSchema: DECISION_SCHEMA,
    systemPrompt: sys,
    userPrompt: user,
  });
  if (!res.success) return { _llmError: res.error || "inference unavailable" };
  const parsed = parseJsonOutput(res.output);
  if (!parsed.success) return { _llmError: "decision not valid JSON" };
  return parsed.data || {};
}

// ════════════════════════════════════════════════════════════════════
// runFollowupAgentHandler — manual-trigger (P0): scan + propose only.
// ════════════════════════════════════════════════════════════════════
async function runFollowupAgentHandler(req, res, { verifyAuth, getUserAccessProfile, ALLOWED_ORIGINS }) {
  const origin = req.headers.origin;
  res.set("Access-Control-Allow-Origin", ALLOWED_ORIGINS && ALLOWED_ORIGINS.includes(origin) ? origin : "");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  let runRef = null;
  try {
    const decoded = await verifyAuth(req);
    const profile = await getUserAccessProfile(decoded.uid);
    if (!AGENT_ROLES.includes(profile.role_id)) {
      return res.status(403).json({ error: "Agent restricted to CEO/business" });
    }

    // Caller-chosen "stuck" window (days). Defaults to STUCK_DAYS; clamped server-side.
    const reqMinDays = clampInt(req.body?.min_days, 1, 365, STUCK_DAYS);

    runRef = db.collection("agent_runs").doc();
    const ctx = {
      runId: runRef.id,
      triggeredBy: decoded.uid,
      triggeredByEmail: decoded.email || profile.email || "unknown",
      modelName: null,
      minDays: reqMinDays,
      proposalsCreated: 0,
      proposalIds: [],
      drafts: {},
      stuckTotal: null,
    };
    const { MODEL_NAME } = require("./lib/ai-client");
    ctx.modelName = MODEL_NAME;

    await runRef.set({
      agent: AGENT_NAME,
      principal: AGENT_PRINCIPAL,
      status: "RUNNING",
      goal: `Propose follow-up tasks for stuck deals (open > ${reqMinDays}d).`,
      min_days: reqMinDays,
      triggered_by_uid: ctx.triggeredBy,
      triggered_by_email: ctx.triggeredByEmail,
      started_at: FieldValue.serverTimestamp(),
    });

    const tools = buildTools(ctx);
    const allowed = Object.keys(tools);
    const transcript = [];
    let steps = 0;
    let finishSummary = "";
    let llmError = null;

    while (steps < MAX_STEPS) {
      const decision = await decide(ctx, transcript);
      if (decision._llmError) { llmError = decision._llmError; break; }

      if (decision.action === "finish") {
        finishSummary = String(decision.summary || "").slice(0, 400);
        break;
      }

      const toolName = decision.tool;
      const args = decision.args || {};
      steps += 1;

      // Guardrail: allow-list. An unknown/blocked tool fails closed and is fed back.
      if (!allowed.includes(toolName)) {
        await logAgentAction({
          run_id: ctx.runId, actor: AGENT_PRINCIPAL, triggered_by: ctx.triggeredBy,
          step: steps, tool: String(toolName), tool_class: "BLOCKED",
          args_sha256: sha256(args), result_summary: "rejected: not on allow-list",
        });
        transcript.push(`STEP ${steps}: ${toolName} → REJECTED (not an allowed tool). Use only: ${allowed.join(", ")}.`);
        continue;
      }

      let obs;
      try {
        obs = await tools[toolName].run(args);
      } catch (e) {
        obs = { error: e.message };
      }
      await logAgentAction({
        run_id: ctx.runId, actor: AGENT_PRINCIPAL, triggered_by: ctx.triggeredBy,
        step: steps, tool: toolName, tool_class: tools[toolName].cls,
        args_sha256: sha256(args), result_summary: String(JSON.stringify(obs)).slice(0, 400),
      });
      transcript.push(`STEP ${steps}: ${toolName}(${JSON.stringify(args).slice(0, 120)}) → ${JSON.stringify(obs).slice(0, 300)}`);

      // Deterministic stop: nothing stuck, or quota spent.
      if (toolName === "listStuckDeals" && obs.shown === 0) { finishSummary = "No stuck deals to follow up."; break; }
      if (ctx.proposalsCreated >= MAX_PROPOSALS_PER_RUN) { finishSummary = `Reached proposal cap (${MAX_PROPOSALS_PER_RUN}).`; break; }
    }

    const status = llmError ? "FAILED" : "DONE";
    await runRef.set({
      status,
      steps_used: steps,
      proposals_created: ctx.proposalsCreated,
      proposal_ids: ctx.proposalIds,
      stuck_total: ctx.stuckTotal,
      summary: llmError ? `Inference error: ${llmError}` : (finishSummary || `Created ${ctx.proposalsCreated} proposal(s).`),
      error: llmError || null,
      finished_at: FieldValue.serverTimestamp(),
    }, { merge: true });

    if (llmError) {
      return res.status(502).json({ error: "Agent inference unavailable", detail: llmError, run_id: ctx.runId, proposals_created: ctx.proposalsCreated });
    }
    return res.status(200).json({
      success: true,
      run_id: ctx.runId,
      proposals_created: ctx.proposalsCreated,
      stuck_total: ctx.stuckTotal,
      summary: finishSummary || `Created ${ctx.proposalsCreated} proposal(s).`,
    });
  } catch (err) {
    console.error("runFollowupAgent error:", err);
    if (runRef) {
      await runRef.set({ status: "FAILED", error: err.message, finished_at: FieldValue.serverTimestamp() }, { merge: true }).catch(() => {});
    }
    const code = err.code && String(err.code).startsWith("AUTH") ? 401 : 500;
    return res.status(code).json({ error: code === 401 ? "Unauthorized" : "Internal server error", detail: err.message });
  }
}

// ════════════════════════════════════════════════════════════════════
// approveAgentProposalHandler — the human-in-the-loop boundary (P1 WRITE).
// APPROVE → creates the crm_task (the only path a proposal becomes real).
// REJECT  → closes the proposal. Expired proposals cannot be approved.
// ════════════════════════════════════════════════════════════════════
async function approveAgentProposalHandler(req, res, { verifyAuth, getUserAccessProfile, ALLOWED_ORIGINS }) {
  const origin = req.headers.origin;
  res.set("Access-Control-Allow-Origin", ALLOWED_ORIGINS && ALLOWED_ORIGINS.includes(origin) ? origin : "");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const decoded = await verifyAuth(req);
    const profile = await getUserAccessProfile(decoded.uid);
    if (!AGENT_ROLES.includes(profile.role_id)) {
      return res.status(403).json({ error: "Agent approvals restricted to CEO/business" });
    }

    const { proposal_id, decision, edits } = req.body || {};
    if (!proposal_id || !["APPROVE", "REJECT"].includes(decision)) {
      return res.status(400).json({ error: "proposal_id and decision (APPROVE|REJECT) required" });
    }

    const propRef = db.collection("agent_proposals").doc(proposal_id);
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(propRef);
      if (!snap.exists) return { code: 404, body: { error: "Proposal not found" } };
      const p = snap.data();
      if (p.status !== "PENDING") return { code: 409, body: { error: `Proposal already ${p.status}` } };
      const expMs = tsMillis(p.expires_at);
      if (expMs && expMs < Date.now()) {
        tx.set(propRef, { status: "EXPIRED", decided_at: FieldValue.serverTimestamp() }, { merge: true });
        return { code: 409, body: { error: "Proposal expired" } };
      }

      const stamp = {
        decided_by_uid: decoded.uid,
        decided_by_email: decoded.email || profile.email || "unknown",
        decided_by_role: profile.role_id,
        decided_at: FieldValue.serverTimestamp(),
      };

      if (decision === "REJECT") {
        tx.set(propRef, { status: "REJECTED", ...stamp }, { merge: true });
        return { code: 200, body: { success: true, status: "REJECTED" } };
      }

      // APPROVE → create the crm_task (P1 write). Edits (if any) override payload.
      const base = p.payload || {};
      const title = String(edits?.title || base.title || `Follow up: ${p.deal_title || p.deal_id}`).slice(0, 160);
      const due_date = String(edits?.due_date || base.due_date || "").slice(0, 10) || null;
      const assignee_email = String(edits?.assignee_email || base.assignee_email || stamp.decided_by_email).trim();

      const taskRef = db.collection("crm_tasks").doc();
      tx.set(taskRef, {
        title,
        due_date,
        assignee_email,
        status: "OPEN",
        deal_id: p.deal_id || null,
        deal_title: p.deal_title || null,
        note: base.note || null,
        source: AGENT_PRINCIPAL,
        agent_proposal_id: proposal_id,
        agent_run_id: p.run_id || null,
        created_by: stamp.decided_by_email,
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      });
      tx.set(propRef, { status: "APPROVED", created_task_id: taskRef.id, ...stamp }, { merge: true });
      return { code: 200, body: { success: true, status: "APPROVED", task_id: taskRef.id } };
    });

    await logAgentAction({
      run_id: null, actor: decoded.email || "unknown", triggered_by: decoded.uid,
      step: null, tool: decision === "APPROVE" ? "human_approve_proposal" : "human_reject_proposal",
      tool_class: "HUMAN", args_sha256: sha256({ proposal_id, decision, edits }),
      result_summary: `proposal ${proposal_id}: ${result.body.status || result.body.error}`,
    });

    return res.status(result.code).json(result.body);
  } catch (err) {
    console.error("approveAgentProposal error:", err);
    const code = err.code && String(err.code).startsWith("AUTH") ? 401 : 500;
    return res.status(code).json({ error: code === 401 ? "Unauthorized" : "Internal server error", detail: err.message });
  }
}

module.exports = { runFollowupAgentHandler, approveAgentProposalHandler };
