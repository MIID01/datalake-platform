"use strict";
//
// Auth Account Audit + Provision
//
// Every row in `users` should have a matching Firebase Auth account, or
// the user literally can't sign in. This module exposes two HTTP endpoints
// (HR/CEO gated):
//
//   auditAuthAccounts          — Read-only diff. For every users/{id}
//                                row, calls admin.auth().getUserByEmail
//                                and reports who's missing vs present.
//
//   provisionMissingAuthAccount — Creates a Firebase Auth user for a
//                                specific email with a generated temp
//                                password, fires our Gmail-DWD welcome /
//                                credentials email so the new user gets
//                                a working sign-in path. Idempotent: if
//                                an Auth account already exists, returns
//                                its uid and skips the create.
//
// The dispatch path goes through the existing sendHrEmail template so
// the new account email uses the same hr-branded format with SPF/DKIM
// pass.

const admin = require("firebase-admin");
const { getGmailClient, sendEmailRaw } = require("./lib/gmail");

const db = admin.firestore();

function isHrOrCeo(profile, email) {
  if (profile?.role_id === "ceo" || profile?.role_id === "hr") return true;
  if (email === "m.alqumri@datalake.sa") return true;
  if (email === "hr@datalake.sa" || email === "HR@datalake.sa") return true;
  return false;
}

// Generate a temp password meeting Firebase's "strong" rule (>=6 chars).
// We use 14 chars from a URL-safe alphabet — enough entropy that brute
// force is uninteresting; the user is meant to use "Forgot password" or
// the reset link in the email to set their own.
function generateTempPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 14; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// HTTP — auditAuthAccounts
// GET → { total, missing: [{ email, employee_id, display_name }],
//         present: [{ email, uid }], scanned_at }
// ═══════════════════════════════════════════════════════════════════
async function auditAuthAccountsHandler(req, res, { getUserAccessProfile } = {}) {
  try {
    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) return res.status(401).json({ error: "Missing auth token" });
    const decoded = await admin.auth().verifyIdToken(authHeader.slice(7));
    const profile = (getUserAccessProfile && (await getUserAccessProfile(decoded.uid))) || null;
    if (!isHrOrCeo(profile, decoded.email)) return res.status(403).json({ error: "HR or CEO only" });

    const snap = await db.collection("users").get();
    const missing = [];
    const present = [];
    const inactive = [];

    // For each users row, try to load the Firebase Auth account.
    // admin.auth().getUserByEmail rate-limits at ~100 QPS per project —
    // serial is fine for our scale (low dozens).
    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      const email = String(data.email || "").toLowerCase();
      if (!email) continue;
      if (data.status === "disabled") {
        inactive.push({ id: docSnap.id, email, display_name: data.display_name || null });
        continue;
      }
      try {
        const authUser = await admin.auth().getUserByEmail(email);
        present.push({
          id: docSnap.id,
          email,
          uid: authUser.uid,
          display_name: data.display_name || authUser.displayName || null,
          role_id: data.role_id || null,
          disabled: authUser.disabled === true,
        });
      } catch (err) {
        if (err.code === "auth/user-not-found") {
          missing.push({
            id: docSnap.id,
            email,
            employee_id: data.employee_id || null,
            display_name: data.display_name || null,
            role_id: data.role_id || null,
          });
        } else {
          console.error(`[AuthAudit] Unexpected error for ${email}:`, err.message);
        }
      }
    }

    return res.status(200).json({
      total: snap.size,
      present_count: present.length,
      missing_count: missing.length,
      inactive_count: inactive.length,
      missing,
      present,
      inactive,
      scanned_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("auditAuthAccounts error:", err);
    return res.status(500).json({ error: err.message || "Internal error" });
  }
}

// ═══════════════════════════════════════════════════════════════════
// HTTP — provisionMissingAuthAccount
// Body: { email, send_welcome?: true } → creates the Firebase Auth
//       account with a generated temp password. If an account already
//       exists, returns its uid (idempotent). Optionally fires our
//       Gmail-DWD welcome email so the new user gets a working
//       sign-in path (instructs them to click "Forgot password?" to
//       set their own).
// ═══════════════════════════════════════════════════════════════════
async function provisionMissingAuthAccountHandler(req, res, { getUserAccessProfile } = {}) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  try {
    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) return res.status(401).json({ error: "Missing auth token" });
    const decoded = await admin.auth().verifyIdToken(authHeader.slice(7));
    const profile = (getUserAccessProfile && (await getUserAccessProfile(decoded.uid))) || null;
    if (!isHrOrCeo(profile, decoded.email)) return res.status(403).json({ error: "HR or CEO only" });

    const { email, send_welcome = true } = req.body || {};
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ error: "Valid email is required" });
    }
    const cleanEmail = String(email).trim().toLowerCase();

    // Resolve display_name from the users doc if we can find one.
    let display_name = null;
    const usersQ = await db.collection("users").where("email", "==", cleanEmail).limit(1).get();
    if (!usersQ.empty) display_name = usersQ.docs[0].data().display_name || null;
    if (!display_name) {
      const empQ = await db.collection("employees").where("email", "==", cleanEmail).limit(1).get();
      if (!empQ.empty) display_name = empQ.docs[0].data().full_name || null;
    }

    // Idempotent: if the account already exists, return it.
    try {
      const existing = await admin.auth().getUserByEmail(cleanEmail);
      return res.status(200).json({
        success: true,
        already_existed: true,
        uid: existing.uid,
        email: cleanEmail,
        note: "Auth account already exists; nothing to create.",
      });
    } catch (lookupErr) {
      if (lookupErr.code !== "auth/user-not-found") {
        return res.status(500).json({ error: lookupErr.message || "Auth lookup failed" });
      }
    }

    // Create the new Auth account.
    const tempPassword = generateTempPassword();
    const newUser = await admin.auth().createUser({
      email: cleanEmail,
      password: tempPassword,
      displayName: display_name || undefined,
      emailVerified: false,
    });

    await db.collection("task_audit_log").add({
      event: "AUTH_ACCOUNT_PROVISIONED",
      action_by: profile?.email || decoded.email,
      action_at: admin.firestore.FieldValue.serverTimestamp(),
      details: { email: cleanEmail, new_uid: newUser.uid },
      ip_address: req.ip || req.headers["x-forwarded-for"] || "unknown",
    });

    // Optionally email the new user a welcome + reset-link prompt.
    let emailResult = null;
    if (send_welcome) {
      const subject = "Welcome to Datalake - your platform access";
      const body = [
        `Dear ${display_name || cleanEmail},`,
        ``,
        `Welcome to Datalake Saudi Arabia LLC.`,
        ``,
        `Your account has been provisioned on the Datalake Platform. To sign in:`,
        ``,
        `  1. Go to https://datalake-production-sa.web.app`,
        `  2. Enter your email: ${cleanEmail}`,
        `  3. Click "Forgot password?" and follow the link we send you to set your own password.`,
        ``,
        `Once signed in, please complete the onboarding flow (PDPL consent + workplace policies) before continuing.`,
        ``,
        `If you have any questions, reply to this email.`,
        ``,
        `- Datalake HR`,
        ``,
        `--------------------------------------------------`,
        `Datalake Saudi Arabia LLC, Riyadh Al-Yarmouk 13243`,
        `CR: 1009194773 | NUN: 7048904952 | www.datalake.sa`,
        `PRIVATE & CONFIDENTIAL - This message may contain personal data processed under PDPL Art. 5.`,
      ].join("\n");

      const logRef = db.collection("email_log").doc();
      await logRef.set({
        log_id: logRef.id,
        to: cleanEmail,
        subject,
        template_id: "auth_account_provisioned",
        sent_by: profile?.email || decoded.email,
        sent_by_uid: decoded.uid,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        status: "PENDING",
        ip_address: req.ip || req.headers["x-forwarded-for"] || "unknown",
        user_agent: req.headers["user-agent"] || "unknown",
      });

      try {
        const gmail = await getGmailClient();
        const sendRes = await sendEmailRaw(gmail, cleanEmail, subject, body);
        await logRef.update({
          status: "SENT",
          gmail_message_id: sendRes?.data?.id || null,
          sent_at: admin.firestore.FieldValue.serverTimestamp(),
        });
        emailResult = { sent: true, gmail_message_id: sendRes?.data?.id || null };
      } catch (sendErr) {
        await logRef.update({
          status: "FAILED",
          error: String(sendErr.message || sendErr).slice(0, 500),
          failed_at: admin.firestore.FieldValue.serverTimestamp(),
        });
        emailResult = { sent: false, error: sendErr.message || "send failed" };
      }
    }

    return res.status(200).json({
      success: true,
      already_existed: false,
      uid: newUser.uid,
      email: cleanEmail,
      // NOTE: the temp password is intentionally NOT returned — the
      // welcome email instructs the user to use "Forgot password" to
      // set their own. If for some reason HR needs the temp on screen
      // (rare), they can reset via /admin again.
      email_sent: emailResult,
    });
  } catch (err) {
    console.error("provisionMissingAuthAccount error:", err);
    return res.status(500).json({ error: err.message || "Internal error" });
  }
}

module.exports = { auditAuthAccountsHandler, provisionMissingAuthAccountHandler };
