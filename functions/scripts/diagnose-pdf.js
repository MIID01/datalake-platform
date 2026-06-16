/**
 * Read-only. Download the latest contract PDF from WORM, run pdf-parse, and show
 * what text actually comes out — so we can see why gemma returned just "{".
 *   cd functions && node scripts/diagnose-pdf.js
 */
"use strict";
const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: "datalake-production-sa" });
const db = admin.firestore();
const pdfParse = require("pdf-parse");

(async () => {
  const snap = await db.collection("contracts").orderBy("created_at", "desc").limit(1).get();
  if (snap.empty) { console.log("no contracts"); return; }
  const c = snap.docs[0].data();
  const path = c.contract_pdf_storage_path || c.pdf_storage_path;
  console.log(`doc: ${snap.docs[0].id}`);
  console.log(`file: ${c.contract_pdf_filename}`);
  console.log(`storage: ${path}\n`);

  const [buf] = await admin.storage().bucket("datalake-worm-hr").file(path).download();
  console.log(`pdf bytes: ${buf.length}`);

  const parsed = await pdfParse(buf);
  const text = parsed.text || "";
  console.log(`pages: ${parsed.numpages} · text chars: ${text.length}`);
  // how much is "readable" latin/arabic vs noise
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  const arabic = (text.match(/[؀-ۿ]/g) || []).length;
  const digits = (text.match(/[0-9]/g) || []).length;
  const ws = (text.match(/\s/g) || []).length;
  console.log(`latin: ${latin} · arabic: ${arabic} · digits: ${digits} · whitespace: ${ws}`);
  console.log("\n────── FIRST 1500 CHARS ──────");
  console.log(JSON.stringify(text.slice(0, 1500)));
  console.log("\n────── CHARS 1500-2500 ──────");
  console.log(JSON.stringify(text.slice(1500, 2500)));
})().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
