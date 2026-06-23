"use strict";
/**
 * Deterministic invoice validation — replaces the LLM invoice pre-check.
 * Pure arithmetic/logic (ZATCA Phase 2 + 3-way sign-off) = code, not an LLM.
 * 100% accurate, instant, auditable. Advisory only — CEO approves the invoice.
 *
 * Status (kept for UI back-compat): AI_VALID / AI_INCONCLUSIVE / AI_FLAGGED.
 *   AI_FLAGGED       — a real error (VAT/total/line-item mismatch, missing ZATCA
 *                      field, currency ≠ SAR, or linked timesheet not CLIENT_SIGNED).
 *   AI_INCONCLUSIVE  — couldn't compute (e.g. line items not itemised). Not a failure.
 *   AI_VALID         — all checks pass.
 */

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Best-effort line-item amount across common shapes.
function lineAmount(it) {
  if (it == null) return null;
  if (typeof it.amount === "number") return it.amount;
  if (typeof it.total === "number") return it.total;
  const qty = Number(it.quantity ?? it.qty);
  const price = Number(it.unit_price ?? it.rate ?? it.price);
  if (Number.isFinite(qty) && Number.isFinite(price)) return qty * price;
  return null;
}

/**
 * @param {object} invoice  the invoices/{id} doc
 * @param {{state?:string,client_signed?:boolean}|null} timesheetData linked timesheet summary
 */
function validateInvoice(invoice, timesheetData = null) {
  const issues = [];
  const warnings = [];
  const missing_zatca_fields = [];

  const subtotal = Number(invoice.subtotal);
  const vatAmount = invoice.vat_amount != null ? Number(invoice.vat_amount) : null;
  const total = invoice.total != null ? Number(invoice.total) : null;

  // 1. Currency must be SAR.
  if (String(invoice.currency || "").toUpperCase() !== "SAR") {
    issues.push(`Currency must be SAR (got "${invoice.currency || "none"}").`);
  }

  // 2. VAT rate must be 15% (ZATCA Phase 2). Accept 0.15 or 15.
  if (invoice.vat_rate != null) {
    const r = Number(invoice.vat_rate);
    const normalised = r > 1 ? r / 100 : r;
    if (Math.abs(normalised - 0.15) > 0.0001) issues.push(`VAT rate must be 15% (got ${invoice.vat_rate}).`);
  } else {
    warnings.push("No vat_rate on the invoice — assuming 15% for the calculation.");
  }

  // 3. VAT amount = subtotal × 15%.
  let calculated_vat = null, calculated_total = null;
  if (Number.isFinite(subtotal)) {
    calculated_vat = round2(subtotal * 0.15);
    calculated_total = round2(subtotal + calculated_vat);
    if (vatAmount != null && Math.abs(round2(vatAmount) - calculated_vat) > 0.01) {
      issues.push(`VAT amount ${round2(vatAmount)} ≠ subtotal×15% (${calculated_vat}).`);
    }
    // 4. Total = subtotal + VAT.
    if (total != null && Math.abs(round2(total) - calculated_total) > 0.01) {
      issues.push(`Total ${round2(total)} ≠ subtotal + VAT (${calculated_total}).`);
    }
  } else {
    issues.push("Subtotal missing or non-numeric — cannot verify VAT/total.");
  }

  // 5. Line items sum = subtotal (if itemised).
  const items = Array.isArray(invoice.line_items) ? invoice.line_items : null;
  if (items && items.length) {
    const amounts = items.map(lineAmount);
    if (amounts.every((a) => a != null)) {
      const sum = round2(amounts.reduce((s, a) => s + a, 0));
      if (Number.isFinite(subtotal) && Math.abs(sum - round2(subtotal)) > 0.01) {
        issues.push(`Line items sum (${sum}) ≠ subtotal (${round2(subtotal)}).`);
      }
    } else {
      warnings.push("Line items not fully itemised with amounts — line-sum check skipped.");
    }
  } else {
    warnings.push("No line items on the invoice — line-sum check skipped.");
  }

  // 6. ZATCA mandatory fields.
  if (!invoice.seller_name) missing_zatca_fields.push("seller_name");
  if (!invoice.seller_vat) missing_zatca_fields.push("seller_vat");
  if (!invoice.seller_cr) missing_zatca_fields.push("seller_cr");
  if (!invoice.invoice_id) missing_zatca_fields.push("invoice_uuid");
  if (missing_zatca_fields.length) issues.push(`Missing ZATCA fields: ${missing_zatca_fields.join(", ")}.`);

  // 7. Three-way sign-off: a linked timesheet must be CLIENT_SIGNED before invoicing.
  let three_way_signoff_verified = null;
  if (timesheetData) {
    three_way_signoff_verified = timesheetData.client_signed === true || timesheetData.state === "CLIENT_SIGNED";
    if (!three_way_signoff_verified) {
      issues.push(`Linked timesheet is "${timesheetData.state || "unknown"}", not CLIENT_SIGNED — invoice before sign-off.`);
    }
  }

  const zatca_compliant = missing_zatca_fields.length === 0 && !issues.some((i) => i.includes("VAT") || i.includes("Currency"));
  const financial_accurate = !issues.some((i) => i.includes("VAT") || i.includes("Total") || i.includes("Line items") || i.includes("Subtotal"));

  let status, valid, summary;
  if (issues.length) {
    status = "AI_FLAGGED"; valid = false;
    summary = `${issues.length} issue(s) — review before approving.`;
  } else if (warnings.length) {
    status = "AI_INCONCLUSIVE"; valid = null;
    summary = "Core checks pass; some checks skipped for missing data.";
  } else {
    status = "AI_VALID"; valid = true;
    summary = "All ZATCA + financial checks passed.";
  }

  return {
    status, valid, zatca_compliant, financial_accurate, three_way_signoff_verified,
    issues, warnings, calculated_vat, calculated_total, missing_zatca_fields, summary,
    checked_by: "automated_checks", checker: "deterministic-v1",
  };
}

module.exports = { validateInvoice };
