const admin = require("firebase-admin");
const { google } = require("googleapis");
const { logToBigQuery } = require("./lib/bigquery");
const db = admin.firestore();

async function getGmailClient() {
  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/gmail.send"],
    clientOptions: { subject: "hr@datalake.sa" }
  });
  const client = await auth.getClient();
  return google.gmail({ version: "v1", auth: client });
}

async function getUsersWithRole(roleId) {
  // Common roles: 'ceo', 'hr', 'finance', 'it_admin'
  const snap = await db.collection("users")
    .where("role_id", "==", roleId)
    .where("status", "==", "active")
    .get();
  
  return snap.empty ? [] : snap.docs.map(doc => ({ id: doc.id, email: doc.data().email }));
}

async function notify(recipientRoleOrId, notificationType, data) {
  try {
    const isRole = ["ceo", "hr", "finance", "it_admin", "pm"].includes(recipientRoleOrId);
    let recipients = [];
    
    if (isRole) {
      recipients = await getUsersWithRole(recipientRoleOrId);
      // For PM, if it's passed as a specific email rather than role, we handle below
    } else if (recipientRoleOrId.includes("@")) {
      // It's an email (like client_pm_email)
      const snap = await db.collection("users").where("email", "==", recipientRoleOrId).limit(1).get();
      if (!snap.empty) {
        recipients = [{ id: snap.docs[0].id, email: recipientRoleOrId }];
      } else {
        // If not a registered user, they still get the email but no in-app notification
        recipients = [{ id: null, email: recipientRoleOrId }];
      }
    } else {
      // It's a specific user ID
      const userDoc = await db.collection("users").doc(recipientRoleOrId).get();
      if (userDoc.exists) {
        recipients = [{ id: recipientRoleOrId, email: userDoc.data().email }];
      }
    }

    if (recipients.length === 0) {
      console.warn(`[NotificationEngine] No recipients found for ${recipientRoleOrId}`);
      return;
    }

    for (const recipient of recipients) {
      // 1. In-App Notification (Firestore)
      if (recipient.id) {
        await db.collection("users").doc(recipient.id).collection("notifications").add({
          type: notificationType,
          data: data,
          read: false,
          created_at: admin.firestore.FieldValue.serverTimestamp()
        });
      }

      // 2. Urgent / Email / SMS routing
      const priority = data.priority || "NORMAL";
      if (priority === "CRITICAL" || recipientRoleOrId.includes("@")) {
        try {
          const gmail = await getGmailClient();
          const subject = `Datalake Notification: ${notificationType}`;
          const body = `You have a new notification: ${notificationType}\nDetails: ${JSON.stringify(data, null, 2)}`;
          
          const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
          const messageParts = [
            `From: hr@datalake.sa`,
            `To: ${recipient.email}`,
            `Subject: ${utf8Subject}`,
            `MIME-Version: 1.0`,
            `Content-Type: text/plain; charset=utf-8`,
            '',
            body
          ];
          const rawMessage = messageParts.join('\n');
          const encodedMessage = Buffer.from(rawMessage)
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
            
          await gmail.users.messages.send({
            userId: "me",
            requestBody: { raw: encodedMessage }
          });
          console.log(`[NotificationEngine] Sent EMAIL to ${recipient.email}`);
        } catch (emailErr) {
          console.error(`[NotificationEngine] Failed to send EMAIL to ${recipient.email}:`, emailErr);
        }
        
        if (priority === "CRITICAL") {
          // TODO: Implement actual SMS sending
          console.log(`[NotificationEngine] [TODO: SMS] Send SMS to ${recipient.email}`);
        }
      }

      // 3. Log to BigQuery
      await logToBigQuery("datalake_audit", "system_events", {
        event_type: "NOTIFICATION_SENT",
        user_id: recipient.id || recipient.email,
        details: JSON.stringify({ type: notificationType, priority }),
        timestamp: new Date()
      });
    }

  } catch (err) {
    console.error("[NotificationEngine] notify error:", err);
  }
}

module.exports = {
  notify
};
