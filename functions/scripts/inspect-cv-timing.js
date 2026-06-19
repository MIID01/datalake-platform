/**
 * Read-only. Find candidate(s) matching a name (default "lama") in talent_pool
 * and dump every timestamp/duration-ish field so we can see how long the CV
 * extraction/reformat took.
 *   cd functions && node scripts/inspect-cv-timing.js [namePart]
 */
"use strict";
const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: "datalake-production-sa" });
const db = admin.firestore();

const needle = (process.argv[2] || "lama").toLowerCase();
const T = (v) => (v && v.toDate ? v.toDate() : (v ? new Date(v) : null));

(async () => {
  const snap = await db.collection("talent_pool").get();
  const hits = snap.docs.filter((d) => {
    const c = d.data();
    const name = `${c.full_name || c.name || c.candidate_name || ""} ${c.email || ""}`.toLowerCase();
    return name.includes(needle);
  });
  console.log(`talent_pool: ${snap.size} · matching "${needle}": ${hits.length}\n`);

  for (const d of hits) {
    const c = d.data();
    console.log("────────────────────────────────── " + d.id);
    console.log("  name:  " + (c.full_name || c.name || c.candidate_name || "-"));
    console.log("  state: " + (c.state || "-"));
    // collect every key that looks like a time
    const times = {};
    for (const [k, v] of Object.entries(c)) {
      if (/_at$|_time|timestamp|date|processed|reformat|extract|uploaded|created/i.test(k)) {
        const t = T(v);
        if (t && !isNaN(t)) times[k] = t;
      }
    }
    const entries = Object.entries(times).sort((a, b) => a[1] - b[1]);
    for (const [k, t] of entries) console.log(`    ${k}: ${t.toISOString()}`);
    // pair up common start/end markers
    const pairs = [
      ["cv_upload_at", "cv_processed_at"],
      ["created_at", "cv_reformatted_at"],
      ["cv_processing_started_at", "cv_processing_completed_at"],
      ["uploaded_at", "extracted_at"],
    ];
    for (const [a, b] of pairs) {
      if (times[a] && times[b]) {
        const sec = (times[b] - times[a]) / 1000;
        console.log(`    >>> ${a} -> ${b}: ${sec.toFixed(1)}s`);
      }
    }
    // explicit duration fields
    for (const [k, v] of Object.entries(c)) {
      if (/duration|_ms$|elapsed|took/i.test(k)) console.log(`    [duration] ${k}: ${v}`);
    }
  }
})().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
