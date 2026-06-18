"use strict";
// Diagnose why an engineer sees "no active project assignment".
// Usage: node scripts/diagnose-assignments.js <engineer-email>
const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: "datalake-production-sa" });
const db = admin.firestore();

(async () => {
  const email = (process.argv[2] || "").trim();
  if (!email) { console.error("Pass an email: node scripts/diagnose-assignments.js a@datalake.sa"); process.exit(1); }
  const emailLc = email.toLowerCase();
  console.log(`\n=== Login email: "${email}" (lc: "${emailLc}") ===`);

  // employees match
  for (const e of [email, emailLc]) {
    const q = await db.collection("employees").where("email", "==", e).limit(2).get();
    console.log(`employees where email=="${e}": ${q.size}`, q.docs.map(d => ({ id: d.id, employee_id: d.data().employee_id, email: d.data().email })));
  }

  // assignments — ALL for this person, any status, matched loosely
  const all = await db.collection("engineer_project_assignments").get();
  const mine = all.docs.filter(d => {
    const a = d.data();
    return [a.engineer_email, (a.engineer_email || "").toLowerCase()].includes(emailLc)
      || (a.engineer_email || "") === email;
  });
  console.log(`\n=== engineer_project_assignments loosely matching this email: ${mine.length} ===`);
  mine.forEach(d => {
    const a = d.data();
    console.log(`  ${d.id}: project=${a.project_id} status="${a.status}" engineer_email="${a.engineer_email}" engineer_id="${a.engineer_id}"`);
  });

  // total assignments + distinct statuses (catch a status-value drift)
  const statuses = {};
  all.docs.forEach(d => { const s = String(d.data().status); statuses[s] = (statuses[s] || 0) + 1; });
  console.log(`\n=== ALL assignments: ${all.size}; status values seen:`, statuses);
})().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
