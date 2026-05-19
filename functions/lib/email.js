const { google } = require("googleapis");

/**
 * Get authenticated Gmail client using Application Default Credentials
 * with Domain-Wide Delegation to send as a service account or generic email.
 */
async function getGmailClient(subject = "hr@datalake.sa") {
  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/gmail.send"],
    clientOptions: {
      subject, // e.g. hr@datalake.sa or noreply@datalake.sa
    },
  });
  const client = await auth.getClient();
  return google.gmail({ version: "v1", auth: client });
}

/**
 * Build a base64url-encoded RFC 2822 MIME email.
 */
function buildRawEmail({ from, to, subject, bodyHtml }) {
  const messageParts = [
    `From: Datalake Platform <${from}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "Content-Type: text/html; charset=utf-8",
    "MIME-Version: 1.0",
    "",
    bodyHtml,
  ];
  
  const message = messageParts.join("\n");
  
  // Gmail API requires URL-safe base64
  return Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Generates the standard Datalake HTML email template.
 */
function buildTemplate(content, actionUrl = null, actionText = null) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
      <div style="background: #0a1628; padding: 24px; text-align: center;">
        <img src="https://datalake-production-sa.web.app/images/logo-white.svg" alt="Datalake" style="height: 40px;" />
      </div>
      <div style="padding: 32px 24px; color: #1e293b; line-height: 1.6;">
        ${content}
        
        ${actionUrl ? `
          <div style="text-align: center; margin-top: 32px;">
            <a href="${actionUrl}" style="background: #1598CC; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
              ${actionText || "View Details"}
            </a>
          </div>
        ` : ''}
      </div>
      <div style="background: #f8fafc; padding: 24px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0;">
        <p>This is an automated message from the Datalake Platform.</p>
        <p>Datalake — Analytics Data Technology | Riyadh, Saudi Arabia</p>
        <p>Protected under PDPL · NCA · SAMA compliance.</p>
      </div>
    </div>
  `;
}

/**
 * Send an email using Gmail API.
 */
async function sendEmail({ to, subject, content, actionUrl, actionText, from = "noreply@datalake.sa" }) {
  try {
    const gmail = await getGmailClient(from);
    const bodyHtml = buildTemplate(content, actionUrl, actionText);
    const raw = buildRawEmail({ from, to, subject, bodyHtml });
    
    const result = await gmail.users.messages.send({
      userId: from,
      requestBody: { raw },
    });
    
    return { success: true, messageId: result.data.id };
  } catch (error) {
    console.warn("Failed to send email:", error.message);
    return { success: false, error: error.message };
  }
}

module.exports = {
  sendEmail
};
