"use strict";

const { PubSub } = require("@google-cloud/pubsub");
const pubsub = new PubSub();

// ══════════════════════════════════════════════════════════════════
// monthlyOperationsTriggerHandler
// ══════════════════════════════════════════════════════════════════
async function monthlyOperationsTriggerHandler() {
  console.log("[Ops] Running monthlyOperationsTriggerHandler...");
  try {
    const now = new Date();
    // E.g. "2026-06" if run on July 1st, we want to report on June, but it could be the current month.
    // Usually a monthly trigger on the 1st processes the *previous* month.
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const year = lastMonth.getFullYear();
    const month = String(lastMonth.getMonth() + 1).padStart(2, '0');
    
    const payload = {
      year,
      month,
      year_month: `${year}-${month}`,
      triggered_at: now.toISOString()
    };

    const topic = pubsub.topic("datalake.monthly.trigger");
    await topic.publishMessage({ json: payload });

    console.log(`[Ops] Published datalake.monthly.trigger for ${payload.year_month}`);
  } catch (err) {
    console.error("[Ops] monthlyOperationsTrigger failed:", err);
  }
}

module.exports = {
  monthlyOperationsTriggerHandler
};
