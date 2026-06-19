"use strict";
/**
 * Project-timesheet client sign-off — two paths, one mechanism:
 *   A) Client portal (authenticated client) — signs while logged in.
 *   B) Emailed secure link (no login) — a one-time token in the URL.
 * Both converge on: record an immutable evidence row + flip the timesheet to
 * CLIENT_SIGNED (the invoiceable state). Chain:
 *   DRAFT → SUBMITTED → CTO_APPROVED → SENT_TO_CLIENT → CLIENT_SIGNED → INVOICED
 *
 * Signature = typed name + explicit affirmation + IP + user-agent + server time
 * (a valid e-signature; lean, no canvas). Evidence is written Admin-side and is
 * immutable via firestore.rules.
 */
const admin = require("firebase-admin");
const crypto = require("crypto");
const { getGmailClient } = require("./lib/gmail");
const { COMPANY } = require("./lib/company-legal");

const db = admin.firestore();
const APP_URL = "https://datalake-production-sa.web.app";
const SIGNABLE = ["CTO_APPROVED", "SENT_TO_CLIENT"];

function summaryOf(t) {
  const rows = (t.rows || []).map((r) => ({
    role: r.role || "",
    total: Object.values(r.days || {}).filter((v) => v === "INHOUSE" || v === "REMOTE").length,
  }));
  return {
    project_name: t.project_name || "", client_name: t.client_name || "",
    period_label: t.period_label || "", po_number: t.po_number || "", state: t.state,
    rows, additional_billable: t.additional_billable || [],
  };
}

function cors(res) {
  res.set("Access-Control-Allow-Origin", APP_URL);
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// ── 1) Send the approved timesheet to the client for signature (authed) ──
async function sendTimesheetToClientHandler(req, res, { verifyAuth, getUserAccessProfile }) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const decoded = await verifyAuth(req);
    const profile = await getUserAccessProfile(decoded.uid);
    if (!["ceo", "business", "sales", "hr"].includes(profile.role_id)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { docId, client_email } = req.body || {};
    if (!docId) return res.status(400).json({ error: "docId required" });
    const ref = db.collection("project_timesheets").doc(docId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Timesheet not found" });
    const t = snap.data();
    if (!SIGNABLE.includes(t.state)) return res.status(400).json({ error: "Timesheet must be internally approved (CTO/CEO) first." });

    let to = (client_email || "").trim();
    if (!to && t.client_id) {
      const c = await db.collection("clients").doc(t.client_id).get();
      if (c.exists) to = c.data().contact_email || "";
    }
    if (!to) return res.status(400).json({ error: "No client email on file — add one on the client record or pass client_email." });

    const token = crypto.randomBytes(24).toString("hex");
    await ref.update({
      sign_token: token,
      sign_token_expires: Date.now() + 1000 * 60 * 60 * 24 * 14, // 14 days
      sign_sent_to: to, sign_sent_by: profile.email,
      sign_sent_at: admin.firestore.FieldValue.serverTimestamp(),
      state: "SENT_TO_CLIENT",
    });

    const link = `${APP_URL}/sign-timesheet/${docId}?t=${token}`;
    const html =
      `<p>Dear ${t.client_name || "Client"},</p>` +
      `<p>Please review and sign the <b>${t.period_label}</b> timesheet for <b>${t.project_name}</b> (PO ${t.po_number || "—"}).</p>` +
      `<p><a href="${link}" style="background:#022873;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">Review &amp; sign the timesheet</a></p>` +
      `<p style="font-size:12px;color:#666">Or paste this link: ${link}<br>This link expires in 14 days.</p>` +
      `<p>${COMPANY.legal_name_en}</p>`;
    const raw = Buffer.from(
      `From: ${COMPANY.legal_name_en} <hr@datalake.sa>\r\nTo: ${to}\r\n` +
      `Subject: Timesheet for signature — ${t.project_name} (${t.period_label})\r\n` +
      `MIME-Version: 1.0\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n${html}`
    ).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const gmail = await getGmailClient();
    await gmail.users.messages.send({ userId: "hr@datalake.sa", requestBody: { raw } });

    return res.json({ ok: true, sent_to: to });
  } catch (e) {
    console.error("sendTimesheetToClient:", e);
    return res.status(500).json({ error: e.message });
  }
}

// ── 2) Get summary (token OR authed client) + record the signature ──
async function signProjectTimesheetHandler(req, res, { verifyAuth, getUserAccessProfile }) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).send("");

  const docId = req.body?.docId || req.query?.docId;
  const token = req.body?.token || req.query?.t;
  if (!docId) return res.status(400).json({ error: "docId required" });
  const ref = db.collection("project_timesheets").doc(docId);
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ error: "Timesheet not found" });
  const t = snap.data();

  // Resolve the signer: a valid token, or an authenticated client of this account.
  const resolveSigner = async () => {
    if (token) {
      if (token !== t.sign_token) return { error: "Invalid or used link." };
      if (t.sign_token_expires && Date.now() > t.sign_token_expires) return { error: "This signing link has expired." };
      return { ok: true, via: "token", email: t.sign_sent_to || "", uid: null };
    }
    try {
      const decoded = await verifyAuth(req);
      const profile = await getUserAccessProfile(decoded.uid);
      const isCeo = profile.role_id === "ceo";
      const isOwningClient = profile.role_id === "client" && profile.client_id && profile.client_id === t.client_id;
      if (!isCeo && !isOwningClient) return { error: "Forbidden" };
      return { ok: true, via: "portal", email: decoded.email || "", uid: decoded.uid };
    } catch (e) {
      return { error: "Sign in or use the emailed link to sign." };
    }
  };

  try {
    if (req.method === "GET") {
      const s = await resolveSigner();
      if (s.error) return res.status(403).json({ error: s.error });
      return res.json({ ok: true, summary: summaryOf(t) });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const s = await resolveSigner();
    if (s.error) return res.status(403).json({ error: s.error });
    if (!SIGNABLE.includes(t.state)) return res.status(400).json({ error: `Already ${t.state} — cannot sign again.` });

    const signer_name = String(req.body?.signer_name || "").trim();
    const affirm = req.body?.affirm === true;
    if (!signer_name || !affirm) return res.status(400).json({ error: "Your name and the affirmation are required." });

    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.ip || "";
    const ua = req.headers["user-agent"] || "";
    const now = admin.firestore.FieldValue.serverTimestamp();
    await ref.collection("approval_evidence").add({
      action: "CLIENT_SIGN_TIMESHEET", label: `Client signature — ${t.period_label}`,
      signer_name, signer_email: s.email || null, signer_uid: s.uid || null, signer_via: s.via,
      signed_at: now, ip_address: ip, user_agent: ua, affirmation: true, typed_name: signer_name,
      parent_collection: "project_timesheets", parent_id: docId,
    });
    await ref.update({
      state: "CLIENT_SIGNED",
      client_signed_by: s.email || signer_name, client_signer_name: signer_name,
      client_signed_via: s.via, client_signed_at: now,
      sign_token: admin.firestore.FieldValue.delete(),
    });
    return res.json({ ok: true });
  } catch (e) {
    console.error("signProjectTimesheet:", e);
    return res.status(500).json({ error: e.message });
  }
}

module.exports = { sendTimesheetToClientHandler, signProjectTimesheetHandler };
