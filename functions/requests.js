const admin = require("firebase-admin");
const { routeForApproval } = require("./approvalRouting");
const { notify } = require("./notifications");

const db = admin.firestore();

// 1. validateExpense ?" Firestore Trigger onDocumentCreated
async function validateExpenseHandler(event) {
  try {
    const expenseDoc = event.data;
    if (!expenseDoc) return;
    const expense_id = event.params.docId;
    const expense = expenseDoc.data();

    // Call routing engine
    if (expense.receipt_url && !expense.ocr_data) {
      try {
        const { callOCR } = require("./lib/ai-client");
        const ocrResult = await callOCR({ image_url: expense.receipt_url });
        if (ocrResult) {
          await expenseDoc.ref.update({ ocr_data: ocrResult });
          expense.ocr_data = ocrResult;
        }
      } catch (ocrErr) {
        console.warn("OCR failed:", ocrErr);
      }
    }

    const route = await routeForApproval("expense", expense.engineer_email, { amount: expense.amount || 0, category: expense.category });
    
    await expenseDoc.ref.update({ route });

    if (route.action === "auto_approve") {
      await expenseDoc.ref.update({ status: "APPROVED", approved_at: admin.firestore.FieldValue.serverTimestamp() });
      for (const n of route.notify) await notify(n, "expense_auto_approved", { expense_id });
    } else {
      const approver = route.approver || route.first_approver || route.fallback;
      await expenseDoc.ref.update({ status: "PENDING_APPROVAL", current_approver: approver });
      await notify(approver, "expense_requires_approval", { expense_id });
    }
  } catch (err) {
    console.error("validateExpense error:", err);
  }
}

// 2. routeTicket ?" Firestore Trigger onDocumentCreated
async function routeTicketHandler(event) {
  try {
    const ticketDoc = event.data;
    if (!ticketDoc) return;
    const ticket_id = event.params.docId;
    const ticket = ticketDoc.data();

    // Call routing engine
    const route = await routeForApproval("ticket", ticket.engineer_email, { category: ticket.category });
    
    const assigned_to = route.assign_to || route.fallback || "it_admin";

    await ticketDoc.ref.update({
      route,
      assigned_to
    });

    await notify(assigned_to, "ticket_assigned", { ticket_id, subject: ticket.subject });
    
    if (route.escalate_to) {
      await notify(route.escalate_to, "ticket_escalated", { ticket_id, subject: ticket.subject });
    }

    if (route.notify) {
      for (const n of route.notify) await notify(n, "ticket_created", { ticket_id, subject: ticket.subject });
    }
  } catch (err) {
    console.error("routeTicket error:", err);
  }
}

module.exports = {
  validateExpenseHandler,
  routeTicketHandler
};
