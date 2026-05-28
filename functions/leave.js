const admin = require("firebase-admin");
const { PubSub } = require("@google-cloud/pubsub");
const { google } = require("googleapis");
const pubsub = new PubSub();
const db = admin.firestore();
const { routeForApproval } = require("./approvalRouting");
const { notify } = require("./notifications");

async function getGmailClient() {
  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/gmail.send"],
    clientOptions: { subject: "hr@datalake.sa" }
  });
  const client = await auth.getClient();
  return google.gmail({ version: "v1", auth: client });
}

// 1. validateLeaveRequest (Firestore Trigger onDocumentCreated)
async function validateLeaveRequestHandler(event) {
  try {
    const leaveDoc = event.data;
    if (!leaveDoc) return;
    const leave_id = event.params.docId;
    const leave = leaveDoc.data();

    // Call routing engine
    const route = await routeForApproval("leave", leave.engineer_email, { type: leave.leave_type, days: leave.working_days });
    
    let approval_history = leave.approval_history || [];
    approval_history.push({
      action: "ROUTED",
      route: route,
      timestamp: new Date().toISOString()
    });

    await leaveDoc.ref.update({
      route,
      approval_history,
      gatekeeper_validated_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    if (route.action === "auto_approve") {
      approval_history.push({ action: "AUTO_APPROVED", timestamp: new Date().toISOString() });
      await leaveDoc.ref.update({ status: "APPROVED", approval_history });
      await pubsub.topic("datalake.leave.approved").publishMessage({ json: { leave_id } });
      
      if (route.notify) {
        for (const n of route.notify) {
          await notify(n, "leave_auto_approved", { leave_id });
        }
      }
    } else if (route.first_approver && route.first_approver.includes("@")) {
      // It's a client PM email (deployed engineer)
      await notifyClientLeave(leave_id, leave, route.first_approver);
    } else {
      // Internal approver
      await leaveDoc.ref.update({ status: "PENDING_APPROVAL", current_approver: route.approver || route.first_approver });
      await notify(route.approver || route.first_approver, "leave_requires_approval", { leave_id });
    }
  } catch (err) {
    console.error("validateLeaveRequest error:", err);
  }
}

async function notifyClientLeave(leaveId, leave, clientPMEmail) {
  const token = `token_${leaveId}_${Date.now()}`;
  
  await db.collection("leave_requests").doc(leaveId).update({
    status: "CLIENT_PENDING",
    client_pm_email: clientPMEmail,
    client_approval_token: token
  });

  // Create CRM Activity
  await db.collection("activities").add({
    tenant_id: "datalake",
    type: "EMAIL",
    contact_email: clientPMEmail,
    description: `Leave request approval sent to client for ${leave.engineer_email}`,
    timestamp: admin.firestore.FieldValue.serverTimestamp()
  });

  try {
    const gmail = await getGmailClient();
    const subject = `Datalake: Action Required - Leave Approval for ${leave.engineer_email}`;
    const body = `Please approve leave for ${leave.engineer_email}. 
Days: ${leave.working_days}
Type: ${leave.leave_type}

Approve Link: https://datalake-platform.web.app/api/clientApproveLeave?token=${token}&action=approve
Reject Link: https://datalake-platform.web.app/api/clientApproveLeave?token=${token}&action=reject`;
    
    const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
    const messageParts = [
      `From: hr@datalake.sa`,
      `To: ${clientPMEmail}`,
      `Subject: ${utf8Subject}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/plain; charset=utf-8`,
      '',
      body
    ];
    const encodedMessage = Buffer.from(messageParts.join('\n'))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
      
    await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw: encodedMessage }
    });
    console.log(`[Email] Sent leave approval to client: ${clientPMEmail}`);
  } catch (err) {
    console.error("Error sending client leave email:", err);
  }
}

// 2. clientApproveLeave ? HTTP (Token based)
async function clientApproveLeaveHandler(req, res) {
  try {
    const { token, action } = req.query; // action = 'approve' or 'reject'
    if (!token || !action) return res.status(400).send("Missing token or action");

    const snap = await db.collection("leave_requests").where("client_approval_token", "==", token).limit(1).get();
    if (snap.empty) return res.status(404).send("Invalid token");
    
    const leaveDoc = snap.docs[0];
    const leave = leaveDoc.data();
    let approval_history = leave.approval_history || [];

    if (action === "approve") {
      approval_history.push({ action: "CLIENT_APPROVED", by: leave.client_pm_email, timestamp: new Date().toISOString() });
      
      await leaveDoc.ref.update({
        status: "CLIENT_APPROVED",
        client_approved_at: admin.firestore.FieldValue.serverTimestamp(),
        client_approval_token: null,
        approval_history
      });

      // Trigger internal routing (second approver)
      if (leave.route && leave.route.second_approver) {
        await leaveDoc.ref.update({ status: "PENDING_APPROVAL", current_approver: leave.route.second_approver });
        await notify(leave.route.second_approver, "leave_requires_approval", { leave_id: leaveDoc.id });
      } else {
        await leaveDoc.ref.update({ status: "APPROVED" });
        await pubsub.topic("datalake.leave.approved").publishMessage({ json: { leave_id: leaveDoc.id } });
      }
      return res.status(200).send("Leave approved successfully.");
    } else {
      approval_history.push({ action: "CLIENT_REJECTED", by: leave.client_pm_email, timestamp: new Date().toISOString() });
      await leaveDoc.ref.update({
        status: "CLIENT_REJECTED",
        client_rejected_at: admin.firestore.FieldValue.serverTimestamp(),
        client_approval_token: null,
        approval_history
      });
      await notify(leave.engineer_email, "leave_rejected_by_client", { leave_id: leaveDoc.id });
      return res.status(200).send("Leave rejected.");
    }
  } catch (err) {
    console.error("clientApproveLeave error:", err);
    return res.status(500).send("Internal server error");
  }
}

// 3. approveLeave ? HTTP (Internal Approvers)
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

    let approval_history = leave.approval_history || [];
    approval_history.push({ action: "INTERNAL_APPROVED", by: profile.email, timestamp: new Date().toISOString() });

    await leaveDoc.ref.update({
      status: "APPROVED",
      approved_by: profile.email,
      approved_at: admin.firestore.FieldValue.serverTimestamp(),
      approval_history
    });

    await pubsub.topic("datalake.leave.approved").publishMessage({ json: { leave_id } });

    // Notifications
    await notify(leave.engineer_email, "leave_approved", { leave_id });
    if (leave.route && leave.route.notify) {
      for (const n of leave.route.notify) await notify(n, "leave_approved", { leave_id });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("approveLeave error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// 4. controllerAdjustPayroll (Pub/Sub)
async function controllerAdjustPayrollHandler(event) {
  try {
    const { leave_id } = event.data.message.json;
    if (!leave_id) throw new Error("leave_id required");

    const leaveDoc = await db.collection("leave_requests").doc(leave_id).get();
    if (!leaveDoc.exists) throw new Error("Leave request not found");
    const leave = leaveDoc.data();

    // The payroll engine uses 'leave_hours' as working_days * 8
    const hours = leave.working_days * 8;
    
    const payrollRef = db.collection("payroll_adjustments").doc();
    await payrollRef.set({
      emp_email: leave.engineer_email, // Updated
      leave_id: leave_id,
      adjustment_hours: hours,
      type: "LEAVE_DEDUCTION",
      status: "APPLIED",
      applied_at: admin.firestore.FieldValue.serverTimestamp()
    });
    
  } catch (err) {
    console.error("controllerAdjustPayroll error:", err);
    throw err;
  }
}

module.exports = {
  validateLeaveRequestHandler,
  clientApproveLeaveHandler,
  approveLeaveHandler,
  controllerAdjustPayrollHandler
};
