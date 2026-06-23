#!/usr/bin/env node
/**
 * CI guard: every Cloud Function trigger MUST be pinned to me-central2 (KSA data
 * residency — PDPL/NCA/SAMA). A function added without `region: "me-central2"`
 * defaults to us-central1 and silently breaks residency. This fails the build if
 * any trigger's options block is missing the region pin.
 *
 *   node functions/scripts/check-region-pins.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const FUNCTIONS_DIR = path.resolve(__dirname, "..");
const REGION = "me-central2";
const TRIGGERS = ["onRequest", "onSchedule", "onMessagePublished", "onCall",
  "onDocumentCreated", "onDocumentWritten", "onDocumentUpdated", "onDocumentDeleted"];
const triggerRe = new RegExp("\\b(" + TRIGGERS.join("|") + ")\\s*\\(", "g");

// Only scan top-level function source files (not lib/ helpers or scripts/).
const files = fs.readdirSync(FUNCTIONS_DIR)
  .filter((f) => f.endsWith(".js") && !f.startsWith("."))
  .map((f) => path.join(FUNCTIONS_DIR, f));

const violations = [];
for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  let m;
  while ((m = triggerRe.exec(src)) !== null) {
    // Skip matches that are inside a comment line (e.g. a doc comment naming the trigger).
    const lineStart = src.lastIndexOf("\n", m.index) + 1;
    const beforeOnLine = src.slice(lineStart, m.index).trimStart();
    if (beforeOnLine.startsWith("//") || beforeOnLine.startsWith("*")) continue;

    // Pinned if the options block has the literal region OR the REGION constant
    // (functions/adminAuth.js etc. use `region: REGION` where REGION = "me-central2").
    const window = src.slice(m.index, m.index + 500);
    const pinned = window.includes(REGION) || /region\s*:\s*REGION\b/.test(window);
    if (!pinned) {
      const line = src.slice(0, m.index).split("\n").length;
      violations.push(`${path.basename(file)}:${line}  ${m[1]}( … missing region:"${REGION}"`);
    }
  }
}

if (violations.length) {
  console.error(`\n✗ REGION-PIN CHECK FAILED — ${violations.length} trigger(s) not pinned to ${REGION}:`);
  violations.forEach((v) => console.error("   " + v));
  console.error("\nEvery Cloud Function must carry { region: \"me-central2\" } (data residency).");
  process.exit(1);
}
console.log(`✓ region-pin check passed — all triggers pinned to ${REGION}.`);
process.exit(0);
