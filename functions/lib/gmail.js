const { google } = require("googleapis");

const SA_EMAIL = "808056940626-compute@developer.gserviceaccount.com";
// hr@datalake.sa is the shared HR mailbox (Workspace alias under
// m.alqumri@datalake.sa). DWD impersonates it directly so the From header,
// SENT folder, and reply-to all route to HR.
const SUBJECT = "hr@datalake.sa";
const SCOPE = "https://www.googleapis.com/auth/gmail.send";

async function getGmailClient() {
  // Get default credentials from Cloud Run metadata server
  const defaultAuth = new google.auth.GoogleAuth();
  const defaultClient = await defaultAuth.getClient();

  // Use signJwt API — signs a complete JWT for domain-wide delegation
  // No key file needed, uses IAM serviceAccountTokenCreator role
  const iam = google.iamcredentials({ version: "v1", auth: defaultClient });
  const now = Math.floor(Date.now() / 1000);

  console.log("[gmail] Signing JWT for", SUBJECT, "via", SA_EMAIL);
  const jwtResponse = await iam.projects.serviceAccounts.signJwt({
    name: `projects/-/serviceAccounts/${SA_EMAIL}`,
    requestBody: {
      payload: JSON.stringify({
        iss: SA_EMAIL,
        sub: SUBJECT,
        scope: SCOPE,
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
      }),
    },
  });

  const signedJwt = jwtResponse.data.signedJwt;
  console.log("[gmail] JWT signed, exchanging for access token");

  // Exchange signed JWT for OAuth2 access token
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${signedJwt}`,
  });

  const tokenData = await tokenRes.json();
  if (tokenData.error) {
    console.error("[gmail] Token exchange FAILED:", tokenData.error, tokenData.error_description);
    throw new Error(`Gmail auth failed: ${tokenData.error_description || tokenData.error}`);
  }

  console.log("[gmail] Access token obtained, creating Gmail client");
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: tokenData.access_token });
  return google.gmail({ version: "v1", auth: oauth2Client });
}

// RFC 2047 — when the subject contains any non-ASCII byte (em-dash, curly
// quote, Arabic, accents, etc.) it must be MIME-encoded or the recipient
// sees "Ã¢Â€Â" mojibake. ASCII-only subjects pass through unchanged.
function mimeEncodeSubject(s) {
  const str = String(s || "");
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(str)) return str;
  return "=?UTF-8?B?" + Buffer.from(str, "utf8").toString("base64") + "?=";
}

async function sendEmailRaw(gmail, to, subject, bodyText) {
  console.log("[gmail] Sending email to", to, "subject:", subject.substring(0, 50));

  // Convert plain text body to simple HTML.
  // ORDER MATTERS: linkify URLs FIRST, while newlines still delimit them, then
  // turn newlines into <br>. If we did it the other way round, a URL sitting on
  // its own line (e.g. a sign link followed by a blank line) would become
  // "https://…/{token}<br><br>Next line" — and the greedy URL match would pull
  // "<br><br>Next line" INTO the href, corrupting the token. Excluding "<" from
  // the URL char class is a second guard against that.
  const htmlBody = bodyText
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
    .replace(/\n/g, "<br>");

  const boundary = "boundary_datalake_" + Date.now().toString(16);
  const messageId = `<${Date.now()}@datalake.sa>`;
  const dateStr = new Date().toUTCString();

  const lines = [
    `From: Datalake HR <hr@datalake.sa>`,
    `To: ${to}`,
    `Subject: ${mimeEncodeSubject(subject)}`,
    `Message-ID: ${messageId}`,
    `Date: ${dateStr}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    ``,
    bodyText,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset="UTF-8"`,
    ``,
    `<html><body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">`,
    htmlBody,
    `</body></html>`,
    ``,
    `--${boundary}--`
  ];
  
  const raw = Buffer.from(lines.join("\r\n")).toString("base64url");
  const result = await gmail.users.messages.send({
    userId: "hr@datalake.sa",
    requestBody: { raw },
  });
  console.log("[gmail] Email sent successfully, messageId:", result.data.id);
  return result;
}

module.exports = { getGmailClient, sendEmailRaw };
