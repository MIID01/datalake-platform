"use strict";
//
// evaluateHireBudget — pure PO-budget decision for a hire.
//
// Used by BOTH the synchronous gate in initiateHire (reject over-PO before the
// pending_hires doc is written) and the validateHireBudget trigger (defence in
// depth). Pure + dependency-free so it is unit-testable without Firestore.
//
//   approved=false  → the hire would push committed spend past the project PO.
//
// Field note: projects store the PO as `po_value_sar` / `po_used_sar`
// (see index.js createProject). The previous trigger read `po_value`/`po_used`,
// which do not exist on the project doc → po_remaining was always wrong.
//
function evaluateHireBudget({ poValueSar, poUsedSar, hireCostSar }) {
  const poValue = Number(poValueSar) || 0;
  const poUsed = Number(poUsedSar) || 0;
  const hireCost = Number(hireCostSar) || 0;

  const remaining = poValue - poUsed;
  const projectedUsed = poUsed + hireCost;

  // No PO configured → cannot validate. Allow, but flag — do not silently pass
  // as if the budget were checked.
  if (poValue <= 0) {
    return {
      approved: true,
      blocked: false,
      po_value_sar: poValue,
      po_used_sar: poUsed,
      hire_cost_sar: hireCost,
      po_remaining_sar: remaining,
      over_by_sar: 0,
      warning: "Project has no po_value_sar configured — budget not validated.",
      reason: "PO not configured; budget check skipped.",
    };
  }

  const overBy = projectedUsed - poValue;
  const approved = overBy <= 0;
  return {
    approved,
    blocked: !approved,
    po_value_sar: poValue,
    po_used_sar: poUsed,
    hire_cost_sar: hireCost,
    po_remaining_sar: remaining,
    over_by_sar: approved ? 0 : overBy,
    reason: approved
      ? "Within PO budget."
      : `Hire cost (SAR ${hireCost.toLocaleString()}) exceeds remaining PO (SAR ${remaining.toLocaleString()}) by SAR ${overBy.toLocaleString()}.`,
  };
}

module.exports = { evaluateHireBudget };
