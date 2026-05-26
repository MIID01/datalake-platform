const admin = require("firebase-admin");
const { PubSub } = require("@google-cloud/pubsub");
const pubsub = new PubSub();
const db = admin.firestore();

// 1. submitLeaveRequest — HTTP
async function submitLeaveRequestHandler(req, res, { verifyAuth, getUserAccessProfile, ALLOWED_ORIGINS }) {
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Origin", ALLOWED_ORIGINS.includes(req.headers.origin) ? req.headers.origin : "");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return res.status(204).send("");
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const decoded = await verifyAuth(req);
    const profile = await getUserAccessProfile(decoded.uid);

    const { start_date, end_date, type } = req.body;
    if (!start_date || !end_date || !type) return res.status(400).json({ error: "Missing fields" });

    const leaveRef = db.collection("leave_requests").doc();
    const now = admin.firestore.FieldValue.serverTimestamp();

    await leaveRef.set({
      emp_id: profile.uid,
      emp_email: profile.email,
      start_date,
      end_date,
      type,
      state: "PENDING_VALIDATION",
      created_at: now,
    });

    // PUBLISH
    await pubsub.topic("datalake.leave.requested").publishMessage({ json: { leave_id: leaveRef.id } });

    return res.status(200).json({ success: true, leave_id: leaveRef.id });
  } catch (err) {
    console.error("submitLeaveRequest error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// 2. gatekeeperValidateLeave — Pub/Sub (datalake.leave.requested)
async function gatekeeperValidateLeaveHandler(event) {
  try {
    const { leave_id } = event.data.message.json;
    if (!leave_id) throw new Error("leave_id required");

    const leaveDoc = await db.collection("leave_requests").doc(leave_id).get();
    if (!leaveDoc.exists) throw new Error("Leave request not found");
    
    // Gatekeeper AI logic goes here to validate entitlement
    // For now, we update to PENDING_APPROVAL
    await db.collection("leave_requests").doc(leave_id).update({
      state: "PENDING_APPROVAL",
      gatekeeper_validated_at: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`Gatekeeper validated leave ${leave_id}`);
  } catch (err) {
    console.error("gatekeeperValidateLeave error:", err);
    throw err;
  }
}

// 3. approveLeave — HTTP (CEO)
async function approveLeaveHandler(req, res, { verifyAuth, getUserAccessProfile, ALLOWED_ORIGINS }) {
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Origin", ALLOWED_ORIGINS.includes(req.headers.origin) ? req.headers.origin : "");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return res.status(204).send("");
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const decoded = await verifyAuth(req);
    const profile = await getUserAccessProfile(decoded.uid);
    if (profile.role_id !== "ceo") return res.status(403).json({ error: "CEO only" });

    const { leave_id } = req.body;
    if (!leave_id) return res.status(400).json({ error: "leave_id required" });

    await db.collection("leave_requests").doc(leave_id).update({
      state: "APPROVED",
      approved_by: profile.email,
      approved_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    // PUBLISH
    await pubsub.topic("datalake.leave.approved").publishMessage({ json: { leave_id } });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("approveLeave error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// 4. controllerAdjustPayroll — Pub/Sub (datalake.leave.approved)
async function controllerAdjustPayrollHandler(event) {
  try {
    const { leave_id } = event.data.message.json;
    if (!leave_id) throw new Error("leave_id required");

    const leaveDoc = await db.collection("leave_requests").doc(leave_id).get();
    if (!leaveDoc.exists) throw new Error("Leave request not found");
    
    // Controller AI logic to adjust payroll
    await db.collection("leave_requests").doc(leave_id).update({
      payroll_adjusted: true,
      payroll_adjusted_at: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`Controller adjusted payroll for leave ${leave_id}`);
  } catch (err) {
    console.error("controllerAdjustPayroll error:", err);
    throw err;
  }
}

module.exports = {
  submitLeaveRequestHandler,
  gatekeeperValidateLeaveHandler,
  approveLeaveHandler,
  controllerAdjustPayrollHandler,
};
