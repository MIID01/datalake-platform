// functions/dealQuotes.js — CRM quote/discount approval gates (server-side).
//
// Two-gate approval for a deal's priced quote:
//   DRAFT → PENDING_FINANCE → PENDING_CEO → APPROVED   (+ REJECTED at any gate)
//
// The DRAFT and the single DRAFT→PENDING_FINANCE submit are client-writable
// (rules-constrained). EVERY transition INTO PENDING_CEO / APPROVED / REJECTED
// happens HERE on the Admin SDK (which bypasses firestore.rules) — so a client can
// never write an approved/forwarded state directly. This is the real gate; the
// firestore.rules deal_quotes block is the defense-in-depth half.
//
// Pattern mirrors functions/invoicing.js ceoApproveInvoiceHandler: verify role,
// load doc, check current status, atomic batch (flip status + pending_approvals
// row), immutable approval_evidence row, task_audit_log.

const admin = require("firebase-admin");

const db = admin.firestore();

// Verbatim mirror of src/lib/deals.js computeQuoteTotals — recomputed server-side
// so a tampered client `total_sar` is never trusted. Keep in sync with the frontend.
function computeQuoteTotals(lineItems, discountPct) {
  const items = Array.isArray(lineItems) ? lineItems : [];
  const subtotal = items.reduce((sum, li) => {
    const qty = Number(li && li.qty) || 0;
    const unit = Number(li && li.unit_price_sar) || 0;
    return sum + qty * unit;
  }, 0);
  const pct = Math.min(100, Math.max(0, Number(discountPct) || 0));
  const discount = subtotal * (pct / 100);
  const total = subtotal - discount;
  const round2 = (n) => Math.round(n * 100) / 100;
  return {
    subtotal_sar: round2(subtotal),
    discount_pct: pct,
    discount_sar: round2(discount),
    total_sar: round2(total),
  };
}

function setCors(req, res, ALLOWED_ORIGINS) {
  res.set("Access-Control-Allow-Origin", ALLOWED_ORIGINS.includes(req.headers.origin) ? req.headers.origin : "");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// Immutable evidence row — same spirit as the timesheet/invoice approval snapshots.
function buildEvidenceRow({ profile, decoded, action, decision, notes, quoteId, dealId, totals, req, now }) {
  return {
    approver_uid: decoded.uid || null,
    approver_email: profile.email || decoded.email || null,
    approver_role: profile.role_id || null,
    approved_at: now,
    approved_at_iso: new Date().toISOString(),
    action,                       // FINANCE_REVIEW_QUOTE | CEO_APPROVE_QUOTE
    decision,                     // APPROVE | REJECT
    notes: notes || null,
    quote_id: quoteId,
    deal_id: dealId || null,
    totals_snapshot: totals,      // the exact numbers signed off
    ip_address: req.ip || req.headers["x-forwarded-for"] || "unknown",
    user_agent: req.headers["user-agent"] || "unknown",
  };
}

function validateDecision(body) {
  const { quote_id, decision, notes } = body || {};
  if (!quote_id || !decision) return { error: "quote_id and decision required" };
  if (!["APPROVE", "REJECT"].includes(decision)) return { error: "decision must be APPROVE or REJECT" };
  if (decision === "REJECT" && !notes) return { error: "Rejection requires notes" };
  return { quote_id, decision, notes: notes || null };
}

// ═══════════════════════════════════════════════════════════════════
// financeReviewDealQuote — finance (or CEO) gate
// PENDING_FINANCE → PENDING_CEO (APPROVE) or REJECTED. On APPROVE, surfaces the
// quote in the CEO Approvals Hub via a pending_approvals row.
// ═══════════════════════════════════════════════════════════════════
async function financeReviewDealQuoteHandler(req, res, { verifyAuth, getUserAccessProfile, ALLOWED_ORIGINS }) {
  if (req.method === "OPTIONS") { setCors(req, res, ALLOWED_ORIGINS); return res.status(204).send(""); }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const decoded = await verifyAuth(req);
    const profile = await getUserAccessProfile(decoded.uid);
    if (!["finance", "ceo"].includes(profile.role_id)) {
      return res.status(403).json({ error: "Finance role required" });
    }

    const v = validateDecision(req.body);
    if (v.error) return res.status(400).json({ error: v.error });
    const { quote_id, decision, notes } = v;

    const quoteRef = db.collection("deal_quotes").doc(quote_id);
    const quoteDoc = await quoteRef.get();
    if (!quoteDoc.exists) return res.status(404).json({ error: "Quote not found" });
    const quote = quoteDoc.data();
    if (quote.status !== "PENDING_FINANCE") {
      return res.status(400).json({ error: `Quote is ${quote.status}, not PENDING_FINANCE` });
    }

    // Recompute authoritative totals from the stored line items (never trust client total).
    const totals = computeQuoteTotals(quote.line_items, quote.discount_pct);
    const now = admin.firestore.FieldValue.serverTimestamp();
    const newStatus = decision === "APPROVE" ? "PENDING_CEO" : "REJECTED";

    const batch = db.batch();
    batch.update(quoteRef, {
      ...totals,
      status: newStatus,
      finance_decision: decision,
      finance_reviewed_by: profile.email,
      finance_reviewed_at: now,
      finance_notes: notes,
      updated_at: now,
    });
    if (decision === "APPROVE") {
      // Surface in the CEO Approvals Hub (Hub listens on pending_approvals). Same
      // row shape as invoices so the generic ingest in Approvals.jsx picks it up.
      batch.set(db.collection("pending_approvals").doc(quote_id), {
        type: "quote",
        quote_id,
        deal_id: quote.deal_id || null,
        title: `Quote — ${quote.deal_title || quote.title || quote_id}`,
        requester: quote.created_by || profile.email,
        client: quote.client_name || "—",
        client_id: quote.client_id || null,
        amount: totals.total_sar,
        discount_pct: totals.discount_pct,
        currency: "SAR",
        created_by: profile.email,
        created_at: now,
        submitted: Date.now(),
        sla: 48,
        slaRemaining: 48,
        actions: ["Approve", "Reject"],
        icon: "🧾",
      });
    }
    await batch.commit();

    await quoteRef.collection("approval_evidence").add(buildEvidenceRow({
      profile, decoded, action: "FINANCE_REVIEW_QUOTE", decision, notes,
      quoteId: quote_id, dealId: quote.deal_id, totals, req, now,
    }));

    await db.collection("task_audit_log").add({
      event: decision === "APPROVE" ? "QUOTE_FINANCE_APPROVED" : "QUOTE_FINANCE_REJECTED",
      action_by: profile.email, action_at: now,
      details: { quote_id, deal_id: quote.deal_id || null, decision, total_sar: totals.total_sar, discount_pct: totals.discount_pct, notes },
      ip_address: req.ip || req.headers["x-forwarded-for"] || "unknown",
    });

    res.set("Access-Control-Allow-Origin", ALLOWED_ORIGINS.includes(req.headers.origin) ? req.headers.origin : "");
    return res.status(200).json({
      success: true, quote_id, new_status: newStatus,
      message: decision === "APPROVE" ? "Forwarded to CEO for approval." : "Quote rejected.",
    });
  } catch (err) {
    console.error("financeReviewDealQuote error:", err);
    return res.status(500).json({ error: "Internal server error", detail: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════
// approveDealQuote — CEO final gate
// PENDING_CEO → APPROVED (or REJECTED). Clears the pending_approvals row and
// stamps the deal with references to the approved quote.
// ═══════════════════════════════════════════════════════════════════
async function approveDealQuoteHandler(req, res, { verifyAuth, getUserAccessProfile, ALLOWED_ORIGINS }) {
  if (req.method === "OPTIONS") { setCors(req, res, ALLOWED_ORIGINS); return res.status(204).send(""); }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const decoded = await verifyAuth(req);
    const profile = await getUserAccessProfile(decoded.uid);
    if (profile.role_id !== "ceo") return res.status(403).json({ error: "CEO role required" });

    const v = validateDecision(req.body);
    if (v.error) return res.status(400).json({ error: v.error });
    const { quote_id, decision, notes } = v;

    const quoteRef = db.collection("deal_quotes").doc(quote_id);
    const quoteDoc = await quoteRef.get();
    if (!quoteDoc.exists) return res.status(404).json({ error: "Quote not found" });
    const quote = quoteDoc.data();
    if (quote.status !== "PENDING_CEO") {
      return res.status(400).json({ error: `Quote is ${quote.status}, not PENDING_CEO` });
    }

    const totals = computeQuoteTotals(quote.line_items, quote.discount_pct);
    const now = admin.firestore.FieldValue.serverTimestamp();
    const newStatus = decision === "APPROVE" ? "APPROVED" : "REJECTED";

    const batch = db.batch();
    batch.update(quoteRef, {
      ...totals,
      status: newStatus,
      ceo_decision: decision,
      ceo_approved_by: profile.email,
      ceo_action_at: now,
      ceo_notes: notes,
      approved_at: decision === "APPROVE" ? now : null,
      updated_at: now,
    });
    batch.delete(db.collection("pending_approvals").doc(quote_id));
    if (decision === "APPROVE" && quote.deal_id) {
      // Stamp the deal with REFERENCES to the approved quote (not copies of quote facts).
      batch.set(db.collection("deals").doc(quote.deal_id), {
        approved_quote_id: quote_id,
        approved_quote_total_sar: totals.total_sar,
        approved_quote_at: now,
        updated_at: now,
      }, { merge: true });
    }
    await batch.commit();

    await quoteRef.collection("approval_evidence").add(buildEvidenceRow({
      profile, decoded, action: "CEO_APPROVE_QUOTE", decision, notes,
      quoteId: quote_id, dealId: quote.deal_id, totals, req, now,
    }));

    await db.collection("task_audit_log").add({
      event: decision === "APPROVE" ? "QUOTE_CEO_APPROVED" : "QUOTE_CEO_REJECTED",
      action_by: profile.email, action_at: now,
      details: { quote_id, deal_id: quote.deal_id || null, decision, total_sar: totals.total_sar, discount_pct: totals.discount_pct, notes },
      ip_address: req.ip || req.headers["x-forwarded-for"] || "unknown",
    });

    res.set("Access-Control-Allow-Origin", ALLOWED_ORIGINS.includes(req.headers.origin) ? req.headers.origin : "");
    return res.status(200).json({
      success: true, quote_id, new_status: newStatus,
      message: decision === "APPROVE" ? "Quote approved." : "Quote rejected.",
    });
  } catch (err) {
    console.error("approveDealQuote error:", err);
    return res.status(500).json({ error: "Internal server error", detail: err.message });
  }
}

module.exports = {
  financeReviewDealQuoteHandler,
  approveDealQuoteHandler,
  computeQuoteTotals, // exported for the emulator test
};
