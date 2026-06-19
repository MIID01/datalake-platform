<!-- ════════════════════════════════════════════════════════════════════ -->
<!--  DRAFT — NOT FOR IMPLEMENTATION  ·  ROUTE TO CEO FOR APPROVAL          -->
<!--  Structured per DTLK-INS-GRC-001 §4.2 (Procedure) · header per §3.2    -->
<!-- ════════════════════════════════════════════════════════════════════ -->

> # ⚠ DRAFT — NOT FOR IMPLEMENTATION
> Working draft under **DTLK-INS-GRC-001**. **Not approved, not in force.** Read every
> page as watermarked **DRAFT**. Route to the CEO (home-Entity Approver of Record).

# DTLK-PROC-FIN-001 — Invoicing & ZATCA E-Invoicing Procedure

## Document Control (per DTLK-INS-GRC-001 §3.2)

| Field | Value |
|---|---|
| **Document ID** | DTLK-PROC-FIN-001 |
| **Version** | 0.1 (DRAFT) |
| **Classification** | Internal — Confidential (auditor-facing) |
| **Owner** | GRC function |
| **Approver** | CEO (home-Entity Approver of Record); customer Approver of Record for SOLD instances |
| **Effective Date** | Not in force — effective upon CEO approval |
| **Next Review** | Annual from Effective Date, or on material ZATCA / SAMA / NCA / PDPL change |
| **Supersedes** | The Zoho-orchestration invoicing flow in **DTLK-ADR-002** as the *target* process (Zoho retained only as interim legal issuer — see Step 8) |
| **Related Documents** | DTLK-POL-FIN-001 (parent policy); DTLK-SPEC-FIN-001 v0.2 (design baseline); DTLK-INS-GRC-001 (§4.2, §7.2) |
| **Regulatory Basis** | ZATCA E-Invoicing Regulation + Phase 2 technical standards; KSA VAT (15%); SAMA Cyber Security Framework; NCA ECC-1:2018 (2-2, 2-7, 2-8, 2-12); PDPL (Art. 18, 29); ISO/IEC 27001:2022 (A.5.3, A.5.33, A.8.10, A.8.15, A.8.24); SOCPA-endorsed IFRS (incl. IFRS 15) |

---

## 1. Purpose

To define the controlled, end-to-end process for generating, approving, clearing/reporting,
archiving and record-keeping of e-invoices using **Datalake's own EGS** against the
**in-platform double-entry ledger** as system of record, with **Segregation of Duties** on
every transaction and every regulatory control enforced as code (CP-FIN-01…06).

## 2. Scope

2.1 Applies **per Entity** to every e-invoice (Standard/B2B and Simplified/B2C) and the
supporting ledger postings, across all instances including **SOLD** instances (where the
Approver of Record is the customer's approver).

2.2 **Operating modes.** This procedure runs in two modes:
- **Interim (current):** **Zoho is the live legal issuer**; the EGS runs in parallel for
  assurance only (Step 8).
- **Target:** the EGS is the legal issuer (Steps 1–7), effective only after the EGS
  completion gate is passed and DTLK-POL-FIN-001 / this Procedure are CEO-approved.

2.3 **Accuracy note (mandatory):** the EGS is **not** represented as ZATCA-approved/accredited
and **no** wave obligation is asserted as met — both **unverified**. This procedure governs
**how** compliance is achieved, not a claim that it already exists.

## 3. Definitions (procedure-specific)

| Term | Meaning |
|---|---|
| **Draft assembly** | The Controller agent's construction of invoice + ledger lines from authoritative source data (Preparer step; no approve/clear/sign). |
| **Approval gate** | The CP-FIN-01 webhook that must record an Approver-of-Record approval **before** any ZATCA submission. |
| **PCSID** | Production CSID — the per-Entity production cryptographic stamp identity held in HSM / Secret Manager. |
| **Clearance / Reporting** | ZATCA pre-send validation (B2B) / within-24h submission (B2C). |
| **Completion gate** | The formal acceptance test the EGS must pass before it may become the legal issuer (Step 8 cutover criteria). |

(General terms — Entity, SoR, EGS, CSID, ICV, PIH, Controller agent, Approver of Record,
Record Keeper, reversing entry — are defined in DTLK-POL-FIN-001 Art. 1.)

## 4. Roles & Responsibilities (RACI)

> R = Responsible · A = Accountable · C = Consulted · I = Informed

| Step / activity | Approver of Record (CEO / customer) | Controller agent (Preparer) | Finance Ops | Platform/Security Eng | Record Keeper (system) |
|---|---|---|---|---|---|
| Draft assembly + VAT/FX | I | **R** | C | I | — |
| Ledger posting (immutable) | I | **R** | C | C | **A** |
| Approval gate (CP-FIN-01) | **A/R** | — | I | I | I |
| EGS stamp / signing (PCSID) | I | — | I | **R** (service) | I |
| Clearance / Reporting | A | — | **R** | C | I |
| Archive & retain (CP-FIN-05) | I | — | C | **R** | **A** |
| Record keeping (WORM) | I | — | I | C | **R** |
| Parallel-run reconciliation (Step 8) | A | — | **R** | C | I |

## 5. Procedure Steps

> Each step states **Inputs · Actions · Outputs · System of Record · Control Gates**.

### Step 1 — Billing trigger & draft assembly (Preparer)
- **Inputs:** authoritative billing/ledger source data for the Entity; Entity identity + tax config.
- **Actions:** Controller agent assembles invoice line items; **VAT engine computes 15% per line**; for foreign-currency lines, **SAMA-rate FX is applied**. No approval/clearance/signing.
- **Outputs:** draft invoice (unapproved); computed totals + VAT.
- **System of Record:** Firestore (draft), `me-central2`.
- **Control Gates:** **CP-FIN-06** (SAMA-rate FX for VAT) must be satisfied for FX lines.

### Step 2 — Ledger posting (double-entry, immutable)
- **Inputs:** approved-for-posting draft figures.
- **Actions:** post supporting double-entry lines; **posted entries are immutable**; corrections are **reversing entries only**.
- **Outputs:** posted ledger entries; append-only evidence.
- **System of Record:** Firestore (operational) + **BigQuery WORM** (evidence).
- **Control Gates:** immutability enforced (no edit/delete of posted entries).

### Step 3 — Approval gate (Approver of Record)
- **Inputs:** draft invoice; approver identity.
- **Actions:** Approver of Record (CEO home / customer SOLD) approves or rejects. **No invoice proceeds to ZATCA without a recorded approval.**
- **Outputs:** immutable approval-evidence record (identity, timestamp, decision).
- **System of Record:** BigQuery WORM + evidence subcollection.
- **Control Gates:** **CP-FIN-01** — approval-gate webhook must record approval **before** Step 5.

### Step 4 — EGS generation & cryptographic stamping
- **Inputs:** approved invoice; per-Entity PCSID; prior invoice hash; ICV state.
- **Actions:** EGS produces **UBL 2.1 XML**, computes **SHA-256 hash**, assigns next **per-Entity ICV**, links the **PIH chain**, and applies the **ECDSA stamp via the EGS signing service using the per-Entity PCSID** (key isolated in HSM / Secret Manager); generates **TLV Base64 QR**.
- **Outputs:** signed UBL XML; stamp; QR; ICV; PIH link.
- **System of Record:** Firestore + BigQuery WORM (artefact metadata).
- **Control Gates:** **CP-FIN-02** (PIH chain intact, append-only) and **CP-FIN-03** (CSID/PCSID valid) must hold or stamping is refused.

### Step 5 — Clearance (B2B) or Reporting (B2C)
- **Inputs:** signed invoice; invoice type.
- **Actions:** **Standard/B2B → EGS clearance API call; the cleared invoice only then reaches the buyer.** **Simplified/B2C → deliver to buyer, then EGS reporting API call within 24h.**
- **Outputs:** ZATCA clearance/reporting response; delivery record.
- **System of Record:** BigQuery WORM (ZATCA response).
- **Control Gates:** **CP-FIN-01** approval must precede submission; B2C reporting must occur within 24h.

### Step 6 — Render & archive
- **Inputs:** signed XML + ZATCA response.
- **Actions:** produce **PDF/A-3** (XML embedded); write XML, stamp, QR, PDF/A-3 to the **retention-locked GCS** archive; where the artefact contains **personal data**, apply PDPL purge to non-fiscal-retention personal data on expiry.
- **Outputs:** archived artefacts (10-year, `me-central2`).
- **System of Record:** locked GCS archive + BigQuery WORM pointer.
- **Control Gates:** **CP-FIN-05** (GCS retention lock) and **CP-FIN-04** (PDPL purge) enforced.

### Step 7 — Record keeping (Record Keeper)
- **Inputs:** all artefacts + responses.
- **Actions:** record full evidence (input hash, approval, ICV, PIH, clearance/reporting response, archive pointer) append-only.
- **Outputs:** regulator-facing evidence record.
- **System of Record:** **BigQuery WORM**.
- **Control Gates:** append-only; no mutation.

### Step 8 — Interim parallel-run & cutover (MANDATORY — current mode)
- **Inputs:** billing event; EGS artefacts (Steps 1–4, 6–7, assurance only); Zoho-issued invoice.
- **Actions:** **Zoho issues the legally effective e-invoice;** the EGS generates/validates/archives in parallel **for assurance only.** Finance **reconciles** EGS artefact vs Zoho invoice (totals, VAT, buyer, sequence); discrepancies logged and resolved before close. **Cutover** to EGS-as-legal-issuer occurs per Entity, CEO-authorised, only when ALL hold: (a) EGS completion gate passed; (b) per-Entity PCSID valid + ZATCA-onboarded; (c) clearance (B2B) and reporting (B2C) verified end-to-end; (d) CP-FIN-01…06 green; (e) DTLK-POL-FIN-001 + this Procedure CEO-approved. **Rollback** to Zoho on any post-cutover integrity defect.
- **Outputs:** reconciliation record; cutover/rollback decision log.
- **System of Record:** BigQuery WORM (reconciliation + decisions).
- **Control Gates:** approval gate (CP-FIN-01) and SoD apply in both paths; cutover is CEO-gated.

## 6. Control Points (Compliance-as-Code — what must be TRUE before the next step executes)

> Named per DTLK-INS-GRC-001 §7.2. Each is an enforcement gate, not prose.

| ID | Gate — must be true to proceed | Blocks | Enforcement point |
|---|---|---|---|
| **CP-FIN-01** | An Approver-of-Record approval exists for the invoice | Step 5 (clearance/reporting) | Approval-gate webhook fires **before** any ZATCA submission; submission rejected without it. |
| **CP-FIN-02** | PIH chain is intact and append-only | Step 4→5 | Each invoice references the prior hash; a broken/forked chain halts issuance + raises an integrity alert. |
| **CP-FIN-03** | PCSID/CSID is valid (not expired) | Step 4 (stamping) | Scheduled validity check; stamping blocked on expiry; renewal initiated ahead of expiry. |
| **CP-FIN-04** | Personal data past retention is purged | Step 6 (archive) | PDPL purge of non-fiscal-retention personal data on expiry; fiscal artefacts retained. |
| **CP-FIN-05** | Archive bucket retention is locked | Step 6 (archive) | GCS `retention_policy.is_locked:true`, 10-year, per `entity_id`. |
| **CP-FIN-06** | FX VAT uses the SAMA reference rate | Step 1 (draft) | VAT engine applies SAMA-rate FX; rate + timestamp recorded with the invoice. |

> SoD is itself an enforced gate: the Controller (Preparer) is denied approval, clearance and
> key access; the signing identity is isolated in HSM / Secret Manager. These denials are
> verified continuously.

## 7. Records

| Record | Where stored | Retention |
|---|---|---|
| Posted ledger entries + reversing entries | Firestore (operational) + **BigQuery WORM** (evidence) | 10 years |
| Approval evidence (CP-FIN-01) | BigQuery WORM + evidence subcollection | 10 years |
| UBL XML, SHA-256, ECDSA stamp, TLV QR, ICV, PIH | BigQuery WORM (metadata) + locked GCS (artefacts) | 10 years |
| PDF/A-3 rendering | **Retention-locked GCS** (`me-central2`, per `entity_id`) | 10 years (CP-FIN-05) |
| ZATCA clearance/reporting responses | BigQuery WORM | 10 years |
| Parallel-run reconciliation + cutover/rollback decisions | BigQuery WORM | 10 years |
| Personal data within artefacts | Subject to PDPL purge on expiry (CP-FIN-04) | Min(fiscal 10-yr where required; else PDPL retention limit) |

## 8. Exceptions & Escalation

| Event | Action / escalation |
|---|---|
| **Clearance rejected by ZATCA (B2B)** | Invoice not delivered; defect triaged; corrected via new invoice; reversing ledger entry if already posted. |
| **B2C reporting window at risk** | Escalate to Finance Ops; ensure report within 24h; record any breach for remediation. |
| **PCSID expired/invalid (CP-FIN-03)** | Stamping halted; renewal/onboarding; no back-dated issuance. |
| **Signing service unavailable** | Issuance paused (no unsigned issuance); incident raised to Platform/Security Eng. |
| **SAMA FX unavailable (CP-FIN-06)** | Issuance held for affected FX lines until a valid SAMA-reference rate is recorded. |
| **PIH integrity alert (CP-FIN-02)** | Issuance halted; chain investigated before resuming. |
| **Unapproved-issuance attempt (CP-FIN-01)** | Blocked + logged; escalate to CEO / customer Approver of Record. |
| **Post-cutover integrity defect** | Roll back to Zoho as legal issuer; log; report to CEO. |

## 9. Related Documents

DTLK-POL-FIN-001 (parent policy); DTLK-SPEC-FIN-001 v0.2; DTLK-INS-GRC-001 (§4.2, §7.2);
DTLK-ADR-002 (superseded target flow); ZATCA E-Invoicing Regulation + Phase 2 standards;
KSA VAT Law & Implementing Regulations; SAMA CSF; NCA ECC-1:2018; PDPL + Implementing
Regulations; ISO/IEC 27001:2022 Annex A; SOCPA-endorsed IFRS.

## 10. Revision History

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1 (DRAFT) | 2026-06-10 | GRC (under DTLK-INS-GRC-001) | Initial draft aligned to DTLK-SPEC-FIN-001 v0.2 (in-house EGS + ledger SoR). Re-sectioned to DTLK-INS-GRC-001 §4.2. **Not in force.** |

---

*Datalake Saudi Arabia LLC · Rajiyah Street, Al Yarmuk District, Riyadh 13243, Kingdom of Saudi Arabia · CR 1009194773 · Unified Number 7048904952*

> **DRAFT — NOT FOR IMPLEMENTATION.** Route to **CEO (home Entity Approver of Record)** for approval.
