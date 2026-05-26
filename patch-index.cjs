const fs = require('fs');
let content = fs.readFileSync('functions/index.js', 'utf8');

// 1. Add PubSub imports
content = content.replace(
  'const { onRequest } = require("firebase-functions/v2/https");\nconst { onSchedule } = require("firebase-functions/v2/scheduler");',
  'const { onRequest } = require("firebase-functions/v2/https");\nconst { onMessagePublished } = require("firebase-functions/v2/pubsub");\nconst { onSchedule } = require("firebase-functions/v2/scheduler");\nconst { PubSub } = require("@google-cloud/pubsub");\nconst pubsub = new PubSub();'
);

// 2. ctoApproveTimesheet publish
content = content.replace(
  '      await db.collection("task_audit_log").add({\n        event: decision === "APPROVE" ? "TIMESHEET_CTO_APPROVED" : "TIMESHEET_CTO_REJECTED",',
  '      if (decision === "APPROVE") {\n        await pubsub.topic("datalake.timesheet.cto_approved").publishMessage({ json: { timesheet_id } });\n      }\n\n      await db.collection("task_audit_log").add({\n        event: decision === "APPROVE" ? "TIMESHEET_CTO_APPROVED" : "TIMESHEET_CTO_REJECTED",'
);

// 3. Hire Sequence
content = content.replace(
  'exports.generateContract = onRequest(\n  { region: "me-central2", memory: "512MiB", timeoutSeconds: 120, cors: ALLOWED_ORIGINS },\n  (req, res) => generateContractHandler(req, res, hireHelpers)\n);',
  'exports.generateContract = onMessagePublished(\n  { topic: "datalake.hire.initiated", region: "me-central2" },\n  (event) => generateContractHandler(event)\n);'
);

content = content.replace(
  'exports.dispatchContractForSignature = onRequest(\n  { region: "me-central2", memory: "512MiB", timeoutSeconds: 60, cors: ALLOWED_ORIGINS },\n  (req, res) => dispatchContractHandler(req, res, hireHelpers)\n);',
  'exports.dispatchContractForSignature = onMessagePublished(\n  { topic: "datalake.contract.generated", region: "me-central2" },\n  (event) => dispatchContractHandler(event)\n);'
);

content = content.replace(
  'exports.provisionEngineer = onRequest(\n  { region: "me-central2", memory: "512MiB", timeoutSeconds: 60, cors: ALLOWED_ORIGINS },\n  (req, res) => provisionEngineerHandler(req, res, hireHelpers)\n);',
  'exports.provisionEngineer = onMessagePublished(\n  { topic: "datalake.contract.signed", region: "me-central2" },\n  (event) => provisionEngineerHandler(event)\n);'
);

// 4. Auditor Contract Review
content = content.replace(
  'exports.auditorContractReview = onRequest(\n  { region: "me-central2", memory: "512MiB", timeoutSeconds: 180, cors: ALLOWED_ORIGINS },\n  (req, res) => auditorContractReviewHandler(req, res, hireHelpers)\n);',
  'exports.auditorContractReview = onMessagePublished(\n  { topic: "datalake.grc.uploaded", region: "me-central2" },\n  (event) => auditorContractReviewHandler(event)\n);'
);

// 5. Controller Validations
content = content.replace(
  'exports.controllerTimesheetValidate = onRequest(\n  { region: "me-central2", memory: "512MiB", timeoutSeconds: 180, cors: ALLOWED_ORIGINS },\n  (req, res) => controllerTimesheetValidateHandler(req, res, hireHelpers)\n);',
  'exports.controllerTimesheetValidate = onMessagePublished(\n  { topic: "datalake.timesheet.cto_approved", region: "me-central2" },\n  (event) => controllerTimesheetValidateHandler(event)\n);'
);

content = content.replace(
  'exports.controllerInvoiceValidate = onRequest(\n  { region: "me-central2", memory: "512MiB", timeoutSeconds: 180, cors: ALLOWED_ORIGINS },\n  (req, res) => controllerInvoiceValidateHandler(req, res, hireHelpers)\n);',
  'exports.controllerInvoiceValidate = onMessagePublished(\n  { topic: "datalake.invoice.generated", region: "me-central2" },\n  (event) => controllerInvoiceValidateHandler(event)\n);'
);

// 6. Monthly Auditor / Trigger Cron
content = content.replace(
  '// Monthly compliance check — scheduled. Read-only, no CEO gate required (per DTLK-PROMPT-AI-001 Rule 4 exception).\nexports.auditorComplianceCheck = onSchedule(\n  {\n    schedule: "0 7 1 * *", // 07:00 Riyadh on the 1st of each month\n    timeZone: "Asia/Riyadh",\n    region: "me-central2",\n    memory: "512MiB",\n    timeoutSeconds: 300,\n  },\n  async () => { await auditorComplianceCheckHandler(); }\n);',
  '// Monthly compliance check — Pub/Sub\nexports.auditorComplianceCheck = onMessagePublished(\n  { topic: "datalake.monthly.trigger", region: "me-central2" },\n  async (event) => { await auditorComplianceCheckHandler(event); }\n);'
);

content = content.replace(
  'exports.aiAuditorMonthlyCron = onSchedule(\n  { schedule: "0 0 1 * *", timeZone: "Asia/Riyadh", region: "me-central2", memory: "512MiB" },\n  async (event) => {\n    const systemPrompt = "You are the Datalake AI Auditor. Review the monthly activity summary and generate an audit finding report. Return strict JSON array of findings.";\n    const userPrompt = "Run the monthly audit on platform activity for the previous month. Check for anomalous timesheet approvals, missing consent records, and security rule violations.";\n\n    try {\n      const res = await callLLM({\n        agent: "auditor",\n        type: "MONTHLY_AUDIT",\n        systemPrompt,\n        userPrompt,\n        triggeredBy: "system:onSchedule"\n      });\n      \n      const db = admin.firestore();\n      await db.collection("audit_reports").add({\n        created_at: admin.firestore.FieldValue.serverTimestamp(),\n        report_raw: res.output,\n        status: "GENERATED"\n      });\n      \n      console.log("Monthly AI audit completed.");\n    } catch (err) {\n      console.error("Monthly AI audit failed:", err);\n    }\n  }\n);',
  '// Phase 10 — Monthly Trigger Cron\nconst { gatekeeperMonthlyHandler, controllerMonthlyHandler } = require("./monthlyTriggers");\n\nexports.monthlyTriggerCron = onSchedule(\n  { schedule: "0 0 1 * *", timeZone: "Asia/Riyadh", region: "me-central2", memory: "256MiB" },\n  async () => {\n    console.log("Publishing monthly trigger event...");\n    await pubsub.topic("datalake.monthly.trigger").publishMessage({ json: { month: new Date().toISOString() } });\n  }\n);\n\nexports.gatekeeperMonthly = onMessagePublished(\n  { topic: "datalake.monthly.trigger", region: "me-central2" },\n  (event) => gatekeeperMonthlyHandler(event)\n);\n\nexports.controllerMonthly = onMessagePublished(\n  { topic: "datalake.monthly.trigger", region: "me-central2" },\n  (event) => controllerMonthlyHandler(event)\n);\n\n// ═══════════════════════════════════════════════════════════════════\n// Leave Management — Pub/Sub Handlers\n// ═══════════════════════════════════════════════════════════════════\nconst { submitLeaveRequestHandler, gatekeeperValidateLeaveHandler, approveLeaveHandler, controllerAdjustPayrollHandler } = require("./leave");\n\nexports.submitLeaveRequest = onRequest(\n  { region: "me-central2", memory: "256MiB", timeoutSeconds: 60, cors: ALLOWED_ORIGINS },\n  (req, res) => submitLeaveRequestHandler(req, res, hireHelpers)\n);\n\nexports.gatekeeperValidateLeave = onMessagePublished(\n  { topic: "datalake.leave.requested", region: "me-central2" },\n  (event) => gatekeeperValidateLeaveHandler(event)\n);\n\nexports.approveLeave = onRequest(\n  { region: "me-central2", memory: "256MiB", timeoutSeconds: 60, cors: ALLOWED_ORIGINS },\n  (req, res) => approveLeaveHandler(req, res, hireHelpers)\n);\n\nexports.controllerAdjustPayroll = onMessagePublished(\n  { topic: "datalake.leave.approved", region: "me-central2" },\n  (event) => controllerAdjustPayrollHandler(event)\n);'
);

fs.writeFileSync('functions/index.js', content);
console.log('Patch complete.');
