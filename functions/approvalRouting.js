const admin = require("firebase-admin");
const { Parser } = require("expr-eval");
const db = admin.firestore();

async function getActiveAssignment(employeeId) {
  const snap = await db.collection("engineer_project_assignments")
    .where("engineer_email", "==", employeeId)
    .where("status", "==", "ACTIVE")
    .limit(1)
    .get();
  
  if (snap.empty) {
    // Try to find a project where employee is in engineers array
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
  const doc = await db.collection("approval_routing").doc("config").get();
  if (doc.exists) {
    const config = doc.data();
    if (config[requestType] && config[requestType].rules) {
      return config[requestType].rules;
    }
  }
  return [];
}

function evaluateCondition(condition, context) {
  if (!condition || condition === "default") return true;
  try {
    const parser = new Parser();
    // expr-eval requires '==' to be '==' and handles it, but handles && as 'and' if configured,
    // though 'expr-eval' supports JS-like operators natively.
    // However, some people write "type == 'SICK'" which expr-eval handles.
    const expr = parser.parse(condition);
    return expr.evaluate(context);
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
      
      const resolveRole = (role) => {
        if (role === "pm") return datalakePM || "hr"; // Fallback
        if (role === "client_pm") return clientPM || "pm";
        return role;
      };

      return {
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
    }
  }

  return { action: "require_approval", approver: "ceo", notify: [] };
}

async function routeForApproval(requestType, employeeId, data) {
  const assignment = await getActiveAssignment(employeeId);
  const project = assignment ? await getProject(assignment.project_id) : null;
  const clientPM = project ? project.client_approver_email : null;
  const datalakePM = project ? project.project_manager_id : null;
  
  const rules = await getRoutingRules(requestType);
  
  return evaluateRules(rules, { employee_id: employeeId, data, clientPM, datalakePM });
}

module.exports = {
  routeForApproval
};
