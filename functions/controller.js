/**
 * Controller Agent — Datalake AI Capability
 *
 * controllerTimesheetValidate — AI validates timesheet against PO (hours, rates, VAT)
 * controllerInvoiceValidate   — AI validates invoice data before CEO approval
 *
 * DTLK-PROMPT-AI-001 | Agent: Controller
 * Rules enforced:
 *   - No external AI APIs. Timesheet validation is now DETERMINISTIC code
 *     (lib/timesheet-validate.js, no LLM — exact + auditable). Invoice validation
 *     still uses the self-hosted LLM (Gemma 3; model id from the LLM_MODEL env).
 *   - ALL outputs are advisory/DRAFTS — the CEO acts.
 *   - Every LLM call logged to BigQuery datalake_audit.ai_actions.
 */

"use strict";

const admin = require("firebase-admin");
const { validateTimesheet } = require("./lib/timesheet-validate");
const { validateInvoice } = require("./lib/invoice-validate");

const db = admin.firestore();

// ══════════════════════════════════════════════════════════════════
// 1. controllerTimesheetValidate — CTO or CEO only
// Called after timesheet submission to validate against PO terms.
// AI checks: hours cap, rate match, date validity, VAT calculation.
// Result stored on timesheet doc — CTO/CEO reviews flagged items.
// ══════════════════════════════════════════════════════════════════
async function controllerTimesheetValidateHandler(event) {
  try {
    const { timesheet_id } = event.data.message.json;
    if (!timesheet_id) throw new Error("timesheet_id required in Pub/Sub message");

    // Load timesheet
    const tsDoc = await db.collection("timesheets").doc(timesheet_id).get();
    if (!tsDoc.exists) throw new Error(`Timesheet not found: ${timesheet_id}`);
    const timesheet = tsDoc.data();

    // Load project (for PO terms and contracted rate)
    const projectDoc = await db.collection("projects").doc(timesheet.project_id).get();
    if (!projectDoc.exists) throw new Error(`Project not found: ${timesheet.project_id}`);
    const project = projectDoc.data();

    // ── Deterministic timesheet validation (no LLM — exact + auditable) ──
    const validation = validateTimesheet(
      { days: timesheet.days, total_hours: timesheet.total_hours, period_month: timesheet.period_month, period_year: timesheet.period_year },
      project,
    );
    const validationStatus = validation.status;

    const now = admin.firestore.FieldValue.serverTimestamp();
    await db.collection("timesheets").doc(timesheet_id).update({
      ai_validation: validation,
      ai_validation_status: validationStatus,
      ai_validated_at: now,
      ai_validated_by: "automated_checks",
      ai_validation_model: "deterministic-v1",
      ai_validation_ms: 0,
    });

    await db.collection("task_audit_log").add({
      event: "TIMESHEET_AI_VALIDATED",
      action_by: "system:pubsub",
      action_at: now,
      details: {
        timesheet_id,
        validation_status: validationStatus,
        issues_count: validation.issues?.length || 0,
        warnings_count: validation.warnings?.length || 0,
        ai_model: MODEL_NAME,
      },
    });

    console.log(`[Controller] Timesheet ${timesheet_id} validated: ${validationStatus}`);
  } catch (err) {
    console.error("controllerTimesheetValidate error:", err);
    throw err;
  }
}

// ══════════════════════════════════════════════════════════════════
// 2. controllerInvoiceValidate — CEO only
// AI validates invoice data against the underlying timesheet and PO.
// Checks: correct VAT, correct totals, ZATCA compliance fields present.
// Output stored on invoice doc — CEO reviews and approves.
// ══════════════════════════════════════════════════════════════════
async function controllerInvoiceValidateHandler(event) {
  try {
    const { invoice_id } = event.data.message.json;
    if (!invoice_id) throw new Error("invoice_id required in Pub/Sub message");

    const invDoc = await db.collection("invoices").doc(invoice_id).get();
    if (!invDoc.exists) throw new Error(`Invoice not found: ${invoice_id}`);
    const invoice = invDoc.data();

    // Load linked timesheet if present
    let timesheetData = null;
    if (invoice.timesheet_id) {
      const tsDoc = await db.collection("timesheets").doc(invoice.timesheet_id).get();
      if (tsDoc.exists) {
        const ts = tsDoc.data();
        timesheetData = {
          total_hours: ts.total_hours,
          state: ts.state,
          client_signed: ts.state === "CLIENT_SIGNED",
        };
      }
    }

    // Deterministic invoice validation (no LLM — exact ZATCA + financial checks).
    const validation = validateInvoice(invoice, timesheetData);

    const now = admin.firestore.FieldValue.serverTimestamp();
    await db.collection("invoices").doc(invoice_id).update({
      ai_validation: validation,
      ai_validation_status: validation.status,
      ai_validated_at: now,
      ai_validated_by: "automated_checks",
      ai_validation_model: "deterministic-v1",
    });

    await db.collection("task_audit_log").add({
      event: "INVOICE_AI_VALIDATED",
      action_by: "system:pubsub",
      action_at: now,
      details: {
        invoice_id,
        invoice_number: invoice.invoice_number,
        valid: validation.valid,
        zatca_compliant: validation.zatca_compliant,
        issues_count: validation.issues?.length || 0,
        validator: "deterministic-v1",
      },
    });

    console.log(`[Controller] Invoice ${invoice_id} validated: ${validation.valid ? "AI_VALID" : "AI_FLAGGED"}`);
  } catch (err) {
    console.error("controllerInvoiceValidate error:", err);
    throw err;
  }
}

module.exports = {
  controllerTimesheetValidateHandler,
  controllerInvoiceValidateHandler,
};
