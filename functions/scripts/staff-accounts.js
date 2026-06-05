/**
 * Read-only: enumerate Firebase Auth accounts + their users-doc role, password
 * provider, and current password_policies flag. Lets us pin down exactly which
 * accounts are on an admin-set password (candidates for force_expiry) before we
 * touch anything. Mutates NOTHING.
 *
 *   cd functions && node scripts/staff-accounts.js
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "datalake-production-sa" });
const db = admin.firestore();
const iso = (t) => (t && t.toDate ? t.toDate().toISOString() : "—");

const CEO_EMAIL = "m.alqumri@datalake.sa";

(async () => {
  // users docs by email → role_id
  const usersSnap = await db.collection("users").get();
  const roleByEmail = {};
  const roleByUid = {};
  usersSnap.docs.forEach(d => {
    const u = d.data();
    if (u.email) roleByEmail[u.email.toLowerCase()] = u.role_id || "—";
    roleByUid[d.id] = u.role_id || "—";
  });
  const itAdmins = usersSnap.docs.filter(d => (d.data().role_id === "it_admin")).map(d => d.data().email);
  console.log(`it_admin users: ${itAdmins.length ? itAdmins.join(", ") : "NONE"}\n`);

  // password_policies
  const polSnap = await db.collection("password_policies").get();
  const pol = {};
  polSnap.docs.forEach(d => { pol[d.id] = d.data(); });

  // Walk every Auth user
  const candidates = [];
  let pageToken;
  console.log("email".padEnd(34), "role".padEnd(10), "pw?", "self-changed?", "force_reset", "lastSignIn");
  console.log("─".repeat(110));
  do {
    const page = await admin.auth().listUsers(1000, pageToken);
    for (const u of page.users) {
      const email = (u.email || "").toLowerCase();
      const role = roleByUid[u.uid] || roleByEmail[email] || "—";
      const hasPw = u.providerData.some(p => p.providerId === "password");
      const p = pol[u.uid] || {};
      const selfChanged = p.changed_self === true;
      const isCeo = email === CEO_EMAIL;
      // Candidate = password account, not the CEO, never self-changed.
      const candidate = hasPw && !isCeo && !selfChanged;
      if (candidate) candidates.push({ uid: u.uid, email, role });
      console.log(
        email.padEnd(34),
        String(role).padEnd(10),
        (hasPw ? "yes" : "no ").padEnd(3),
        (selfChanged ? "yes" : "no ").padEnd(13),
        (p.force_reset === true ? "TRUE" : "—").padEnd(11),
        (u.metadata.lastSignInTime || "—")
      );
    }
    pageToken = page.pageToken;
  } while (pageToken);

  console.log(`\nCandidates for force_expiry (password account, not CEO, never self-changed): ${candidates.length}`);
  candidates.forEach(c => console.log(`   ${c.email}  [${c.role}]  uid=${c.uid}`));
  process.exit(0);
})().catch(e => { console.error("Failed:", e); process.exit(1); });
