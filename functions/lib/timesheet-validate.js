"use strict";
/**
 * Deterministic timesheet validation — replaces the LLM "Controller AI" pre-screen.
 *
 * Pure arithmetic/logic = code, not a language model. 100% accurate, instant, free,
 * fully auditable. Advisory only: the CTO/CEO still makes the call.
 *
 * Status semantics (the important fix):
 *   AI_VALID         — all checks pass AND the amount/VAT could be computed.
 *   AI_INCONCLUSIVE  — checks pass but project data is missing (no rate / no PO caps),
 *                      so the amount can't be computed. "Needs data", NOT a failure.
 *   AI_FLAGGED       — a REAL problem with the timesheet (hours mismatch, invalid day
 *                      type, date outside the period, or PO cap exceeded).
 *
 * Status values are kept as AI_VALID/AI_INCONCLUSIVE/AI_FLAGGED for back-compat with
 * the existing review UI; the source is now "automated_checks", not an LLM.
 */

const VALID_TYPES = new Set([
  "in_house", "remote",
  "leave_annual", "leave_sick", "leave_public_holiday", "leave",
  "weekend", "holiday", "none",
]);

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const daysInMonth = (y, m) => new Date(Number(y), Number(m), 0).getDate();

/**
 * @param {{days:object,total_hours:number,period_month:number,period_year:number}} ts
 * @param {object} project  the projects/{id} doc (rate_amount_sar, po_total_hours, …)
 */
function validateTimesheet(ts, project = {}) {
  const issues = [];
  const warnings = [];
  const days = ts.days || {};
  const nDays = daysInMonth(ts.period_year, ts.period_month);

  // 1) Sum the day hours and compare to the submitted total.
  let summed = 0;
  for (const [k, entry] of Object.entries(days)) {
    const h = Number(entry && entry.hours) || 0;
    summed += h;

    // 2) Day key must fall inside the billing month. The key may be a day-of-month
    //    ("1".."31", current submissions) OR a full ISO date ("2026-04-01", legacy).
    let keyOk = false;
    if (/^\d{1,2}$/.test(k)) {
      const n = Number(k);
      keyOk = n >= 1 && n <= nDays;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(k)) {
      const [yy, mm, dd] = k.split("-").map(Number);
      keyOk = yy === Number(ts.period_year) && mm === Number(ts.period_month) && dd >= 1 && dd <= nDays;
    }
    if (!keyOk) {
      issues.push(`Day "${k}" is outside ${ts.period_year}-${String(ts.period_month).padStart(2, "0")} (1–${nDays}).`);
    }
    // 3) Day type must be recognised.
    const type = entry && entry.type;
    if (type && !VALID_TYPES.has(type)) {
      issues.push(`Day ${k} has an unrecognised type "${type}".`);
    }
  }
  summed = round2(summed);
  const submitted = round2(ts.total_hours || 0);
  if (Math.abs(summed - submitted) > 0.01) {
    issues.push(`Submitted total (${submitted}h) does not match the sum of day entries (${summed}h).`);
  }

  // 4) Money: amount = hours × rate, VAT = amount × 15% (ZATCA Phase 2).
  const rate = Number(project.rate_amount_sar) || null;
  let total_amount_sar = null, vat_amount_sar = null, total_with_vat_sar = null;
  if (rate) {
    total_amount_sar = round2(submitted * rate);
    vat_amount_sar = round2(total_amount_sar * 0.15);
    total_with_vat_sar = round2(total_amount_sar + vat_amount_sar);
  } else {
    warnings.push("No hourly rate on the project — amount and VAT can't be calculated. Set rate_amount_sar on the project.");
  }

  // 5) PO cap: used + this period must not exceed the PO total hours (if tracked).
  let po_remaining_hours = null, po_remaining_amount_sar = null;
  const poTotal = Number(project.po_total_hours) || null;
  if (poTotal) {
    const poUsed = Number(project.po_used_hours) || 0;
    po_remaining_hours = round2(poTotal - poUsed - submitted);
    if (po_remaining_hours < 0) {
      issues.push(`This period (${submitted}h) exceeds the PO cap: ${poUsed}h used of ${poTotal}h, over by ${Math.abs(po_remaining_hours)}h.`);
    }
    if (rate) po_remaining_amount_sar = round2(Math.max(0, po_remaining_hours) * rate);
  } else {
    warnings.push("PO hour cap not tracked on the project — can't validate against the PO limit.");
  }

  // Status: real issue → FLAGGED; else missing data → INCONCLUSIVE; else VALID.
  let status, valid, notes;
  if (issues.length) {
    status = "AI_FLAGGED"; valid = false;
    notes = `${issues.length} issue(s) found — review before approving.`;
  } else if (warnings.length) {
    status = "AI_INCONCLUSIVE"; valid = null;
    notes = "Hours check out; project data is incomplete (rate/PO) so the amount couldn't be verified.";
  } else {
    status = "AI_VALID"; valid = true;
    notes = "All checks passed.";
  }

  return {
    status, valid,
    total_hours_verified: submitted,
    total_amount_sar, vat_amount_sar, total_with_vat_sar,
    po_remaining_hours, po_remaining_amount_sar,
    issues, warnings, notes,
    checked_by: "automated_checks", checker: "deterministic-v1",
  };
}

module.exports = { validateTimesheet };
