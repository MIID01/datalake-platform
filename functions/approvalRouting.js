const admin = require("firebase-admin");
const db = admin.firestore();

async function getActiveAssignment(employeeId) {
  // Assuming 'assignments' or 'projects' has an active status for the employee
  const snap = await db.collection("assignments")
    .where("employee_id", "==", employeeId)
    .where("status", "==", "ACTIVE")
    .limit(1)
    .get();
  
  if (snap.empty) {
    // Try to find a project where employee_id is in engineers array
    const projSnap = await db.collection("projects")
      .where("engineers", "array-contains", employeeId)
      .where("status", "==", "ACTIVE")
      .limit(1)
      .get();
    
    if (!projSnap.empty) {
      return { project_id: projSnap.docs[0].id };
    }
    return null;
  }
  return snap.docs[0].data();
}

async function getProject(projectId) {
  const doc = await db.collection("projects").doc(projectId).get();
  return doc.exists ? doc.data() : null;
}

async function getRoutingRules(requestType) {
  const doc = await db.collection("approval_routing").doc(requestType).get();
  return doc.exists ? doc.data().rules || [] : [];
}

function evaluateCondition(condition, context) {
  if (!condition || condition === "default") return true;
  try {
    // Create a safe evaluator function
    const keys = Object.keys(context);
    const values = Object.values(context);
    // eslint-disable-next-line no-new-func
    const evaluator = new Function(...keys, `return ${condition};`);
    return evaluator(...values);
  } catch (err) {
    console.warn(`[ApprovalRouting] Error evaluating condition '${condition}':`, err);
    return false;
  }
}

function evaluateRules(rules, context) {
  const { data, clientPM, datalakePM } = context;
  
  // Expose variables for condition evaluation
  const evalContext = {
    ...data,
    deployed: !!clientPM
  };

  for (const rule of rules) {
    if (evaluateCondition(rule.condition, evalContext)) {
      
      // Resolve dynamic roles to actual IDs/emails if needed
      const resolveRole = (role) => {
        if (role === "pm") return datalakePM || "hr"; // Fallback to HR if no PM
        if (role === "client_pm") return clientPM || "pm";
        return role;
      };

      const routingResult = {
        action: rule.action || "require_approval",
        approver: rule.approver ? resolveRole(rule.approver) : null,
        first_approver: rule.first_approver ? resolveRole(rule.first_approver) : null,
        second_approver: rule.second_approver ? resolveRole(rule.second_approver) : null,
        assign_to: rule.assign_to ? resolveRole(rule.assign_to) : null,
        notify: (rule.notify || []).map(resolveRole),
        escalate_to: rule.escalate_to ? resolveRole(rule.escalate_to) : null,
        fallback: rule.fallback ? resolveRole(rule.fallback) : "ceo",
        priority: rule.priority || "NORMAL"
      };

      return routingResult;
    }
  }

  // Fallback if no rules match
  return { action: "require_approval", approver: "ceo", notify: [] };
}

async function routeForApproval(requestType, employeeId, data) {
  const assignment = await getActiveAssignment(employeeId);
  const project = assignment ? await getProject(assignment.project_id) : null;
  const clientPM = project ? project.client_pm_email : null;
  const datalakePM = project ? project.project_manager_id : null;
  
  const rules = await getRoutingRules(requestType);
  
  return evaluateRules(rules, { employee_id: employeeId, data, clientPM, datalakePM });
}

module.exports = {
  routeForApproval
};
