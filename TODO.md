# TODO

Priority order. "Active" = work on these now; "Parked" = blocked on a dependency; "Done" = completed this session.

## Active Tasks (work on these)

### T1: Invoice Builder Page
Build `/ceo/finance/new-invoice` with manual line-item composition.
CEO sees `CLIENT_SIGNED` timesheets, can add/remove engineers, adjust descriptions, select PO.
Auto-calculates subtotal + 15% VAT. Calls `generateInvoice` on submit.
Branch `parked/finance-invoice-wiring` has the auto-generation code — redesign with a composition step.

### T2: Replace Mock Data in 7 CEO Pages
- **Finance Cash Flow** — replace `baseCash=0` with a real forecast from the `recalculateForecast` function.
- **Finance Expenses** — replace the hardcoded budget array with the Firestore `expenses` collection.
- **AI Operations** — replace the `setTimeout` fake status with real Cloud Run health pings.
- **Contracts** — replace the hardcoded Proposal Audit Trail with Firestore data.
- **Compliance** — replace the hardcoded Upcoming Deadlines with the `compliance_calendar` collection.
- **System Health** — replace the random chart points with real Cloud Monitoring data.

> (Listed as 7 in the title; 6 pages enumerated above. Finance Invoices is covered by T1.)

### T3: Employee Onboarding Flow
Build an onboarding checklist at `/employee/onboarding`.
Read from `employees/{id}/onboarding` subcollection.
Items: policy acknowledgment, security training, code of conduct, PDPL consent.
Each item has `status` (pending/completed), completion timestamp, evidence link.
Employee `status` stays `ONBOARDING` until all items complete → then `ACTIVE`.

### T4: PDPL Consent Page
Fix the `/consent/:token` page to write the consent decision to Firestore.
Track in `users/{uid}.pdpl_consent_state`.
Log to BigQuery `consent_log`.

## Parked (waiting on dependencies)

### T5: Zoho Invoice Push
Needs Invoice Builder (T1) first. Wire `syncToZohoBooks` after the CEO approves an invoice.

### T6: ZATCA XML Generation
Needs Invoice Builder (T1) first. Wire `generateZatcaXml` after the CEO approves.

### T7: WPS Payroll File Generation
Needs the Payroll Procedure document (Phase 6) first. Build the WPS file format for bank submission.

## Done (completed this session)
- Routing fix (`homePathForRole`)
- TaskInbox persistence (`fsId`)
- Policies page (route + real data)
- 13 Cloud Function IAM fixes
- Full 64-function audit
- Git history security audit
- DNS documentation
