# DTLK-ADR-002: Phase 3 - Zoho Books & ZATCA Phase 2 Integration

## 1. Context
The Datalake platform requires a fully automated invoicing pipeline that bridges approved timesheets with our accounting ledger (Zoho Books) and complies with the Saudi Zakat, Tax and Customs Authority (ZATCA) Phase 2 e-invoicing requirements (Integration Phase).

## 2. Decision

We will implement a 3-way reconciliation pipeline (Timesheet -> Zoho Invoice -> ZATCA XML):

### A. OAuth Token Storage
- **Decision:** Zoho OAuth Refresh Tokens and Client Secrets will be stored in **Google Cloud Secret Manager**, not Firestore.
- **Reason:** SAMA CSF and general best practices strictly prohibit storing long-lived API secrets in standard databases, even with rules applied.

### B. ZATCA Phase 2 Compliance (FATOORA)
- **Decision:** Generate UBL 2.1 XML, calculate the required SHA-256 hashes, sign the XML using an X.509 certificate, and generate the required TLV (Tag-Length-Value) Base64 QR code.
- **Reason:** Phase 2 (Integration Phase) mandates that B2B invoices (Standard Invoices) must be cleared by ZATCA's FATOORA platform and must contain a Cryptographic Stamp and a Phase 2 compliant QR code. 

### C. 15% VAT Line-Item Logic
- **Decision:** VAT (15%) is applied per line item and rolled up to the document total. Amounts are rounded to 2 decimal places to prevent reconciliation drift between the Datalake database, Zoho Books, and ZATCA.

### D. Idempotent Payment Webhooks
- **Decision:** A Cloud Function (`zohoPaymentWebhook`) will expose an endpoint to receive `invoice.payment` events from Zoho Books. It will use Firestore transactions and a `processed_events` collection to guarantee idempotency.
- **Reason:** Network retries from Zoho could result in double-processing. Idempotency ensures the `PAID` status is only applied once.

## 3. Consequences
- **Positive:** Full compliance with Saudi e-invoicing laws; hands-free accounting pipeline.
- **Negative:** Increased complexity in XML generation and cryptography within the Node.js Cloud Functions.
- **Dependencies:** Requires provisioning a Secret in GCP for Zoho credentials. Requires a valid Cryptographic Stamp Identifier (CSID) from ZATCA for production signing.
