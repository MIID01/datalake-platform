/**
 * ai-client.js — Datalake Shared AI Client Module
 *
 * ALL Cloud Functions use this module to call AI services.
 * No function may call an external AI API directly.
 *
 * Provides:
 *   callLLM(options)  — calls datalake-ai-inference (Qwen 2.5 7B, self-hosted Ollama)
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
const { BigQuery } = require("@google-cloud/bigquery");
const { GoogleAuth } = require("google-auth-library");

// ── Service URLs — read from environment (set on Cloud Run deployment) ──
// Fallback values are placeholders; real URLs are injected via Cloud Run env vars.
const AI_INFERENCE_URL =
  process.env.AI_INFERENCE_URL ||
  "https://datalake-ai-inference-808056940626.me-central2.run.app";

const OCR_URL =
  process.env.OCR_URL ||
  "https://datalake-ocr-808056940626.me-central2.run.app";

// ── Constants ──
const MODEL_NAME = "qwen2.5:3b-instruct-q4_K_M";
const MODEL_VERSION = "1.0";
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
    model_name: MODEL_NAME,
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
    // A BigQuery insert failure is a COMPLIANCE VIOLATION — log loudly.
    // Do NOT suppress. If the audit log fails, the calling function should
    // decide whether to abort or proceed with a warning.
    console.error(
      "[AUDIT LOG FAILED — COMPLIANCE VIOLATION]",
      err.message,
      JSON.stringify(err.errors || [])
    );
    // Re-throw so callers can decide; callLLM/callOCR catch and log but continue.
    throw err;
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
}) {
  const startTime = Date.now();

  let authToken;
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

  try {
    const response = await fetch(`${AI_INFERENCE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authToken,
      },
      body: JSON.stringify({
        model: MODEL_NAME,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1, // Low temperature for deterministic compliance outputs
        max_tokens: MAX_TOKENS,
        stream: false,
        // Ollama structured outputs.
        //   • jsonSchema (preferred) — passes a full JSON Schema; Ollama
        //     constrains output to match the schema EXACTLY. This is what
        //     stops Qwen 2.5 7B from inventing its own field names on long
        //     inputs (the "sections": [...obligations...] failure mode).
        //   • jsonMode — loose JSON mode (no shape constraint). Use when
        //     you want a JSON object but don't care which keys.
        ...(jsonSchema
          ? { format: jsonSchema, response_format: { type: "json_object", schema: jsonSchema } }
          : (jsonMode ? { format: "json", response_format: { type: "json_object" } } : {})),
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
  try {
    const cleaned = rawOutput
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/g, "")
      .trim();
    return { success: true, data: JSON.parse(cleaned) };
  } catch (err) {
    return { success: false, error: `JSON parse failed: ${err.message}`, raw: rawOutput };
  }
}

module.exports = { callLLM, callOCR, logAiAction, parseJsonOutput, MODEL_NAME, MODEL_VERSION };
