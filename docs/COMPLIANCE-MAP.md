# Compliance Map — Datalake Platform vs SAMA / NCA / NDMO / ISO 27001 / PDPL

**Status:** DRAFT for review · **Date:** 2026-06-21 · **Owner:** CEO (acting CISO/DPO)
**Method:** evidence-based audit of the actual codebase (`firestore.rules`, `storage.rules`, `functions/`, `src/`, `docs/`, CI). A control is credited **only** where it is present in code/config. Absence is stated as a **GAP**. Runtime-only facts (GCS retention, live IAM bindings, Firestore DB region) are marked **VERIFY** — they cannot be proven from source and need `gcloud`/console evidence.

> This document is auditor/bank-facing. Per the project's accuracy rule, no control is described as built unless verified. Where this map and `docs/SECURITY.md` disagree, the discrepancy is listed in §7.

---

## 1. Critical scope clarification (read first)

**This platform stores _Datalake's own_ business data — its staff, timesheets, HR, payroll, and invoices to the client (Emkan). It does _not_ ingest or store Emkan's banking/customer data.** That client data is processed on **Emkan's own systems**, where Datalake's deployed "team-as-a-service" engineers work, governed by the **engagement contract** — not by this platform.

Consequences for this mapping:
- Datalake is, in this platform, a **data controller of its own staff/business data** (PDPL).
- The **TaaS processing of Emkan's data happens outside this platform.** The platform's compliance role is to be the **auditable system of record** that proves Datalake is a controlled, compliant outsourcing provider to a SAMA-regulated FI (evidence, residency, access control, outsourcing governance).
- Therefore "client-banking-data residency/segregation" is **largely out of scope for this platform**; the genuine PDPL exposure here is **Datalake's staff/candidate PII** plus **financial PII sent to sub-processors** (Zoho, Google).

---

## 2. Overall readiness verdict

**Foundations are strong; not yet "100% / audit-ready."** The platform enforces a genuine **compliance-as-code** core (residency pins, default-deny RBAC, immutable approval evidence, hashed AI audit, honest status-integrity), and has real GRC capability (GRC document library, SAMA outsourcing materiality + NOC gate, automated PDPL erasure, audit export). But there are **material gaps** — most are organizational/legal or runtime-config, several are code — that must be closed before an external SAMA/NCA/ISO audit.

| Framework | Posture | Headline |
|---|---|---|
| **PDPL** | 🟡 Partial-strong | Real consent + automated erasure + controller declaration; **no DPA/sub-processor register, no DSAR/export, no org-wide retention schedule**. |
| **NCA ECC** | 🟡 Partial | Strong access/audit/residency core; gaps in MFA, logging completeness, BCP, third-party security, monitoring/alerting. |
| **SAMA CSF + Outsourcing** | 🟡 Partial | **Outsourcing materiality + NOC gate is a genuine strength**; gaps in BCM/BCP, MFA, vendor risk, incident management. |
| **NDMO** | 🔴 Largely absent | No data-classification taxonomy, data quality, catalog, lineage, or stewardship. |
| **ISO 27001** | 🔴 Not pursued | No ISMS, no Statement of Applicability, no certification. Many Annex A controls exist piecemeal but unmapped. |

---

## 3. Compliance-as-code — what is genuinely enforced (strengths)

These are real, verified, and the backbone of the audit story:

- **KSA residency pins** — `region: "me-central2"` on all 143 Cloud Functions; BigQuery datasets created with `location: "me-central2"`; Cloud Run AI services in-region; GPU zone `me-central2-c`. (`functions/index.js`, `functions/lib/bigquery.js:22`). *VERIFY: Firestore DB + bucket regions (project-creation settings).*
- **Default-deny RBAC boundary** — `firestore.rules:572-574` catch-all `if false`; role resolution + `client_id` scoping; CEO cannot change own role (`:51`). The rules are the real authz boundary.
- **Immutable approval evidence** — every `approval_evidence` subcollection is `update, delete: if false`; written server-side only via `recordApproval.js` (Admin SDK) with approver identity, signature SHA-256, file SHA-256, before-hash, and a signed WORM manifest. **Verified genuinely immutable.**
- **Hashed AI audit** — every LLM/OCR call → BigQuery `datalake_audit` with SHA-256 input hash, no raw prompts (`functions/lib/ai-client.js:167-206`).
- **No external-AI egress** — fully self-hosted Gemma 3 + PaddleOCR in me-central2; OpenAI/Gemini/Vertex/Anthropic all removed (only removal-marker comments remain). Telephony transcription returns `NOT_AVAILABLE` (no fabrication).
- **Status-integrity / No-Fabricated-Data** — AI service health computed from live Cloud Run + Monitoring signals, honest `NOT_DEPLOYED/BROKEN/IDLE` states (`functions/aiHealth.js`).
- **Segregation of duties** — payroll multi-stage chain with distinct signers, role-assign vs credential-reset split, timesheet self-approval block (`recordApproval.js`, `adminAuth.js`).
- **Force-password-change-on-first-login** — actually gates the whole app (`AuthGate.jsx:140-190`) — stronger than `SECURITY.md` claims.
- **SAMA outsourcing materiality + NOC gate** — blocks an engagement going ACTIVE until NOC obtained (`src/components/SamaMaterialityAssessment.jsx`).
- **Automated PDPL erasure** — daily candidate purge, Art. 18-cited, audited (`functions/hr.js:44-240`).
- **GRC document library** — WORM bucket, 4-tier classification, versioning, immutable change log (`functions/grcLibrary.js`).
- **Change control** — CI build→preview→Cypress→gated promote→tag; rollback runbook; dependabot (`.github/workflows/deploy.yml`, `docs/rollback.md`).

---

## 4. Control-domain mapping

Legend: ✅ BUILT · 🟡 PARTIAL · 🔴 GAP · 🔎 VERIFY (runtime). Frameworks: P=PDPL, E=NCA ECC, S=SAMA, N=NDMO, I=ISO 27001.

### 4.1 Data residency & encryption
| Control | St | Evidence | Frameworks |
|---|---|---|---|
| Function/BigQuery/Cloud Run region pin = me-central2 | ✅ | `index.js` (143 fns), `lib/bigquery.js:22` | P,E,S |
| Firestore DB region | 🔎 | project setting, not in repo | P,E,S |
| Storage bucket regions | 🔎 | infra-managed | P,E,S |
| Encryption at rest | 🟡 | Google default AES-256 only (no config) | E,I |
| Encryption in transit (TLS) | 🟡 | HTTPS everywhere **except GPU-VM Ollama hop = plain HTTP over VPC** (`lib/ai-client.js:34`) | E,I |
| CMEK / customer-managed keys | 🔴 | none anywhere | S,E (if required) |
| No external-AI egress | ✅ | `lib/ai-client.js` | P,S |
| Cross-border: M365/Graph Teams invites → global endpoint | 🟡 | `lib/msgraph.js:20,44` (inert until env-set) | P,S |
| Cross-border: Zoho `.sa`, Gmail/Workspace global | 🟡 | Zoho KSA DC ✓; Workspace org-level | P |

### 4.2 Access control / IAM / authentication
| Control | St | Evidence | Frameworks |
|---|---|---|---|
| Default-deny RBAC boundary | ✅ | `firestore.rules:572-574` | E,I,S |
| Over-permissive `auth!=null` read+write (leave/expense/tasks/tickets) | 🔴 | `firestore.rules:309-319,439-440` | E,I,P |
| `audit_log` client-writable | 🔴 | `firestore.rules:452-453` | E,I |
| `employees` PII readable by any authed user | 🔴 | `firestore.rules:244` | P,E |
| `compliance` collection any-auth write | 🔴 | `firestore.rules:562` | E,I |
| MFA | 🔴 | none platform-wide | S,E,I |
| Email/password auth | ✅ | `auth.js:14-17` | E |
| Session idle/absolute timeout | 🔴 | none (Firebase ~1h token) | S,E |
| Server password policy ENFORCE | 🟡 | `set-password-policy.js` code-complete, **not proven activated** | E |
| Force-change-on-first-login | ✅ | `AuthGate.jsx:140-190` (fails open on error) | E |
| Account lockout policy | 🔴 | Firebase throttling only | E,S |
| Segregation of duties (payroll/role/timesheet) | ✅ | `recordApproval.js`, `adminAuth.js` | S,I |
| IAM invoker `allUsers` (by design) + conflicting `fix_iam.ps1` | 🟡 | `index.js:51`, `fix_iam.ps1:16-17` | E |
| Workspace directory de-provisioning | 🔴 | no Directory API; offboarding queries non-canonical `engineers` | E,I |

### 4.3 Audit logging, immutability, monitoring
| Control | St | Evidence | Frameworks |
|---|---|---|---|
| Immutable approval evidence | ✅ | `firestore.rules` (`update,delete:if false`), `recordApproval.js` | S,E,I,P |
| Hashed AI audit | ✅ | `lib/ai-client.js:167-206` | E,I |
| **WORM buckets = name-only (no retention lock in code; CEO can delete)** | 🔴/🔎 | `storage.rules:49-53`; no `lockRetentionPolicy` anywhere | S,E,I |
| `outbound_comms_log` declared, **no writer** | 🔴 | `firestore.rules:491-494`, no `lib/comms-gateway.js` | E |
| Log retention periods defined | 🔴 | none (BigQuery/Firestore) | E,I,S |
| Security monitoring/alerting | 🔴 | violations written silently, nobody paged | S,E |
| Login/auth-event & data-access logging | 🔴 | not logged | E,I |
| Audit writes fail-closed | 🔴 | failures swallowed, action proceeds | E,I |
| BigQuery append-only enforced | 🟡 | convention only (no table/IAM config) | E,I |
| Scheduled integrity/compliance crons | ✅ | `auditor.js`, `index.js` schedulers | S |

### 4.4 Data protection / PDPL / NDMO
| Control | St | Evidence | Frameworks |
|---|---|---|---|
| Candidate consent capture + enforcement | ✅ | `index.js:190-196`, `sendInterviewInvite.js:53-54` | P |
| Employee acknowledgment register (versioned) | ✅ | `src/lib/policies.js` | P,E |
| Automated erasure (candidates, deal contacts) | ✅ | `functions/hr.js:44-240,161-204` | P |
| DSAR / data export / portability | 🔴 | none | P |
| Right to object / withdraw consent | 🔴 | none | P |
| Org-wide retention schedule | 🔴 | only candidates/deal-contacts | P,N |
| Controller declared | ✅ | `company-legal.js:42-43` | P |
| Controller/processor role modeling (TaaS) | 🔴 | not modeled | P,S |
| **DPA with client** | 🔴 | none | P,S |
| **Sub-processor register (Zoho, Google)** | 🔴 | none | P,S,E |
| NDMO data classification taxonomy | 🔴 | RBAC field-perms ≠ sensitivity labels | N |
| NDMO data quality / catalog / lineage / stewardship | 🔴 | absent | N |

### 4.5 GRC, outsourcing, BCP, vendor, incident
| Control | St | Evidence | Frameworks |
|---|---|---|---|
| SAMA outsourcing materiality + NOC gate | ✅ | `SamaMaterialityAssessment.jsx` | S |
| GRC document library (WORM, classified, versioned) | ✅ | `functions/grcLibrary.js` | S,E,I |
| Compliance calendar + CAPA tracking | 🟡 | `complianceCalendar.js`, `auditor.js:551` (calendar item titles outrun real controls) | S,E |
| Audit evidence export (real data) | ✅ | `src/pages/ceo/AuditExport.jsx` | S,E,I |
| **`Compliance.jsx` hardcoded/fabricated audit-log table** | 🔴 | `src/pages/ceo/Compliance.jsx:182-198` | (No-Fabricated-Data violation) |
| BCP / DR (RTO/RPO, restore test) | 🔴 | calendar item exists, **no BCP** | S,E |
| Scheduled backups | 🟡 | one manual Firestore backup; no automated/tested | S,E,I |
| Vendor / sub-processor risk register | 🔴 | none (calendar placeholder only) | S,E,P |
| Incident management (register/SLA) | 🟡 | runbook in `SECURITY.md` only | S,E,I |
| Vulnerability mgmt (dependabot) | ✅ | `.github/dependabot.yml` | E,I |
| Change management (gated CI + rollback) | ✅/🟡 | `deploy.yml` (auto-promote partly aspirational) | E,I |
| ISO/NCA/SAMA consolidated control mapping | 🔴 | none in repo (scattered refs) | I,E,S |

---

## 5. Gap register (prioritized)

**P1 — must fix before any external audit**
1. **WORM is name-only** — apply + **lock** a GCS retention policy on `datalake-worm-*`, remove the CEO-delete rule (`storage.rules:52`), or stop calling them WORM. (🔎 verify live with `gcloud storage buckets describe`.) [code + infra]
2. **Fabricated audit-log table** in `Compliance.jsx:182-198` — remove/replace with real `compliance` data (violates the CEO's own No-Fabricated-Data rule; fatal in an audit). [code]
3. **`compliance` & over-permissive collections writable by any authed user** (`firestore.rules:452-453, 562, 309-319`) — restrict to owner/role; `audit_log` must be append-only/server-only. [code]
4. **DPA + sub-processor register** — model the controller↔processor terms with Emkan and an onward-processor inventory (Zoho, Google Cloud, Workspace, M365). [org/legal + code]
5. **MFA** — implement/enforce, at least for privileged + remote access (SAMA/NCA hard requirement). [code/IdP]
6. **BCP/DR** — author a real plan with RTO/RPO + scheduled backups + a restore test (SAMA BCM). [org + infra]

**P2 — required for full coverage**
7. Server-side password policy: **prove activated** (run `set-password-policy.js`, capture evidence) + add **account lockout**. [ops/code]
8. **Log retention periods** + fail-closed audit + BigQuery append-only enforced by config/IAM. [code/infra]
9. **Security alerting** on `compliance_violations`, failed crons, audit-insert failures (notification channels). [infra]
10. **`employees` PII read scoping** — restrict from "any authed user" to HR/CEO/owner. [code]
11. **Workspace directory de-provisioning** + fix offboarding to query canonical `employees/employment_status=='ACTIVE'`. [code]
12. **Vendor/sub-processor risk register** feature (the calendar already promises it). [code]
13. **Session timeout** (idle/absolute). [code]

**P3 — framework completeness**
14. **NDMO**: data-classification taxonomy (Public/Internal/Confidential/Restricted on assets), data-quality, catalog/lineage, steward roles. [org + code]
15. **Consolidated control mapping**: ISO 27001 SoA + NCA ECC matrix + SAMA CSF mapping + PDPL register (none exist). [org/doc]
16. **TaaS consent + compliance** for the 4 managed-team staff (see `team-as-a-service` memory) — PDPL data-sharing consent + onboarding acks + Emkan vendor checklist. [process + code]
17. GPU-VM hop TLS; M365/Graph residency gate; CMEK if mandated. [infra]

---

## 6. "Compliance-as-code" enforcement points (where to encode controls)
- `firestore.rules` / `storage.rules` — the real authz + immutability boundary (tighten the over-permissive matches; lock evidence/log/compliance writes).
- `recordApproval.js` + approval-evidence pattern — the immutable evidence engine (extend to vendor/DPA records).
- `functions/lib/ai-client.js` — residency + hashed audit (keep self-hosted-only).
- `complianceCalendar.js` / `auditor.js` — automated GRC cadence + integrity scans (back the calendar items with real controls + alerting).
- CI (`deploy.yml`) — add a **region-pin guard** and a **rules-lint** so residency/immutability can't silently regress.

---

## 7. Documentation corrections (SECURITY.md — goes to bank teams)
1. **Payroll SoD understated** — `SECURITY.md` §2/§8 says CEO-only DRAFT→APPROVED; code is a **multi-stage chain** with distinct Finance + CEO signers (`recordApproval.js:81-118`). Correct it (the real control is *stronger*). *(Note: code enforces Finance→CEO as the two server-validated signature stages, with HR as preparer — reconcile the "3-stage HR→Finance→CEO" wording across CLAUDE.md/SECURITY.md to match what is actually signature-gated.)*
2. **Retired model named** — `SECURITY.md:137` (and stale comments in `complianceCalendar.js:6,87`) say "Qwen 2.5"; the live model is **Gemma 3** (Qwen retired). Fix to avoid auditor confusion.
3. **Force-password-change-on-first-login** — `CLAUDE.md` says "only displayed"; it is actually **built and gating** (`AuthGate.jsx:140-190`). Update.

---

## 8. Path to "100% / audit-ready"
"100%" is reached by closing the gap register, and splits into:
- **Code (I can do):** items 2, 3, 8, 9, 10, 11, 13, 14(partial), and the SECURITY.md corrections, region-pin CI guard.
- **Infra/runtime (you/ops, I can script + verify):** 1 (WORM lock), 7 (activate password policy), 9 (alerting), 17.
- **Organizational/legal (outside the platform):** 4 (DPA + sub-processor register — legal artifacts), 6 (BCP/DR plan + restore test), 15 (control-mapping pack + ISO/NCA/SAMA attestations), 16 (TaaS consent/compliance process).

**Recommended first sprint (highest risk, mostly code):** (1) lock WORM + remove CEO-delete, (2) delete the fabricated audit-log table, (3) tighten `firestore.rules` over-permissive/`audit_log`/`compliance` writes, (4) prove/activate the password policy, (5) add the region-pin + rules-lint CI guards. These are fast, high-impact, and remove the items most likely to fail an audit on sight.
