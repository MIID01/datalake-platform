// functions/deals.js — CRM deal-side server actions.
//
// sendDealEmail: send an email from a deal via Workspace domain-wide delegation
// (gmail.js) and log it as an immutable EMAIL activity on the deal timeline.
// Role-gated to the CRM audience (ceo / business / sales) — the same audience
// firestore.rules grants on /deals.
//
// NOTE: gmail.js DWD currently impersonates hr@datalake.sa, so deal mail sends
// FROM the HR mailbox. Sending as the deal owner would need the DWD `sub`
// extended to the owner's mailbox (flagged follow-up, not in Phase 1).

const admin = require("firebase-admin");
const { getGmailClient, sendEmailRaw } = require("./lib/gmail");

const db = admin.firestore();
const CRM_ROLES = ["ceo", "business", "sales"];

async function sendDealEmailHandler(req, res, { verifyAuth, getUserAccessProfile, ALLOWED_ORIGINS }) {
  const origin = req.headers.origin;
  res.set("Access-Control-Allow-Origin", ALLOWED_ORIGINS && ALLOWED_ORIGINS.includes(origin) ? origin : "");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const decoded = await verifyAuth(req);
    const profile = await getUserAccessProfile(decoded.uid);
    if (!CRM_ROLES.includes(profile.role_id)) {
      return res.status(403).json({ error: "CRM role required (ceo/business/sales)" });
    }

    const { deal_id, to, subject, body } = req.body || {};
    if (!deal_id || !to || !subject || !body) {
      return res.status(400).json({ error: "deal_id, to, subject, body are required" });
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(to).trim())) {
      return res.status(400).json({ error: "Invalid recipient email" });
    }

    const dealRef = db.collection("deals").doc(deal_id);
    const dealSnap = await dealRef.get();
    if (!dealSnap.exists) return res.status(404).json({ error: "Deal not found" });

    // Send via Workspace DWD (from hr@datalake.sa).
    const gmail = await getGmailClient();
    const sendRes = await sendEmailRaw(gmail, String(to).trim(), String(subject), String(body));

    // Immutable EMAIL activity on the deal timeline.
    await dealRef.collection("deal_activities").add({
      type: "EMAIL",
      direction: "OUTBOUND",
      body: String(body),
      email_to: String(to).trim(),
      email_subject: String(subject),
      email_message_id: sendRes?.id || sendRes?.data?.id || null,
      sent_from: "hr@datalake.sa",
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      created_by: decoded.email || profile.email || "unknown",
      created_by_uid: decoded.uid,
    });
    await dealRef.set({ last_activity_at: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("sendDealEmail error:", err);
    return res.status(500).json({ error: "Internal server error", detail: err.message });
  }
}

module.exports = { sendDealEmailHandler };
