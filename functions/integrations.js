const admin = require("firebase-admin");
const { SecretManagerServiceClient } = require("@google-cloud/secret-manager");
const { logToBigQuery } = require("./lib/bigquery");

const db = admin.firestore();
const secretManager = new SecretManagerServiceClient();
const PROJECT_ID = "datalake-production-sa";

// Helper to determine if a field is sensitive based on key name
function isSensitiveField(key) {
  const sensitiveKeys = ['password', 'secret', 'token', 'api_key', 'access_token', 'refresh_token'];
  const lowerKey = key.toLowerCase();
  return sensitiveKeys.some(sk => lowerKey.includes(sk));
}

// Helper to save secret to Secret Manager
async function saveSecretToGCP(tenantId, provider, field, value) {
  // Secret IDs can only contain letters, numbers, hyphens, and underscores
  const secretId = `tenant_${tenantId}_${provider}_${field}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  const parent = `projects/${PROJECT_ID}`;
  const secretPath = `${parent}/secrets/${secretId}`;

  try {
    // Check if secret exists
    await secretManager.getSecret({ name: secretPath });
  } catch (err) {
    if (err.code === 5) { // NOT_FOUND
      // Create secret if it doesn't exist
      await secretManager.createSecret({
        parent: parent,
        secretId: secretId,
        secret: {
          replication: { automatic: {} },
        },
      });
    } else {
      throw err;
    }
  }

  // Add new secret version
  const [version] = await secretManager.addSecretVersion({
    parent: secretPath,
    payload: {
      data: Buffer.from(value, 'utf8'),
    },
  });

  return version.name; // e.g. projects/.../secrets/.../versions/1
}

// Helper to validate tenant access
async function validateTenantAccess(req, verifyAuth, getUserAccessProfile) {
  const decoded = await verifyAuth(req);
  const profile = await getUserAccessProfile(decoded.uid);
  
  // Validate role
  if (profile.role_id !== "ceo" && profile.role_id !== "it_admin") {
    throw new Error("Unauthorized: Must be ceo or it_admin");
  }

  // Fetch user document to get tenant_id
  const userDoc = await db.collection("users").doc(decoded.uid).get();
  if (!userDoc.exists) throw new Error("User not found");
  
  const userTenantId = userDoc.data().tenant_id;
  if (!userTenantId) throw new Error("User has no assigned tenant_id");

  // Validate X-Tenant-ID header
  const headerTenantId = req.headers['x-tenant-id'];
  if (!headerTenantId) throw new Error("Missing X-Tenant-ID header");

  if (userTenantId !== headerTenantId) {
    throw new Error("Unauthorized: Tenant mismatch");
  }

  return { uid: decoded.uid, email: profile.email, tenantId: userTenantId };
}

// ═══════════════════════════════════════════════════════════════════
// saveIntegrationConfig
// ═══════════════════════════════════════════════════════════════════
async function saveIntegrationConfigHandler(req, res, { verifyAuth, getUserAccessProfile, ALLOWED_ORIGINS }) {
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Origin", ALLOWED_ORIGINS.includes(req.headers.origin) ? req.headers.origin : "");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Tenant-ID");
    return res.status(204).send("");
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { email, tenantId } = await validateTenantAccess(req, verifyAuth, getUserAccessProfile);
    const { provider, config } = req.body;

    if (!provider || !config) {
      return res.status(400).json({ error: "provider and config object required" });
    }

    const secureConfig = { ...config };
    const now = admin.firestore.FieldValue.serverTimestamp();

    // Process sensitive fields
    for (const [key, value] of Object.entries(config)) {
      if (isSensitiveField(key) && value && typeof value === 'string' && !value.startsWith('projects/')) {
        // Assume it's a raw secret that needs to be stored
        const secretName = await saveSecretToGCP(tenantId, provider, key, value);
        // Replace raw value with the secret name reference
        secureConfig[key] = secretName;
      }
    }

    secureConfig.updated_at = now;
    secureConfig.updated_by = email;

    // Save to Firestore
    await db.collection("tenants").doc(tenantId).collection("integrations").doc(provider).set(secureConfig, { merge: true });

    // Audit Log to BigQuery
    await logToBigQuery("datalake_audit", "admin_audit_log", {
      agent_name: "Platform",
      action_type: "SAVE_INTEGRATION_CONFIG",
      entity_id: provider,
      tenant_id: tenantId,
      result: "SUCCESS",
      duration_ms: 0,
      timestamp: new Date()
    });

    return res.status(200).json({ success: true, message: `Configuration saved for ${provider}` });
  } catch (err) {
    console.error("saveIntegrationConfig error:", err);
    return res.status(err.message.startsWith("Unauthorized") ? 403 : 500).json({ error: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════
// getIntegrationConfig
// ═══════════════════════════════════════════════════════════════════
async function getIntegrationConfigHandler(req, res, { verifyAuth, getUserAccessProfile, ALLOWED_ORIGINS }) {
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Origin", ALLOWED_ORIGINS.includes(req.headers.origin) ? req.headers.origin : "");
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Tenant-ID");
    return res.status(204).send("");
  }
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { tenantId } = await validateTenantAccess(req, verifyAuth, getUserAccessProfile);
    const provider = req.query.provider;

    if (!provider) {
      return res.status(400).json({ error: "provider query parameter required" });
    }

    const doc = await db.collection("tenants").doc(tenantId).collection("integrations").doc(provider).get();
    if (!doc.exists) {
      return res.status(200).json({ config: null });
    }

    const config = doc.data();

    // Mask sensitive fields so the frontend doesn't see the secret paths (or actual secrets)
    for (const [key, value] of Object.entries(config)) {
      if (isSensitiveField(key) && value) {
        config[key] = "********"; // Masked representation
      }
    }

    return res.status(200).json({ config });
  } catch (err) {
    console.error("getIntegrationConfig error:", err);
    return res.status(err.message.startsWith("Unauthorized") ? 403 : 500).json({ error: err.message });
  }
}

module.exports = {
  saveIntegrationConfigHandler,
  getIntegrationConfigHandler
};
