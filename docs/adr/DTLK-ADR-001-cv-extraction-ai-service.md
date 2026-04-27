# DTLK-ADR-001 — CV Extraction AI Service

**Document ID:** DTLK-ADR-001
**Version:** 1.0
**Status:** Accepted
**Date:** April 23, 2026
**Owner:** CEO (Mido)

---

## Context

Datalake's careers portal requires automated CV parsing to extract structured data (name, email, phone, skills, employment history, etc.) from candidate-uploaded resumes. This supports:
1. CEO directive to reduce career form friction (A.1 in backlog)
2. The "wow moment" in client/investor demos
3. Downstream HR scoring pipeline (requires structured candidate data)

Primary constraints:
- **KSA data sovereignty**: All personal data must remain in me-central2 (Dammam) per PDPL
- **Cost**: Bootstrap-phase budget (<$50/month infrastructure)
- **Integration simplicity**: Must work within existing Firebase + GCP stack
- **Accuracy**: Good enough that candidates don't abandon the auto-fill

## Options Considered

### Option A: Google Document AI
- Purpose-built for document parsing (specialist)
- Form Parser processor type (or Resume Parser if available)
- Cost: ~$0.065/page (2 pages typical = $0.13/CV)
- **Critical finding**: Not available in me-central2 region

### Option B: Vertex AI Gemini 2.5 Flash
- LLM-based extraction (general-purpose, flexible)
- Cost: ~$0.002/CV
- **Available in me-central2** ✓ (with global fallback during propagation)
- Current-generation model, strong at unstructured document parsing

### Option C: OpenAI GPT-4o-mini
- Cheapest option (~$0.001/CV)
- **Not KSA-sovereign** — runs on OpenAI infrastructure outside KSA

### Option D: Self-hosted open-source (Llama 3, Mistral, etc.)
- Fully sovereign if hosted in me-central2
- GPU infrastructure cost: ~$200-500/month minimum
- **Not cheap at low volume** — fixed cost regardless of usage

## Decision

**Use Vertex AI Gemini 2.5 Flash with KSA-first routing (me-central2 → global fallback).**

This decision represents a pivot from the original intent (Google Document AI) made during implementation after discovering Document AI's regional limitation.

## Consequences

### Positive
- **KSA sovereignty preserved**: Every byte of candidate PII stays in me-central2 (Dammam)
- **30x cheaper per CV** than the original Document AI plan ($0.002 vs $0.065)
- **Already in Google stack**: No new vendor, billing account, or credentials
- **Better for unstructured CVs**: LLMs handle varying CV formats better than Document AI's Form Parser
- **Faster to ship**: No new API enablement, no processor creation

### Negative
- **Less deterministic than Document AI**: LLM outputs can vary slightly between calls. Mitigated by temperature=0.1 configuration (near-deterministic; Google's recommended setting for structured extraction).
- **Routing transparency**: KSA-first pattern tries me-central2, falls back to global if regional endpoint unavailable. Audit log records which endpoint was used per request.
- **Requires prompt engineering**: Field extraction quality depends on prompt design (vs Document AI where the processor handles this)
- **Newer model may change**: Gemini 2.0 Flash is relatively new; may deprecate or change behavior
- **No built-in Resume schema**: Must define extraction fields in prompt, whereas Document AI Resume Parser has them predefined

### Process Lessons
- **Drift happened silently**: The switch from Document AI to Gemini was made during implementation without CEO explicit sign-off. Progress Report and consent text went out of sync momentarily.
- **Fix going forward**: Any deviation from architectural spec must be flagged to CEO BEFORE deploy and captured in an ADR like this one.
- **Documentation must match code**: Careers consent text correctly references Gemini. Progress Report was corrected to match.

## Implementation Details

- **SDK**: `@google-cloud/vertexai` ^1.9.0 (Node.js)
- **Model**: `gemini-2.5-flash`
- **Location**: KSA-first routing — tries `me-central2` (Dammam), falls back to `global` if regional unavailable
- **Called from**: Cloud Function `extractCVData` in me-central2
- **Returns**: Structured JSON with 12 candidate fields
- **Audit**: Each extraction logs `ai_region` (actual endpoint used) to `task_audit_log`
- **PDPL consent**: 5th checkbox in `/careers` explicitly names "Vertex AI Gemini, hosted in KSA me-central2 region"

## Review Date

Revisit this decision when:
- me-central2 regional endpoint fully propagates (remove global fallback, full sovereignty)
- Google Document AI becomes available in me-central2 (monitor https://cloud.google.com/document-ai/docs/regions)
- CV volume exceeds 500/month (may justify self-hosted Gemma 4 on L4 GPU in me-central2)
- Gemini 2.5 Flash is deprecated or superseded
- Cost-quality trade-offs change materially

---

## Related Documents

- DTLK-ARCH-SYS-001 (Zero-Human Architecture) — update to reflect Gemini not Document AI
- DTLK-POL-PRI-001 (Privacy Policy) — ensure AI processing disclosure includes Vertex AI Gemini
- DTLK-OPS-TLP-001 (Talent Pool Lifecycle) — references PDPL consent flow (aligned)
- Careers.jsx — contains the candidate-facing consent text (aligned)

---

**Version:** 1.0
**Next Review:** July 2026 or upon major Google Cloud region announcement
