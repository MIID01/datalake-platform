"use strict";
//
// HR Send Email — DTLK-COMM-HR-001
//
// HR (or CEO) sends an arbitrary email from the /hr/employees panel. The
// email is dispatched via the existing Gmail domain-wide-delegation client
// (functions/lib/gmail.js) as the real m.alqumri@datalake.sa mailbox — so
// the SENT folder reflects HR's outbound communications, replies route to
// the right inbox, and SPF/DKIM/DMARC pass naturally (Workspace-signed).
//
// Every send writes an immutable email_log row used by the audit export
// and HR's own send-history view.
//

const admin = require("firebase-admin");
const { getGmailClient, sendEmailRaw } = require("./lib/gmail");

const db = admin.firestore();

// ── Built-in templates. Stored here so the UI can list/preview them
// without round-tripping; HR-customised templates live in
// tenants/{id}/templates and the UI merges them on top.
const TEMPLATES = {
  welcome_credentials: {
    id: "welcome_credentials",
    label: "Welcome / Login Credentials",
    subject: "Welcome to Datalake — your platform access",
    body: (vars) => [
      `Dear ${vars.full_name || vars.recipient_email},`,
      ``,
      `Welcome to Datalake Saudi Arabia LLC.`,
      ``,
      `Your account has been provisioned on the Datalake Platform. You may sign in at:`,
      ``,
      `  ${vars.login_url || "https://datalake-production-sa.web.app"}`,
      ``,
      `Username (email): ${vars.recipient_email}`,
      `Initial password: ${vars.temporary_password || "(set by IT — use the 'Forgot password' link to set your own)"}`,
      ``,
      `If you don't yet have a password, click "Forgot password?" on the sign-in page to set one.`,
      ``,
      `Once you sign in, please complete the onboarding flow (PDPL consent + workplace policies) before continuing.`,
      ``,
      `If you have any questions, reply to this email.`,
      ``,
      `— Datalake HR`,
      ``,
      `────────────────────────────────────────`,
      `Datalake Saudi Arabia LLC, Riyadh Al-Yarmouk 13243`,
      `CR: 1009194773 | NUN: 7048904952 | www.datalake.sa`,
      `PRIVATE & CONFIDENTIAL — This message may contain personal data processed under PDPL Art. 5.`,
    ].join("\n"),
  },
  generic: {
    id: "generic",
    label: "Blank message",
    subject: "",
    body: () => "",
  },
};

function isHrOrCeo(profile, email) {
  if (!profile && !email) return false;
  if (profile?.role_id === "ceo" || profile?.role_id === "hr") return true;
  if (email === "m.alqumri@datalake.sa") return true;
  if (email === "hr@datalake.sa" || email === "HR@datalake.sa") return true;
  return false;
}

// ═══════════════════════════════════════════════════════════════════
// HTTP — sendHrEmail
// Body: { to, subject, body, template_id?, vars?, employee_id?, cc?, bcc? }
// ═══════════════════════════════════════════════════════════════════
async function sendHrEmailHandler(req, res, { getUserAccessProfile } = {}) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });

  try {
    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) return res.status(401).json({ error: "Missing auth token" });

    const decoded = await admin.auth().verifyIdToken(authHeader.slice(7));
    const profile = (getUserAccessProfile && (await getUserAccessProfile(decoded.uid))) || null;
    if (!isHrOrCeo(profile, decoded.email)) {
      return res.status(403).json({ error: "HR or CEO only" });
    }

    const { to, subject, body, template_id, vars, employee_id, cc, bcc } = req.body || {};
    if (!to || !/^\S+@\S+\.\S+$/.test(to)) {
      return res.status(400).json({ error: "Valid 'to' email is required" });
    }

    // If a template is named, render it. Caller-supplied subject/body still
    // wins so HR can tweak the rendered text before sending.
    let resolvedSubject = subject;
    let resolvedBody = body;
    if (template_id && TEMPLATES[template_id]) {
      const tpl = TEMPLATES[template_id];
      const ctx = { recipient_email: to, login_url: "https://datalake-production-sa.web.app", ...(vars || {}) };
      if (!resolvedSubject) resolvedSubject = tpl.subject;
      if (!resolvedBody) resolvedBody = tpl.body(ctx);
    }
    if (!resolvedSubject || !resolvedBody) {
      return res.status(400).json({ error: "subject and body required (or a valid template_id)" });
    }

    const logRef = db.collection("email_log").doc();
    const baseLog = {
      log_id: logRef.id,
      to,
      cc: cc || null,
      bcc: bcc || null,
      subject: resolvedSubject,
      body_preview: String(resolvedBody).slice(0, 500),
      template_id: template_id || null,
      employee_id: employee_id || null,
      sent_by: profile?.email || decoded.email,
      sent_by_uid: decoded.uid,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      status: "PENDING",
      ip_address: req.ip || req.headers["x-forwarded-for"] || "unknown",
      user_agent: req.headers["user-agent"] || "unknown",
    };
    await logRef.set(baseLog);

    try {
      const gmail = await getGmailClient();
      const result = await sendEmailRaw(gmail, to, resolvedSubject, resolvedBody);
      await logRef.update({
        status: "SENT",
        gmail_message_id: result?.data?.id || null,
        sent_at: admin.firestore.FieldValue.serverTimestamp(),
      });
      return res.status(200).json({ success: true, log_id: logRef.id, gmail_message_id: result?.data?.id || null });
    } catch (sendErr) {
      console.error("sendHrEmail Gmail send failed:", sendErr);
      await logRef.update({
        status: "FAILED",
        error: String(sendErr.message || sendErr).slice(0, 500),
        failed_at: admin.firestore.FieldValue.serverTimestamp(),
      });
      return res.status(502).json({ error: "Email send failed: " + (sendErr.message || "unknown") });
    }
  } catch (err) {
    console.error("sendHrEmail error:", err);
    return res.status(500).json({ error: err.message || "Internal error" });
  }
}

// HTTP — listEmailTemplates: tiny convenience for the UI dropdown.
async function listEmailTemplatesHandler(req, res) {
  try {
    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) return res.status(401).json({ error: "Missing auth token" });
    await admin.auth().verifyIdToken(authHeader.slice(7));
    const list = Object.values(TEMPLATES).map(t => ({ id: t.id, label: t.label, subject: t.subject }));
    return res.status(200).json({ templates: list });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Internal error" });
  }
}

module.exports = { sendHrEmailHandler, listEmailTemplatesHandler, TEMPLATES };
