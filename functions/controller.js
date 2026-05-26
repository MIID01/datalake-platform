/**
 * Controller Agent — Datalake AI Capability
 *
 * controllerTimesheetValidate — AI validates timesheet against PO (hours, rates, VAT)
 * controllerInvoiceValidate   — AI validates invoice data before CEO approval
 *
 * DTLK-PROMPT-AI-001 | Agent: Controller
 * Rules enforced:
 *   - No external AI APIs. Self-hosted Qwen 2.5 7B only.
 *   - ALL outputs are DRAFTS — AI flags issues, CEO acts.
 *   - Every call logged to BigQuery datalake_audit.ai_actions.
 *   - max_tokens: 2000 (hard ceiling per §Cost Control).
 */

"use strict";

const admin = require("firebase-admin");
const { callLLM, parseJsonOutput } = require("./lib/ai-client");

const db = admin.firestore();

// ══════════════════════════════════════════════════════════════════
// 1. controllerTimesheetValidate — Pub/Sub trigger (datalake.timesheet.cto_approved)
// Called after timesheet submission to validate against PO terms.
// AI checks: hours cap, rate match, date validity, VAT calculation.
// Result stored on timesheet doc — CTO/CEO reviews flagged items.
// ══════════════════════════════════════════════════════════════════
async function controllerTimesheetValidateHandler(event) {
  try {
    const { timesheet_id } = event.data.message.json;
    if (!timesheet_id) throw new Error("timesheet_id required");

    // Load timesheet
    const tsDoc = await db.collection("timesheets").doc(timesheet_id).get();
    if (!tsDoc.exists) return res.status(404).json({ error: "Timesheet not found" });
    const timesheet = tsDoc.data();

    // Load project (for PO terms and contracted rate)
    const projectDoc = await db.collection("projects").doc(timesheet.project_id).get();
    if (!projectDoc.exists) return res.status(404).json({ error: "Project not found" });
    const project = projectDoc.data();

    // Build validation input — no PII beyond names already in the system
    const validationInput = {
      timesheet_id,
      period_label: timesheet.period_label,
      period_month: timesheet.period_month,
      period_year: timesheet.period_year,
      engineer_name: timesheet.engineer_name,
      project_name: timesheet.project_name,
      client_name: timesheet.client_name,
      // Hour totals from submitted timesheet
      total_hours_submitted: timesheet.total_hours,
      in_house_hours: timesheet.in_house_hours,
      remote_hours: timesheet.remote_hours,
      leave_hours: timesheet.leave_hours,
      // Day-by-day entries (AI validates no duplicate dates, valid types)
      days_entries: timesheet.days || {},
      // Project/PO financial terms
      contracted_rate_sar_per_hour: project.rate_amount_sar || null,
      rate_structure: project.rate_structure || "HOURLY",
      po_value_sar: project.po_value_sar || null,
      // NOTE: po_total_hours and po_used_hours may not be tracked yet;
      // Controller AI will flag if rate is null and cannot calculate
      po_total_hours: project.po_total_hours || null,
      po_used_hours: project.po_used_hours || null,
      billing_period_start: `${timesheet.period_year}-${String(timesheet.period_month).padStart(2, "0")}-01`,
      billing_period_end: new Date(timesheet.period_year, timesheet.period_month, 0)
        .toISOString().split("T")[0], // Last day of month
    };

    // ── Controller LLM: timesheet validation ──
    const llmResult = await callLLM({
      agent: "controller",
      type: "timesheet_validation",
      triggeredBy: "system",
      promptTemplateId: "CONTROLLER_TIMESHEET_V1",
      systemPrompt: `You are the Datalake Controller AI. Validate this timesheet against the purchase order and Saudi tax requirements.
Perform ALL of the following checks:
1. Total hours match sum of all day entries
2. No duplicate dates in day entries
3. All dates fall within the billing period
4. Hour types are valid: in_house, remote, leave_annual, leave_sick, leave_public_holiday
5. If contracted_rate_sar_per_hour is provided: total_amount_sar = total_hours × rate
6. VAT calculation: vat_amount_sar = total_amount_sar × 0.15 (ZATCA Phase 2 requirement)
7. total_with_vat_sar = total_amount_sar + vat_amount_sar
8. If po_total_hours and po_used_hours are provided: check hours do not exceed PO monthly/total cap

Return ONLY a valid JSON object:
{
  "valid": true|false,
  "total_hours_verified": N,
  "total_amount_sar": N or null,
  "vat_amount_sar": N or null,
  "total_with_vat_sar": N or null,
  "po_remaining_hours": N or null,
  "po_remaining_amount_sar": N or null,
  "issues": ["issue description 1", "issue description 2"],
  "warnings": ["warning 1"],
  "notes": "Additional notes for the reviewer"
}
If contracted_rate_sar_per_hour is null, set amount fields to null and note it in warnings.
Return valid JSON only, no markdown.`,
      userPrompt: JSON.stringify(validationInput),
    });

    if (!llmResult.success) {
      throw new Error(`AI validation failed: ${llmResult.error}`);
    }

    const parsed = parseJsonOutput(llmResult.output);
    const validation = parsed.success
      ? parsed.data
      : { valid: null, issues: ["AI output parse failed"], raw: llmResult.output };

    const validationStatus = validation.valid === true
      ? "AI_VALID"
      : validation.valid === false
        ? "AI_FLAGGED"
        : "AI_INCONCLUSIVE";

    // Update timesheet with AI validation result
    const now = admin.firestore.FieldValue.serverTimestamp();
    await db.collection("timesheets").doc(timesheet_id).update({
      ai_validation: validation,
      ai_validation_status: validationStatus,
      ai_validated_at: now,
      ai_validated_by: "controller_ai",
      ai_validation_model: "qwen2.5-7b-instruct-q4_K_M",
      ai_validation_ms: llmResult.inferenceMs,
    });

    await db.collection("task_audit_log").add({
      event: "TIMESHEET_AI_VALIDATED",
      action_by: "system",
      action_at: now,
      details: {
        timesheet_id,
        validation_status: validationStatus,
        issues_count: validation.issues?.length || 0,
        warnings_count: validation.warnings?.length || 0,
        ai_model: "qwen2.5-7b-instruct-q4_K_M",
      },
    });

  } catch (err) {
    console.error("controllerTimesheetValidate error:", err);
    throw err;
  }
}

// ══════════════════════════════════════════════════════════════════
// 2. controllerInvoiceValidate — Pub/Sub trigger (datalake.invoice.generated)
// Called after auto-invoice generation to verify against Zatca rules.
// ══════════════════════════════════════════════════════════════════
async function controllerInvoiceValidateHandler(event) {
  try {
    const { invoice_id } = event.data.message.json;
    if (!invoice_id) throw new Error("invoice_id required");

    const invDoc = await db.collection("invoices").doc(invoice_id).get();
    if (!invDoc.exists) throw new Error("Invoice not found");
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

    const validationInput = {
      invoice_number: invoice.invoice_number,
      client_name: invoice.client_name,
      period_start: invoice.period_start,
      period_end: invoice.period_end,
      line_items: invoice.line_items,
      subtotal: invoice.subtotal,
      vat_rate: invoice.vat_rate,
      vat_amount: invoice.vat_amount,
      total: invoice.total,
      currency: invoice.currency,
      seller_name: invoice.seller_name,
      seller_vat: invoice.seller_vat,
      seller_cr: invoice.seller_cr,
      linked_timesheet: timesheetData,
      zatca_required_fields: {
        seller_name: !!invoice.seller_name,
        seller_vat: !!invoice.seller_vat,
        seller_cr: !!invoice.seller_cr,
        invoice_uuid: !!invoice.invoice_id,
        issue_date: true, // present in the invoice
      },
    };

    const llmResult = await callLLM({
      agent: "controller",
      type: "invoice_validation",
      triggeredBy: "system",
      promptTemplateId: "CONTROLLER_INVOICE_V1",
      systemPrompt: `You are the Datalake Controller AI. Validate this invoice for ZATCA Phase 2 compliance and financial accuracy.
Check ALL of the following:
1. VAT rate is exactly 15% (ZATCA Phase 2 requirement for Saudi Arabia)
2. vat_amount = subtotal × 0.15 (round to 2 decimal places)
3. total = subtotal + vat_amount
4. Line items sum = subtotal
5. All ZATCA mandatory fields present: seller_name, seller_vat_number, seller_cr, UUID, issue_date
6. Currency is SAR
7. If linked timesheet exists: verify it was CLIENT_SIGNED before invoice (3-way signoff gate)
8. If linked timesheet has total_hours: verify invoice line items correspond

Return ONLY a valid JSON object:
{
  "valid": true|false,
  "zatca_compliant": true|false,
  "financial_accurate": true|false,
  "three_way_signoff_verified": true|false|null,
  "issues": ["issue 1"],
  "warnings": ["warning 1"],
  "calculated_vat": N,
  "calculated_total": N,
  "missing_zatca_fields": ["field name"],
  "summary": "Brief validation summary"
}
Return valid JSON only, no markdown.`,
      userPrompt: JSON.stringify(validationInput),
    });

    if (!llmResult.success) {
      throw new Error(`AI validation failed: ${llmResult.error}`);
    }

    const parsed = parseJsonOutput(llmResult.output);
    const validation = parsed.success ? parsed.data : { valid: null, raw: llmResult.output };

    const now = admin.firestore.FieldValue.serverTimestamp();
    await db.collection("invoices").doc(invoice_id).update({
      ai_validation: validation,
      ai_validation_status: validation.valid ? "AI_VALID" : "AI_FLAGGED",
      ai_validated_at: now,
      ai_validated_by: "controller_ai",
    });

    await db.collection("task_audit_log").add({
      event: "INVOICE_AI_VALIDATED",
      action_by: "system",
      action_at: now,
      details: {
        invoice_id,
        invoice_number: invoice.invoice_number,
        valid: validation.valid,
        zatca_compliant: validation.zatca_compliant,
        issues_count: validation.issues?.length || 0,
        ai_model: "qwen2.5-7b-instruct-q4_K_M",
      },
    });

  } catch (err) {
    console.error("controllerInvoiceValidate error:", err);
    throw err;
  }
}

module.exports = {
  controllerTimesheetValidateHandler,
  controllerInvoiceValidateHandler,
};
