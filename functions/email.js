const admin = require("firebase-admin");
const { PubSub } = require("@google-cloud/pubsub");
const { SecretManagerServiceClient } = require("@google-cloud/secret-manager");
const { logToBigQuery } = require("./lib/bigquery");
const { callLLM, parseJsonOutput } = require("./lib/ai-client");

const db = admin.firestore();
const pubsub = new PubSub();
const secretManager = new SecretManagerServiceClient();

async function getSecretValue(secretName) {
  if (!secretName || !secretName.startsWith("projects/")) return secretName;
  try {
    const [version] = await secretManager.accessSecretVersion({ name: secretName });
    return version.payload.data.toString("utf8");
  } catch (e) {
    console.error(`Failed to load secret ${secretName}:`, e);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// 1. syncEmails (Cloud Scheduler per tenant freq, or master cron)
// ═══════════════════════════════════════════════════════════════════
async function syncEmailsHandler() {
  console.log("[Email Engine] Starting syncEmails...");
  try {
    // Note: Since each tenant can configure sync frequency (5m, 15m, 1h), a central master cron 
    // runs every 5 minutes and checks if it's time to sync for each tenant based on config.
    const tenantsSnap = await db.collection("tenants").where("active", "==", true).get();
    
    for (const tenantDoc of tenantsSnap.docs) {
      const tenantId = tenantDoc.id;
      const configDoc = await db.collection("tenants").doc(tenantId).collection("integrations").doc("email").get();
      
      if (!configDoc.exists || configDoc.data().status !== "connected") continue;
      
      const config = configDoc.data();
      const lastSync = config.last_sync_timestamp ? config.last_sync_timestamp.toDate() : new Date(0);
      const freqMs = (config.sync_frequency_minutes || 15) * 60 * 1000;
      
      if (Date.now() - lastSync.getTime() < freqMs) continue; // Not time yet

      const refreshTokenName = config.refresh_token_secret_name;
      const refreshToken = await getSecretValue(refreshTokenName);
      if (!refreshToken) {
        console.warn(`[Email Engine] Tenant ${tenantId} missing refresh token secret.`);
        continue;
      }

      // ─────────────────────────────────────────────────────────────
      // MOCK: Fetch Emails from Provider (Google / M365)
      // Real implementation would use googleapis or @microsoft/microsoft-graph-client
      // ─────────────────────────────────────────────────────────────
      // const emails = await fetchEmailsFromProvider(config.provider, refreshToken, lastSync);
      const mockEmails = [
        {
          id: `msg-${Date.now()}`,
          thread_id: "thread-123",
          subject: "Proposal Update",
          from: "client@emkan.com",
          to: "ceo@datalake.sa",
          cc: [],
          snippet: "Thanks for the meeting. I will send the proposal by Thursday. Please review.",
          timestamp: new Date(),
          attachments: [{ name: "specs.pdf", size: 102400 }]
        }
      ];

      for (const email of mockEmails) {
        // Match sender to CRM contacts
        const contactSnap = await db.collection("contacts")
          .where("tenant_id", "==", tenantId)
          .where("email", "==", email.from)
          .limit(1)
          .get();
        
        const contactId = contactSnap.empty ? null : contactSnap.docs[0].id;
        const contactName = contactSnap.empty ? "Unknown" : (contactSnap.docs[0].data().name || contactSnap.docs[0].data().full_name);

        const activityRef = db.collection("activities").doc();
        await activityRef.set({
          tenant_id: tenantId,
          type: "EMAIL",
          contact_id: contactId,
          contact_name: contactName,
          email_id: email.id,
          thread_id: email.thread_id,
          subject: email.subject,
          from: email.from,
          to: email.to,
          cc: email.cc,
          description: email.snippet,
          attachments: email.attachments,
          timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        // Publish to AI analyzer
        await pubsub.topic("datalake.email.synced").publishMessage({
          json: { tenant_id: tenantId, activity_id: activityRef.id, email_body: email.snippet }
        });
      }

      // Update last sync
      await configDoc.ref.update({ last_sync_timestamp: admin.firestore.FieldValue.serverTimestamp() });

      await logToBigQuery("datalake_audit", "ai_actions", {
        agent_name: "Email Engine", action_type: "SYNC_EMAILS", entity_id: tenantId, tenant_id: tenantId,
        result: "SUCCESS", timestamp: new Date()
      });
    }

  } catch (err) {
    console.error("[Email Engine] syncEmails error:", err);
  }
}

// ═══════════════════════════════════════════════════════════════════
// 2. analyzeEmail (Pub/Sub Subscriber)
// ═══════════════════════════════════════════════════════════════════
async function analyzeEmailHandler(event) {
  try {
    const { tenant_id, activity_id, email_body } = event.data.message.json;
    if (!tenant_id || !activity_id) throw new Error("Missing payload fields");

    const aiConfigDoc = await db.collection("tenants").doc(tenant_id).collection("integrations").doc("ai").get();
    const aiConfig = aiConfigDoc.exists ? aiConfigDoc.data() : { analysis_model: "qwen" };

    const prompt = `Analyze this email snippet:
    "${email_body}"
    
    Extract the following strictly in valid JSON format:
    {
      "sentiment": "positive|neutral|negative",
      "commitments": ["commitment text"],
      "intent": "request|complaint|information|approval|follow-up"
    }`;

    const analysisResponse = await callLLM(prompt, "You are an email analysis engine.", { model: aiConfig.analysis_model || "qwen" });
    const analysis = parseJsonOutput(analysisResponse);

    // Update activity record with analysis
    const activityRef = db.collection("activities").doc(activity_id);
    const activityDoc = await activityRef.get();
    if (!activityDoc.exists) return;
    
    const activity = activityDoc.data();

    await activityRef.update({
      analysis: analysis,
      analyzed_at: admin.firestore.FieldValue.serverTimestamp()
    });

    // Create Tasks for Commitments
    if (analysis.commitments && analysis.commitments.length > 0) {
      for (const commitment of analysis.commitments) {
        await db.collection("tasks").add({
          tenant_id: tenant_id,
          title: commitment,
          contact_id: activity.contact_id,
          status: "TODO",
          created_by: "system:EmailAI",
          created_at: admin.firestore.FieldValue.serverTimestamp()
        });
      }
    }

    // Update Client Health Score if contact is known
    if (activity.contact_id) {
      const contactRef = db.collection("contacts").doc(activity.contact_id);
      
      await db.runTransaction(async (transaction) => {
        const contactDoc = await transaction.get(contactRef);
        if (contactDoc.exists) {
          const contact = contactDoc.data();
          const currentScore = contact.health_score || 50; // Default 50/100
          
          let scoreModifier = 0;
          if (analysis.sentiment === "positive") scoreModifier = 5;
          if (analysis.sentiment === "negative") scoreModifier = -10;
          
          // Simple running adjustment (Real app would calc weighted average)
          const newScore = Math.max(0, Math.min(100, currentScore + scoreModifier));
          
          transaction.update(contactRef, {
            health_score: newScore,
            health_last_updated: admin.firestore.FieldValue.serverTimestamp()
          });
        }
      });
    }

    await logToBigQuery("datalake_audit", "ai_actions", {
      agent_name: "Email Engine", action_type: "ANALYZE_EMAIL", entity_id: activity_id, tenant_id: tenant_id,
      result: "SUCCESS", timestamp: new Date()
    });

  } catch (err) {
    console.error("[Email Engine] analyzeEmail error:", err);
    throw err;
  }
}

module.exports = {
  syncEmailsHandler,
  analyzeEmailHandler
};
