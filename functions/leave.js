const admin = require("firebase-admin");
const { PubSub } = require("@google-cloud/pubsub");
const pubsub = new PubSub();
const db = admin.firestore();
const { routeForApproval } = require("./approvalRouting");
const { notify } = require("./notifications");

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

    const start = new Date(start_date);
    const end = new Date(end_date);
    const days = (end - start) / (1000 * 60 * 60 * 24);

    await leaveRef.set({
      emp_id: profile.uid,
      emp_email: profile.email,
      start_date,
      end_date,
      days,
      type,
      state: "PENDING_VALIDATION",
      created_at: now,
    });

    // We changed the topic to route to our new validate function
    await pubsub.topic("datalake.leave.requested").publishMessage({ json: { leave_id: leaveRef.id } });

    return res.status(200).json({ success: true, leave_id: leaveRef.id });
  } catch (err) {
    console.error("submitLeaveRequest error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// 2. validateLeaveRequest (Pub/Sub) - Replaces gatekeeperValidateLeave
async function validateLeaveRequestHandler(event) {
  try {
    const { leave_id } = event.data.message.json;
    if (!leave_id) throw new Error("leave_id required");

    const leaveDoc = await db.collection("leave_requests").doc(leave_id).get();
    if (!leaveDoc.exists) throw new Error("Leave request not found");
    const leave = leaveDoc.data();

    // CALL ROUTING ENGINE
    const route = await routeForApproval("leave", leave.emp_id, { type: leave.type, days: leave.days });
    
    // Store route in leave doc so we know who should approve
    await db.collection("leave_requests").doc(leave_id).update({
      route,
      gatekeeper_validated_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    if (route.action === "auto_approve") {
      await db.collection("leave_requests").doc(leave_id).update({ state: "APPROVED" });
      await pubsub.topic("datalake.leave.approved").publishMessage({ json: { leave_id } });
      
      for (const n of route.notify) {
        await notify(n, "leave_auto_approved", { leave_id });
      }
    } else if (route.first_approver && route.first_approver.includes("@")) {
      // It's a client PM email (deployed engineer)
      await notifyClientLeave(leave_id, leave, route.first_approver);
    } else {
      // Internal approver
      await db.collection("leave_requests").doc(leave_id).update({ state: "PENDING_APPROVAL", current_approver: route.approver || route.first_approver });
      await notify(route.approver || route.first_approver, "leave_requires_approval", { leave_id });
    }
  } catch (err) {
    console.error("validateLeaveRequest error:", err);
    throw err;
  }
}

async function notifyClientLeave(leaveId, leave, clientPMEmail) {
  const token = `token_${leaveId}_${Date.now()}`;
  
  await db.collection("leave_requests").doc(leaveId).update({
    state: "CLIENT_PENDING",
    client_pm_email: clientPMEmail,
    client_approval_token: token
  });

  // Create CRM Activity
  await db.collection("activities").add({
    tenant_id: "datalake", // Default tenant
    type: "EMAIL",
    contact_email: clientPMEmail,
    description: `Leave request approval sent to client for ${leave.emp_email}`,
    timestamp: admin.firestore.FieldValue.serverTimestamp()
  });

  // Mock sending email
  console.log(`[Email] To: ${clientPMEmail} - Please approve leave for ${leave.emp_email}. Approve Link: /api/clientApproveLeave?token=${token}&action=approve`);
}

// 3. clientApproveLeave — HTTP (Token based)
async function clientApproveLeaveHandler(req, res) {
  try {
    const { token, action } = req.query; // action = 'approve' or 'reject'
    if (!token || !action) return res.status(400).send("Missing token or action");

    const snap = await db.collection("leave_requests").where("client_approval_token", "==", token).limit(1).get();
    if (snap.empty) return res.status(404).send("Invalid token");
    
    const leaveDoc = snap.docs[0];
    const leave = leaveDoc.data();

    if (action === "approve") {
      await leaveDoc.ref.update({
        state: "CLIENT_APPROVED",
        client_approved_at: admin.firestore.FieldValue.serverTimestamp(),
        client_approval_token: null
      });

      // Trigger internal routing (second approver)
      if (leave.route && leave.route.second_approver) {
        await leaveDoc.ref.update({ state: "PENDING_APPROVAL", current_approver: leave.route.second_approver });
        await notify(leave.route.second_approver, "leave_requires_approval", { leave_id: leaveDoc.id });
      } else {
        await leaveDoc.ref.update({ state: "APPROVED" });
        await pubsub.topic("datalake.leave.approved").publishMessage({ json: { leave_id: leaveDoc.id } });
      }
      return res.status(200).send("Leave approved successfully.");
    } else {
      await leaveDoc.ref.update({
        state: "CLIENT_REJECTED",
        client_rejected_at: admin.firestore.FieldValue.serverTimestamp(),
        client_approval_token: null
      });
      await notify(leave.emp_id, "leave_rejected_by_client", { leave_id: leaveDoc.id });
      return res.status(200).send("Leave rejected.");
    }
  } catch (err) {
    console.error("clientApproveLeave error:", err);
    return res.status(500).send("Internal server error");
  }
}

// 4. approveLeave — HTTP (Internal Approvers)
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
    
    const { leave_id } = req.body;
    if (!leave_id) return res.status(400).json({ error: "leave_id required" });

    const leaveDoc = await db.collection("leave_requests").doc(leave_id).get();
    if (!leaveDoc.exists) return res.status(404).json({ error: "Not found" });
    const leave = leaveDoc.data();

    // Check if the current user is the authorized approver
    if (profile.role_id !== leave.current_approver && profile.role_id !== "ceo") {
       return res.status(403).json({ error: "Unauthorized approver for this request" });
    }

    await leaveDoc.ref.update({
      state: "APPROVED",
      approved_by: profile.email,
      approved_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    await pubsub.topic("datalake.leave.approved").publishMessage({ json: { leave_id } });

    // Notifications
    await notify(leave.emp_id, "leave_approved", { leave_id });
    if (leave.route && leave.route.notify) {
      for (const n of leave.route.notify) await notify(n, "leave_approved", { leave_id });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("approveLeave error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// 5. controllerAdjustPayroll — Pub/Sub
async function controllerAdjustPayrollHandler(event) {
  try {
    const { leave_id } = event.data.message.json;
    if (!leave_id) throw new Error("leave_id required");

    const leaveDoc = await db.collection("leave_requests").doc(leave_id).get();
    if (!leaveDoc.exists) throw new Error("Leave request not found");
    
    await db.collection("leave_requests").doc(leave_id).update({
      payroll_adjusted: true,
      payroll_adjusted_at: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error("controllerAdjustPayroll error:", err);
    throw err;
  }
}

module.exports = {
  submitLeaveRequestHandler,
  validateLeaveRequestHandler,
  clientApproveLeaveHandler,
  approveLeaveHandler,
  controllerAdjustPayrollHandler,
};
