/**
 * Read-only: find ALL employees whose onboarding_evidence ack rows do NOT satisfy
 * the current policy registry version (the "stale/undefined version" cohort that
 * must re-acknowledge the current text). Mirrors src/lib/policies.js derivation.
 *
 *   cd functions && node scripts/ack-affected-accounts.js
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "datalake-production-sa" });
const db = admin.firestore();

const DEFAULT_REGISTRY = [
  { id: "privacy_policy", version: "1.0" },
  { id: "pdpl_consent", version: "1.0" },
  { id: "code_of_conduct", version: "1.0" },
  { id: "infosec_awareness", version: "1.0" },
];
const normId = (v) => String(v ?? "").trim().toLowerCase();
function versionsMatch(a, b) {
  const sa = String(a ?? "").trim().toLowerCase().replace(/^v/, "");
  const sb = String(b ?? "").trim().toLowerCase().replace(/^v/, "");
  if (!sa || !sb) return false;
  if (sa === sb) return true;
  const na = Number(sa), nb = Number(sb);
  return Number.isFinite(na) && Number.isFinite(nb) && na === nb;
}
const iso = (t) => (t && t.toDate ? t.toDate().toISOString() : "—");

(async () => {
  let registry = DEFAULT_REGISTRY;
  try {
    const snap = await db.collection("platform_settings").doc("policy_registry").get();
    if (snap.exists && Array.isArray(snap.data().policies) && snap.data().policies.length) registry = snap.data().policies;
  } catch { /* defaults */ }

  const emps = await db.collection("employees").get();
  const affected = [];
  for (const e of emps.docs) {
    const ev = await e.ref.collection("onboarding_evidence").get();
    if (ev.empty) continue; // never started — separate cohort, not "stale ack"
    const rows = ev.docs.map(d => ({ _id: d.id, ...d.data() }));
    const missing = [];
    let earliestAck = null;
    for (const p of registry) {
      const row = rows.find(r => normId(r.policy_id ?? r.id) === normId(p.id));
      if (!(row && versionsMatch(row.policy_version, p.version))) missing.push(p.id);
      if (row && row.acknowledged_at && (!earliestAck || row.acknowledged_at.toMillis() < earliestAck.toMillis())) earliestAck = row.acknowledged_at;
    }
    if (missing.length) {
      affected.push({
        emp: e.id, email: e.data().email || "—",
        acked_rows: rows.length, missing_count: missing.length,
        earliest_ack: iso(earliestAck),
        sample_version: JSON.stringify(rows[0] && rows[0].policy_version),
      });
    }
  }
  console.log(`Employees scanned: ${emps.size}`);
  console.log(`Affected (have ack rows but DO NOT satisfy current version): ${affected.length}\n`);
  affected.forEach(a => console.log(`  ${a.emp.padEnd(10)} ${String(a.email).padEnd(32)} missing ${a.missing_count}/4  earliest_ack=${a.earliest_ack}  v=${a.sample_version}`));
  process.exit(0);
})().catch(e => { console.error("Failed:", e); process.exit(1); });
