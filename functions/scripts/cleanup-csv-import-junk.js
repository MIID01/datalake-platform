/**
 * Clean up the junk lead/deal records created by the un-validated CSV lead
 * import (CRM Phase-1). That import blind-matched headers against a fixed
 * allowlist; a CSV whose real data lived in an unrecognised column (e.g. "a1"
 * holding a URL) had ALL its content dropped, and the title fallback
 * (`... || 'Imported lead'`) then wrote a placeholder row for every CSV line —
 * thousands of empty-content deals.
 *
 *   cd functions && node scripts/cleanup-csv-import-junk.js           # DRY-RUN (counts + sample, deletes nothing)
 *   cd functions && node scripts/cleanup-csv-import-junk.js --apply   # actually delete the junk batch
 *
 * SAFETY — junk is defined by ABSENCE of any real content, not by source alone:
 *   junk  ⇔  source == 'CSV_IMPORT'
 *            AND no real title (empty OR the exact 'Imported lead' placeholder)
 *            AND no company_name
 *            AND no contact_name / contact_email / contact_phone
 *            AND value_sar is 0 / non-positive
 *   …and, as belt-and-suspenders, the deal must have NO hard linkage:
 *            no client_id, no won_client_id, no approved_quote_id, and ZERO
 *            deal_activities subdocs.
 * A stage of WON/LOST alone does NOT save a row — the broken batch produced 6
 * empty placeholders that got an accidental Won/Lost click; those carry no real
 * content and no linkage, so they ARE junk (CEO-approved 2026-06-11). A
 * genuinely worked lead always carries real content OR a client/quote/activity
 * link, so it can never match. Anything that is CSV_IMPORT but DOES carry
 * content or linkage is reported as KEPT and never touched. Every decision is
 * logged; dry-run is the default.
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "datalake-production-sa" });
const db = admin.firestore();

const APPLY = process.argv.includes("--apply");
// Also sweep empty/no-linkage rows whose ONLY "work" is throw-away activities
// (e.g. the CEO's own "test call" / "test note" pokes on a junk placeholder).
// When set, those rows AND their deal_activities subdocs are deleted. Without
// it, any row carrying an activity is preserved for manual review.
const SWEEP_ACTIVITY = process.argv.includes("--include-activity-junk");

const isBlank = (v) => v == null || String(v).trim() === "";
const PLACEHOLDER_TITLE = "imported lead"; // the fallback the broken import wrote

// Does this deal carry ANY real, human-meaningful content?
function hasRealContent(d) {
  const title = String(d.title || "").trim();
  const titleReal = title !== "" && title.toLowerCase() !== PLACEHOLDER_TITLE;
  return (
    titleReal ||
    !isBlank(d.company_name) ||
    !isBlank(d.contact_name) ||
    !isBlank(d.contact_email) ||
    !isBlank(d.contact_phone) ||
    (Number(d.value_sar) || 0) > 0
  );
}

// Hard linkage = this deal is wired into real account/quote/activity data and
// must never be auto-deleted, regardless of content. (Stage alone is NOT hard
// linkage — a misclicked Won/Lost on an empty placeholder is still junk.)
function hasHardLinkage(d) {
  return (
    !isBlank(d.client_id) ||
    !isBlank(d.won_client_id) ||
    !isBlank(d.approved_quote_id)
  );
}

(async () => {
  console.log(
    APPLY
      ? "═══ APPLY — deleting CSV_IMPORT junk deals ═══\n"
      : "═══ DRY-RUN — nothing deleted (re-run with --apply) ═══\n"
  );

  // Before: total deals, and the CSV_IMPORT slice.
  const totalBefore = (await db.collection("deals").count().get()).data().count;
  const snap = await db.collection("deals").where("source", "==", "CSV_IMPORT").get();
  console.log(`deals total: ${totalBefore}`);
  console.log(`deals where source==CSV_IMPORT: ${snap.size}\n`);

  const junk = [];
  const kept = [];
  const linkedButEmpty = []; // empty content yet wired to client/quote/activity — KEEP, flag
  const byDay = {}; // junk grouped by import day
  const byCreator = {}; // junk grouped by created_by

  for (const doc of snap.docs) {
    const d = doc.data();
    if (hasRealContent(d)) { kept.push({ id: doc.id, d }); continue; }
    if (hasHardLinkage(d)) { linkedButEmpty.push({ id: doc.id, d }); continue; }
    // Activity timeline: preserve by default; sweep (with cascade) under the flag.
    const acts = await doc.ref.collection("deal_activities").get();
    if (!acts.empty && !SWEEP_ACTIVITY) { linkedButEmpty.push({ id: doc.id, d }); continue; }

    junk.push({ ref: doc.ref, id: doc.id, d, activityRefs: acts.docs.map((a) => a.ref) });
    const day = tsToDay(d.created_at);
    byDay[day] = (byDay[day] || 0) + 1;
    const who = d.created_by || "unknown";
    byCreator[who] = (byCreator[who] || 0) + 1;
  }

  console.log(`Classification of the ${snap.size} CSV_IMPORT deals:`);
  console.log(`  JUNK (empty content, no linkage): ${junk.length}`);
  console.log(`  KEPT (real content):              ${kept.length}`);
  console.log(`  KEPT (empty but client/quote-linked): ${linkedButEmpty.length}\n`);

  if (junk.length) {
    console.log("Junk grouped by import day (created_at):");
    Object.entries(byDay).sort().forEach(([day, n]) => console.log(`  ${day}: ${n}`));
    console.log("Junk grouped by created_by:");
    Object.entries(byCreator).forEach(([who, n]) => console.log(`  ${who}: ${n}`));

    console.log("\nSample of 10 JUNK rows that WOULD be deleted:");
    junk.slice(0, 10).forEach(({ id, d }) =>
      console.log(`  ${id}  title=${JSON.stringify(d.title)} company=${JSON.stringify(d.company_name)} value=${d.value_sar} created=${tsToDay(d.created_at)}`)
    );
  }

  if (kept.length) {
    console.log("\nSample of up to 5 KEPT (real content) CSV imports — PRESERVED:");
    kept.slice(0, 5).forEach(({ id, d }) =>
      console.log(`  ${id}  title=${JSON.stringify(d.title)} company=${JSON.stringify(d.company_name)} value=${d.value_sar}`)
    );
  }
  if (linkedButEmpty.length) {
    console.log("\nKEPT — empty content but wired to a client/quote/activity (review manually):");
    linkedButEmpty.slice(0, 10).forEach(({ id, d }) =>
      console.log(`  ${id}  stage=${d.stage} client_id=${d.client_id || "-"} won_client_id=${d.won_client_id || "-"} quote=${d.approved_quote_id || "-"}`)
    );
  }

  if (!APPLY) {
    console.log(`\nDRY-RUN complete. ${junk.length} junk deal(s) WOULD be deleted; ${kept.length + linkedButEmpty.length} CSV import(s) preserved.`);
    console.log("Re-run with --apply to delete the junk batch.");
    process.exit(0);
  }

  // APPLY — delete junk via BulkWriter (handles thousands efficiently).
  const actCount = junk.reduce((s, j) => s + (j.activityRefs?.length || 0), 0);
  console.log(`\nDeleting ${junk.length} junk deal(s)${actCount ? ` + ${actCount} cascaded activity subdoc(s)` : ""}…`);
  const writer = db.bulkWriter();
  let deleted = 0;
  for (const { ref, activityRefs } of junk) {
    for (const a of activityRefs || []) writer.delete(a).catch((e) => console.log(`  activity delete failed ${a.id}: ${e.message}`));
    writer.delete(ref).then(() => { deleted++; }).catch((e) => console.log(`  delete failed ${ref.id}: ${e.message}`));
  }
  await writer.close();

  const totalAfter = (await db.collection("deals").count().get()).data().count;
  console.log(`\nDELETED: ${deleted} junk deal(s).`);
  console.log(`deals total BEFORE: ${totalBefore}  →  AFTER: ${totalAfter}  (removed ${totalBefore - totalAfter}).`);
  console.log(`Preserved: ${kept.length + linkedButEmpty.length} CSV import(s) with real content / linkage.`);
  process.exit(0);
})().catch((e) => { console.error("Failed:", e); process.exit(1); });

function tsToDay(ts) {
  try {
    if (ts && typeof ts.toDate === "function") return ts.toDate().toISOString().slice(0, 10);
  } catch { /* ignore */ }
  return "unknown";
}
