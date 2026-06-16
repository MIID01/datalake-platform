/**
 * Read-only. Show the newest contracts doc: which model ran, the extraction
 * status/error, and the RAW model output captured on PARSE_FAILED.
 *   cd functions && node scripts/inspect-latest-contract.js
 */
"use strict";
const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: "datalake-production-sa" });
const db = admin.firestore();

(async () => {
  const snap = await db.collection("contracts").orderBy("created_at", "desc").limit(3).get();
  console.log(`contracts: ${snap.size}\n`);
  for (const d of snap.docs) {
    const c = d.data();
    console.log("────────────────────────────────── " + d.id);
    console.log("  file:           " + (c.contract_pdf_filename || c.original_filename || "-"));
    console.log("  created_at:     " + (c.created_at && c.created_at.toDate ? c.created_at.toDate().toISOString() : "-"));
    console.log("  status:         " + c.status + " / " + c.contract_extraction_status);
    console.log("  MODEL:          " + (c.contract_extraction_model || "-"));
    console.log("  method:         " + (c.contract_extraction_method || "-"));
    console.log("  ocr_lines:      " + (c.contract_ocr_lines != null ? c.contract_ocr_lines : "-"));
    console.log("  error:          " + (c.extraction_error || c.contract_extraction_error || "-"));
    if (c.extraction_raw_output) {
      console.log("  RAW OUTPUT (first 1200 chars):");
      console.log("  ┌─────────────────────────────");
      console.log(String(c.extraction_raw_output).slice(0, 1200).split("\n").map(l => "  │ " + l).join("\n"));
      console.log("  └─────────────────────────────");
    }
  }
})().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
