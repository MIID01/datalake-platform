<!-- DRAFT — proposed minor-version amendment. Route to CEO / GRC owner for approval. -->

> # ⚠ DRAFT — Proposed Minor-Version Amendment (NOT YET APPLIED)

# DTLK-INS-GRC-001 — §7.2 Reconciliation (proposed amendment)

## Change record

| Field | Value |
|---|---|
| **Instruction** | DTLK-INS-GRC-001 (GRC authoring instruction) |
| **Proposed version** | minor-version bump (e.g. v1.0 → **v1.1**) — confirm current version against the live GRC copy |
| **Section affected** | **§7.2** (Compliance-as-Code enforcement register) |
| **Reason** | The §7.2 ZATCA/SoD lines still describe the **superseded Zoho-orchestration** model. The CEO-confirmed design (**DTLK-SPEC-FIN-001 v0.2**) makes Datalake's **in-house EGS** the e-invoicing engine and the in-platform ledger the system of record. §7.2 must agree with the build and with DTLK-POL-FIN-001 / DTLK-PROC-FIN-001. |
| **Status** | **Proposed — not yet applied.** Route to the instruction owner (GRC) / CEO. |

## §7.2 format (unchanged — restated for compliance)

Each control is written as **`[regulatory requirement] → [named system enforcement point]`**.
**Rule:** every control names its enforcement point. **If there is no enforcement point, the
control is not real — flag it to the CEO as a design gap.** Do not write a control as policy
prose when an enforcement point exists.

## Redline

**Remove (superseded single line):**
> `ZATCA 15% VAT → Controller AI line-item calculation in invoice generation function`
> *(and the prior SoD line predicated on Zoho)*

**Insert (in-house-EGS entries):**

| # | `[regulatory requirement]` → `[named system enforcement point]` | CP |
|---|---|---|
| 1 | **SAMA segregation of duties** → DRAFT assembled by **Controller agent (Preparer)**; **CEO approval gate (Approver)** fires **before any ZATCA submission**; **immutable BigQuery record (Record Keeper)** | CP-FIN-01 |
| 2 | **ZATCA 15% VAT calculation** → **VAT engine line-item computation at draft assembly**; **SAMA-rate FX applied** | **CP-FIN-06** |
| 3 | **ZATCA Phase 2 clearance (standard/B2B)** → **EGS clearance API call, gated behind the CEO approval webhook** (fires before the invoice reaches the buyer) | CP-FIN-01 |
| 4 | **ZATCA Phase 2 reporting (simplified/B2C)** → **EGS reporting API call within 24h of issuance** | — |
| 5 | **ZATCA cryptographic stamp + hash chain** → **EGS signing service using the per-entity PCSID (HSM/Secret Manager)**; **per-entity ICV counter + PIH chain, append-only** | CP-FIN-02 / CP-FIN-03 |
| 6 | **E-invoice WORM archival** → **GCS `retention_policy.is_locked:true`, 10-year, per `entity_id`** | **CP-FIN-05** |

> Entry #4 (B2C reporting) currently has no dedicated CP-FIN ID. Its enforcement point (EGS
> reporting API within 24h) **does** exist, so it is a real control; if GRC wants a numbered
> gate for reporting timeliness, add **CP-FIN-07** at adoption. **CP-FIN-04 (PDPL purge)**
> remains where personal data applies. No control above is prose-only — each names its
> enforcement point.

## Interim reality (do NOT delete)

This §7.2 mapping describes the **target** state (in-house EGS as legal issuer).
**DTLK-PROC-FIN-001 Step 8 still documents the interim state in which Zoho is the live legal
issuer until the EGS passes its completion gate.** §7.2 governs the target control flow; it is
**not** a claim that the EGS is already live or accredited.

## Accuracy guard

This amendment changes only the **description of the intended control flow**. It does **not**
assert the EGS is ZATCA-approved/accredited or that any wave obligation is met (both
**unverified**).

---

*Datalake Saudi Arabia LLC · Rajiyah Street, Al Yarmuk District, Riyadh 13243, Kingdom of Saudi Arabia · CR 1009194773 · Unified Number 7048904952*
