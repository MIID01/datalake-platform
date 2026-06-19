/**
 * test-gateway-invite.js — End-to-end proof of the comms gateway (DTLK-STD-COMMS-001).
 *
 * Test 1 (no credentials needed): the PDPL consent gate REFUSES a client recipient
 *         when no consent_basis_ref is supplied. (Throws before any Firestore/send.)
 * Test 2 (needs ADC + MS_* env): a real invite to m.alqumri@datalake.sa ONLY — no
 *         client — routed through sendStandardMessage(); then reads back the
 *         outbound_comms_log row and confirms status:sent + the message ref.
 *
 * Run from functions/:  node scripts/test-gateway-invite.js
 */

const fs = require("fs");
const path = require("path");

// Load functions/.env (MS_* + others) without a dotenv dependency.
(function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#")) {
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!(m[1] in process.env)) process.env[m[1]] = v;
    }
  }
})();

const TEST_RECIPIENT = "m.alqumri@datalake.sa";

const admin = require("firebase-admin");
admin.initializeApp({ projectId: "datalake-production-sa" });

const { sendStandardMessage } = require("../lib/comms-gateway");

function localStr(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
}

(async () => {
  let failures = 0;

  // ── Test 1: consent gate refusal (client email, no consent_basis_ref) ──
  console.log("── Test 1: PDPL consent gate refuses a client recipient with no consent_basis_ref ──");
  try {
    await sendStandardMessage({
      profileKey: "hr", type: "INV", subject: "Gate test", bodyText: "x",
      to: [TEST_RECIPIENT],
      gatedClientEmail: "external-client@example.com", // a "client" — must be gated
      // consentBasisRef intentionally omitted
      triggeredBy: "test@datalake.sa", kind: "email",
    });
    console.log("   ✖ FAIL — send was NOT refused (the gate let a client through with no consent).");
    failures++;
  } catch (err) {
    if (/consent/i.test(err.message)) {
      console.log("   ✓ PASS — refused:", err.message.split(":")[0]);
    } else {
      console.log("   ✖ FAIL — threw for the wrong reason:", err.message);
      failures++;
    }
  }

  // ── Test 2: real send to the CEO only, through the gateway ──
  console.log("\n── Test 2: real invite to", TEST_RECIPIENT, "(no client) through the gateway ──");
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  start.setHours(11, 0, 0, 0);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  try {
    const result = await sendStandardMessage({
      profileKey: "hr",
      type: "INV",
      subject: `[GATEWAY TEST] Interview Invitation — ${new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(start)}`,
      bodyText: [
        "Hello,", "", "You are invited to an interview with Datalake Saudi Arabia LLC.",
        "", `Date & time: ${start.toISOString()}`, "Duration: 30 minutes", "Location: Microsoft Teams",
        "", "Please accept this invitation to confirm your attendance.", "", "Best regards,", "Datalake HR",
      ].join("\n"),
      to: [TEST_RECIPIENT],
      triggeredBy: "gateway-test@datalake.sa",
      relatedRecord: { collection: "talent_pool", id: "GATEWAY_TEST" },
      kind: "calendar_invite",
      calendar: {
        startUtc: start, endUtc: end,
        startLocal: localStr(start), endLocal: localStr(end),
        timeZone: "Asia/Riyadh", location: "Microsoft Teams (gateway test)",
        icsDescription: "Gateway smoke test.", uid: `gw-test-${start.getTime()}@datalake.sa`,
      },
    });
    console.log("   ✓ sent:", JSON.stringify({ ref: result.message_ref, transport: result.transport, to: result.to, client_present: result.client_present }));
    console.log("   Join URL:", result.join_url || "(none)");

    // Read back the audit row.
    const doc = await admin.firestore().collection("outbound_comms_log").doc(result.message_ref).get();
    if (doc.exists && doc.data().status === "sent") {
      console.log("   ✓ outbound_comms_log row present, status:", doc.data().status, "| has ip/user_agent:",
        ("ip_address" in doc.data() || "user_agent" in doc.data()));
    } else {
      console.log("   ✖ FAIL — outbound_comms_log row missing or not 'sent':", doc.exists ? doc.data().status : "MISSING");
      failures++;
    }
  } catch (err) {
    console.log("   ✖ Test 2 could not complete:", err.message);
    console.log("     (Needs Application Default Credentials: run `gcloud auth application-default login`.");
    console.log("      Test 1 above does not need credentials and is the key PDPL-gate proof.)");
    failures++;
  }

  console.log(failures ? `\n${failures} check(s) failed.` : "\nAll gateway checks passed.");
  process.exit(failures ? 1 : 0);
})();
