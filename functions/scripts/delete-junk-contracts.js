/**
 * Delete the test/confabulated `contracts` docs (all 3 are re-uploads of the same
 * real "Contract MOHAMED DAHAS.pdf" that Qwen 3B confabulated into John Doe / system).
 * Firestore docs are deleted (clears the UI). The raw PDFs live in the locked WORM
 * bucket (datalake-worm-hr) and cannot be removed — we attempt and report.
 *   cd functions && node scripts/delete-junk-contracts.js
 */
"use strict";
const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: "datalake-production-sa" });
const db = admin.firestore();

(async () => {
  const snap = await db.collection("contracts").get();
  console.log(`contracts to delete: ${snap.size}\n`);
  for (const d of snap.docs) {
    const c = d.data();
    const name = (c.contract_extracted_fields || {}).employee_name || "?";
    const path = c.contract_pdf_storage_path || c.pdf_storage_path;
    console.log(`• ${d.id} — extracted="${name}" file=${c.contract_pdf_filename || "-"}`);
    // attempt to remove the WORM object (expected to fail under locked retention)
    if (path) {
      try {
        await admin.storage().bucket("datalake-worm-hr").file(path).delete();
        console.log(`    storage: deleted ${path}`);
      } catch (e) {
        console.log(`    storage: KEPT (WORM retention) — ${String(e.message).slice(0, 80)}`);
      }
    }
    await d.ref.delete();
    console.log(`    firestore: deleted`);
  }
  const after = await db.collection("contracts").get();
  console.log(`\nremaining contracts: ${after.size}`);
})().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
