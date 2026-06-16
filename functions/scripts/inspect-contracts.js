/**
 * Read-only. Dump every doc in `contracts` as raw JSON so we can see the real
 * schema and where "John Doe / ABC Corporation" actually lives.
 *   cd functions && node scripts/inspect-contracts.js
 */
"use strict";
const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: "datalake-production-sa" });
const db = admin.firestore();

function ts(v) { return v && v.toDate ? v.toDate().toISOString() : v; }

(async () => {
  const snap = await db.collection("contracts").get();
  console.log(`contracts: ${snap.size}\n`);
  for (const d of snap.docs) {
    const c = d.data();
    // shallow-stringify, converting Timestamps
    const flat = {};
    for (const [k, v] of Object.entries(c)) {
      if (v && v.toDate) flat[k] = ts(v);
      else if (v && typeof v === "object") flat[k] = v;
      else flat[k] = v;
    }
    console.log("────────────────────────────────────── " + d.id);
    console.log(JSON.stringify(flat, null, 1).slice(0, 2200));
    console.log("");
  }
})().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
