const admin = require("firebase-admin");
const db = admin.firestore();
const { v4: uuidv4 } = require("uuid");
const { getGmailClient, sendEmailRaw } = require("./lib/gmail");

async function writeBigQueryAudit(eventData) {
  try {
    const { BigQuery } = require("@google-cloud/bigquery");
    const bq = new BigQuery({ projectId: "datalake-production-sa", location: "me-central2" });
    await bq.dataset("datalake_audit").table("system_events").insert([
      { ...eventData, timestamp: new Date().toISOString() },
    ]);
  } catch (err) {
    console.warn("BigQuery audit write failed (non-fatal):", err.message);
  }
}

async function backfillEmployeeHandler(req, res, { verifyAuth, getUserAccessProfile }) {
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  try {
    console.log("[backfill] Step 1: verifyAuth");
    const decoded = await verifyAuth(req);

    console.log("[backfill] Step 2: getUserAccessProfile for", decoded.uid);
    const profile = await getUserAccessProfile(decoded.uid);
    if (profile.role_id !== "ceo") return res.status(403).json({ error: "Forbidden: CEO access required." });

    let { emp_id, full_name, arabic_name, email, role_id, job_title, nationality, start_date, contract_type, salary_sar, emkan_assignment } = req.body;
    email = (email || "").trim().toLowerCase();
    console.log("[backfill] Step 3: processing", emp_id, email);

    if (!/^DLSA\d{4}$/.test(emp_id)) return res.status(400).json({ error: "Invalid emp_id format." });

    // Never backfill a leaver
    const leaversSnap = await db.collection("ex_employees").where("emp_id", "==", emp_id).get();
    if (!leaversSnap.empty) return res.status(409).json({ error: "Employee ID already exists in ex_employees." });

    // Check emp_id not used by a DIFFERENT email
    const usersByEmpId = await db.collection("users").where("emp_id", "==", emp_id).get();
    if (!usersByEmpId.empty) {
      const existingEmail = usersByEmpId.docs[0].data().email;
      if (existingEmail !== email) {
        return res.status(409).json({ error: `emp_id ${emp_id} already assigned to ${existingEmail}.` });
      }
    }

    // Look up or create Firebase Auth user to get UID
    console.log("[backfill] Step 4: Firebase Auth lookup for", email);
    let firebaseUser;
    try {
      firebaseUser = await admin.auth().getUserByEmail(email);
      console.log("[backfill] Found existing auth user:", firebaseUser.uid);
    } catch (err) {
      if (err.code === "auth/user-not-found") {
        console.log("[backfill] Creating new auth user for", email);
        firebaseUser = await admin.auth().createUser({ email, displayName: full_name });
        console.log("[backfill] Created auth user:", firebaseUser.uid);
      } else {
        console.error("[backfill] Firebase Auth error:", err.code, err.message);
        return res.status(500).json({ error: `Firebase Auth failed: ${err.code || err.message}` });
      }
    }
    const uid = firebaseUser.uid;

    const token = uuidv4();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 14);

    // Auto-create role + access_matrix if missing (e.g. "finance")
    console.log("[backfill] Step 5: check role", role_id);
    const roleDoc = await db.collection("roles").doc(role_id).get();
    if (!roleDoc.exists) {
      const hrMatrix = await db.collection("access_matrix").doc("hr").get();
      const hrClasses = hrMatrix.exists ? hrMatrix.data().data_classes : {};
      await db.collection("roles").doc(role_id).set({
        role_id, role_name: role_id.charAt(0).toUpperCase() + role_id.slice(1),
        description: `Auto-created during backfill (cloned from hr).`,
        role_type: "system", is_deletable: false,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        created_by: decoded.email,
      });
      await db.collection("access_matrix").doc(role_id).set({
        role_id, data_classes: hrClasses,
        last_updated_by: decoded.email,
        last_updated_at: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log("[backfill] Auto-created role + matrix:", role_id);
    }

    // Build user payload â€” uses status:"active" to match access.js expectations
    console.log("[backfill] Step 6: write user doc", uid);
    const userPayload = {
      emp_id, full_name, arabic_name: arabic_name || null, email, role_id, job_title, nationality,
      start_date, contract_type, salary_sar: Number(salary_sar) || 0, emkan_assignment: emkan_assignment || false,
      source: "BACKFILL_PRE_PLATFORM",
      status: "active",
      pdpl_consent_state: "PENDING",
      pdpl_consent_token: token,
      pdpl_consent_granted_at: null,
      created_by: decoded.email,
      iam_provisioned: false
    };

    // Merge into users/{uid} â€” preserves existing fields if doc exists (e.g. CEO seed record)
    const existingDoc = await db.collection("users").doc(uid).get();
    if (existingDoc.exists) {
      await db.collection("users").doc(uid).set(userPayload, { merge: true });
      console.log("[backfill] Merged into existing user doc");
    } else {
      await db.collection("users").doc(uid).set({
        ...userPayload,
        uid,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log("[backfill] Created new user doc");
    }

    // Write consent token (expires in 14 days)
    console.log("[backfill] Step 7: write consent token");
    await db.collection("backfill_consent_tokens").doc(token).set({
      emp_id, email, expires_at: admin.firestore.Timestamp.fromDate(expiresAt), state: "PENDING"
    });

    // Send consent email via Gmail API (non-fatal â€” consent link still works if email fails)
    console.log("[backfill] Step 8: send email to", email);
    let emailSent = false;
    let emailError = null;
    try {
      const bodyText = `Dear ${full_name},\n\nDatalake has implemented its new internal HR and operations platform.\nAs an existing member of the team, your records are being registered.\nBefore you can access it, please:\n\n1. Confirm the data we hold about you is correct\n2. Provide additional details we need\n3. Acknowledge how your personal data will be processed\n\nThis takes about 5 minutes. Complete within 14 days:\nhttps://datalake-production-sa.web.app/consent/${token}\n\nQuestions? Reply to this email or contact m.alqumri@datalake.sa\n\nDatalake Saudi Arabia\nRiyadh 13243 Rajeeh Street | CR:109194773 | UEN:7048904952`;

      const gmail = await getGmailClient();
      await sendEmailRaw(gmail, email, "Datalake Platform â€” Action Required: Confirm your data and consent", bodyText);
      emailSent = true;
      console.log("[backfill] Email sent successfully");
    } catch (emailErr) {
      emailError = emailErr.message;
      console.error("[backfill] Email send FAILED:", emailErr.message);
    }

    // Audit (non-fatal)
    await writeBigQueryAudit({ event_type: "EMPLOYEE_BACKFILLED", actor: decoded.email, details: JSON.stringify({ emp_id, email }) });

    console.log("[backfill] SUCCESS for", emp_id, "email_sent:", emailSent);
    return res.status(200).json({
      success: true, emp_id,
      consent_link: `https://datalake-production-sa.web.app/consent/${token}`,
      expires_at: expiresAt.toISOString(),
      email_sent: emailSent,
      email_error: emailError
    });
  } catch (err) {
    if (err.code === "AUTH_MISSING" || err.code === "AUTH_INVALID") {
      return res.status(401).json({ error: err.message });
    }
    if (err.code === "AUTH_DOMAIN") { return res.status(403).json({ error: err.message }); }
    console.error("[backfill] FATAL ERROR:", err.message, err.stack);
    return res.status(500).json({ error: err.message });
  }
}

async function recordLeaverHandler(req, res, { verifyAuth, getUserAccessProfile }) {
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  try {
    const decoded = await verifyAuth(req);
    const profile = await getUserAccessProfile(decoded.uid);
    if (profile.role_id !== "ceo") return res.status(403).json({ error: "Forbidden: CEO access required." });

    const { emp_id, full_name, email, job_title, start_date, end_date, reason } = req.body;
    const validReasons = ["RESIGNATION", "TERMINATION", "MUTUAL_AGREEMENT", "END_OF_CONTRACT"];
    if (!validReasons.includes(reason)) return res.status(400).json({ error: "Invalid reason" });

    const retentionEndDate = new Date(end_date);
    retentionEndDate.setFullYear(retentionEndDate.getFullYear() + 10);

    await db.collection("ex_employees").add({
      emp_id, full_name, email, job_title, start_date, end_date, reason,
      source: "PRE_PLATFORM_LEAVER", retention_until: admin.firestore.Timestamp.fromDate(retentionEndDate),
      recorded_at: admin.firestore.FieldValue.serverTimestamp(), recorded_by: decoded.email
    });

    await writeBigQueryAudit({ event_type: "LEAVER_RECORDED", actor: decoded.email, details: JSON.stringify({ emp_id, email, reason }) });
    return res.status(200).json({ success: true, emp_id, reminder: "Manually suspend their @datalake.sa Workspace account if not already done." });
  } catch (err) {
    if (err.code === "AUTH_MISSING" || err.code === "AUTH_INVALID") {
      return res.status(401).json({ error: err.message });
    }
    if (err.code === "AUTH_DOMAIN") { return res.status(403).json({ error: err.message }); }
    console.error("[recordLeaver] ERROR:", err.message);
    return res.status(500).json({ error: err.message });
  }
}

async function getBackfillConsentFormHandler(req, res) {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: "Missing token" });

    const tokenDoc = await db.collection("backfill_consent_tokens").doc(token).get();
    if (!tokenDoc.exists) return res.status(404).json({ error: "Token not found" });

    const data = tokenDoc.data();
    if (data.state !== "PENDING" || data.expires_at.toDate() < new Date()) {
      return res.status(404).json({ error: "Token is expired or already used" });
    }

    const usersSnap = await db.collection("users").where("email", "==", data.email).get();
    if (usersSnap.empty) return res.status(404).json({ error: "User not found" });

    const user = usersSnap.docs[0].data();
    return res.status(200).json({
      full_name: user.full_name, email: user.email, role_id: user.role_id,
      job_title: user.job_title, nationality: user.nationality, start_date: user.start_date, contract_type: user.contract_type
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function submitBackfillConsentHandler(req, res) {
  try {
    const { token, data_confirmed_correct, corrections_text, arabic_name, national_id, iqama_number, date_of_birth, contact_phone, iban, emergency_contact_name, emergency_contact_phone, consent_acknowledged, consent_to_processing, consent_to_ai_usage, consent_to_monitoring } = req.body;

    if (!consent_acknowledged || !consent_to_processing || !consent_to_ai_usage || !consent_to_monitoring) {
      return res.status(400).json({ error: "All consent checkboxes must be checked." });
    }

    const tokenDoc = await db.collection("backfill_consent_tokens").doc(token).get();
    if (!tokenDoc.exists) return res.status(404).json({ error: "Token not found" });

    const tokenData = tokenDoc.data();
    if (tokenData.state !== "PENDING" || tokenData.expires_at.toDate() < new Date()) {
      return res.status(400).json({ error: "Token is expired or used" });
    }

    const usersSnap = await db.collection("users").where("email", "==", tokenData.email).get();
    if (usersSnap.empty) return res.status(404).json({ error: "User not found" });

    const userRef = usersSnap.docs[0].ref;
    const ip_address = req.headers["x-forwarded-for"] || req.connection?.remoteAddress || "unknown";

    await userRef.update({
      pdpl_consent_state: "GRANTED",
      pdpl_consent_granted_at: admin.firestore.FieldValue.serverTimestamp(),
      pdpl_consent_ip: ip_address,
      arabic_name: arabic_name || null,
      national_id: national_id || null,
      iqama_number: iqama_number || null,
      date_of_birth: date_of_birth || null,
      contact_phone: contact_phone || null,
      iban: iban || null,
      emergency_contact_name: emergency_contact_name || null,
      emergency_contact_phone: emergency_contact_phone || null,
      pdpl_corrections_requested: corrections_text ? true : false
    });

    await db.collection("backfill_consent_tokens").doc(token).update({
      state: "USED", used_at: admin.firestore.FieldValue.serverTimestamp()
    });

    if (corrections_text) {
      try {
        const gmail = await getGmailClient();
        await sendEmailRaw(gmail, "m.alqumri@datalake.sa", `Data Correction Request: ${tokenData.email}`, `The user ${tokenData.email} submitted data corrections during consent flow:\n\n${corrections_text}`);
      } catch (emailErr) {
        console.warn("Correction email failed (non-fatal):", emailErr.message);
      }
    }

    await writeBigQueryAudit({ event_type: "PDPL_CONSENT_GRANTED", actor: tokenData.email, details: JSON.stringify({ ip_address }) });
    return res.status(200).json({ success: true, message: "Thank you. Your data has been confirmed." });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

module.exports = { backfillEmployeeHandler, recordLeaverHandler, getBackfillConsentFormHandler, submitBackfillConsentHandler };

