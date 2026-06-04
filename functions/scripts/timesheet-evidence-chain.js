/**
 * DoD #6 — retrieve the WHOLE evidence chain for ONE timesheet. Read-only.
 *
 *   cd functions && node scripts/timesheet-evidence-chain.js <timesheet_id>
 *
 * Assembles, in order: submitted input (per-entry table + notes) → AI validation
 * (advisory) → CTO/CEO approval snapshot (+ immutable evidence row + WORM PDF) →
 * client sign-off (signature hash + audit trail) → invoice + CEO invoice approval.
 * This is the auditor-facing "show me the input and everything that happened to it"
 * record, proving the chain is reconstructable from stored data alone.
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "datalake-production-sa" });
const db = admin.firestore();

const tsId = process.argv[2];
if (!tsId) { console.error("Usage: node scripts/timesheet-evidence-chain.js <timesheet_id>"); process.exit(1); }

const ts2s = (t) => (t && t.toDate ? t.toDate().toISOString() : (t || "—"));
const line = (s = "") => console.log(s);
const hr = () => line("─".repeat(72));

(async () => {
  const tsDoc = await db.collection("timesheets").doc(tsId).get();
  if (!tsDoc.exists) { console.error(`No timesheets/${tsId}`); process.exit(1); }
  const ts = tsDoc.data();

  hr(); line(`TIMESHEET ${tsId}`); hr();
  line(`Engineer:   ${ts.engineer_name || "—"} (${ts.engineer_email || "—"})`);
  line(`Project:    ${ts.project_name || "—"}   PO: ${ts.po_number || "—"}   Client: ${ts.client_name || "—"}`);
  line(`Period:     ${ts.period_label || "—"}    State: ${ts.state || ts.status || "—"}`);

  // 1. INPUT — per-entry table + notes
  line("\n[1] SUBMITTED INPUT (the engineer's actual entry)");
  if (ts.days && typeof ts.days === "object") {
    Object.keys(ts.days).filter(d => Number(ts.days[d] && ts.days[d].hours) > 0)
      .sort((a, b) => Number(a) - Number(b))
      .forEach(d => line(`    ${ts.period_year}-${String(ts.period_month).padStart(2, "0")}-${String(d).padStart(2, "0")}  ${String(ts.days[d].hours).padStart(4)}h  ${ts.days[d].type || ""}`));
  } else line("    (no per-day breakdown stored)");
  line(`    Totals: ${ts.total_hours || 0}h total  (in-house ${ts.in_house_hours || 0} / remote ${ts.remote_hours || 0} / leave ${ts.leave_hours || 0})`);
  line(`    Notes:  ${ts.notes || "—"}`);
  line(`    Submitted at: ${ts2s(ts.submitted_at)}`);

  // 2. AI VALIDATION (advisory)
  line("\n[2] AI VALIDATION (advisory only)");
  line(`    Status: ${ts.ai_validation_status || "—"}   Reason: ${ts.ai_validation_reason || "—"}`);

  // 3. APPROVAL SNAPSHOT + immutable evidence + WORM PDF
  line("\n[3] CTO/CEO APPROVAL");
  line(`    Approved by: ${ts.cto_action_by || "—"}   at: ${ts2s(ts.cto_action_at)}   decision: ${ts.cto_decision || "—"}`);
  if (ts.cto_approval_snapshot) {
    const s = ts.cto_approval_snapshot;
    line(`    Snapshot: ${(s.line_items || []).length} line items, total ${s.totals && s.totals.total_hours}h, approver ${s.approver_email}, at ${s.approved_at_iso}`);
  } else line("    Snapshot: (none on timesheet doc)");
  line(`    WORM PDF: ${ts.cto_approval_pdf_path || "—"}`);
  const ev = await db.collection("timesheets").doc(tsId).collection("approval_evidence").get();
  line(`    Immutable approval_evidence rows: ${ev.size}`);
  ev.docs.forEach(d => { const e = d.data(); line(`      - ${d.id}: action=${e.action} approver=${e.approver_email} at=${e.approved_at_iso}`); });

  // 4. CLIENT SIGN-OFF
  line("\n[4] CLIENT SIGN-OFF");
  line(`    Signature hash: ${ts.client_signature_hash || "—"}`);
  line(`    Method: ${ts.client_signature_method || "—"}   at: ${ts2s(ts.client_action_at)}   IP: ${ts.client_action_ip || "—"}`);
  if (Array.isArray(ts.audit_trail)) ts.audit_trail.forEach(a => line(`      trail: ${a.timestamp} ${a.event} by ${a.actor}`));

  // 5. INVOICE + CEO invoice approval
  line("\n[5] INVOICE & CEO INVOICE APPROVAL");
  let invs = await db.collection("invoices").where("timesheet_ids", "array-contains", tsId).get();
  if (invs.empty) invs = await db.collection("invoices").where("timesheet_id", "==", tsId).get();
  if (invs.empty) line("    (no invoice references this timesheet yet)");
  for (const d of invs.docs) {
    const inv = d.data();
    line(`    Invoice ${inv.invoice_number || d.id}: status=${inv.status} total=SAR ${inv.total} created_by=${inv.created_by}`);
    line(`      CEO decision: ${inv.ceo_decision || "—"} by ${inv.ceo_approved_by || "—"} at ${ts2s(inv.ceo_action_at)}`);
    line(`      Zoho synced: ${!!inv.zoho_synced}   ZATCA generated: ${!!inv.zatca_generated}`);
    const ie = await db.collection("invoices").doc(d.id).collection("approval_evidence").get();
    ie.docs.forEach(x => { const e = x.data(); line(`      invoice approval_evidence: ${e.approver_email || e.approver_name || x.id} sha256=${e.evidence_sha256 || e.evidence_sha_256 || "—"}`); });
  }
  hr(); line("END OF EVIDENCE CHAIN (read-only)"); hr();
  process.exit(0);
})().catch(e => { console.error("Failed:", e); process.exit(1); });
