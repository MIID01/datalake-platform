# TODO

Priority order. "Active" = work on these now; "Parked" = blocked on a dependency; "Done" = completed.

## Active Tasks (work on these)

### T1: Invoice Builder Page
Build `/finance/invoices` composition flow (or `/ceo/finance/new-invoice`) with manual line-item composition.
Finance/CEO sees `CLIENT_SIGNED` timesheets, can add/remove engineers, adjust descriptions, select PO.
Auto-calculates subtotal + 15% VAT. Calls `generateInvoice` on submit.
Branch `parked/finance-invoice-wiring` has the auto-generation code — redesign with a composition step.

### T2: Remaining mock-data cleanup (most done — see Done)
- **Finance Cash Flow** — replace `baseCash=0` with a real forecast from the `recalculateForecast` function.
- **AI Operations** — replace the `setTimeout` fake "Running" status with real Cloud Run health pings (random errorCount already removed).
- **Contracts** — replace the hardcoded Proposal Audit Trail with Firestore data.
- **Compliance** — replace the hardcoded Upcoming Deadlines with the `compliance_calendar` collection.

## Parked (waiting on dependencies)

### T5: Zoho Invoice Push
Needs Invoice Builder (T1) first. Wire `syncToZohoBooks` after invoice approval.

### T6: ZATCA XML Generation
Needs Invoice Builder (T1) first. Wire `generateZatcaXml` after approval.

### T7: WPS Payroll File Generation
Needs the Payroll Procedure document (Phase 6) first. Build the WPS file format for bank submission.

## Done (completed)
- Routing fix (`homePathForRole`); TaskInbox persistence; Policies page; 13 Cloud Function IAM fixes; full 64-function audit; git history security audit; DNS docs
- **Onboarding gate** centralized in `AuthGate` (all roles incl. CEO); 4-policy acknowledgment page at `/employee/onboarding` writing real consent
- **White-page fix**: `firebase.json` serves `index.html` `no-cache` + hashed assets `immutable`; app-level `ErrorBoundary` surfaces real errors instead of blanking
- **Timesheet 500 fix**: `getMyTimesheets` no longer needs a composite index (in-memory sort) + try/catch returns JSON; frontend parses responses safely
- **Employee profile**: reads `employees` by `employee_id`, correct field mapping; working photo upload to Storage (`employee-photos/`); editable phone + emergency contact (limited self-service fields)
- **Mock data removed**: employee Dashboard contract card (real assignment via `getEngineerProjectView` or empty state); AIOps random errorCount; FinanceExpenses budget→real actual-by-category; SystemHealth random sparklines→real history/empty state
- **Portal segregation**: `/ceo/*` CEO-only; new **Finance portal** `/finance/*` (`FinanceLayout`) reusing CEO finance components; `/employee/*` open to all roles; CEO **Switch Portal** dropdown; `routes.js` finance → `/finance`
- **CI/CD**: `.github/workflows/deploy.yml` (preview → Cypress → promote-on-green → tag `v{date}-{time}`); `.github/dependabot.yml` (weekly npm scans)
- **Firebase Storage enabled**; `storage.rules` deployed (incl. `employee-photos/`)
- **Security**: rotated all account passwords to unique values after a leaked shared password; purged the secret from git history
- **Docs**: `docs/rollback.md` (hosting / Cloud Run / rules / git-tag rollback)
