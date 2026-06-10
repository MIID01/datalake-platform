# Datalake Platform — Cost & Open-Source Strategy (brainstorm, v0.1)

> Working document. Goal: where does this platform spend money, what free / open-source
> options exist, and what's the **overall direction** — not a build list. Decisions are
> shaped by three hard constraints that rule out most "just use the free cloud thing":
>
> 1. **Data residency = `me-central2` (Dammam, KSA)** for PDPL + ZATCA. Any alternative must run in-region.
> 2. **ZATCA Phase-2 e-invoicing** is a legal requirement (FATOORA clearance/reporting).
> 3. **Bank + ISO audit**: WORM immutability, append-only audit, segregation of duties must survive any change.

## TL;DR — the headline
The expensive mistakes were **already avoided**. The platform self-hosts its AI (the usual #1 SaaS bill),
sends email inside the Workspace it already pays for, and uses 100% open-source libraries. So there is no
big "switch to free" lever left on the *tooling*. The real money questions are:

1. **One recurring third-party SaaS subscription stands out: Zoho Books.** Whether we can drop it depends on
   completing **in-house ZATCA/FATOORA** (the platform already does ~80% of the XML/QR/hash). This is the
   single biggest recurring-cost decision — a build-vs-buy on a compliance-critical function.
2. **The biggest "free" wins are OPTIMIZATION, not replacement** — Firestore read discipline, Cloud Run
   scale-to-zero everywhere, function consolidation, AI result caching, storage tiering. These cut the GCP
   bill without migration risk.

---

## Cost surface (what actually costs money today)

| Area | Today | Cost model | Already optimal? |
|---|---|---|---|
| **AI LLM + OCR** | Qwen 2.5 **3B** (Ollama) + PaddleOCR, self-hosted Cloud Run over VPC, no external API | Cloud Run compute only | ✅ **Yes — the big win is banked** |
| **Email** | Gmail via Workspace domain-wide delegation | ~free within existing Workspace seats | ✅ Yes |
| **Frontend + backend libs** | React/Vite/jspdf/exceljs/recharts; pdfkit/pdf-parse/docxtemplater/googleapis | $0 (open-source) | ✅ Yes |
| **Firestore** | Primary DB + realtime `onSnapshot` everywhere | per read/write/delete + storage | ⚠️ Optimize (reads) |
| **Cloud Functions (Gen2/Run)** | ~120+ functions | invocations + compute; scale-to-zero (hard rule) | ⚠️ Consolidate |
| **Cloud Storage** | WORM buckets (cv-uploads, worm-hr, worm-finance, grc-library) | storage + egress + ops | ⚠️ Lifecycle tiering |
| **BigQuery** | Append-only audit (`datalake_audit`, `datalake_finance`) | storage (cheap) + per-TB query | ⚠️ Partition |
| **Firebase Auth** | email/password | free < 50K MAU (we have ~12 + clients) | ✅ Effectively free |
| **Firebase Hosting** | SPA | free tier ample | ✅ Yes |
| **Zoho Books** | accounting + invoicing + (FATOORA?) | **monthly SaaS subscription** | ❌ **The decision** |
| **Telephony / SMS / WhatsApp** | Twilio / Unifonic / Meta (Integrations page, optional) | pay-per-use, only if enabled | ⚠️ Enable only what's needed |

---

## The central decision: Zoho Books vs in-house ZATCA + open-source accounting

**Context that changes the math:** we just renamed `zatca_status` from `"SUBMITTED"` to
`"LOCAL_XML_GENERATED"` — i.e. the platform **generates** ZATCA Phase-2 UBL XML + QR + hash but does **not
submit to FATOORA**, and the cryptographic stamp is a `SIGNATURE_PLACEHOLDER`. So today either Zoho is the
FATOORA path, or FATOORA submission isn't happening yet. **We must confirm which** — it determines everything.

**Option A — Complete in-house ZATCA, drop Zoho.** The platform already owns the invoice lifecycle, SoD gate,
CEO approval, WORM PDF, and 80% of the ZATCA artifact. Remaining work: real CSID/EGS onboarding, cryptographic
signing (replace the placeholder), and the FATOORA clearance/reporting API calls. Biggest recurring saving;
highest compliance-engineering effort and risk.

**Option B — Open-source accounting ledger + in-house FATOORA.** Replace Zoho Books' *bookkeeping* with
self-hosted **ERPNext (Frappe)** — open-source, has KSA/VAT localization and a ZATCA community module — in
`me-central2`. Keeps a real double-entry ledger without the subscription; still need FATOORA integration.

**Option C — Keep Zoho** as the compliance system-of-record if the subscription is cheaper than the
engineering + audit risk of A/B. Legitimate if invoice volume is low.

> Recommendation: **first confirm the FATOORA reality** (does anything submit today?). If we're already
> obligated to do FATOORA in-house, Option A's marginal cost shrinks and dropping Zoho becomes attractive.

---

## "Free / open-source we can use" — the menu (by area)

- **AI / LLM**: Qwen / Llama / Mistral (open weights, have Qwen) · Ollama / vLLM serving · **PaddleOCR / Tesseract** for OCR. *Principle: never add a paid LLM API; extend the self-hosted stack.*
- **Accounting / ERP / invoicing**: **ERPNext** (KSA localization), Invoice Ninja, Akaunting — all self-hostable in-region.
- **HTML→PDF** (replace client-side `html2canvas`+`jspdf` for server-rendered, consistent PDFs): **Gotenberg** or headless Chromium microservice on Cloud Run. Cleaner audit artifacts.
- **Telephony**: Asterisk / FreePBX / FusionPBX (self-host; still need a SIP trunk). SMS in KSA = licensed local provider (Unifonic/Msegat) — no free path (regulatory).
- **Auth** (only if ever leaving Firebase): Keycloak / Authentik.
- **DB + realtime** (only if ever leaving Firestore): PostgreSQL + Supabase/Hasura. *High migration cost — not recommended now.*
- **Email** (only if ever leaving Workspace for transactional): Postal / Mailu / Mailcow. *Deliverability risk; not worth it while paying for Workspace anyway.*
- **Observability** (vs Cloud Logging/Monitoring spend): Grafana + Prometheus + Loki.
- **Object storage** (vs GCS): MinIO (S3-compatible) — but WORM + residency make GCS the safer call.
- **Secrets** (vs Secret Manager): HashiCorp Vault — Secret Manager is already cheap; skip.

---

## Optimization wins that need NO replacement (do these first — lowest risk, real savings)

1. **Firestore read discipline** — the hidden bill. Audit `onSnapshot(collection(...))` whole-collection
   listeners (CEO dashboards, admin pages); switch realtime→one-shot where live isn't needed (already done for
   the client sign page), add `limit()`/pagination, dedupe overlapping listeners.
2. **Cloud Run scale-to-zero everywhere** — verify no function carries `min-instances` (hard rule already);
   right-size memory/timeout per function.
3. **Function consolidation** — ~120+ functions inflate cold-starts, deploy 429s, and ops. Merge cohesive
   endpoints (e.g. the RBAC admin set, the invoice set) behind fewer functions.
4. **AI result caching** — `ai-client.js` already SHA-256-hashes inputs; add a cache keyed on that hash to
   skip re-inference on identical inputs (re-validations, retries). Pure compute saving.
5. **Storage lifecycle tiering** — Nearline/Coldline/Archive for old audit objects (respecting WORM retention).
6. **BigQuery partition + cluster** audit tables by date; never `SELECT *`. Keeps queries in the free tier.

---

## Guiding principle (the direction)
> **Self-host open-source where it removes a per-use or per-seat fee AND can run compliantly in `me-central2`.
> Keep managed GCP where migration risk + ops cost exceed the saving.** The AI stack already embodies this;
> the next test case is ZATCA/accounting.

## Open questions to resolve before committing
- **Does anything submit to FATOORA today, or is Zoho the only ZATCA path?** (Determines the Zoho decision.)
- **What is the actual monthly Zoho spend + invoice volume?** (Build-vs-buy threshold.)
- **Current GCP bill breakdown** (Firestore reads vs Functions vs Storage vs BigQuery) — to target optimization.
- **Are telephony/SMS/WhatsApp integrations actually enabled/used**, or just scaffolded? (If unused, $0 — ignore.)

## Threads worth deep external research (current facts, cited)
- ZATCA Phase-2 FATOORA in-house feasibility (CSID/EGS onboarding, signing) — effort to drop Zoho.
- ERPNext KSA/ZATCA localization maturity (is it audit-grade?).
- GCP `me-central2` pricing levers (Cloud Run, Firestore, BigQuery) for a concrete optimization target.
