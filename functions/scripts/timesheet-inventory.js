/**
 * READ-ONLY inventory of every timesheet, so we can decide what is test data vs
 * real before deleting anything. Deletes NOTHING.
 *
 *   gcloud auth application-default login          # one-time, if not already
 *   cd functions && node scripts/timesheet-inventory.js
 *
 * Lists both stores:
 *   • timesheets          (per-engineer submissions — the old per-engineer flow)
 *   • project_timesheets  (consolidated monthly client sheet — the new flow)
 * For each it prints id, who/what, state, the key dates, and a TODAY? flag so the
 * "keep today's live ones + the approved ones, delete the test junk" call is easy.
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "datalake-production-sa" });
const db = admin.firestore();

const d = (t) => (t && t.toDate ? t.toDate() : (t && t._seconds ? new Date(t._seconds * 1000) : (t ? new Date(t) : null)));
const ymd = (dt) => (dt ? dt.toISOString().slice(0, 10) : "—");
const TODAY = new Date().toISOString().slice(0, 10); // server-local today
const APPROVED_STATES = ["CTO_APPROVED", "SENT_TO_CLIENT", "CLIENT_SIGNED", "INVOICED"];
const pad = (s, n) => String(s ?? "—").slice(0, n).padEnd(n);

(async () => {
  console.log(`\nTODAY = ${TODAY}  ·  (KEEP = created/submitted today OR state in ${APPROVED_STATES.join("/")})\n`);

  // ── 1. per-engineer timesheets ──
  const ts = await db.collection("timesheets").get();
  console.log(`=== timesheets (per-engineer) — ${ts.size} docs ===`);
  console.log(pad("id", 22), pad("engineer", 20), pad("project", 18), pad("period", 14), pad("state", 16), pad("submitted", 11), "KEEP?");
  let tsKeep = 0, tsCandidate = 0;
  ts.forEach((doc) => {
    const t = doc.data();
    const sub = ymd(d(t.submitted_at) || d(t.created_at));
    const keep = sub === TODAY || APPROVED_STATES.includes(t.state || t.status);
    if (keep) tsKeep++; else tsCandidate++;
    console.log(pad(doc.id, 22), pad(t.engineer_name || t.engineer_email, 20), pad(t.project_name, 18), pad(t.period_label, 14), pad(t.state || t.status, 16), pad(sub, 11), keep ? "keep" : "  -> DELETE?");
  });
  console.log(`-- keep ${tsKeep}, delete-candidates ${tsCandidate}\n`);

  // ── 2. consolidated project_timesheets ──
  const pt = await db.collection("project_timesheets").get();
  console.log(`=== project_timesheets (consolidated) — ${pt.size} docs ===`);
  console.log(pad("docId", 30), pad("project", 18), pad("period", 14), pad("state", 16), pad("assembled", 11), "KEEP?");
  let ptKeep = 0, ptCandidate = 0;
  pt.forEach((doc) => {
    const t = doc.data();
    const asm = ymd(d(t.assembled_at) || d(t.created_at));
    const keep = asm === TODAY || APPROVED_STATES.includes(t.state);
    if (keep) ptKeep++; else ptCandidate++;
    console.log(pad(doc.id, 30), pad(t.project_name, 18), pad(t.period_label, 14), pad(t.state, 16), pad(asm, 11), keep ? "keep" : "  -> DELETE?");
  });
  console.log(`-- keep ${ptKeep}, delete-candidates ${ptCandidate}\n`);

  console.log("READ-ONLY — nothing was deleted. Review the DELETE? rows, then I'll write a delete-by-id script for the ones you confirm.");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
