const admin = require("firebase-admin");
const { logToBigQuery } = require("./lib/bigquery");
const db = admin.firestore();

async function getUsersWithRole(roleId) {
  // Common roles: 'ceo', 'hr', 'finance', 'it_admin'
  const snap = await db.collection("users")
    .where("role_id", "==", roleId)
    .where("active", "==", true)
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
        // Mock sending email
        console.log(`[NotificationEngine] Sending EMAIL to ${recipient.email}: [${notificationType}]`);
        
        // Mock sending SMS if critical
        if (priority === "CRITICAL") {
          console.log(`[NotificationEngine] Sending SMS to ${recipient.email} (via profile phone)`);
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
