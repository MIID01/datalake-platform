// functions/grcAgent.js — DTLK-GRC-AI-001 — GRC Compliance Agent.
//
// The platform's GRC assistant. Three jobs, all grounded in REAL platform data:
//   1. grcAssistantChat   — talk to it. Answers ONLY from the document corpus +
//      audit/compliance logs, cites doc_id vX.Y for every claim, and says
//      "Not found in the current library" when nothing grounds the answer. It
//      also mentors on the compliance/policy PROCESS using the real logs.
//   2. grcAuditReadiness  — on-demand readiness report from real counts (no
//      green-by-default; missing data is reported as missing, never assumed pass).
//   3. grcReviewSweep     — daily schedule: refresh the readiness snapshot and
//      PROPOSE reviews for overdue documents (propose-only).
//   + approveGrcProposal  — the human-in-the-loop boundary (clone of the CRM one).
//
// Guardrails (defense in depth, same as crmAgent.js):
//   • Allow-list tool catalog — READ tools + ONE PROPOSE tool. No tool writes
//     business data; proposeAction writes the human-review queue (grc_proposals).
//   • Access matrix everywhere — every tool result is filtered by the CALLER's
//     canAccess(role, classification, domain). The agent never leaks a
//     Confidential/Restricted document to a role that may not read it.
//   • Agent identity, never impersonation — principal `agent:grc-compliance`;
//     every step → immutable grc_action_log.
//   • No-Fabricated-Data — the model answers from tool output only; empty corpus
//     yields an honest "not found", never invented policy text/dates/approvals.
//   • PDPL/residency — inference is callLLM (self-hosted, me-central2).

const admin = require("firebase-admin");
const crypto = require("crypto");
const { callLLM, parseJsonOutput, MODEL_NAME } = require("./lib/ai-client");
const { canAccess } = require("./grcLibrary");
const { retrieve } = require("./grcRag");

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

const AGENT_NAME = "grc-compliance";
const AGENT_PRINCIPAL = "agent:grc-compliance";
const PRIVILEGED = ["ceo", "compliance_lead"]; // who may propose / run readiness / approve
const MAX_STEPS = 12;
const MAX_PROPOSALS = 5;
const PROPOSAL_TTL_DAYS = 21;

// ── RAG caps (DTLK-GRC-AI-001): keep the assistant to GRC, grounded in the corpus ──
const VECTOR_MIN_SCORE = 0.35;   // cosine relevance gate (vector mode)
const SEED_TOPK = 6;
// Off-topic gate: a question is in-scope only if the corpus returns a relevant chunk
// OR it clearly concerns GRC/compliance/policy process. Anything else is refused
// deterministically (no LLM call) so the agent never free-forms general knowledge.
const SCOPE_RE = /\b(polic|procedure|standard|guideline|control|complian|govern|risk|audit|review|expir|overdue|renew|capa|evidence|approval|owner|classif|retention|incident|access control|mfa|encrypt|data protection|privacy|pdpl|nca|sama|iso\s?27001|ecc|csf|register|document|grc|whistle|dpo|consent)\b/i;
// Fixed refusals — never an LLM free-form answer.
const REFUSAL_OFFTOPIC = "I can only help with Datalake's governance, risk and compliance documents and processes. I can't answer that. Try asking about a policy, what's overdue for review, or our compliance posture.";
const REFUSAL_NOTFOUND = "Not found in the current library. I couldn't find an accessible document that grounds an answer to that. If the policy exists, please upload it to the GRC Library.";

const sha256 = (v) => crypto.createHash("sha256").update(JSON.stringify(v ?? "")).digest("hex");
const clampInt = (n, lo, hi, dflt) => {
  const x = Math.round(Number(n));
  return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : dflt;
};
const dateMs = (v) => {
  if (!v) return null;
  if (typeof v === "string") { const t = Date.parse(v); return Number.isFinite(t) ? t : null; }
  if (v._seconds) return v._seconds * 1000;
  if (typeof v.toMillis === "function") return v.toMillis();
  return null;
};
const normDate = (v) => { const ms = dateMs(v); return ms ? new Date(ms).toISOString().slice(0, 10) : null; };

async function logAgentAction(row) {
  try {
    await db.collection("grc_action_log").add({ ...row, created_at: FieldValue.serverTimestamp() });
  } catch (e) {
    console.error("[grcAgent] grc_action_log insert FAILED:", e.message);
  }
}

// ════════════════════════════════════════════════════════════════════
// Shared readiness computation — REAL counts over ACTIVE grc_documents.
// Returns honest metrics; callers persist/serve it. No positive defaults.
// ════════════════════════════════════════════════════════════════════
async function computeReadiness() {
  const snap = await db.collection("grc_documents").where("status", "==", "ACTIVE").get();
  const docs = snap.docs.map((d) => d.data());
  const now = Date.now();
  let withReviewDate = 0, overdue = 0, dueSoon = 0, withOwner = 0, withApprover = 0;
  const overdueItems = [];
  const missingReviewDate = [];
  const domains = {};
  for (const d of docs) {
    domains[d.domain || "—"] = (domains[d.domain || "—"] || 0) + 1;
    if (d.owner) withOwner++;
    if (d.approver) withApprover++;
    const ms = dateMs(d.next_review_date);
    if (ms == null) { missingReviewDate.push({ doc_id: d.doc_id, title: d.doc_title }); continue; }
    withReviewDate++;
    const days = Math.floor((ms - now) / 86400000);
    if (days < 0) { overdue++; overdueItems.push({ doc_id: d.doc_id, title: d.doc_title, next_review_date: normDate(ms), days_overdue: Math.abs(days) }); }
    else if (days <= 30) dueSoon++;
  }
  const total = docs.length;
  const pct = (n) => (total ? Math.round((n / total) * 100) : 0);
  overdueItems.sort((a, b) => b.days_overdue - a.days_overdue);
  return {
    total_active: total,
    with_review_date: withReviewDate, missing_review_date: total - withReviewDate,
    overdue, due_soon: dueSoon,
    with_owner: withOwner, with_approver: withApprover,
    pct_with_review_date: pct(withReviewDate), pct_with_owner: pct(withOwner), pct_with_approver: pct(withApprover),
    domains,
    overdue_items: overdueItems.slice(0, 50),
    missing_review_date_items: missingReviewDate.slice(0, 50),
  };
}

// ════════════════════════════════════════════════════════════════════
// Chat tool catalog. Every READ tool filters by the caller's canAccess.
// ════════════════════════════════════════════════════════════════════
function buildTools(ctx) {
  return {
    searchPolicies: {
      cls: "READ",
      async run(args) {
        // Vector RAG (cosine over embedded chunks); honest keyword fallback if the
        // embed model is unavailable. Access-filtered per caller; relevance-gated.
        const r = await retrieve({
          query: String(args?.query || ""),
          accessFilter: (c, d) => canAccess(ctx.role, c, d),
          topK: SEED_TOPK, minScore: VECTOR_MIN_SCORE, triggeredBy: ctx.triggeredBy,
        });
        r.hits.forEach((h) => ctx.knownDocIds.add(h.doc_id));
        return {
          retrieval_mode: r.mode, count: r.hits.length, top_score: Number(r.top_score || 0).toFixed(3),
          results: r.hits.map((h) => ({ doc_id: h.doc_id, version: h.version, title: h.title, domain: h.domain, classification: h.classification, excerpt: String(h.text || "").slice(0, 600) })),
          note: r.hits.length === 0 ? "No accessible document chunk passed the relevance gate." : "",
        };
      },
    },
    getPolicy: {
      cls: "READ",
      async run(args) {
        const id = String(args?.doc_id || "");
        if (!id) return { error: "doc_id required" };
        const snap = await db.collection("grc_documents").where("doc_id", "==", id).where("status", "==", "ACTIVE").limit(1).get();
        if (snap.empty) return { error: "not found" };
        const d = snap.docs[0].data();
        if (!canAccess(ctx.role, d.classification, d.domain)) return { error: "access denied for your role" };
        ctx.knownDocIds.add(d.doc_id);
        return {
          doc_id: d.doc_id, title: d.doc_title, version: d.version, classification: d.classification, domain: d.domain,
          owner: d.owner || null, approver: d.approver || null,
          effective_date: normDate(d.effective_date), next_review_date: normDate(d.next_review_date),
          regulatory_basis: d.regulatory_basis || null, framework_tags: d.framework_tags || [],
          text_excerpt: String(d.extracted_text || "").slice(0, 4000),
        };
      },
    },
    listExpiringPolicies: {
      cls: "READ",
      async run(args) {
        const within = clampInt(args?.within_days, 1, 3650, 90);
        const snap = await db.collection("grc_documents").where("status", "==", "ACTIVE").get();
        const now = Date.now();
        const items = [];
        snap.docs.map((d) => d.data()).filter((d) => canAccess(ctx.role, d.classification, d.domain)).forEach((d) => {
          const ms = dateMs(d.next_review_date);
          if (ms == null) { items.push({ doc_id: d.doc_id, title: d.doc_title, status: "NO_REVIEW_DATE" }); return; }
          const days = Math.floor((ms - now) / 86400000);
          if (days <= within) items.push({ doc_id: d.doc_id, title: d.doc_title, next_review_date: normDate(ms), days_until: days, status: days < 0 ? "OVERDUE" : "DUE_SOON" });
        });
        items.sort((a, b) => (a.days_until ?? 99999) - (b.days_until ?? 99999));
        items.forEach((it) => ctx.knownDocIds.add(it.doc_id));
        return { within_days: within, count: items.length, items: items.slice(0, 50) };
      },
    },
    getAuditTrail: {
      cls: "READ",
      async run(args) {
        const snap = await db.collection("grc_change_log").orderBy("timestamp", "desc").limit(40).get();
        let rows = snap.docs.map((d) => d.data());
        if (args?.doc_id) rows = rows.filter((r) => r.doc_id === String(args.doc_id));
        rows.forEach((r) => { if (r.doc_id) ctx.knownDocIds.add(r.doc_id); });
        return {
          count: rows.length,
          entries: rows.slice(0, 15).map((r) => ({
            doc_id: r.doc_id, action: r.action_type, actor: r.actor_email, version: r.new_version,
            when: r.timestamp ? normDate(r.timestamp) : null,
          })),
        };
      },
    },
    getComplianceStatus: {
      cls: "READ",
      async run() {
        const readiness = await computeReadiness();
        let register = null;
        try {
          const snap = await db.collection("compliance").limit(5).get();
          if (!snap.empty) {
            const docs = snap.docs.map((d) => d.data());
            const reg = docs.find((d) => typeof d.score === "number") || docs[0];
            register = {
              score: typeof reg.score === "number" ? reg.score : null,
              breakdown: reg.breakdown || null,
              open_capas: Array.isArray(reg.capas) ? reg.capas.length : 0,
            };
          }
        } catch (_) { /* register optional */ }
        return { document_readiness: readiness, compliance_register: register || "No compliance register data recorded." };
      },
    },
    proposeAction: {
      cls: "PROPOSE",
      async run(args) {
        if (!PRIVILEGED.includes(ctx.role)) return { error: "Only CEO/compliance_lead can create proposals." };
        if (ctx.proposalsCreated >= MAX_PROPOSALS) return { error: `proposal cap reached (${MAX_PROPOSALS})` };
        const kind = String(args?.kind || "");
        if (!["flag_for_review", "draft_capa", "schedule_review"].includes(kind)) {
          return { error: "kind must be flag_for_review | draft_capa | schedule_review" };
        }
        const docId = args?.doc_id ? String(args.doc_id) : null;
        const ref = await db.collection("grc_proposals").add({
          run_id: ctx.runId || null,
          agent: AGENT_NAME,
          kind,
          status: "PENDING",
          doc_id: docId,
          payload: {
            doc_id: docId,
            reason: String(args?.reason || "").slice(0, 500),
            proposed_review_date: args?.proposed_review_date ? String(args.proposed_review_date).slice(0, 10) : null,
            capa_summary: kind === "draft_capa" ? String(args?.capa_summary || args?.reason || "").slice(0, 800) : null,
          },
          model_name: ctx.modelName,
          created_at: FieldValue.serverTimestamp(),
          expires_at: Timestamp.fromMillis(Date.now() + PROPOSAL_TTL_DAYS * 86400000),
          triggered_by_uid: ctx.triggeredBy,
          triggered_by_email: ctx.email,
        });
        ctx.proposalsCreated += 1;
        ctx.proposalIds.push(ref.id);
        return { proposed: true, proposal_id: ref.id, kind, doc_id: docId, remaining_quota: MAX_PROPOSALS - ctx.proposalsCreated };
      },
    },
  };
}

const TOOL_CATALOG_TEXT =
  "TOOLS (you may ONLY use these):\n" +
  "- searchPolicies({query}) → up to 5 accessible ACTIVE documents matching the query (with text excerpts).\n" +
  "- getPolicy({doc_id}) → one document's metadata + a longer text excerpt.\n" +
  "- listExpiringPolicies({within_days?}) → documents overdue or due for review (and those with no review date).\n" +
  "- getAuditTrail({doc_id?}) → recent change-log entries (who changed/downloaded what, when).\n" +
  "- getComplianceStatus() → real document-readiness metrics + compliance register summary.\n" +
  "- proposeAction({kind, doc_id?, reason, proposed_review_date?, capa_summary?}) → queue an action for human approval. kind ∈ flag_for_review|schedule_review|draft_capa. (CEO/compliance_lead only.)\n";

const DECISION_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["use_tool", "answer"] },
    tool: { type: ["string", "null"] },
    args: { type: "object" },
    answer: { type: ["string", "null"] },
    citations: { type: "array", items: { type: "string" } },
  },
  required: ["action"],
};

async function decide(ctx, transcript, question, history) {
  const sys =
    "You are the GRC Compliance Assistant for Datalake Saudi Arabia LLC. Your ONLY domain is Datalake's governance, risk and " +
    "compliance documents (policies, procedures, forms) and the compliance/policy process. " +
    "You are NOT a general assistant: if a question is not about Datalake GRC/compliance, reply exactly: " +
    "'I can only help with Datalake's governance, risk and compliance documents and processes.' Do not answer it.\n" +
    "STRICT GROUNDING — this is critical:\n" +
    "• Answer ONLY from the tool results in this session (the retrieved document excerpts and READ-tool data). NEVER use outside/general knowledge. NEVER invent policy text, document IDs, dates, owners, approvals, numbers or regulations.\n" +
    "• Cite the source for every factual claim as `doc_id vVERSION` (e.g. DTLK-POL-SEC-001 v2.0). Put the cited doc_ids in the citations array too.\n" +
    "• If the tools return nothing that grounds the answer, reply exactly that it is 'Not found in the current library' and suggest what to upload — do NOT guess.\n" +
    "• You may explain the compliance/policy PROCESS (review cadence, approval chain, audit-evidence requirements) using what the logs and documents actually show.\n" +
    "PLAN: gather what you need with READ tools, then action='answer' with a concise grounded answer + citations. " +
    "Only use proposeAction when the user explicitly asks to flag/schedule/raise something AND you are permitted.\n" +
    "Return JSON only: {action:'use_tool'|'answer', tool, args, answer, citations}.\n" + TOOL_CATALOG_TEXT;

  const histText = (history || []).slice(-6).map((m) => `${m.role === "assistant" ? "ASSISTANT" : "USER"}: ${String(m.content || "").slice(0, 500)}`).join("\n");
  const user =
    (histText ? `Conversation so far:\n${histText}\n\n` : "") +
    `CURRENT QUESTION: ${question}\n\n` +
    (transcript.length ? `Tool results so far:\n${transcript.join("\n")}\n\nNext step?` : "No tools called yet. Decide the first step.");

  const res = await callLLM({
    agent: AGENT_NAME,
    type: "grc_chat_orchestrate",
    triggeredBy: ctx.triggeredBy,
    promptTemplateId: "DTLK-GRC-AI-001/chat-v1",
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
// grcAssistantChat — conversational, grounded, cited. Any authenticated staff.
// ════════════════════════════════════════════════════════════════════
async function grcAssistantChatHandler(req, res, { verifyAuth, getUserAccessProfile, ALLOWED_ORIGINS }) {
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
    const question = String(req.body?.question || "").slice(0, 2000).trim();
    if (!question) return res.status(400).json({ error: "question is required" });
    const history = Array.isArray(req.body?.history) ? req.body.history : [];

    runRef = db.collection("grc_agent_runs").doc();
    const ctx = {
      runId: runRef.id,
      role: profile.role_id,
      email: decoded.email || profile.email || "unknown",
      triggeredBy: decoded.uid,
      modelName: MODEL_NAME,
      proposalsCreated: 0,
      proposalIds: [],
      knownDocIds: new Set(), // doc_ids the tools actually surfaced this run — the only valid citations
    };
    await runRef.set({
      agent: AGENT_NAME, principal: AGENT_PRINCIPAL, kind: "chat", status: "RUNNING",
      question, role: ctx.role, triggered_by_email: ctx.email, started_at: FieldValue.serverTimestamp(),
    });

    // ── CAP 1: deterministic off-topic + grounding gate (no LLM call) ──
    // Seed-retrieve against the access-filtered corpus. The question is in-scope only
    // if a relevant chunk came back OR it clearly concerns GRC/compliance/process.
    // Otherwise refuse with a fixed message — the model never free-forms.
    const seed = await retrieve({
      query: question, accessFilter: (c, d) => canAccess(ctx.role, c, d),
      topK: SEED_TOPK, minScore: VECTOR_MIN_SCORE, triggeredBy: ctx.triggeredBy,
    });
    seed.hits.forEach((h) => ctx.knownDocIds.add(h.doc_id));
    const onTopic = seed.hits.length > 0 || SCOPE_RE.test(question);
    if (!onTopic) {
      await runRef.set({ status: "DONE", steps_used: 0, answer: REFUSAL_OFFTOPIC, citations: [], refused: "offtopic", finished_at: FieldValue.serverTimestamp() }, { merge: true });
      await logAgentAction({ run_id: ctx.runId, actor: AGENT_PRINCIPAL, triggered_by: ctx.triggeredBy, step: 0, tool: "scope_gate", tool_class: "GATE", args_sha256: sha256(question), result_summary: "refused: off-topic" });
      return res.status(200).json({ success: true, run_id: ctx.runId, answer: REFUSAL_OFFTOPIC, citations: [], refused: true });
    }

    const tools = buildTools(ctx);
    const allowed = Object.keys(tools);
    const transcript = [];
    // Seed the model with the retrieved grounding context so it can answer directly.
    if (seed.hits.length) {
      transcript.push(`STEP 0: searchPolicies(seed) [${seed.mode}] → ${JSON.stringify(seed.hits.map((h) => ({ doc_id: h.doc_id, version: h.version, title: h.title, classification: h.classification, excerpt: String(h.text || "").slice(0, 600) }))).slice(0, 2000)}`);
    } else {
      transcript.push(`STEP 0: searchPolicies(seed) → no chunk passed the relevance gate. If you cannot ground an answer, reply that it is "Not found in the current library".`);
    }
    let steps = 0, answer = "", citations = [], llmError = null;

    while (steps < MAX_STEPS) {
      const decision = await decide(ctx, transcript, question, history);
      if (decision._llmError) { llmError = decision._llmError; break; }
      if (decision.action === "answer") {
        answer = String(decision.answer || "").slice(0, 4000);
        citations = Array.isArray(decision.citations) ? decision.citations.slice(0, 20) : [];
        break;
      }
      const toolName = decision.tool;
      const args = decision.args || {};
      steps += 1;
      if (!allowed.includes(toolName)) {
        await logAgentAction({ run_id: ctx.runId, actor: AGENT_PRINCIPAL, triggered_by: ctx.triggeredBy, step: steps, tool: String(toolName), tool_class: "BLOCKED", args_sha256: sha256(args), result_summary: "rejected: not on allow-list" });
        transcript.push(`STEP ${steps}: ${toolName} → REJECTED (not allowed). Use only: ${allowed.join(", ")}.`);
        continue;
      }
      let obs;
      try { obs = await tools[toolName].run(args); }
      catch (e) { obs = { error: e.message }; }
      await logAgentAction({ run_id: ctx.runId, actor: AGENT_PRINCIPAL, triggered_by: ctx.triggeredBy, step: steps, tool: toolName, tool_class: tools[toolName].cls, args_sha256: sha256(args), result_summary: String(JSON.stringify(obs)).slice(0, 400) });
      transcript.push(`STEP ${steps}: ${toolName}(${JSON.stringify(args).slice(0, 120)}) → ${JSON.stringify(obs).slice(0, 600)}`);
    }

    if (!answer && !llmError) answer = "I couldn't complete the answer from the available documents. Please rephrase or narrow your question.";

    // ── CAP 2: citations must reference doc_ids the tools actually surfaced ──
    // (strip any fabricated citation the model may have emitted).
    citations = (citations || []).filter((c) => [...ctx.knownDocIds].some((k) => k && String(c).includes(k)));

    await runRef.set({
      status: llmError ? "FAILED" : "DONE", steps_used: steps, answer: llmError ? null : answer,
      citations, proposals_created: ctx.proposalsCreated, proposal_ids: ctx.proposalIds,
      error: llmError || null, finished_at: FieldValue.serverTimestamp(),
    }, { merge: true });

    if (llmError) return res.status(502).json({ error: "Assistant inference unavailable", detail: llmError, run_id: ctx.runId });
    return res.status(200).json({ success: true, run_id: ctx.runId, answer, citations, proposals_created: ctx.proposalsCreated });
  } catch (err) {
    console.error("grcAssistantChat error:", err);
    if (runRef) await runRef.set({ status: "FAILED", error: err.message, finished_at: FieldValue.serverTimestamp() }, { merge: true }).catch(() => {});
    const code = err.code && String(err.code).startsWith("AUTH") ? 401 : 500;
    return res.status(code).json({ error: code === 401 ? "Unauthorized" : "Internal server error", detail: err.message });
  }
}

// ════════════════════════════════════════════════════════════════════
// grcAuditReadiness — on-demand readiness report. CEO/compliance_lead.
// ════════════════════════════════════════════════════════════════════
async function grcAuditReadinessHandler(req, res, { verifyAuth, getUserAccessProfile, ALLOWED_ORIGINS }) {
  const origin = req.headers.origin;
  res.set("Access-Control-Allow-Origin", ALLOWED_ORIGINS && ALLOWED_ORIGINS.includes(origin) ? origin : "");
  res.set("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).send("");

  try {
    const decoded = await verifyAuth(req);
    const profile = await getUserAccessProfile(decoded.uid);
    if (!PRIVILEGED.includes(profile.role_id)) return res.status(403).json({ error: "Requires ceo or compliance_lead" });

    const readiness = await computeReadiness();
    await db.collection("grc_readiness").doc("current").set({
      ...readiness, computed_at: FieldValue.serverTimestamp(), computed_by: decoded.email || profile.email || "unknown",
    }, { merge: true });

    return res.status(200).json({ success: true, readiness });
  } catch (err) {
    console.error("grcAuditReadiness error:", err);
    const code = err.code && String(err.code).startsWith("AUTH") ? 401 : 500;
    return res.status(code).json({ error: code === 401 ? "Unauthorized" : "Internal server error", detail: err.message });
  }
}

// ════════════════════════════════════════════════════════════════════
// grcReviewSweep — scheduled (daily). Refresh readiness snapshot and PROPOSE a
// schedule_review for each overdue document (deduped against PENDING proposals).
// Propose-only: nothing is written to grc_documents here.
// ════════════════════════════════════════════════════════════════════
async function grcReviewSweepHandler() {
  const readiness = await computeReadiness();
  await db.collection("grc_readiness").doc("current").set({
    ...readiness, computed_at: FieldValue.serverTimestamp(), computed_by: "grc-review-sweep",
  }, { merge: true });

  // Dedupe against existing PENDING schedule_review proposals.
  const pendSnap = await db.collection("grc_proposals").where("status", "==", "PENDING").where("kind", "==", "schedule_review").get();
  const pendingDocIds = new Set(pendSnap.docs.map((d) => d.data().doc_id).filter(Boolean));

  let created = 0;
  for (const item of readiness.overdue_items) {
    if (created >= MAX_PROPOSALS) break;
    if (pendingDocIds.has(item.doc_id)) continue;
    await db.collection("grc_proposals").add({
      run_id: null, agent: AGENT_NAME, kind: "schedule_review", status: "PENDING", doc_id: item.doc_id,
      payload: { doc_id: item.doc_id, reason: `Review overdue by ${item.days_overdue} day(s).`, proposed_review_date: null, capa_summary: null },
      model_name: null, created_at: FieldValue.serverTimestamp(),
      expires_at: Timestamp.fromMillis(Date.now() + PROPOSAL_TTL_DAYS * 86400000),
      triggered_by_uid: AGENT_PRINCIPAL, triggered_by_email: "grc-review-sweep",
    });
    created += 1;
  }
  await logAgentAction({ run_id: null, actor: AGENT_PRINCIPAL, triggered_by: "scheduler", step: null, tool: "review_sweep", tool_class: "SYSTEM", args_sha256: sha256({}), result_summary: `overdue=${readiness.overdue} proposals_created=${created}` });
  return { overdue: readiness.overdue, proposals_created: created };
}

// ════════════════════════════════════════════════════════════════════
// approveGrcProposal — human boundary. APPROVE applies the action. CEO/compliance_lead.
// ════════════════════════════════════════════════════════════════════
async function approveGrcProposalHandler(req, res, { verifyAuth, getUserAccessProfile, ALLOWED_ORIGINS }) {
  const origin = req.headers.origin;
  res.set("Access-Control-Allow-Origin", ALLOWED_ORIGINS && ALLOWED_ORIGINS.includes(origin) ? origin : "");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const decoded = await verifyAuth(req);
    const profile = await getUserAccessProfile(decoded.uid);
    if (!PRIVILEGED.includes(profile.role_id)) return res.status(403).json({ error: "Approvals restricted to ceo/compliance_lead" });

    const { proposal_id, decision, edits } = req.body || {};
    if (!proposal_id || !["APPROVE", "REJECT"].includes(decision)) {
      return res.status(400).json({ error: "proposal_id and decision (APPROVE|REJECT) required" });
    }

    const propRef = db.collection("grc_proposals").doc(proposal_id);
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(propRef);
      if (!snap.exists) return { code: 404, body: { error: "Proposal not found" } };
      const p = snap.data();
      if (p.status !== "PENDING") return { code: 409, body: { error: `Proposal already ${p.status}` } };
      const expMs = dateMs(p.expires_at);
      if (expMs && expMs < Date.now()) {
        tx.set(propRef, { status: "EXPIRED", decided_at: FieldValue.serverTimestamp() }, { merge: true });
        return { code: 409, body: { error: "Proposal expired" } };
      }

      const stamp = {
        decided_by_uid: decoded.uid, decided_by_email: decoded.email || profile.email || "unknown",
        decided_by_role: profile.role_id, decided_at: FieldValue.serverTimestamp(),
      };
      if (decision === "REJECT") {
        tx.set(propRef, { status: "REJECTED", ...stamp }, { merge: true });
        return { code: 200, body: { success: true, status: "REJECTED" } };
      }

      // APPROVE → apply the action.
      const payload = p.payload || {};
      let applied = null;
      if (p.kind === "schedule_review" || p.kind === "flag_for_review") {
        const docId = p.doc_id || payload.doc_id;
        if (docId) {
          const dsnap = await tx.get(db.collection("grc_documents").where("doc_id", "==", docId).where("status", "==", "ACTIVE").limit(1));
          if (!dsnap.empty) {
            const ref = dsnap.docs[0].ref;
            const patch = { review_flagged: true, review_flagged_at: FieldValue.serverTimestamp(), review_flagged_by: stamp.decided_by_email };
            const newDate = edits?.proposed_review_date || payload.proposed_review_date;
            if (p.kind === "schedule_review" && newDate) patch.next_review_date = String(newDate).slice(0, 10);
            tx.set(ref, patch, { merge: true });
            applied = { doc_id: docId, ...patch };
          }
        }
      } else if (p.kind === "draft_capa") {
        const capaRef = db.collection("capas").doc();
        tx.set(capaRef, {
          source: AGENT_PRINCIPAL, grc_proposal_id: proposal_id, doc_id: p.doc_id || null,
          summary: edits?.capa_summary || payload.capa_summary || payload.reason || "GRC CAPA",
          status: "OPEN", created_by: stamp.decided_by_email, created_at: FieldValue.serverTimestamp(),
        });
        applied = { capa_id: capaRef.id };
      }
      tx.set(propRef, { status: "APPROVED", applied: applied || null, ...stamp }, { merge: true });
      return { code: 200, body: { success: true, status: "APPROVED", applied } };
    });

    await logAgentAction({
      run_id: null, actor: decoded.email || "unknown", triggered_by: decoded.uid, step: null,
      tool: decision === "APPROVE" ? "human_approve_proposal" : "human_reject_proposal", tool_class: "HUMAN",
      args_sha256: sha256({ proposal_id, decision, edits }), result_summary: `proposal ${proposal_id}: ${result.body.status || result.body.error}`,
    });

    return res.status(result.code).json(result.body);
  } catch (err) {
    console.error("approveGrcProposal error:", err);
    const code = err.code && String(err.code).startsWith("AUTH") ? 401 : 500;
    return res.status(code).json({ error: code === 401 ? "Unauthorized" : "Internal server error", detail: err.message });
  }
}

module.exports = {
  grcAssistantChatHandler,
  grcAuditReadinessHandler,
  grcReviewSweepHandler,
  approveGrcProposalHandler,
};
