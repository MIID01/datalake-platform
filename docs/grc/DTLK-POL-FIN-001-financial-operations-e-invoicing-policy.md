<!-- ════════════════════════════════════════════════════════════════════ -->
<!--  DRAFT — NOT FOR IMPLEMENTATION  ·  ROUTE TO CEO FOR APPROVAL          -->
<!--  Structured per DTLK-INS-GRC-001 §4.1 (Policy) · header per §3.2       -->
<!-- ════════════════════════════════════════════════════════════════════ -->

> # ⚠ DRAFT — NOT FOR IMPLEMENTATION
> Working draft authored under **DTLK-INS-GRC-001**. **Not approved, not in force.**
> Must not be implemented or relied upon until the Approver of Record (CEO, home
> Entity) signs it off. Read every page as watermarked **DRAFT**.

# DTLK-POL-FIN-001 — Financial Operations & E-Invoicing Policy

## Document Control (per DTLK-INS-GRC-001 §3.2)

| Field | Value |
|---|---|
| **Document ID** | DTLK-POL-FIN-001 |
| **Version** | 0.1 (DRAFT) |
| **Classification** | Internal — Confidential (auditor-facing) |
| **Owner** | GRC function |
| **Approver** | CEO (home-Entity Approver of Record); customer Approver of Record for SOLD instances |
| **Effective Date** | Not in force — effective upon CEO approval |
| **Next Review** | Annual from Effective Date, or on material change to ZATCA / SAMA / NCA / PDPL obligations |
| **Supersedes** | The "Zoho Books as system of record / orchestration layer" model in **DTLK-ADR-002** (superseded by CEO decision) |
| **Related Documents** | DTLK-SPEC-FIN-001 v0.2 (design baseline); DTLK-PROC-FIN-001 (implementing procedure); DTLK-INS-GRC-001 (authoring instruction) |
| **Regulatory Basis** | ZATCA E-Invoicing Regulation + Phase 2 technical standards; KSA VAT (15%); SAMA Cyber Security Framework; NCA ECC-1:2018; PDPL + Implementing Regulations; ISO/IEC 27001:2022 (A.5/A.8); SOCPA-endorsed IFRS |

---

## Preamble

Datalake's financial operations are moving to an **in-house double-entry ledger as the
authoritative system of record** and to **Datalake's own E-Invoice Generation Solution
(EGS)** for ZATCA Phase 2 e-invoicing, replacing the superseded model in DTLK-ADR-002 in
which Zoho Books was the system of record / orchestration layer. This Policy sets the
mandatory principles, requirements and controls that ensure financial records are
complete, accurate, immutable and auditable; that e-invoicing meets Saudi regulatory
obligations; and that **no single actor can both create and authorise a transaction**.
It is issued under DTLK-INS-GRC-001 and aligned to the CEO-confirmed design baseline
**DTLK-SPEC-FIN-001 v0.2**.

---

## Part One — Preliminary Provisions

### Article 1 — Definitions

| Term | Meaning |
|---|---|
| **Entity** | A configured legal issuer with its own identity (name, CR, VAT/TRN, address) and Approver of Record. The **home Entity** is Datalake Saudi Arabia LLC (Approver of Record = CEO). |
| **System of Record (SoR)** | The authoritative ledger: Firestore (operational, `me-central2`) with append-only/WORM evidence in BigQuery. |
| **EGS** | E-Invoice Generation Solution — Datalake's own ZATCA Phase 2 e-invoicing engine. |
| **CSID** | Cryptographic Stamp Identifier — per-Entity cryptographic identity from ZATCA onboarding. |
| **Clearance** | ZATCA real-time validation/stamping of a Standard (B2B) invoice **before** delivery to the buyer. |
| **Reporting** | ZATCA submission of a Simplified (B2C) invoice **within 24 hours** of issuance. |
| **ICV** | Invoice Counter Value — a per-Entity monotonic counter. |
| **PIH** | Previous Invoice Hash — the chained hash linking each invoice to its predecessor (tamper-evident). |
| **Controller agent** | The automated **Preparer**; drafts only. Holds **no** clearance, approval or signing authority and **no** key access. |
| **Approver of Record** | The human authorised to approve a transaction for an Entity (home = CEO; SOLD = customer's approver). |
| **Record Keeper** | BigQuery WORM evidence store + retention-locked GCS archive. |
| **Reversing entry** | A new equal-and-opposite posted entry used to correct a prior posted entry (posted entries are never edited or deleted). |

### Article 2 — Objectives

(a) Maintain a complete, accurate, **immutable** financial system of record.
(b) Issue ZATCA Phase 2 compliant e-invoices via the in-house EGS.
(c) Enforce **Segregation of Duties** on every transaction.
(d) Preserve data residency, retention and privacy obligations in `me-central2`.
(e) Achieve and evidence regulatory compliance **without overstating** the current state.

### Article 3 — Scope

3.1 This Policy applies **per Entity** to all financial transactions in the ledger and all
e-invoices issued through the EGS, across every instance — **including SOLD instances**,
where the Approver of Record is the **customer's** approver, not Datalake's CEO.

3.2 It binds all human and automated actors (including the Controller agent) that prepare,
approve, sign, clear, report, archive or keep records of financial transactions.

3.3 Entity-identity attributes are **configurable per Entity** and sourced from the
canonical company-legal source of truth; they are not hardcoded in this Policy.

---

## Part Two — Principles

1. **Authoritative, immutable ledger.** The in-platform double-entry ledger is the SoR; posted entries are immutable; corrections are reversing entries only.
2. **Segregation of Duties.** Preparer, Approver and Record Keeper are mutually exclusive on any one transaction; the signing identity is isolated.
3. **Cryptographic integrity.** Per-Entity CSID; SHA-256 hashing; ECDSA stamping; ICV + PIH chain; keys held only in HSM / Secret Manager.
4. **ZATCA Phase 2 conformance.** Standard/B2B cleared before sending; Simplified/B2C reported within 24h; UBL 2.1; TLV QR; PDF/A-3.
5. **Residency & retention.** All data, keys and artefacts in `me-central2`; e-invoice artefacts retained 10 years under a locked GCS policy.
6. **Privacy by design.** PDPL lawful basis, purpose limitation, tenant isolation, and purge of personal data on retention expiry.
7. **Compliance-as-code.** Controls are enforced automatically (CP-FIN-01…06) and produce immutable evidence.
8. **Honesty / no overstatement.** The EGS is not represented as accredited and no wave obligation is claimed met unless verified.
9. **Per-Entity applicability.** The Policy applies per Entity, including SOLD instances.
10. **Interim safety.** Until the EGS completion gate is passed, Zoho remains the live legal issuer.

---

## Part Three — Roles & Responsibilities (RACI)

> R = Responsible · A = Accountable · C = Consulted · I = Informed

| Activity | CEO / Approver of Record | Controller agent (Preparer) | Finance Ops | GRC | Platform/Security Eng | Record Keeper (system) |
|---|---|---|---|---|---|---|
| Draft invoice & ledger entries | I | **R** | C | I | I | — |
| Post double-entry (immutable) | I | **R** | C | I | C | **A** (evidence) |
| Approve before clearance/reporting | **A/R** | — | I | C | I | I |
| Cryptographic stamp / signing | I | — | I | I | **R** (service) | I |
| Clearance / Reporting to ZATCA | A | — | **R** | C | C | I |
| Archive & retain (10-yr, locked) | I | — | C | C | **R** | **A** |
| Parallel-run reconciliation (§interim) | A | — | **R** | C | C | I |
| Maintain compliance-as-code controls | I | — | I | **A** | **R** | I |
| Approve Policy / authorise cutover | **A/R** | — | I | C | I | I |

For SOLD instances, the **customer's Approver of Record** holds the A/R approval and cutover
authority for that Entity.

---

## Part Four — Requirements & Controls

### R-1 System of Record (ledger)
The in-platform **double-entry ledger is authoritative**, replacing Zoho Books in that role.
Posted entries are **immutable**; corrections are **reversing entries only**. Operational
state in Firestore (`me-central2`); append-only evidence in **BigQuery WORM**. Basis:
SOCPA-endorsed IFRS.

### R-2 E-Invoicing (EGS, ZATCA Phase 2)
E-invoices are generated by the in-house EGS using a **per-Entity CSID**. **Standard/B2B
require CLEARANCE before sending; Simplified/B2C are REPORTED within 24h.** Each invoice is
**UBL 2.1 XML** with **SHA-256 hash**, **ECDSA stamp**, **TLV QR**, **per-Entity ICV** and
**PIH chain**; rendered and archived as **PDF/A-3**. VAT at **15%**, per line item, rounded
to two decimals.

### R-3 Segregation of Duties (per Entity)
Preparer (Controller agent), Approver (Approver of Record), and Record Keeper (BigQuery WORM
+ locked archive) are **mutually exclusive on any single transaction**. The **signing
identity is isolated** in HSM / Secret Manager and is not exportable by any actor. **No actor
holds two roles on one transaction.**

### R-4 Cryptographic identity & key management
Each Entity holds its **own CSID**. Keys/CSID material reside only in HSM / Secret Manager
(`me-central2`). **CSID validity is monitored and renewed on schedule** so no invoice is
stamped under an expired/invalid certificate.

### R-5 Residency, retention & privacy
All financial data, artefacts, keys and evidence are stored/processed in **`me-central2`**.
E-invoice artefacts are retained **10 years** in a **retention-locked GCS** archive. Where
records contain **personal data**, PDPL applies: lawful basis, purpose limitation, tenant
isolation, and **purge on retention expiry** for personal data not under fiscal retention.

### R-6 Entity model & multi-tenancy
The Policy applies **per Entity**; entity identity is **configurable**. For **SOLD
instances**, the Approver of Record is the **customer's** approver. Tenant data is isolated.

### R-7 Accounting standard
Ledger and revenue recognition follow **SOCPA-endorsed IFRS** (incl. IFRS 15).

### R-8 Interim control — parallel run / cutover
**Until the EGS passes its formal completion gate, Zoho remains the live legal issuer.** The
EGS runs in parallel (generation + internal validation) and is **non-authoritative** until
the gate is passed and DTLK-POL-FIN-001 / DTLK-PROC-FIN-001 are CEO-approved. The cutover
state is governed by DTLK-PROC-FIN-001.

### Controls (compliance-as-code) — operationalised in DTLK-PROC-FIN-001 §Control Points

| Control | Requirement enforced |
|---|---|
| **CP-FIN-01** Approval-gate webhook | Fires **before** any clearance/reporting submission; blocks unapproved invoices. |
| **CP-FIN-02** PIH chain | Append-only and tamper-evident; a broken chain halts issuance. |
| **CP-FIN-03** CSID validity/renewal scheduler | Prevents stamping under an expired/invalid CSID. |
| **CP-FIN-04** PDPL purge | Purges personal data on retention expiry where applicable. |
| **CP-FIN-05** GCS retention lock | Enforces 10-year immutable retention in `me-central2`. |
| **CP-FIN-06** SAMA-rate FX for VAT | Foreign-currency VAT computed at the SAMA reference rate. |

---

## Part Five — Monitoring, Measurement & Reporting

5.1 The compliance-as-code controls (CP-FIN-01…06) are continuously enforced and emit
**immutable evidence to BigQuery WORM**. Control health (approval gate, PIH integrity, CSID
scheduler, retention lock, FX source) is monitored; failures raise alerts and halt the
affected step.

5.2 During the interim/parallel-run state, Finance performs **EGS-vs-Zoho reconciliation**
per billing event; discrepancies are logged and resolved before close.

5.3 GRC reports control status and exceptions to the **CEO** on the review cadence and on any
material breach. Key measures: % invoices passing CP-FIN-01 before submission, PIH-integrity
incidents, CSID-expiry near-misses, reconciliation discrepancies, retention-lock coverage.

---

## Part Six — Training & Awareness

6.1 Approvers of Record, Finance Ops and engineering are trained on SoD, the approval gate,
the parallel-run/cutover rules, and the **honesty / no-overstatement** requirement (no claim
of ZATCA accreditation or met wave obligation unless verified).

6.2 Awareness is refreshed on each material amendment and at onboarding of any new Entity
(including SOLD instances and their customer Approvers of Record).

---

## Part Seven — Breach of Policy

7.1 Breaches include: editing or deleting a posted entry; one actor holding two roles on a
single transaction; issuing without recorded approval or (for B2B) without clearance;
stamping under an expired CSID; or **overstating** compliance/accreditation.

7.2 Such actions are blocked by the controls above and logged to immutable audit. Material
breaches are escalated to the CEO (or customer Approver of Record for SOLD instances) and
remediated under GRC oversight.

---

## Part Eight — Review & Amendment

8.1 Reviewed **annually** and on material regulatory change. Minor amendments take a minor
version bump; substantive changes require CEO re-approval.

8.2 A consequential reconciliation of **DTLK-INS-GRC-001 §7.2** (ZATCA control line → in-house
EGS flow) is raised separately as a minor-version amendment to that instruction.

---

## Part Nine — Enforcement, Publication, Entry into Force

9.1 **Enforcement** is primarily by compliance-as-code (CP-FIN-01…06) with GRC oversight.

9.2 **Publication** is to the Datalake GRC library upon approval.

9.3 **Entry into force** is upon **CEO approval** (home Entity) / customer Approver of Record
(SOLD instances). **This version is DRAFT and NOT in force.**

---

## Annexes

### Annex A — Regulatory & Standards Mapping

| Requirement | Basis |
|---|---|
| Phase 2 clearance/reporting; UBL 2.1; CSID; SHA-256; ECDSA stamp; TLV QR; ICV/PIH | **ZATCA E-Invoicing Regulation** (4 Dec 2020) + Implementation Resolution; **Phase 2 standards** — XML Implementation Standard (UBL 2.1), Security Features Implementation Standard (cryptographic stamp, CSID, hash, QR), Data Dictionary |
| 15% VAT per line | **KSA VAT Law & Implementing Regulations**; standard rate 15% (eff. 1 Jul 2020) |
| SoD; audit rights; residency | **SAMA Cyber Security Framework** — Identity & Access Management (SoD), Audit, residency |
| Least privilege; cryptography; immutable logging; data protection | **NCA ECC-1:2018** — 2-2 IAM; 2-8 Cryptography; 2-12 Event Logs & Monitoring; 2-7 Data & Information Protection |
| Residency; retention/purge; tenant isolation | **PDPL** (Royal Decree M/19) + Implementing Regulations — Art. 18 (destruction/retention), Art. 29 (cross-border/residency), purpose limitation |
| Records protection; SoD; cryptography; deletion; logging | **ISO/IEC 27001:2022 Annex A** — A.5.3, A.5.33, A.8.24, A.8.10, A.8.15 |
| Double-entry ledger; revenue recognition | **SOCPA-endorsed IFRS** (incl. IFRS 15) |

### Annex B — Accuracy & Limitations (mandatory honesty statement)

B.1 **Datalake's EGS is NOT stated to be ZATCA-approved/accredited** — **unverified**.
B.2 **No ZATCA wave/enrolment obligation is asserted as already met.** This Policy governs
**how** compliance is achieved, not a claim that it already exists.
B.3 While the interim control (R-8) is in force, **Zoho is the live legal issuer** and the
EGS is non-authoritative.

### Annex C — Entity Identity

Entity identity is configurable per Entity and sourced from the canonical company-legal
source of truth. The home Entity's published identity is recorded in the document footer.

---

*Datalake Saudi Arabia LLC · Rajiyah Street, Al Yarmuk District, Riyadh 13243, Kingdom of Saudi Arabia · CR 1009194773 · Unified Number 7048904952*

> **DRAFT — NOT FOR IMPLEMENTATION.** Route to **CEO (home Entity Approver of Record)** for approval.
