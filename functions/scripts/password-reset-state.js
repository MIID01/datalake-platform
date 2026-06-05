/**
 * Read-only: who is currently flagged force_reset (must change at next login).
 * Lets us confirm the forced-change gate will actually fire for the staff who
 * are sitting on a shared/temp password.
 *
 *   cd functions && node scripts/password-reset-state.js
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "datalake-production-sa" });
const db = admin.firestore();
const iso = (t) => (t && t.toDate ? t.toDate().toISOString() : "—");

(async () => {
  const snap = await db.collection("password_policies").get();
  console.log(`password_policies docs: ${snap.size}\n`);
  let flagged = 0;
  for (const d of snap.docs) {
    const p = d.data();
    let email = "—";
    try { email = (await admin.auth().getUser(d.id)).email || "—"; } catch { /* */ }
    const fr = p.force_reset === true;
    if (fr) flagged++;
    console.log(`${fr ? "🔴 FORCE_RESET" : "  ok        "}  ${email.padEnd(34)}  last_changed_at=${iso(p.last_changed_at)}  by=${p.last_changed_by || "—"}  changed_self=${p.changed_self === true}`);
  }
  console.log(`\n${flagged} account(s) currently force_reset=true (gate WILL fire for these).`);
  process.exit(0);
})().catch(e => { console.error("Failed:", e); process.exit(1); });
