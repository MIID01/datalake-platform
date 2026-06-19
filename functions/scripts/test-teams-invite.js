/**
 * test-teams-invite.js — SAFE local smoke test for the M365 / Teams interview-invite wiring.
 *
 * Bypasses the Cloud Function entirely (no auth, no candidate, no project, NO CLIENT).
 * Exercises only the new/risky part: MS Graph client-credentials auth + creating a
 * Teams online-meeting calendar event on the organizer mailbox. Outlook then sends the
 * invite to the SINGLE hardcoded internal recipient below.
 *
 * Hardcoded recipient = m.alqumri@datalake.sa. The script refuses to send anywhere else.
 *
 * Run from functions/:  node scripts/test-teams-invite.js
 */

const fs = require("fs");
const path = require("path");

// ── Load functions/.env into process.env (no dotenv dependency) ──
function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) { console.error("✖ functions/.env not found"); process.exit(1); }
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#")) {
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!(m[1] in process.env)) process.env[m[1]] = v;
    }
  }
}
loadEnv();

// ── Safety: this test may ONLY ever invite the CEO. No client, no candidate. ──
const TEST_RECIPIENT = "m.alqumri@datalake.sa";

const { isGraphConfigured, createTeamsCalendarEvent } = require("../lib/msgraph");
const { COMPANY, LEGAL_EMAIL_FOOTER } = require("../lib/company-legal");

function localStr(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
}

(async () => {
  console.log("── Teams interview-invite smoke test ──");
  console.log("Organizer        :", process.env.MS_INTERVIEW_ORGANIZER || "(unset)");
  console.log("Tenant set       :", !!process.env.MS_TENANT_ID);
  console.log("Client ID set    :", !!process.env.MS_CLIENT_ID);
  console.log("Secret set       :", !!process.env.MS_CLIENT_SECRET);
  console.log("Sole recipient   :", TEST_RECIPIENT, "(hardcoded — no client, no candidate)\n");

  if (!isGraphConfigured()) {
    console.error("✖ MS Graph not configured — fill MS_TENANT_ID / MS_CLIENT_ID / MS_CLIENT_SECRET / MS_INTERVIEW_ORGANIZER in functions/.env");
    process.exit(1);
  }

  // Tomorrow 10:00 local (organizer's mailbox is Riyadh / Arabia Standard Time).
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  start.setHours(10, 0, 0, 0);
  const end = new Date(start.getTime() + 30 * 60 * 1000);

  // Mirrors the generic body produced by buildInviteBody() in sendInterviewInvite.js
  // so this send previews the real invite wording (no names).
  const when = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Riyadh", weekday: "long", day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  }).format(start);
  const bodyHtml = [
    "Hello,",
    "",
    `You are invited to an interview with ${COMPANY.legal_name_en}.`,
    "",
    `Date &amp; time: ${when} (Riyadh time)`,
    "Duration: 30 minutes",
    "Location: Microsoft Teams",
    "",
    "Please accept this invitation to confirm your attendance. The meeting join details are included above.",
    "",
    "Best regards,",
    "Datalake HR Team",
    "hr@datalake.sa",
    "",
    LEGAL_EMAIL_FOOTER,
  ].join("<br>");

  try {
    const result = await createTeamsCalendarEvent({
      organizer: process.env.MS_INTERVIEW_ORGANIZER,
      subject: `[TEST] Interview Invitation — ${COMPANY.legal_name_en}`,
      bodyHtml,
      startLocal: localStr(start),
      endLocal: localStr(end),
      timeZone: "Asia/Riyadh",
      location: "Microsoft Teams (test)",
      attendees: [{ email: TEST_RECIPIENT, optional: false }],
    });
    console.log("✓ Teams event created and invite sent to", TEST_RECIPIENT);
    console.log("  Event ID :", result.id);
    console.log("  Join URL :", result.joinUrl || "(none returned — check isOnlineMeeting on the event)");
    console.log("  Web link :", result.webLink || "(n/a)");
    console.log("\nCheck the", TEST_RECIPIENT, "inbox/calendar for the invite, then delete the test event.");
  } catch (err) {
    console.error("✖ Test failed:", err.message);
    console.error("\nLikely causes:");
    console.error("  • Calendars.ReadWrite application permission not admin-consented (green ✅ in Entra)");
    console.error("  • Application access policy not yet propagated, or organizer not in the scope group");
    console.error("  • Wrong client secret Value (used the Secret ID instead of the Value)");
    process.exit(1);
  }
})();
