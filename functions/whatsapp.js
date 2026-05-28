const admin = require("firebase-admin");
const { PubSub } = require("@google-cloud/pubsub");
const { logToBigQuery } = require("./lib/bigquery");

const db = admin.firestore();
const pubsub = new PubSub();

// ═══════════════════════════════════════════════════════════════════
// 1. whatsappWebhook (HTTP Webhook from Meta)
// ═══════════════════════════════════════════════════════════════════
async function whatsappWebhookHandler(req, res) {
  try {
    const tenantId = req.query.tenant_id;
    if (!tenantId) return res.status(400).send("tenant_id required");

    const configDoc = await db.collection("tenants").doc(tenantId).collection("integrations").doc("whatsapp").get();
    if (!configDoc.exists || configDoc.data().status !== "connected") {
      console.warn(`[WhatsApp Engine] Tenant ${tenantId} not configured.`);
      return res.status(200).send("EVENT_RECEIVED");
    }
    const config = configDoc.data();

    // Verification request from Meta
    if (req.method === "GET") {
      const mode = req.query["hub.mode"];
      const token = req.query["hub.verify_token"];
      const challenge = req.query["hub.challenge"];

      if (mode && token) {
        if (mode === "subscribe" && token === config.webhook_verify_token) {
          console.log(`[WhatsApp Engine] Webhook verified for tenant ${tenantId}`);
          return res.status(200).send(challenge);
        } else {
          return res.status(403).send("Verification failed");
        }
      }
      return res.status(400).send("Missing parameters");
    }

    // Message received from Meta
    if (req.method === "POST") {
      const body = req.body;
      if (body.object !== "whatsapp_business_account") {
        return res.status(404).send("Unrecognized object");
      }

      for (const entry of body.entry) {
        for (const change of entry.changes) {
          if (change.field === "messages") {
            const messages = change.value.messages;
            if (!messages) continue;

            for (const msg of messages) {
              const senderNumber = msg.from;
              const msgId = msg.id;
              const text = msg.text ? msg.text.body : "[Non-text message]";

              // Match sender to CRM contact
              const contactSnap = await db.collection("contacts")
                .where("tenant_id", "==", tenantId)
                .where("phone", "==", senderNumber)
                .limit(1)
                .get();
              
              const contactId = contactSnap.empty ? null : contactSnap.docs[0].id;
              const contactName = contactSnap.empty ? "Unknown WhatsApp User" : (contactSnap.docs[0].data().name || contactSnap.docs[0].data().full_name);

              // Create Activity
              const activityRef = db.collection("activities").doc();
              await activityRef.set({
                tenant_id: tenantId,
                type: "WHATSAPP",
                contact_id: contactId,
                contact_name: contactName,
                message_id: msgId,
                from: senderNumber,
                description: text,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
              });

              // Trigger AI analysis for this message
              // (Reusing the email analysis topic, or could be generic datalake.activity.created)
              await pubsub.topic("datalake.email.synced").publishMessage({
                json: { tenant_id: tenantId, activity_id: activityRef.id, email_body: text }
              });
            }
          }
        }
      }

      await logToBigQuery("datalake_audit", "ai_actions", {
        agent_name: "WhatsApp Engine", action_type: "RECEIVE_MESSAGE", entity_id: tenantId, tenant_id: tenantId,
        result: "SUCCESS", timestamp: new Date()
      });

      return res.status(200).send("EVENT_RECEIVED");
    }
  } catch (err) {
    console.error("[WhatsApp Engine] Error processing webhook:", err);
    res.status(500).send("Internal Server Error");
  }
}

module.exports = {
  whatsappWebhookHandler
};
