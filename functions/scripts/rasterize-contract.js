/**
 * Download the latest contract PDF from WORM, rasterize pages 1-2 to PNG with
 * mupdf (WASM), and upload them to GCS so the VM can run Gemma vision on them.
 *   cd functions && node scripts/rasterize-contract.js
 */
"use strict";
const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: "datalake-production-sa" });
const db = admin.firestore();

(async () => {
  const mupdf = await import("mupdf");
  const snap = await db.collection("contracts").orderBy("created_at", "desc").limit(1).get();
  const c = snap.docs[0].data();
  const path = c.contract_pdf_storage_path || c.pdf_storage_path;
  console.log(`contract: ${c.contract_pdf_filename} (${path})`);
  const [buf] = await admin.storage().bucket("datalake-worm-hr").file(path).download();

  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  const n = doc.countPages();
  console.log(`pages: ${n}`);
  const out = admin.storage().bucket("datalake-cv-uploads");
  const scale = mupdf.Matrix.scale(4, 4); // 4x — small Arabic name text needs the resolution
  for (let i = 0; i < Math.min(2, n); i++) {
    const page = doc.loadPage(i);
    const pix = page.toPixmap(scale, mupdf.ColorSpace.DeviceRGB, false, true);
    const png = pix.asPNG();
    await out.file(`_diag/contract-p${i + 1}.png`).save(Buffer.from(png), { contentType: "image/png" });
    console.log(`uploaded _diag/contract-p${i + 1}.png (${png.length} bytes)`);
  }
})().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
