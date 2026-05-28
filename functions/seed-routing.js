const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const rules = {
  leave: {
    rules: [
      { condition: "type == 'SICK' && days <= 2", action: "auto_approve", notify: ["pm", "hr"] },
      { condition: "type == 'EMERGENCY'", action: "auto_approve", notify: ["pm", "hr", "ceo"] },
      { condition: "deployed == true", first_approver: "client_pm", second_approver: "pm", fallback: "hr" },
      { condition: "days > 5", approver: "hr", notify: ["ceo"] },
      { condition: "type == 'UNPAID' || type == 'HAJJ'", approver: "ceo" },
      { condition: "default", approver: "pm", fallback: "hr" }
    ]
  },
  expense: {
    rules: [
      { condition: "category == 'COMMUNICATION' && amount <= 200", action: "auto_approve" },
      { condition: "amount < 1000", approver: "pm", fallback: "hr" },
      { condition: "amount >= 1000 && amount < 5000", approver: "finance" },
      { condition: "amount >= 5000", approver: "ceo" }
    ]
  },
  ticket: {
    rules: [
      { condition: "category == 'IT_ACCESS' || category == 'SYSTEM_ISSUE'", assign_to: "it_admin" },
      { condition: "category == 'PAYROLL_SALARY'", assign_to: "finance" },
      { condition: "category == 'LEAVE_HR' || category == 'CONTRACT_LEGAL'", assign_to: "hr" },
      { condition: "category == 'CLIENT_CONFLICT'", assign_to: "pm", escalate_to: "ceo" },
      { condition: "category == 'HEALTH_SAFETY'", assign_to: "hr", notify: ["ceo"], priority: "CRITICAL" }
    ]
  }
};

async function seedRouting() {
  console.log("Seeding approval_routing collection...");
  const batch = db.batch();
  
  for (const [docId, data] of Object.entries(rules)) {
    const ref = db.collection("approval_routing").doc(docId);
    batch.set(ref, data);
  }
  
  await batch.commit();
  console.log("Seeded successfully.");
}

seedRouting().catch(console.error);
