/**
 * One flag, full cleanup. Sweeps every doc flagged { _test: true } across the
 * test-bearing collections, AND deletes the test engineer account (Firestore doc
 * + its Firebase Auth user).
 *
 *   cd functions && node scripts/cleanup-test-data.js           # DRY-RUN (lists, deletes nothing)
 *   cd functions && node scripts/cleanup-test-data.js --apply   # actually delete
 *
 * Safety: dry-run by default; an EMKAN mis-flag guard refuses to delete anything
 * whose data mentions EMKAN (the real client), so a stray _test:true on a real
 * record can't wipe production data. Every deletion is logged.
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "datalake-production-sa" });
const db = admin.firestore();

const APPLY = process.argv.includes("--apply");

// Plain data collections — delete the matching docs.
const DATA_COLLECTIONS = ["invoices", "pending_approvals", "timesheets", "projects", "clients"];
// Identity collections — delete the doc AND the linked Firebase Auth user.
const IDENTITY_COLLECTIONS = ["users", "employees"];

// HARD requirement to delete: a positive, structural test marker — NOT just the
// _test flag. A real record (any client, not only EMKAN) that gets a stray
// _test:true is still unwipeable because it won't carry a TEST_DO_NOT_BILL status
// or a TEST- id. Both conditions (flag + marker) must hold.
// Markers: TEST- prefix, a "-TEST-" segment (covers TS-TEST-*/PRJ-TEST-* ids —
// a real id like TS-2026-05-... never contains "-TEST-"), or an explicit
// TEST_DO_NOT_BILL status. A real record would need _test:true AND one of these,
// which it structurally never has.
const hasTestMarker = (id, data) =>
  id.startsWith("TEST-") || id.includes("-TEST-") || (data && data.status === "TEST_DO_NOT_BILL");
// Belt-and-suspenders: never touch anything mentioning the real client.
const mentionsEmkan = (data) => JSON.stringify(data || {}).toLowerCase().includes("emkan");

(async () => {
  console.log(APPLY ? "═══ APPLY — deleting all _test:true data ═══\n" : "═══ DRY-RUN — nothing deleted (re-run with --apply) ═══\n");
  let deleted = 0, skipped = 0, authDeleted = 0;
  const seenUids = new Set();

  // 1. Data collections
  for (const col of DATA_COLLECTIONS) {
    const snap = await db.collection(col).where("_test", "==", true).get();
    if (snap.empty) { console.log(`${col}: none`); continue; }
    console.log(`${col}: ${snap.size} flagged`);
    for (const d of snap.docs) {
      const data = d.data();
      if (!hasTestMarker(d.id, data)) { console.log(`  ⚠ SKIP ${col}/${d.id} — _test:true but NO test marker (id not TEST-*, status!="TEST_DO_NOT_BILL"). Refusing.`); skipped++; continue; }
      if (mentionsEmkan(data)) { console.log(`  ⚠ SKIP ${col}/${d.id} — mentions EMKAN. Refusing.`); skipped++; continue; }
      console.log(`  ${APPLY ? "✗ deleted" : "would delete"} ${col}/${d.id}`);
      if (APPLY) await d.ref.delete();
      deleted++;
    }
  }

  // 2. Identity collections — Firestore doc + Auth user
  for (const col of IDENTITY_COLLECTIONS) {
    const snap = await db.collection(col).where("_test", "==", true).get();
    if (snap.empty) { console.log(`${col}: none`); continue; }
    console.log(`${col}: ${snap.size} flagged`);
    for (const d of snap.docs) {
      const data = d.data();
      if (!hasTestMarker(d.id, data)) { console.log(`  ⚠ SKIP ${col}/${d.id} — _test:true but NO test marker (id not TEST-*, status!="TEST_DO_NOT_BILL"). Refusing.`); skipped++; continue; }
      if (mentionsEmkan(data)) { console.log(`  ⚠ SKIP ${col}/${d.id} — mentions EMKAN. Refusing.`); skipped++; continue; }
      // Resolve the Auth uid: explicit uid field, or the users doc id, or by email.
      let uid = data.uid || (col === "users" ? d.id : null);
      if (!uid && data.email) { try { uid = (await admin.auth().getUserByEmail(data.email)).uid; } catch { /* no auth user */ } }
      console.log(`  ${APPLY ? "✗ deleted" : "would delete"} ${col}/${d.id}  (email=${data.email || "?"} uid=${uid || "?"})`);
      if (APPLY) await d.ref.delete();
      deleted++;
      if (uid && !seenUids.has(uid)) {
        seenUids.add(uid);
        console.log(`    ${APPLY ? "✗ deleted" : "would delete"} Auth user ${uid}`);
        if (APPLY) { try { await admin.auth().deleteUser(uid); authDeleted++; } catch (e) { console.log(`    (auth delete failed: ${e.message})`); } }
        else authDeleted++;
      }
    }
  }

  console.log(`\n${APPLY ? "DELETED" : "WOULD DELETE"}: ${deleted} doc(s) + ${authDeleted} Auth user(s).  Skipped (EMKAN guard): ${skipped}.`);
  if (!APPLY) console.log("Re-run with --apply to perform the deletion.");
  process.exit(0);
})().catch(e => { console.error("Failed:", e); process.exit(1); });
