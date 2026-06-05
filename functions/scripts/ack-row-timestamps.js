/**
 * Read-only: dump DLSA1007's onboarding_evidence rows with ALL timestamp/
 * provenance fields, so we can compare each row's granted_at to the
 * consent→acknowledgment relabel deploy time and decide field-RESTORE vs
 * RE-ACKNOWLEDGE. Mutates nothing.
 *
 *   cd functions && node scripts/ack-row-timestamps.js [employee_id]
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "datalake-production-sa" });
const db = admin.firestore();

const EMP = process.argv[2] || "DLSA1007";
const iso = (t) => (t && t.toDate ? t.toDate().toISOString() : (t === undefined ? "—" : JSON.stringify(t)));

(async () => {
  const ev = await db.collection("employees").doc(EMP).collection("onboarding_evidence").get();
  if (ev.empty) { console.log(`No onboarding_evidence under employees/${EMP}`); process.exit(0); }
  console.log(`employees/${EMP}/onboarding_evidence — ${ev.size} rows\n`);
  ev.docs.forEach(d => {
    const r = d.data();
    console.log(`docId=${d.id}`);
    console.log(`   policy_id        = ${JSON.stringify(r.policy_id ?? r.id)}`);
    console.log(`   policy_version   = ${JSON.stringify(r.policy_version)}`);
    console.log(`   granted_at       = ${iso(r.granted_at)}`);
    console.log(`   acknowledged_at  = ${iso(r.acknowledged_at)}`);
    console.log(`   created_at       = ${iso(r.created_at)}`);
    console.log(`   timestamp        = ${iso(r.timestamp)}`);
    // any other keys, for completeness
    const known = new Set(["policy_id","id","policy_version","granted_at","acknowledged_at","created_at","timestamp"]);
    const extra = Object.keys(r).filter(k => !known.has(k));
    if (extra.length) console.log(`   other keys: ${extra.map(k => `${k}=${iso(r[k])}`).join("  ")}`);
    console.log("");
  });
  process.exit(0);
})().catch(e => { console.error("Failed:", e); process.exit(1); });
