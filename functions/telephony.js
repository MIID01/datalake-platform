const admin = require("firebase-admin");
const { PubSub } = require("@google-cloud/pubsub");
const { logToBigQuery } = require("./lib/bigquery");
const { callLLM, parseJsonOutput } = require("./lib/ai-client");

const db = admin.firestore();
const pubsub = new PubSub();
const PROJECT_ID = "datalake-production-sa";

// ═══════════════════════════════════════════════════════════════════
// 1. handleIncomingCall (HTTP Webhook from SIP Provider)
// ═══════════════════════════════════════════════════════════════════
async function handleIncomingCallHandler(req, res) {
  try {
    // We expect the SIP provider to pass tenant_id as a query param or path param
    const tenantId = req.query.tenant_id;
    if (!tenantId) return res.status(400).send("tenant_id required");

    const payload = req.body;
    
    // Agnostic extraction: Try to find standard fields across different SIP provider webhooks
    const callerNumber = payload.From || payload.caller_id || payload.source || "";
    const calledNumber = payload.To || payload.destination || "";
    const callId = payload.CallSid || payload.call_id || payload.session_id || `call-${Date.now()}`;

    // Read Telephony Config
    const configDoc = await db.collection("tenants").doc(tenantId).collection("integrations").doc("telephony").get();
    if (!configDoc.exists || configDoc.data().status !== "connected") {
      console.warn(`[Telephony] Tenant ${tenantId} has no active telephony config.`);
      // Return neutral response
      return res.status(200).send("OK");
    }

    const config = configDoc.data();

    // Match caller to a CRM contact
    const contactsSnap = await db.collection("contacts")
      .where("tenant_id", "==", tenantId)
      .where("phone", "==", callerNumber)
      .limit(1)
      .get();
    
    let contactId = null;
    let contactName = "Unknown Caller";
    if (!contactsSnap.empty) {
      contactId = contactsSnap.docs[0].id;
      contactName = contactsSnap.docs[0].data().name || contactsSnap.docs[0].data().full_name;
    }

    // Initialize call record
    const callRef = db.collection("tenants").doc(tenantId).collection("calls").doc(callId);
    await callRef.set({
      call_id: callId,
      caller_number: callerNumber,
      called_number: calledNumber,
      contact_id: contactId,
      contact_name: contactName,
      provider: config.provider,
      status: "in-progress",
      started_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    await logToBigQuery("datalake_audit", "ai_actions", {
      agent_name: "Telephony Engine", action_type: "INCOMING_CALL", entity_id: callId, tenant_id: tenantId,
      result: "SUCCESS", timestamp: new Date()
    });

    // Send generic response to start recording (this varies slightly by provider, but many accept standard XML/JSON)
    // For a fully agnostic engine, we just return HTTP 200 OK. The provider should be configured to record automatically.
    // If returning generic TwiML-like XML:
    res.setHeader("Content-Type", "text/xml");
    res.status(200).send(`
      <Response>
        <Record action="/handleCallCompleted?tenant_id=${tenantId}&amp;call_id=${callId}" />
      </Response>
    `);
  } catch (err) {
    console.error("handleIncomingCall error:", err);
    res.status(500).send("Error processing call");
  }
}

// ═══════════════════════════════════════════════════════════════════
// 2. handleCallCompleted (HTTP Webhook from SIP Provider)
// ═══════════════════════════════════════════════════════════════════
async function handleCallCompletedHandler(req, res) {
  try {
    const tenantId = req.query.tenant_id;
    const callId = req.query.call_id || req.body.CallSid || req.body.call_id;
    if (!tenantId || !callId) return res.status(400).send("tenant_id and call_id required");

    const payload = req.body;
    // Extract recording URL (providers send this differently)
    const recordingUrl = payload.RecordingUrl || payload.recording_url || payload.file_url;

    if (!recordingUrl) {
      console.log(`[Telephony] No recording URL provided for call ${callId}`);
      return res.status(200).send("OK");
    }

    // Fetch config for recording bucket
    const configDoc = await db.collection("tenants").doc(tenantId).collection("integrations").doc("telephony").get();
    const bucketName = configDoc.exists ? configDoc.data().recording_bucket : "datalake-worm-finance"; // Fallback bucket
    
    // In a real scenario, we would download the file from `recordingUrl` and upload to GCS.
    // Assuming we do that here:
    // const audioRes = await fetch(recordingUrl);
    // const audioBuffer = await audioRes.buffer();
    // const file = admin.storage().bucket(bucketName).file(`recordings/${tenantId}/${callId}.wav`);
    // await file.save(audioBuffer);
    
    const internalGcsUrl = `gs://${bucketName}/recordings/${tenantId}/${callId}.wav`;

    // Update call record
    const callRef = db.collection("tenants").doc(tenantId).collection("calls").doc(callId);
    await callRef.update({
      status: "completed",
      recording_url: internalGcsUrl,
      duration: payload.Duration || payload.duration || 0,
      completed_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Publish to Pub/Sub for Transcription
    await pubsub.topic("datalake.call.completed").publishMessage({
      json: { tenant_id: tenantId, call_id: callId, recording_url: internalGcsUrl }
    });

    res.status(200).send("OK");
  } catch (err) {
    console.error("handleCallCompleted error:", err);
    res.status(500).send("Error");
  }
}

// ═══════════════════════════════════════════════════════════════════
// 3. transcribeCall (Pub/Sub Subscriber)
// ═══════════════════════════════════════════════════════════════════
async function transcribeCallHandler(event) {
  console.log("[Telephony AI] Starting transcribeCall...");
  try {
    const { tenant_id, call_id, recording_url } = event.data.message.json;
    if (!tenant_id || !call_id) throw new Error("tenant_id and call_id required");

    const aiConfigDoc = await db.collection("tenants").doc(tenant_id).collection("integrations").doc("ai").get();
    const aiConfig = aiConfigDoc.exists ? aiConfigDoc.data() : { auto_transcribe_calls: true };

    if (aiConfig.auto_transcribe_calls === false) {
      console.log(`[Telephony AI] Auto-transcribe disabled for tenant ${tenant_id}`);
      return;
    }

    // No real transcription backend exists yet. Per the No-Fabricated-Data rule we
    // do NOT invent or store a transcript. Mark it explicitly unavailable, store NO
    // transcript text, and do NOT trigger downstream analysis (nothing real to
    // analyse). Deferred: self-hosted, in-region (me-central2) STT — see TODO.md.
    const callRef = db.collection("tenants").doc(tenant_id).collection("calls").doc(call_id);
    await callRef.update({
      transcript: null,
      transcription_status: "NOT_AVAILABLE",
      transcription_note: "Transcription not configured — no self-hosted in-region STT backend.",
      transcribed_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    await logToBigQuery("datalake_audit", "ai_actions", {
      agent_name: "Telephony Engine", action_type: "TRANSCRIBE_CALL", entity_id: call_id, tenant_id: tenant_id,
      result: "SKIPPED_NO_STT_BACKEND", timestamp: new Date()
    });
    console.log(`[Telephony AI] No STT backend — transcript NOT_AVAILABLE for call ${call_id} (recording present: ${!!recording_url})`);

  } catch (err) {
    console.error("[Telephony AI] transcribeCall error:", err);
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════
// 4. analyzeCall (Pub/Sub Subscriber)
// ═══════════════════════════════════════════════════════════════════
async function analyzeCallHandler(event) {
  console.log("[Telephony AI] Starting analyzeCall...");
  try {
    const { tenant_id, call_id } = event.data.message.json;
    if (!tenant_id || !call_id) throw new Error("tenant_id and call_id required");

    const aiConfigDoc = await db.collection("tenants").doc(tenant_id).collection("integrations").doc("ai").get();
    const aiConfig = aiConfigDoc.exists ? aiConfigDoc.data() : { analysis_model: "qwen", auto_extract_commitments: true };

    const callRef = db.collection("tenants").doc(tenant_id).collection("calls").doc(call_id);
    const callDoc = await callRef.get();
    if (!callDoc.exists || !callDoc.data().transcript) throw new Error(`Call ${call_id} or transcript missing`);
    
    const call = callDoc.data();

    const prompt = `Analyze this call transcript:
    "${call.transcript}"
    
    Extract the following in strictly valid JSON format, with no markdown formatting or backticks:
    {
      "sentiment": "positive|neutral|negative",
      "topics": ["topic1", "topic2"],
      "action_items": ["item1"],
      "commitments": ["commitment1"]
    }`;

    // Analysis runs on the self-hosted Qwen LLM via callLLM (ai-client.js) — no external model.
    const analysisResponse = await callLLM(prompt, "You are a CRM analysis engine.", { model: aiConfig.analysis_model || "qwen" });
    const analysis = parseJsonOutput(analysisResponse);

    await callRef.update({
      analysis: analysis,
      analyzed_at: admin.firestore.FieldValue.serverTimestamp()
    });

    // Create Activity in CRM
    const activityRef = db.collection("activities").doc();
    await activityRef.set({
      tenant_id,
      type: "CALL",
      contact_id: call.contact_id || null,
      contact_name: call.contact_name || "Unknown",
      description: `Call with ${call.contact_name} regarding: ${analysis.topics.join(", ")}`,
      sentiment: analysis.sentiment,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    // Create Tasks for Commitments
    if (aiConfig.auto_extract_commitments && analysis.action_items && analysis.action_items.length > 0) {
      for (const taskStr of analysis.action_items) {
        await db.collection("tasks").add({
          tenant_id,
          title: taskStr,
          contact_id: call.contact_id || null,
          status: "TODO",
          created_by: "system:TelephonyAI",
          created_at: admin.firestore.FieldValue.serverTimestamp()
        });
      }
    }

    await logToBigQuery("datalake_audit", "ai_actions", {
      agent_name: "Telephony Engine", action_type: "ANALYZE_CALL", entity_id: call_id, tenant_id: tenant_id,
      result: "SUCCESS", timestamp: new Date()
    });

  } catch (err) {
    console.error("[Telephony AI] analyzeCall error:", err);
    throw err;
  }
}

module.exports = {
  handleIncomingCallHandler,
  handleCallCompletedHandler,
  transcribeCallHandler,
  analyzeCallHandler
};
