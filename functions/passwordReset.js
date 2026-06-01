"use strict";
//
// Password Reset — Gmail-DWD backed.
//
// Firebase Auth's built-in sendPasswordResetEmail goes through Firebase's
// default sender (noreply@datalake-production-sa.firebaseapp.com) which
// gets spam-filtered hard on Gmail and Outlook. This endpoint replaces it:
//
//   1. admin.auth().generatePasswordResetLink(email) — produces the
//      Firebase action link (oobCode-backed). Same security model, same
//      1-hour expiry; only the delivery channel changes.
//   2. sendEmailRaw(gmail, ...) — dispatches via the existing Gmail
//      domain-wide-delegation client (functions/lib/gmail.js) as the
//      shared hr@datalake.sa mailbox. Workspace-signed → SPF/DKIM/DMARC
//      pass naturally → lands in the inbox.
//   3. email_log row written (PENDING → SENT/FAILED) so the audit trail
//      sees password-reset emails alongside HR comms.
//
// This endpoint is PUBLIC (unauth) — the caller is locked out by definition.
// To avoid user-enumeration we always return 200, regardless of whether
// the email actually mapped to an account.

const admin = require("firebase-admin");
const { getGmailClient, sendEmailRaw } = require("./lib/gmail");

const db = admin.firestore();

async function generateAndSendPasswordResetHandler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  try {
    const { email } = req.body || {};
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ error: "Valid email is required" });
    }
    const cleanEmail = String(email).trim().toLowerCase();

    // Generate the Firebase password-reset link. If the user doesn't exist,
    // this throws — we swallow + return 200 so the caller can't enumerate.
    let resetLink = null;
    try {
      resetLink = await admin.auth().generatePasswordResetLink(cleanEmail, {
        url: "https://datalake-production-sa.web.app/",
        handleCodeInApp: false,
      });
    } catch (linkErr) {
      console.log(`[PasswordReset] No account or auth error for ${cleanEmail} — ${linkErr.code || linkErr.message}`);
      return res.status(200).json({ success: true });
    }

    const subject = "Reset your Datalake account password";
    const body = [
      `Hello,`,
      ``,
      `Someone requested a password reset for your Datalake account (${cleanEmail}).`,
      `If this was you, click the link below to set a new password:`,
      ``,
      `  ${resetLink}`,
      ``,
      `This link expires in 1 hour. If you didn't request this, you can safely ignore this email - your password won't change.`,
      ``,
      `For help, reply to this email and Datalake HR will respond.`,
      ``,
      `- Datalake HR`,
      ``,
      `--------------------------------------------------`,
      `Datalake Saudi Arabia LLC, Riyadh Al-Yarmouk 13243`,
      `CR: 1009194773 | NUN: 7048904952 | www.datalake.sa`,
      `PRIVATE & CONFIDENTIAL - This message contains a one-time security link.`,
    ].join("\n");

    const logRef = db.collection("email_log").doc();
    await logRef.set({
      log_id: logRef.id,
      to: cleanEmail,
      subject,
      template_id: "password_reset",
      employee_id: null,
      sent_by: "system:password_reset",
      sent_by_uid: null,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      status: "PENDING",
      ip_address: req.ip || req.headers["x-forwarded-for"] || "unknown",
      user_agent: req.headers["user-agent"] || "unknown",
    });

    try {
      const gmail = await getGmailClient();
      const result = await sendEmailRaw(gmail, cleanEmail, subject, body);
      await logRef.update({
        status: "SENT",
        gmail_message_id: result?.data?.id || null,
        sent_at: admin.firestore.FieldValue.serverTimestamp(),
      });
      return res.status(200).json({ success: true });
    } catch (sendErr) {
      await logRef.update({
        status: "FAILED",
        error: String(sendErr.message || sendErr).slice(0, 500),
        failed_at: admin.firestore.FieldValue.serverTimestamp(),
      });
      // Still 200 to avoid enumeration; the failure is in the log + Cloud Logging.
      console.error(`[PasswordReset] Gmail send failed for ${cleanEmail} — ${sendErr.message}`);
      return res.status(200).json({ success: true });
    }
  } catch (err) {
    console.error("generateAndSendPasswordReset error:", err);
    // Generic OK to avoid enumeration even on unexpected errors.
    return res.status(200).json({ success: true });
  }
}

module.exports = { generateAndSendPasswordResetHandler };
