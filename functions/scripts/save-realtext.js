"use strict";
const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: "datalake-production-sa" });
const db = admin.firestore();
const pdfParse = require("pdf-parse");
(async () => {
  const snap = await db.collection("contracts").orderBy("created_at", "desc").limit(1).get();
  const c = snap.docs[0].data();
  const path = c.contract_pdf_storage_path || c.pdf_storage_path;
  const [buf] = await admin.storage().bucket("datalake-worm-hr").file(path).download();
  const parsed = await pdfParse(buf);
  const text = (parsed.text || "").slice(0, 15000);
  // upload straight to GCS so the VM can pull it (avoids local /tmp path mismatch)
  await admin.storage().bucket("datalake-cv-uploads").file("_diag/realtext.txt").save(text, {
    contentType: "text/plain; charset=utf-8",
  });
  console.log(`uploaded ${text.length} chars to gs://datalake-cv-uploads/_diag/realtext.txt`);
})().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
