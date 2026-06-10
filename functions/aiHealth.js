/**
 * getAiServiceHealth — DTLK-ARCH-AI-002
 *
 * Server-side health check for all AI Cloud Run services.
 * Queries Cloud Run Admin API + Cloud Monitoring for real signals.
 * No mocking, no setTimeout, no client-stamped timestamps.
 *
 * HEALTH CRITERIA (explicit pass/fail per service):
 *   HEALTHY   = latestReadyRevision exists AND ready=True AND
 *               0 serving instances configured (scale-to-zero OK) AND
 *               24h 5xx rate < 20% of total requests (or 0 requests)
 *   DEGRADED  = ready=True BUT 5xx rate >= 20% in last 24h
 *   NOT_DEPLOYED = Cloud Run service does not exist in me-central2
 *   ERROR     = ready=False or condition shows failure message
 *   UNKNOWN   = API call failed — never default to healthy
 *
 * Caller: CEO AI Operations dashboard (/ceo/ai-ops).
 * Role:   CEO only (enforced here + firestore.rules).
 */

const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { GoogleAuth } = require("google-auth-library");
const https = require("https");

if (!admin.apps.length) admin.initializeApp();

const PROJECT  = "datalake-production-sa";
const REGION   = "me-central2";
const LOCATION = `projects/${PROJECT}/locations/${REGION}`;

// ── Canonical service registry — ground truth for DTLK-ARCH-AI-002 ──────────
// name: actual Cloud Run service name in me-central2 (case-sensitive)
// label: display name for the dashboard
// role: what this service does
// url: the authoritative URL (from ai-client.js — env var fallback values)
const SERVICE_REGISTRY = [
  {
    name:  "datalake-ai-inference",
    label: "LLM Inference (Qwen 2.5)",
    role:  "inference",
    url:   "https://datalake-ai-inference-808056940626.me-central2.run.app",
  },
  {
    name:  "datalake-ocr",
    label: "OCR (PaddleOCR)",
    role:  "ocr",
    url:   "https://datalake-ocr-808056940626.me-central2.run.app",
  },
  {
    name:  "datalake-cv-agent",
    label: "CV Agent",
    role:  "cv-agent",
    url:   "https://datalake-cv-agent-808056940626.me-central2.run.app",
  },
  // The "agents" are NOT standalone AI services (there is no gatekeeper/controller/
  // auditor *-ai-service, and no qwen-inference-service). They are Cloud FUNCTIONS
  // that invoke datalake-ai-inference via functions/lib/ai-client.js, and run as
  // Cloud Run gen2-function services. Health-checked the same way, but labelled as
  // FUNCTIONS so the dashboard never implies a phantom service.
  {
    name:  "gatekeepercontractextract",
    label: "Gatekeeper Agent (Cloud Function)",
    role:  "function",
    url:   "https://gatekeepercontractextract-ifzodp5svq-wx.a.run.app",
  },
  {
    name:  "controllertimesheetvalidate",
    label: "Controller Agent (Cloud Function)",
    role:  "function",
    url:   "https://controllertimesheetvalidate-ifzodp5svq-wx.a.run.app",
  },
  {
    name:  "auditorcompliancecheck",
    label: "Auditor Agent (Cloud Function)",
    role:  "function",
    url:   "https://auditorcompliancecheck-ifzodp5svq-wx.a.run.app",
  },
];

// Health thresholds
const ERROR_RATE_THRESHOLD = 0.20; // 20% 5xx rate → DEGRADED

function httpsGet(token, hostname, path) {
  return new Promise((resolve, reject) => {
    https.get(
      { hostname, path, headers: { Authorization: "Bearer " + token } },
      (r) => {
        let d = "";
        r.on("data", (c) => (d += c));
        r.on("end", () => {
          try { resolve({ status: r.statusCode, body: JSON.parse(d) }); }
          catch(e) { resolve({ status: r.statusCode, body: { raw: d.slice(0, 300) } }); }
        });
      }
    ).on("error", reject);
  });
}

function httpsPost(token, hostname, path, body) {
  return new Promise((resolve, reject) => {
    const s = JSON.stringify(body);
    const opts = {
      hostname, path, method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(s),
      },
    };
    const req = https.request(opts, (r) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => {
        try { resolve({ status: r.statusCode, body: JSON.parse(d) }); }
        catch(e) { resolve({ status: r.statusCode, body: { raw: d.slice(0, 300) } }); }
      });
    });
    req.on("error", reject);
    req.write(s); req.end();
  });
}

/**
 * Fetch Cloud Run service metadata for all services in one call.
 * Returns a map: serviceName → { ready, latestRevision, uri, readyReason, readyMsg }
 */
async function fetchCloudRunState(token) {
  const serviceMap = {};
  let pageToken = "";
  do {
    const url = `/v2/${LOCATION}/services?pageSize=50` +
                (pageToken ? "&pageToken=" + pageToken : "");
    const r = await httpsGet(token, "run.googleapis.com", url);
    if (r.body.error) {
      console.error("[getAiServiceHealth] Cloud Run list error:", JSON.stringify(r.body.error));
      break;
    }
    for (const svc of (r.body.services || [])) {
      const name = svc.name.split("/").pop();
      const cond = (svc.conditions || []).find((c) => c.type === "Ready") || {};
      serviceMap[name] = {
        ready:          cond.state === "CONDITION_SUCCEEDED",
        readyReason:    cond.reason || "",
        readyMsg:       cond.message ? cond.message.slice(0, 200) : "",
        latestRevision: svc.latestReadyRevision ? svc.latestReadyRevision.split("/").pop() : null,
        uri:            svc.uri || null,
        updateTime:     svc.updateTime || svc.createTime || null,
        trafficAllocation: (svc.traffic || []).map((t) =>
          `${t.revision ? t.revision.split("/").pop() : "latest"}:${t.percent || 0}%`
        ).join(", "),
      };
    }
    pageToken = r.body.nextPageToken || "";
  } while (pageToken);
  return serviceMap;
}

/**
 * Fetch 24h request counts from Cloud Monitoring, broken down by
 * service_name and response_code_class (2xx, 4xx, 5xx).
 * Returns: { serviceName: { "2xx": N, "4xx": N, "5xx": N, total: N, lastRequestTime: ISO } }
 */
async function fetchMonitoringMetrics(token) {
  const query = [
    "fetch cloud_run_revision",
    "| metric 'run.googleapis.com/request_count'",
    `| filter resource.project_id == '${PROJECT}'`,
    `| filter resource.location == '${REGION}'`,
    "| group_by [resource.service_name, metric.response_code_class]",
    "  [value: sum(value.request_count)]",
    // 30d window so the error rate reflects REAL traffic. A 24h window is usually
    // idle for these event-driven services and would falsely read green. Idle-in-24h
    // is reported separately (idle_24h) from lastRequestTime.
    "| within 30d",
  ].join("\n");

  const r = await httpsPost(
    token,
    "monitoring.googleapis.com",
    `/v3/projects/${PROJECT}/timeSeries:query`,
    { name: `projects/${PROJECT}`, query }
  );

  const counts = {};
  if (r.body.error) {
    console.error("[getAiServiceHealth] Monitoring error:", JSON.stringify(r.body.error).slice(0, 300));
    return counts;
  }

  const descriptor = r.body.timeSeriesDescriptor || {};
  const labelKeys = (descriptor.labelDescriptors || []).map((l) => l.key);

  for (const series of (r.body.timeSeriesData || [])) {
    const labels = {};
    (series.labelValues || []).forEach((lv, i) => {
      labels[labelKeys[i] || `l${i}`] = lv.stringValue || lv.int64Value || "";
    });
    const svcName   = labels["resource.service_name"] || "";
    const codeClass = labels["metric.response_code_class"] || "unknown";
    let total = 0;
    for (const pt of (series.pointData || [])) {
      total += parseInt((pt.values && pt.values[0] && pt.values[0].int64Value) || 0, 10);
    }
    if (!counts[svcName]) counts[svcName] = { "2xx": 0, "4xx": 0, "5xx": 0, total: 0 };
    counts[svcName][codeClass] = (counts[svcName][codeClass] || 0) + total;
    counts[svcName].total += total;
  }
  return counts;
}

/**
 * Fetch the timestamp of the most recent request per service from Logging.
 * Returns: { serviceName: ISO8601 string | null }
 */
async function fetchLastRequestTimes(token, serviceNames) {
  // One Logging query covering all target services
  const filter = [
    `resource.type="cloud_run_revision"`,
    `resource.labels.location="${REGION}"`,
    `(${serviceNames.map((n) => `resource.labels.service_name="${n}"`).join(" OR ")})`,
    `httpRequest.status:*`,
  ].join(" ");

  const r = await httpsPost(
    token,
    "logging.googleapis.com",
    "/v2/entries:list",
    {
      resourceNames: [`projects/${PROJECT}`],
      filter,
      orderBy: "timestamp desc",
      pageSize: serviceNames.length * 3, // a few per service is enough
    }
  );

  const lastTimes = {};
  for (const entry of (r.body.entries || [])) {
    const svcName = entry.resource?.labels?.service_name;
    if (svcName && !lastTimes[svcName]) {
      lastTimes[svcName] = entry.timestamp || null;
    }
  }
  return lastTimes;
}

/** Compute health status from gathered signals */
function computeHealth(svcDef, cloudRunEntry, metrics, lastRequestTime) {
  // Service not deployed at all
  if (!cloudRunEntry) {
    return {
      status:          "NOT_DEPLOYED",
      ready:           false,
      latestRevision:  null,
      uri:             svcDef.url,
      windowDays:      30,
      idle24h:         null,
      errorRateWindow: null,
      requestsWindow:  null,
      success2xxWindow: null,
      errors5xxWindow: null,
      lastRequestTime: null,
      note:            "Cloud Run service absent in me-central2.",
      criteria: { deployed: false, readyCondition: false, errorRateOk: null, hasSuccesses: null },
    };
  }

  const reqW    = metrics ? metrics.total          : 0;   // requests in the 30d window
  const ok2xx   = metrics ? (metrics["2xx"] || 0)  : 0;
  const err5xx  = metrics ? (metrics["5xx"] || 0)  : 0;
  const errRate = reqW > 0 ? err5xx / reqW : 0;
  // Idle in the last 24h = ready but no request recently. Reported alongside the
  // 30d verdict (NOT a substitute for it) so a quiet day never masks a real fault.
  const idle24h = !lastRequestTime || (Date.now() - new Date(lastRequestTime).getTime() > 24 * 3600 * 1000);

  const readyCondition = cloudRunEntry.ready;

  // Honest verdict — never a green default. Worst applicable wins.
  let status, note;
  if (!readyCondition) {
    status = "ERROR";
    note   = cloudRunEntry.readyMsg || cloudRunEntry.readyReason || "Ready condition false";
  } else if (reqW === 0) {
    status = "IDLE";
    note   = "Ready, but ZERO requests in 30d — cannot assert healthy.";
  } else if (ok2xx === 0 || errRate >= 0.5) {
    status = "BROKEN";
    note   = `${err5xx}/${reqW} are 5xx (${(errRate * 100).toFixed(0)}%) with ${ok2xx} successes over 30d — effectively non-functional. /health 200 does NOT reflect the real path.`;
  } else if (errRate >= ERROR_RATE_THRESHOLD) {
    status = "DEGRADED";
    note   = `5xx rate ${(errRate * 100).toFixed(1)}% over 30d exceeds ${ERROR_RATE_THRESHOLD * 100}% threshold.`;
  } else {
    status = "HEALTHY";
    note   = `${reqW} requests, ${err5xx} 5xx (${(errRate * 100).toFixed(1)}%) over 30d.${idle24h ? " Idle in the last 24h." : ""}`;
  }

  return {
    status,
    ready:            readyCondition,
    latestRevision:   cloudRunEntry.latestRevision,
    uri:              cloudRunEntry.uri,
    trafficAllocation: cloudRunEntry.trafficAllocation,
    windowDays:       30,
    idle24h,
    errorRateWindow:  reqW > 0 ? parseFloat((errRate * 100).toFixed(1)) : null,
    requestsWindow:   reqW,
    success2xxWindow: ok2xx,
    errors5xxWindow:  err5xx,
    lastRequestTime:  lastRequestTime || null,
    note,
    criteria: {
      deployed:       true,
      readyCondition,
      errorRateOk:    reqW === 0 || errRate < ERROR_RATE_THRESHOLD,
      hasSuccesses:   ok2xx > 0,
    },
  };
}

exports.getAiServiceHealth = onRequest(
  {
    region:         REGION,
    memory:         "256MiB",
    timeoutSeconds: 30,
    cors: ["https://datalake-production-sa.web.app", "https://datalake-production-sa.firebaseapp.com",
           "http://localhost:5173"],
  },
  async (req, res) => {
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }

    // ── Auth — CEO only ──
    try {
      const authHeader = req.headers.authorization || "";
      if (!authHeader.startsWith("Bearer ")) {
        res.status(401).json({ error: "Missing Authorization header" }); return;
      }
      const decoded = await admin.auth().verifyIdToken(authHeader.split("Bearer ")[1]);
      if ((decoded.email || "").toLowerCase() !== "m.alqumri@datalake.sa") {
        res.status(403).json({ error: "CEO access required" }); return;
      }
    } catch (e) {
      res.status(401).json({ error: "Invalid token: " + e.message }); return;
    }

    try {
      // Get a GCP access token (service account identity of Cloud Functions)
      const gauth  = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
      const token  = await gauth.getAccessToken();

      // Query all three data sources in parallel
      const deployedServiceNames = SERVICE_REGISTRY
        .filter((s) => s.url !== null)
        .map((s) => s.name);

      const [cloudRunMap, metricsMap, lastRequestMap] = await Promise.all([
        fetchCloudRunState(token),
        fetchMonitoringMetrics(token),
        fetchLastRequestTimes(token, deployedServiceNames),
      ]);

      // Build per-service health report
      const services = SERVICE_REGISTRY.map((svcDef) => ({
        name:    svcDef.name,
        label:   svcDef.label,
        role:    svcDef.role,
        health:  computeHealth(
          svcDef,
          cloudRunMap[svcDef.name] || null,
          metricsMap[svcDef.name]  || null,
          lastRequestMap[svcDef.name] || null,
        ),
      }));

      // Summary counts (one per honest verdict)
      const tally = (st) => services.filter((s) => s.health.status === st).length;
      const summary = {
        healthy:      tally("HEALTHY"),
        degraded:     tally("DEGRADED"),
        broken:       tally("BROKEN"),
        idle:         tally("IDLE"),
        error:        tally("ERROR"),
        not_deployed: tally("NOT_DEPLOYED"),
      };

      res.status(200).json({
        checkedAt:    new Date().toISOString(),
        project:      PROJECT,
        region:       REGION,
        criteria: {
          healthy:   "ready AND has 2xx AND 5xxRate<20% over 30d",
          degraded:  "ready AND 5xxRate 20–50% over 30d",
          broken:    "ready AND (0 successes OR 5xxRate>=50%) over 30d — /health 200 is NOT trusted",
          idle:      "ready AND 0 requests over 30d",
          error:     "Cloud Run ready condition false",
          not_deployed: "Cloud Run service absent in me-central2",
          window:    "30d for rate verdict; idle24h reported separately from lastRequestTime",
        },
        summary,
        services,
      });
    } catch (err) {
      console.error("[getAiServiceHealth] Error:", err.message, err.stack);
      res.status(500).json({ error: "Health check failed: " + err.message });
    }
  }
);
