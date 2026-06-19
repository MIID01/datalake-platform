"use strict";
const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: "datalake-production-sa" });
const db = admin.firestore();
const { BigQuery } = require("@google-cloud/bigquery");

(async () => {
  // 1) talent_pool names
  const tp = await db.collection("talent_pool").get();
  console.log(`=== talent_pool (${tp.size}) ===`);
  tp.docs.forEach((d) => {
    const c = d.data();
    console.log(`  ${d.id}: name="${c.full_name || c.name || c.candidate_name || "-"}" state=${c.state || "-"}`);
  });

  // 2) other CV-ish collections
  for (const col of ["interview_cvs", "prepared_cvs", "cv_uploads", "cvs", "candidates"]) {
    try {
      const s = await db.collection(col).limit(10).get();
      if (s.size) {
        console.log(`\n=== ${col} (${s.size}) ===`);
        s.docs.forEach((d) => {
          const c = d.data();
          console.log(`  ${d.id}: ${JSON.stringify(Object.fromEntries(Object.entries(c).filter(([k]) => /name|file|_at|status|state/i.test(k)))).slice(0, 200)}`);
        });
      }
    } catch (_) {}
  }

  // 3) recent AI audit rows (OCR + LLM durations)
  try {
    const bq = new BigQuery({ projectId: "datalake-production-sa" });
    const [rows] = await bq.query({
      query: `SELECT timestamp, agent_name, action_type, input_type, output_action,
                     inference_time_ms, model_name
              FROM \`datalake-production-sa.datalake_audit.ai_actions\`
              ORDER BY timestamp DESC LIMIT 15`,
    });
    console.log(`\n=== ai_actions (last 15) ===`);
    rows.forEach((r) => {
      const ts = r.timestamp && r.timestamp.value ? r.timestamp.value : r.timestamp;
      console.log(`  ${ts} | ${r.agent_name}/${r.action_type} | ${r.input_type} | ${r.inference_time_ms}ms | ${r.model_name} | ${r.output_action}`);
    });
  } catch (e) {
    console.log("\nBQ query failed: " + e.message);
  }
})().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
