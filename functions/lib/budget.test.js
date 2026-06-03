"use strict";
// Standalone negative/positive test for evaluateHireBudget.
//   node lib/budget.test.js
const { evaluateHireBudget } = require("./budget");

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (got ${actual}, want ${expected})`);
  ok ? pass++ : fail++;
}

// PO = 480,000 SAR; 400,000 already used → 80,000 remaining.
// Over-PO hire: 12 months × 12,000 = 144,000 > 80,000 → MUST block.
const over = evaluateHireBudget({ poValueSar: 480000, poUsedSar: 400000, hireCostSar: 144000 });
check("over-PO hire is BLOCKED", over.approved, false);
check("over-PO reports over_by", over.over_by_sar, 64000);

// Within budget: 12 months × 6,000 = 72,000 ≤ 80,000 → allow.
const within = evaluateHireBudget({ poValueSar: 480000, poUsedSar: 400000, hireCostSar: 72000 });
check("within-PO hire is APPROVED", within.approved, true);

// Field-bug guard: a project with po_value_sar set must NOT read as 0.
const fieldOk = evaluateHireBudget({ poValueSar: 480000, poUsedSar: 0, hireCostSar: 100000 });
check("po_value_sar is honoured (remaining computed)", fieldOk.po_remaining_sar, 480000);

// Exactly at the cap → allowed (boundary).
const exact = evaluateHireBudget({ poValueSar: 100000, poUsedSar: 40000, hireCostSar: 60000 });
check("exact-cap hire is APPROVED", exact.approved, true);

console.log(`\n${pass} passing, ${fail} failing`);
process.exit(fail === 0 ? 0 : 1);
