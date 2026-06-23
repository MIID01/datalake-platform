/**
 * ai-client.js — Datalake Shared AI Client Module
 *
 * ALL Cloud Functions use this module to call AI services.
 * No function may call an external AI API directly.
 *
 * Provides:
 *   callLLM(options)  — calls the self-hosted Ollama backend (Gemma 3, in me-central2):
 *                       either datalake-ai-inference (Cloud Run CPU) or the in-KSA GPU VM.
 *   callOCR(options)  — calls datalake-ocr (PaddleOCR, CPU-only)
 *   logAiAction(data) — immutable BigQuery audit insert to datalake_audit.ai_actions
 *
 * Rules enforced:
 *   1. No external AI APIs — all calls go to internal Cloud Run services via VPC.
 *   2. Every AI call is logged to BigQuery BEFORE returning to caller.
 *   3. Input is stored as SHA-256 hash only — never the raw content.
 *   4. AI inference scales to zero (min-instances=0) — cold start ~30s, acceptable.
 *   5. max_tokens: 2000 hard ceiling on every call.
 *
 * DTLK-PROMPT-AI-001 | NCA ECC-1:2018 | SAMA CSF
 */

"use strict";

const fetch = require("node-fetch");
const crypto = require("crypto");
const admin = require("firebase-admin");
const { BigQuery } = require("@google-cloud/bigquery");
const { GoogleAuth } = require("google-auth-library");

// ── Service URLs — read from environment (set on Cloud Run deployment) ──
// Fallback values are placeholders; real URLs are injected via Cloud Run env vars.
// AI_INFERENCE_URL is EITHER a Cloud Run service (https://…run.app, OIDC-authed,
// scale-to-zero CPU) OR the in-KSA GPU VM (http://10.x.x.x:11434, no auth, reached
// over a Serverless VPC connector). We detect which by the hostname and adjust auth
// + wake-on-demand accordingly.
const AI_INFERENCE_URL =
  process.env.AI_INFERENCE_URL ||
  "https://datalake-ai-inference-808056940626.me-central2.run.app";

const OCR_URL =
  process.env.OCR_URL ||
  "https://datalake-ocr-808056940626.me-central2.run.app";

// ── In-KSA GPU VM (Gemma 3 12B on an L4) — optional. When GPU_VM_NAME is set, the
// inference backend is a GCE VM that AUTO-STOPS when idle (cost control), so before
// any call we start it if TERMINATED and wait for Ollama to answer. Unset on the
// CPU/Cloud-Run path, where ensureInferenceUp() is a no-op.
const GPU_VM_NAME = process.env.GPU_VM_NAME || "";
const GPU_VM_ZONE = process.env.GPU_VM_ZONE || "me-central2-c";
// A non-Cloud-Run backend (the VM's internal IP) is NOT a Google OIDC audience —
// Ollama does no auth, so we must NOT attach a Cloud Run ID token to it.
const BACKEND_IS_CLOUD_RUN = /\.run\.app(\/|$)/i.test(AI_INFERENCE_URL);

// ── Constants ──
// Self-hosted OPEN-WEIGHT models on our own Ollama in me-central2 (no external AI;
// PII never leaves KSA). Qwen 2.5 3B is retired — it confabulated on extraction.
// TEXT model (LLM_MODEL): Qwen 2.5 14B on the in-KSA GPU — in a head-to-head on a
// real bilingual (AR/EN) contract it extracted more fields than Gemma 12B (passport,
// both contract dates) and is strong on Arabic. VISION model (VISION_MODEL): Gemma 3
// 12B — Qwen 2.5 14B is text-only, so image/scanned CVs go to Gemma vision.
// Both are env-driven so the deployed model and the audit label can never drift
// (integrity rule: the label must name the TRUE model that ran).
const MODEL_NAME = process.env.LLM_MODEL || "qwen2.5:14b-instruct";
const VISION_MODEL = process.env.VISION_MODEL || "gemma3:12b";
const MODEL_VERSION = process.env.LLM_MODEL_VERSION || "qwen2.5";
const MAX_TOKENS = 2000; // Hard ceiling per DTLK-PROMPT-AI-001 §Cost Control
const BQ_DATASET = "datalake_audit";
const BQ_TABLE = "ai_actions";
const PROJECT_ID = "datalake-production-sa";

const bigquery = new BigQuery({ projectId: PROJECT_ID });

// ── Auth token cache (avoid re-fetching on every call within same instance) ──
const _tokenCache = {};

/**
 * Get a short-lived service-to-service ID token for calling authenticated Cloud Run services.
 * Tokens are cached for 50 minutes (they expire after 60).
 */
async function getAuthToken(targetUrl) {
  const now = Date.now();
  const cached = _tokenCache[targetUrl];
  if (cached && cached.expiresAt > now) {
    return cached.token;
  }

  const auth = new GoogleAuth();
  const client = await auth.getIdTokenClient(targetUrl);
  const headers = await client.getRequestHeaders();
  const token = headers.Authorization;

  _tokenCache[targetUrl] = { token, expiresAt: now + 50 * 60 * 1000 };
  return token;
}

// ══════════════════════════════════════════════════════════════════
// ensureInferenceUp — wake the in-KSA GPU VM if it auto-stopped while idle.
// No-op on the Cloud Run backend (GPU_VM_NAME unset). On the VM backend it:
//   1. reads the instance status via the Compute REST API,
//   2. starts it if not RUNNING,
//   3. polls Ollama's /api/version until it answers (boot + ollama start ≈ 30-60s).
// The first inference after a wake still pays the model load (~50s) inside callLLM's
// own timeout — that's expected and acceptable for async CV/contract processing.
// ══════════════════════════════════════════════════════════════════
const _sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function _computeAccessToken() {
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  return token;
}

async function _ollamaReady() {
  try {
    const r = await fetch(`${AI_INFERENCE_URL}/api/version`, { timeout: 4000 });
    return r.ok;
  } catch (_) {
    return false;
  }
}

async function ensureInferenceUp() {
  if (!GPU_VM_NAME) return; // Cloud Run backend — nothing to wake.

  // Fast path: already serving.
  if (await _ollamaReady()) return;

  const base = `https://compute.googleapis.com/compute/v1/projects/${PROJECT_ID}/zones/${GPU_VM_ZONE}/instances/${GPU_VM_NAME}`;
  const token = await _computeAccessToken();
  const authH = { Authorization: `Bearer ${token}` };

  // Read status; start if it isn't running.
  let status = "UNKNOWN";
  try {
    const g = await fetch(base, { headers: authH, timeout: 10000 });
    if (g.ok) status = (await g.json()).status || "UNKNOWN";
  } catch (_) {}

  if (status !== "RUNNING") {
    console.log(`[AI Client] GPU VM ${GPU_VM_NAME} is ${status} — starting it…`);
    const s = await fetch(`${base}/start`, { method: "POST", headers: authH, timeout: 15000 });
    if (!s.ok && s.status !== 200) {
      const t = await s.text().catch(() => "");
      // 409/instance-already-running is fine; otherwise surface it.
      if (!/already|running/i.test(t)) console.warn(`[AI Client] VM start returned ${s.status}: ${t.slice(0, 120)}`);
    }
  }

  // Poll until Ollama answers (boot + systemd ollama start).
  const deadline = Date.now() + 150000; // 2.5 min ceiling
  while (Date.now() < deadline) {
    await _sleep(5000);
    if (await _ollamaReady()) {
      console.log(`[AI Client] GPU VM ${GPU_VM_NAME} is serving.`);
      return;
    }
  }
  throw new Error(`GPU VM ${GPU_VM_NAME} did not become ready within 150s`);
}

// ══════════════════════════════════════════════════════════════════
// logAiAction — Immutable BigQuery audit insert
// Called for EVERY AI action: LLM call, OCR call, or error.
// NCA ECC-1:2018: No UPDATE or DELETE on this table.
// ══════════════════════════════════════════════════════════════════
async function logAiAction(action) {
  const row = {
    action_id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    agent_name: action.agent || "unknown",
    action_type: action.type || "unknown",
    triggered_by: action.triggeredBy || "system",
    // CRITICAL: SHA-256 hash of input — never store raw prompts in BigQuery
    input_hash: crypto
      .createHash("sha256")
      .update(JSON.stringify(action.input || ""))
      .digest("hex"),
    input_type: action.inputType || "text",
    output_summary: String(action.outputSummary || "").substring(0, 500),
    output_action: action.outputAction || "unknown",
    model_name: action.modelName || MODEL_NAME,
    model_version: action.modelVersion || MODEL_VERSION,
    prompt_template_id: action.promptTemplateId || "none",
    inference_time_ms: action.inferenceMs || 0,
    token_count_input: action.tokensIn || null,
    token_count_output: action.tokensOut || null,
    confidence_score: action.confidence || null,
    error: action.error || null,
  };

  try {
    await bigquery.dataset(BQ_DATASET).table(BQ_TABLE).insert([row]);
  } catch (err) {
    // A BigQuery insert failure is a COMPLIANCE VIOLATION — log loudly AND write a
    // durable fallback so the audit record is NEVER silently lost (fail-durable, not
    // fail-silent). The fallback Firestore collection is server-write-only and can be
    // re-ingested to BigQuery. Only if BOTH sinks fail do we re-throw.
    console.error(
      "[AUDIT LOG FAILED — COMPLIANCE VIOLATION]",
      err.message,
      JSON.stringify(err.errors || [])
    );
    try {
      await admin.firestore().collection("ai_audit_fallback").add({
        ...row,
        _fallback_reason: String(err.message || "bigquery insert failed").slice(0, 500),
        _fallback_at: admin.firestore.FieldValue.serverTimestamp(),
        _reingested: false,
      });
      console.error("[AUDIT LOG] wrote durable Firestore fallback (ai_audit_fallback) — not lost.");
      return; // audit is captured durably; do not break the caller's AI action.
    } catch (fallbackErr) {
      console.error("[AUDIT LOG] FALLBACK ALSO FAILED — re-throwing", fallbackErr.message);
      throw err; // both sinks down → surface it
    }
  }
}

// ══════════════════════════════════════════════════════════════════
// callLLM — Calls datalake-ai-inference (Ollama / Qwen 2.5 7B)
// OpenAI-compatible endpoint: POST /v1/chat/completions
// ══════════════════════════════════════════════════════════════════
/**
 * @param {object} options
 * @param {string} options.agent           - 'gatekeeper' | 'auditor' | 'controller'
 * @param {string} options.type            - action type for audit log
 * @param {string} options.systemPrompt    - system instruction
 * @param {string} options.userPrompt      - user content (what to process)
 * @param {string} options.triggeredBy     - uid or 'scheduler'
 * @param {string} options.promptTemplateId - versioned template ID
 * @param {Array<{base64:string,mimeType:string}>} [options.images] - when set, the
 *        call is MULTIMODAL: the images are sent to Gemma 3 vision alongside the
 *        text prompt (OCR + extraction in one GPU call — no separate PaddleOCR step).
 * @returns {{ success: boolean, output: string, inferenceMs: number, error?: string }}
 */
async function callLLM({
  agent,
  type,
  systemPrompt,
  userPrompt,
  triggeredBy,
  promptTemplateId,
  jsonMode = false,
  jsonSchema = null,
  images = null,
}) {
  const startTime = Date.now();

  // Text -> Qwen (MODEL_NAME); images -> Gemma vision (VISION_MODEL). The audit
  // logs whichever actually ran so the label never lies about the model.
  const modelUsed = (images && images.length) ? VISION_MODEL : MODEL_NAME;

  // Wake the in-KSA GPU VM if it auto-stopped (no-op on Cloud Run backend).
  try {
    await ensureInferenceUp();
  } catch (wakeErr) {
    const inferenceMs = Date.now() - startTime;
    console.error(`[AI Client] Inference backend not ready: ${wakeErr.message}`);
    try {
      await logAiAction({
        agent, type, triggeredBy, promptTemplateId,
        input: userPrompt,
        outputAction: "backend_unavailable",
        error: wakeErr.message,
        inferenceMs,
      });
    } catch (_) {}
    return { success: false, error: `Inference backend not ready: ${wakeErr.message}`, inferenceMs };
  }

  // OIDC token ONLY for the Cloud Run backend. The GPU VM (Ollama) does no auth.
  let authToken = null;
  if (BACKEND_IS_CLOUD_RUN) {
    try {
      authToken = await getAuthToken(AI_INFERENCE_URL);
    } catch (authErr) {
      const inferenceMs = Date.now() - startTime;
      console.error(`[AI Client] Auth failed for inference: ${authErr.message}`);
      // Best-effort audit log
      try {
        await logAiAction({
          agent, type, triggeredBy, promptTemplateId,
          input: userPrompt,
          outputAction: "auth_error",
          error: authErr.message,
          inferenceMs,
        });
      } catch (_) {}
      return { success: false, error: `Auth error: ${authErr.message}`, inferenceMs };
    }
  }

  try {
    const response = await fetch(`${AI_INFERENCE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authToken ? { Authorization: authToken } : {}),
      },
      body: JSON.stringify({
        model: modelUsed,
        messages: [
          { role: "system", content: systemPrompt },
          // Multimodal when images are supplied: OpenAI-compatible content parts
          // (text + image_url data URIs). Gemma 3 reads the image directly, so the
          // model does OCR + extraction in one pass — no separate PaddleOCR call.
          (images && images.length)
            ? {
                role: "user",
                content: [
                  { type: "text", text: userPrompt || "" },
                  ...images.map((img) => ({
                    type: "image_url",
                    image_url: { url: `data:${img.mimeType || "image/png"};base64,${img.base64}` },
                  })),
                ],
              }
            : { role: "user", content: userPrompt },
        ],
        temperature: 0.1, // Low temperature for deterministic compliance outputs
        max_tokens: MAX_TOKENS,
        stream: false,
        // Structured outputs via the OpenAI-COMPATIBLE endpoint (/v1/chat/completions).
        //   The schema MUST be passed as response_format:{type:'json_schema', json_schema:{…}}.
        //   The previous shape — top-level `format` (Ollama-native, ignored by the
        //   OpenAI layer) + response_format:{type:'json_object', schema} (the `schema`
        //   subfield is ignored under json_object) — left the model UNCONSTRAINED, so
        //   on a contract it free-formed the letterhead instead of the requested fields.
        //   `type:'json_schema'` is what actually constrains Qwen to the exact keys.
        //   • jsonMode — loose JSON object (valid-JSON only, no shape constraint).
        //   NOTE: strict is intentionally OFF — under strict the small 3B model was
        //   forced to fill every field and CONFABULATED sample values ("John Doe",
        //   fake passport/IBAN). Without strict the schema guides the shape but the
        //   model may output null for fields it cannot find in the text (which the
        //   hard grounding rule in the prompt requires).
        ...(jsonSchema
          ? { response_format: { type: "json_schema", json_schema: { name: "extraction", schema: jsonSchema } } }
          : (jsonMode ? { response_format: { type: "json_object" } } : {})),
      }),
      timeout: 480000, // 8-minute timeout — Qwen 2.5 7B on CPU can take 3-7 minutes on long OCR output; pdf-parse text is much shorter so this is generous headroom
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Inference HTTP ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const inferenceMs = Date.now() - startTime;
    const output = data.choices?.[0]?.message?.content || "";

    await logAiAction({
      agent,
      type,
      triggeredBy,
      promptTemplateId,
      input: userPrompt,
      inputType: "text",
      modelName: modelUsed,
      outputSummary: output.substring(0, 500),
      outputAction: "draft_created",
      inferenceMs,
      tokensIn: data.usage?.prompt_tokens,
      tokensOut: data.usage?.completion_tokens,
    }).catch((logErr) => {
      // Audit log failure: log but do not block the response
      console.error("[AI Client] BQ audit insert failed:", logErr.message);
    });

    return { success: true, output, inferenceMs };
  } catch (err) {
    const inferenceMs = Date.now() - startTime;
    console.error(`[AI Client] LLM call failed (${agent}/${type}):`, err.message);

    try {
      await logAiAction({
        agent, type, triggeredBy, promptTemplateId,
        input: userPrompt,
        outputAction: "error",
        error: err.message,
        inferenceMs,
      });
    } catch (_) {}

    return { success: false, error: err.message, inferenceMs };
  }
}

// ══════════════════════════════════════════════════════════════════
// callOCR — Calls datalake-ocr (PaddleOCR, CPU-only)
// POST /extract — accepts base64-encoded PDF or image
// ══════════════════════════════════════════════════════════════════
/**
 * @param {object} options
 * @param {string} options.fileBase64  - base64-encoded file content
 * @param {string} [options.lang]      - 'en' | 'ar' (default: 'en')
 * @param {string} options.agent       - 'gatekeeper' | 'auditor' | 'controller'
 * @param {string} options.type        - action type for audit log
 * @param {string} options.triggeredBy - uid or 'scheduler'
 * @returns {{ success: boolean, lines: Array, pageCount: number, error?: string }}
 */
async function callOCR({ fileBase64, lang, agent, type, triggeredBy }) {
  const startTime = Date.now();
  const language = lang || "en";

  let authToken;
  try {
    authToken = await getAuthToken(OCR_URL);
  } catch (authErr) {
    const inferenceMs = Date.now() - startTime;
    console.error(`[AI Client] Auth failed for OCR: ${authErr.message}`);
    try {
      await logAiAction({
        agent, type, triggeredBy,
        input: `ocr_auth_fail_${language}`,
        outputAction: "auth_error",
        error: authErr.message,
        inferenceMs,
      });
    } catch (_) {}
    return { success: false, error: `Auth error: ${authErr.message}`, lines: [], pageCount: 0 };
  }

  // PaddleOCR scales to zero; first request after idle pays a cold start
  // (container + model load) that can take 60-90s before any byte is processed.
  // Bumping fetch timeout to 180s and retrying once on network/timeout
  // covers that without sitting on min-instances (forbidden per CLAUDE.md).
  const attemptOcr = async () => {
    const response = await fetch(`${OCR_URL}/extract`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authToken,
      },
      body: JSON.stringify({ file_base64: fileBase64, lang: language }),
      timeout: 180000,
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OCR HTTP ${response.status}: ${errText}`);
    }
    return response;
  };

  try {
    let response;
    try {
      response = await attemptOcr();
    } catch (firstErr) {
      const transient = /timeout|ETIMEDOUT|ECONNRESET|ENOTFOUND|network/i.test(firstErr.message || "");
      if (!transient) throw firstErr;
      console.warn(`[AI Client] OCR first attempt failed (${firstErr.message}) — retrying once after cold-start`);
      response = await attemptOcr();
    }

    const data = await response.json();
    const inferenceMs = Date.now() - startTime;

    await logAiAction({
      agent,
      type,
      triggeredBy,
      input: `ocr_${language}_${data.page_count || 0}_pages`,
      inputType: "document",
      outputSummary: `Extracted ${data.lines?.length || 0} text lines from ${
        data.page_count || 0
      } pages`,
      outputAction: "ocr_complete",
      inferenceMs,
    }).catch((logErr) => {
      console.error("[AI Client] BQ audit insert failed (OCR):", logErr.message);
    });

    return {
      success: true,
      lines: data.lines || [],
      pageCount: data.page_count || 0,
      inferenceMs,
    };
  } catch (err) {
    const inferenceMs = Date.now() - startTime;
    console.error(`[AI Client] OCR call failed (${agent}/${type}):`, err.message);

    try {
      await logAiAction({
        agent, type, triggeredBy,
        input: `ocr_${language}`,
        inputType: "document",
        outputAction: "error",
        error: err.message,
        inferenceMs,
      });
    } catch (_) {}

    return { success: false, error: err.message, lines: [], pageCount: 0, inferenceMs };
  }
}

// ══════════════════════════════════════════════════════════════════
// parseJsonOutput — Safe JSON parser for LLM outputs
// Models sometimes wrap JSON in markdown fences — strip them.
// ══════════════════════════════════════════════════════════════════
function parseJsonOutput(rawOutput) {
  const cleaned = String(rawOutput || "")
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  // 1) Direct parse (the happy path — a clean JSON object).
  try {
    return { success: true, data: JSON.parse(cleaned) };
  } catch (_) { /* fall through */ }

  // 2) Tolerate prose/commentary around the JSON: pull the FIRST balanced
  //    {…} object and parse that. A truncated object (no matching close —
  //    e.g. a model that returned only "{") cannot be salvaged and fails
  //    honestly, so the UI shows PARSE_FAILED rather than fabricating fields.
  const block = extractFirstJsonObject(cleaned);
  if (block) {
    try {
      return { success: true, data: JSON.parse(block) };
    } catch (_) { /* fall through */ }
  }

  return {
    success: false,
    error: "JSON parse failed: model output was not valid JSON",
    raw: rawOutput,
  };
}

// Scan for the first complete top-level {…} object, respecting string literals
// and escapes so braces inside strings don't throw off the depth count.
function extractFirstJsonObject(s) {
  const start = s.indexOf("{");
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') {
      inStr = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null; // unbalanced / truncated — not salvageable
}

module.exports = { callLLM, callOCR, logAiAction, parseJsonOutput, MODEL_NAME, MODEL_VERSION };
