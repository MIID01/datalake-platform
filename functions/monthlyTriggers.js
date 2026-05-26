const admin = require("firebase-admin");
const db = admin.firestore();

// 1. gatekeeperMonthlyHandler — Pub/Sub (datalake.monthly.trigger)
async function gatekeeperMonthlyHandler(event) {
  try {
    console.log("[Gatekeeper] Monthly trigger received. Checking active users...");
    // Future logic goes here
  } catch (err) {
    console.error("gatekeeperMonthly error:", err);
    throw err;
  }
}

// 2. controllerMonthlyHandler — Pub/Sub (datalake.monthly.trigger)
async function controllerMonthlyHandler(event) {
  try {
    console.log("[Controller] Monthly trigger received. Reconciling general ledger...");
    // Future logic goes here
  } catch (err) {
    console.error("controllerMonthly error:", err);
    throw err;
  }
}

module.exports = {
  gatekeeperMonthlyHandler,
  controllerMonthlyHandler,
};
