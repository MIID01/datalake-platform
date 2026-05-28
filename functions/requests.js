const admin = require("firebase-admin");
const { routeForApproval } = require("./approvalRouting");
const { notify } = require("./notifications");

const db = admin.firestore();

// 1. validateExpense — HTTP
async function validateExpenseHandler(req, res, { verifyAuth, getUserAccessProfile, ALLOWED_ORIGINS }) {
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Origin", ALLOWED_ORIGINS.includes(req.headers.origin) ? req.headers.origin : "");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return res.status(204).send("");
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const decoded = await verifyAuth(req);
    const { expense_id } = req.body;
    if (!expense_id) return res.status(400).json({ error: "expense_id required" });

    const expenseDoc = await db.collection("expenses").doc(expense_id).get();
    if (!expenseDoc.exists) return res.status(404).json({ error: "Not found" });
    const expense = expenseDoc.data();

    // Call routing engine
    const route = await routeForApproval("expense", expense.employee_id, { amount: expense.amount || 0, category: expense.category });
    
    await expenseDoc.ref.update({ route });

    if (route.action === "auto_approve") {
      await expenseDoc.ref.update({ status: "APPROVED", approved_at: admin.firestore.FieldValue.serverTimestamp() });
      for (const n of route.notify) await notify(n, "expense_auto_approved", { expense_id });
    } else {
      const approver = route.approver || route.first_approver || route.fallback;
      await expenseDoc.ref.update({ status: "PENDING_APPROVAL", current_approver: approver });
      await notify(approver, "expense_requires_approval", { expense_id });
    }
    return res.status(200).json({ success: true, route });
  } catch (err) {
    console.error("validateExpense error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// 2. submitTicket — HTTP
async function submitTicketHandler(req, res, { verifyAuth, getUserAccessProfile, ALLOWED_ORIGINS }) {
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
    const { title, category, description } = req.body;
    if (!title || !category) return res.status(400).json({ error: "Missing fields" });

    const ticketRef = db.collection("tickets").doc();
    const ticketData = {
      emp_id: profile.uid,
      emp_email: profile.email,
      title,
      category,
      description,
      status: "OPEN",
      created_at: admin.firestore.FieldValue.serverTimestamp()
    };

    // Call routing engine
    const route = await routeForApproval("ticket", profile.uid, { category });
    ticketData.route = route;

    const assigned_to = route.assign_to || route.fallback || "it_admin";
    ticketData.assigned_to = assigned_to;

    await ticketRef.set(ticketData);

    await notify(assigned_to, "ticket_assigned", { ticket_id: ticketRef.id });
    
    if (route.escalate_to) {
      await notify(route.escalate_to, "ticket_escalated", { ticket_id: ticketRef.id });
    }

    if (route.notify) {
      for (const n of route.notify) await notify(n, "ticket_created", { ticket_id: ticketRef.id });
    }

    return res.status(200).json({ success: true, ticket_id: ticketRef.id });
  } catch (err) {
    console.error("submitTicket error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

module.exports = {
  validateExpenseHandler,
  submitTicketHandler
};
