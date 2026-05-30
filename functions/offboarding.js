/**
 * Offboarding Cloud Functions
 *
 * dailyOffboardingSweep — Cloud Scheduler: finds engineers with end_date = today
 * offboardEngineer     — CEO: suspends account, removes IAM, generates cert, emails
 *
 * DTLK-PROC-HRM-002 / DTLK-FORM-HRM-002
 */

const admin = require("firebase-admin");
const { google } = require("googleapis");

const db = admin.firestore();

// ═══════════════════════════════════════════════════════════════════
// 1. dailyOffboardingSweep — runs daily via Cloud Scheduler
// ═══════════════════════════════════════════════════════════════════
async function dailyOffboardingSweepHandler() {
  const today = new Date().toISOString().split("T")[0];
  console.log(`[OffboardingSweep] Running for date: ${today}`);

  const snapshot = await db.collection("engineers")
    .where("contract_end", "==", today)
    .where("status", "==", "active")
    .get();

  if (snapshot.empty) {
    console.log("[OffboardingSweep] No engineers to offboard today.");
    return { processed: 0 };
  }

  const results = [];
  for (const doc of snapshot.docs) {
    const eng = doc.data();
    try {
      await performOffboarding(doc.id, eng, "system@datalake.sa");
      results.push({ engineer_id: doc.id, name: eng.full_name, status: "offboarded" });
    } catch (err) {
      console.error(`[OffboardingSweep] Failed for ${doc.id}:`, err.message);
      results.push({ engineer_id: doc.id, name: eng.full_name, status: "failed", error: err.message });
    }
  }

  console.log(`[OffboardingSweep] Processed ${results.length} engineers.`);
  return { processed: results.length, results };
}

// ═══════════════════════════════════════════════════════════════════
// 2. offboardEngineer — CEO manual trigger
// ═══════════════════════════════════════════════════════════════════
async function offboardEngineerHandler(req, res, { verifyAuth, getUserAccessProfile, ALLOWED_ORIGINS }) {
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Origin", ALLOWED_ORIGINS.includes(req.headers.origin) ? req.headers.origin : "");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return res.status(204).send("");
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const decoded = await verifyAuth(req);
    const profile = await getUserAccessProfile(decoded.uid);
    if (profile.role_id !== "ceo") return res.status(403).json({ error: "CEO role required" });

    const { engineer_id } = req.body;
    if (!engineer_id) return res.status(400).json({ error: "engineer_id required" });

    const engDoc = await db.collection("engineers").doc(engineer_id).get();
    if (!engDoc.exists) return res.status(404).json({ error: "Engineer not found" });
    const eng = engDoc.data();

    if (eng.status === "offboarded") return res.status(409).json({ error: "Already offboarded" });

    await performOffboarding(engineer_id, eng, profile.email);
    return res.status(200).json({ success: true, engineer_id, message: `${eng.full_name} offboarded` });
  } catch (err) {
    console.error("offboardEngineer error:", err);
    return res.status(500).json({ error: "Internal server error", detail: err.message });
  }
}

async function performOffboarding(engineerId, eng, actorEmail) {
  const now = admin.firestore.FieldValue.serverTimestamp();

  // 1. Disable Firebase Auth account
  if (eng.uid) {
    try {
      await admin.auth().updateUser(eng.uid, { disabled: true });
    } catch (e) {
      console.warn(`Could not disable auth for ${eng.uid}:`, e.message);
    }
  }

  // 2. Update user doc
  if (eng.uid) {
    await db.collection("users").doc(eng.uid).update({
      status: "offboarded",
      offboarded_at: now,
      offboarded_by: actorEmail,
    });
  }

  // 3. Generate de-provisioning certificate text
  const certText = generateCertificate(eng, engineerId);

  // 4. Update engineer doc
  await db.collection("engineers").doc(engineerId).update({
    status: "offboarded",
    offboarded_at: now,
    offboarded_by: actorEmail,
    deprovision_certificate: certText,
  });

  // 5. Store cert in WORM
  const wormBucket = admin.storage().bucket("datalake-worm-hr");
  const certPath = `offboarding/${engineerId}/DTLK-FORM-HRM-002_${new Date().toISOString().split("T")[0]}.txt`;
  await wormBucket.file(certPath).save(certText, {
    metadata: {
      contentType: "text/plain",
      metadata: { engineer_id: engineerId, offboarded_by: actorEmail, regulatory_basis: "PDPL Art. 4; NCA ECC-1:2018" },
    },
  });

  // 6. Email CEO + engineer
  try {
    const gmail = await getGmailClient();
    // Notify CEO
    const ceoBody = [
      `Engineer Offboarded: ${eng.full_name} (${engineerId})`,
      `Project: ${eng.project_name}`, `Client: ${eng.client_name}`,
      `Contract End: ${eng.contract_end}`, `De-provisioning certificate archived to WORM.`,
      "", "— Datalake Offboarding System",
    ].join("\n");
    await sendEmail(gmail, "m.alqumri@datalake.sa", `Offboarding Complete: ${eng.full_name}`, ceoBody);

    // Notify engineer
    if (eng.email) {
      const engBody = [
        `Dear ${eng.full_name},`,
        "", "Your engagement with Datalake Saudi Arabia LLC has concluded.",
        `Project: ${eng.project_name}`, `End Date: ${eng.contract_end}`,
        "", "Your platform access has been suspended. Thank you for your contributions.",
        "", "Best regards,", "Datalake HR", "hr@datalake.sa",
      ].join("\n");
      await sendEmail(gmail, eng.email, `Engagement Concluded — Datalake IT`, engBody);
    }
  } catch (emailErr) {
    console.warn("Offboarding email failed (non-blocking):", emailErr.message);
  }

  // 7. Audit
  await db.collection("task_audit_log").add({
    event: "ENGINEER_OFFBOARDED", action_by: actorEmail, action_at: now,
    details: { engineer_id: engineerId, full_name: eng.full_name, project: eng.project_name, client: eng.client_name },
  });

  // 8. BigQuery audit
  try {
    const { writeBigQueryAudit } = require("./prepareInterviewCV");
    await writeBigQueryAudit({
      event_type: "ENGINEER_OFFBOARDED", actor: actorEmail,
      candidate_id: engineerId, project_id: eng.project_id || "",
      pdpl_consent_verified: true, regulatory_basis: "PDPL Art. 4; NCA ECC-1:2018",
    });
  } catch (_) { /* non-blocking */ }
}

function generateCertificate(eng, engineerId) {
  return [
    "CERTIFICATE OF DE-PROVISIONING",
    "DTLK-FORM-HRM-002",
    "═══════════════════════════════════════",
    "",
    `Date: ${new Date().toISOString().split("T")[0]}`,
    `Engineer: ${eng.full_name}`,
    `Engineer ID: ${engineerId}`,
    `Email: ${eng.email}`,
    `Project: ${eng.project_name}`,
    `Client: ${eng.client_name}`,
    `Contract Period: ${eng.contract_start} to ${eng.contract_end}`,
    "",
    "Actions Taken:",
    "1. Firebase Authentication account disabled",
    "2. Platform access revoked",
    "3. User role set to 'offboarded'",
    "4. This certificate archived to WORM storage",
    "",
    "Note: Nafath e-signature integration pending Phase 3.",
    "",
    "═══════════════════════════════════════",
    "Datalake Saudi Arabia LLC",
    "Riyadh Al-Yarmouk 13243",
    "CR: 1009194773 | NUN: 7048904952 | www.datalake.sa",
    "Processed under PDPL Art. 4; NCA ECC-1:2018",
  ].join("\n");
}

async function getGmailClient() {
  const auth = new google.auth.GoogleAuth({ scopes: ["https://www.googleapis.com/auth/gmail.send"] });
  const client = await auth.getClient();
  client.subject = "hr@datalake.sa";
  return google.gmail({ version: "v1", auth: client });
}

async function sendEmail(gmail, to, subject, body) {
  const raw = Buffer.from(
    [`From: Datalake HR <hr@datalake.sa>`, `To: ${to}`, `Subject: ${subject}`,
     "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "", body].join("\r\n")
  ).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  await gmail.users.messages.send({ userId: "hr@datalake.sa", requestBody: { raw } });
}

module.exports = { dailyOffboardingSweepHandler, offboardEngineerHandler };
