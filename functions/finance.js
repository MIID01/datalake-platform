const admin = require("firebase-admin");
const { PubSub } = require("@google-cloud/pubsub");
const pubsub = new PubSub();
const { logToBigQuery } = require("./lib/bigquery");

const db = admin.firestore();

// ═══════════════════════════════════════════════════════════════════
// Phase 5A: Payroll Calculation Chain
// ═══════════════════════════════════════════════════════════════════
async function calculatePayrollHandler({ year_month, actor } = {}) {
  console.log("[Payroll] Starting calculatePayroll for", year_month || "current month");
  try {
    const now = new Date();
    // E.g., "2026-06". If the caller supplied year_month use that, else
    // default to the current Riyadh month. This is what makes the function
    // usable both from the scheduled cron AND from the "Create Payroll Run"
    // UI for any past/future month.
    const yearMonth = year_month && /^\d{4}-\d{2}$/.test(year_month)
      ? year_month
      : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // Read all active employees. We accept either employment_status="active"
    // or status="active" because the directory has used both keys historically.
    const employeesSnapshot = await db.collection("employees").get();

    if (employeesSnapshot.empty) {
      console.log("[Payroll] No employees at all.");
      return { period: yearMonth, created: false, reason: "no_employees" };
    }

    let total_gross = 0;
    let total_net = 0;
    let total_gosi_employee = 0;
    let total_gosi_employer = 0;
    const payroll_employees = [];
    // Employees who are active but have no salary data — listed separately
    // so HR can see who's blocked on a contract, not silently zeroed out.
    const pending_contract = [];

    for (const doc of employeesSnapshot.docs) {
      const emp = doc.data();
      const empStatus = String(emp.employment_status || emp.status || '').toLowerCase();
      // Skip inactive employees outright.
      if (empStatus && empStatus !== 'active') continue;

      const empId = emp.employee_id || doc.id;

      // Determine base salary and allowances (with fallbacks for legacy schemas).
      const base_salary = Number(emp.salary_monthly_sar || emp.salary_sar || emp.salary || 0);
      const housing = Number(emp.housing_allowance_sar || emp.contract_extracted_fields?.housing_allowance_sar || 0);
      const transport = Number(emp.transport_allowance_sar || emp.contract_extracted_fields?.transport_allowance_sar || 0);

      // No contract / no salary data → list in pending_contract and skip the
      // payroll math. We don't want a "SAR 0 net" row in WPS for someone whose
      // contract isn't loaded yet — that's the bug from the user's spec.
      if (base_salary <= 0) {
        pending_contract.push({
          employee_id: empId,
          name: emp.full_name || emp.name || empId,
          nationality: emp.nationality || null,
          reason: 'no_salary_data',
        });
        continue;
      }
      
      // GOSI Calculation (based on Nationality)
      const isSaudi = (emp.nationality || '').toLowerCase() === 'saudi';
      const gosi_employee = isSaudi ? base_salary * 0.0975 : 0;
      const gosi_employer = isSaudi ? base_salary * 0.1175 : base_salary * 0.02;

      // Fetch Deductions
      let total_deductions = 0;
      const deductionsSnapshot = await db.collection("deductions")
        .where("employee_id", "==", empId)
        .where("status", "==", "ACTIVE")
        .get();
      
      deductionsSnapshot.docs.forEach(d => {
        total_deductions += Number(d.data().amount || 0);
      });

      // Fetch Expenses/Reimbursements
      let total_reimbursements = 0;
      const expensesSnapshot = await db.collection("expenses")
        .where("employee_id", "==", empId)
        .where("status", "==", "APPROVED")
        .get();
      
      const expenseUpdates = [];
      expensesSnapshot.docs.forEach(e => {
        const expenseData = e.data();
        if (!expenseData.reimbursed_in_payroll) {
          total_reimbursements += Number(expenseData.amount || expenseData.extracted_data?.amount || 0);
          expenseUpdates.push(e.ref);
        }
      });

      // Calculate Net Pay
      const net_pay = base_salary + housing + transport - gosi_employee - total_deductions + total_reimbursements;

      // Accumulate totals
      total_gross += (base_salary + housing + transport);
      total_net += net_pay;
      total_gosi_employee += gosi_employee;
      total_gosi_employer += gosi_employer;

      payroll_employees.push({
        employee_id: empId,
        name: emp.full_name,
        nationality: emp.nationality || 'Unknown',
        gosi_type: isSaudi ? 'saudi' : 'non-saudi',
        base_salary,
        housing,
        transport,
        gosi_employee,
        deductions: total_deductions,
        reimbursements: total_reimbursements,
        net_pay
      });

      // Mark expenses as reimbursed in this payroll
      // (Using a batch for atomicity)
      const batch = db.batch();
      expenseUpdates.forEach(ref => {
        batch.update(ref, { reimbursed_in_payroll: yearMonth });
      });
      if (expenseUpdates.length > 0) await batch.commit();
    }

    const payrollRunId = `PR-${yearMonth}`;
    const payload = {
      period: yearMonth,
      status: "DRAFT",
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      created_by: actor || 'system:scheduler',
      total_gross,
      total_net,
      total_gosi_employee,
      total_gosi_employer,
      employees: payroll_employees,
      employee_count: payroll_employees.length,
      pending_contract,
      pending_contract_count: pending_contract.length,
      approved_by: null,
      approved_at: null,
    };

    await db.collection("payroll_runs").doc(payrollRunId).set(payload);

    // Audit Log to BigQuery (best-effort — don't fail the run if BQ is down)
    try {
      await logToBigQuery("datalake_audit", "ai_actions", {
        agent_name: "Controller",
        action_type: "CALCULATE_PAYROLL",
        entity_id: payrollRunId,
        result: "SUCCESS",
        duration_ms: Date.now() - now.getTime(),
        regulatory_reference: "Saudi Labor Law / GOSI",
        timestamp: new Date(),
      });
    } catch (bqErr) {
      console.warn("[Payroll] BigQuery audit insert failed (non-blocking):", bqErr.message);
    }

    console.log(`[Payroll] DRAFT run created for ${yearMonth} (id=${payrollRunId}): ${payroll_employees.length} paid, ${pending_contract.length} pending contract`);

    // Publish to Pub/Sub for any downstream that wants the "draft created" event
    try {
      await pubsub.topic("datalake.payroll.calculated").publishMessage({ json: { payroll_run_id: payrollRunId, period: yearMonth } });
    } catch (psErr) {
      console.warn("[Payroll] Pub/Sub publish failed (non-blocking):", psErr.message);
    }

    return { period: yearMonth, payroll_run_id: payrollRunId, created: true, employee_count: payroll_employees.length, pending_contract_count: pending_contract.length, total_gross, total_net };
  } catch (error) {
    console.error("[Payroll] calculatePayroll error:", error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Placeholder handlers for remaining Phase 5 tasks to be implemented next
// ═══════════════════════════════════════════════════════════════════
async function generateWPSFileHandler(event) {
  console.log("[Controller AI] Starting generateWPSFile...");
  try {
    const { payroll_run_id } = event.data.message.json;
    if (!payroll_run_id) throw new Error("Missing payroll_run_id in event payload.");

    const payrollDoc = await db.collection("payroll_runs").doc(payroll_run_id).get();
    if (!payrollDoc.exists) throw new Error(`Payroll run ${payroll_run_id} not found.`);
    
    const payroll = payrollDoc.data();
    if (payroll.status !== "APPROVED") {
      console.warn(`[Controller AI] Payroll ${payroll_run_id} is not APPROVED (status: ${payroll.status}). Skipping WPS generation.`);
      return;
    }

    // WPS Saudi Arabia SIF/CSV Format Generation
    // Expected basic columns for SI Format: Employee ID/Iqama, Employee Name, Bank Name, IBAN, Net Salary, Employer MOL Number, Remarks
    // For Datalake, MOL number is a placeholder if not present in DB.
    const employerMOLNumber = "7-1234567"; // Placeholder MOL
    const csvRows = [
      ["Employee Name", "Employee ID / Iqama", "Bank Name", "IBAN", "Net Salary", "Employer MOL Number", "Remarks"]
    ];

    const employeesSnapshot = await db.collection("employees").get();
    const employeeMap = new Map();
    employeesSnapshot.docs.forEach(d => employeeMap.set(d.id, d.data()));

    for (const empPay of payroll.employees) {
      const empDb = employeeMap.get(empPay.employee_id) || {};
      const idOrIqama = empDb.iqama_number || empDb.passport_number || empPay.employee_id;
      const bankName = empDb.bank_name || "Unknown Bank";
      const iban = empDb.bank_iban || "SA0000000000000000000000";

      csvRows.push([
        empPay.name,
        idOrIqama,
        bankName,
        iban,
        empPay.net_pay.toFixed(2),
        employerMOLNumber,
        "Salary Transfer"
      ]);
    }

    const csvString = csvRows.map(row => row.join(",")).join("\n");
    const fileBuffer = Buffer.from(csvString, "utf-8");

    const bucketName = "datalake-worm-finance";
    const bucket = admin.storage().bucket(bucketName);
    const storagePath = `wps/${payroll.period}.csv`;
    const file = bucket.file(storagePath);
    
    await file.save(fileBuffer, {
      contentType: "text/csv",
      metadata: {
        cacheControl: "private, max-age=0",
        metadata: { payroll_run_id, period: payroll.period },
      },
    });

    console.log(`[Controller AI] WPS file uploaded to ${storagePath}`);

    const now = admin.firestore.FieldValue.serverTimestamp();
    const wps_file_url = `gs://${bucketName}/${storagePath}`;

    // Update payroll run
    await payrollDoc.ref.update({
      wps_file_url,
      wps_generated_at: now
    });

    // Audit Log
    await logToBigQuery("datalake_audit", "ai_actions", {
      agent_name: "Controller",
      action_type: "GENERATE_WPS",
      entity_id: payroll_run_id,
      result: "SUCCESS",
      duration_ms: 0, // Simplified duration
      regulatory_reference: "Saudi Wage Protection System",
      timestamp: new Date()
    });

    // Publish to Pub/Sub
    await pubsub.topic("datalake.wps.generated").publishMessage({ json: { payroll_run_id } });

  } catch (error) {
    console.error("[Controller AI] generateWPSFile error:", error);
    throw error;
  }
}

async function generateGOSIReportHandler(event) {
  console.log("[Controller AI] Starting generateGOSIReport...");
  try {
    const { payroll_run_id } = event.data.message.json;
    if (!payroll_run_id) throw new Error("Missing payroll_run_id in event payload.");

    const payrollDoc = await db.collection("payroll_runs").doc(payroll_run_id).get();
    if (!payrollDoc.exists) throw new Error(`Payroll run ${payroll_run_id} not found.`);
    
    const payroll = payrollDoc.data();
    if (payroll.status !== "APPROVED") {
      console.warn(`[Controller AI] Payroll ${payroll_run_id} is not APPROVED. Skipping GOSI report generation.`);
      return;
    }

    // GOSI JSON format generation
    const gosiRecords = payroll.employees.map(emp => {
      return {
        employee_id: emp.employee_id,
        employee_name: emp.name,
        nationality: emp.nationality,
        gosi_type: emp.gosi_type,
        base_salary_sar: emp.base_salary,
        gosi_employee_contribution: emp.gosi_employee,
        gosi_employer_contribution: emp.gosi_employer,
        total_gosi_contribution: emp.gosi_employee + emp.gosi_employer
      };
    });

    const gosiReport = {
      period: payroll.period,
      payroll_run_id,
      total_gosi_employee: payroll.total_gosi_employee,
      total_gosi_employer: payroll.total_gosi_employer,
      total_gosi_combined: payroll.total_gosi_employee + payroll.total_gosi_employer,
      employee_records: gosiRecords,
      generated_at: new Date().toISOString()
    };

    const jsonString = JSON.stringify(gosiReport, null, 2);
    const fileBuffer = Buffer.from(jsonString, "utf-8");

    const bucketName = "datalake-worm-finance";
    const bucket = admin.storage().bucket(bucketName);
    const storagePath = `gosi/${payroll.period}.json`;
    const file = bucket.file(storagePath);
    
    await file.save(fileBuffer, {
      contentType: "application/json",
      metadata: {
        cacheControl: "private, max-age=0",
        metadata: { payroll_run_id, period: payroll.period },
      },
    });

    console.log(`[Controller AI] GOSI report uploaded to ${storagePath}`);

    const now = admin.firestore.FieldValue.serverTimestamp();
    const gosi_report_url = `gs://${bucketName}/${storagePath}`;

    // Update payroll run
    await payrollDoc.ref.update({
      gosi_report_url,
      gosi_generated_at: now
    });

    // Audit Log
    await logToBigQuery("datalake_audit", "ai_actions", {
      agent_name: "Controller",
      action_type: "GENERATE_GOSI",
      entity_id: payroll_run_id,
      result: "SUCCESS",
      duration_ms: 0,
      regulatory_reference: "GOSI Monthly Submission",
      timestamp: new Date()
    });

  } catch (error) {
    console.error("[Controller AI] generateGOSIReport error:", error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Phase 8: Controller Monthly Ops (Revenue Reconciliation)
// ═══════════════════════════════════════════════════════════════════
async function controllerMonthlyOpsHandler(event) {
  console.log("[Controller] Running monthly revenue reconciliation...");
  try {
    const { year, month, year_month } = event.data.message.json;
    
    // Revenue reconciliation: Check if all timesheets for the previous month are invoiced
    const timesheetsSnap = await db.collection("timesheets").where("status", "==", "APPROVED").get();
      
    let unbilledCount = 0;
    timesheetsSnap.docs.forEach(doc => {
      const ts = doc.data();
      // If timesheet is from the year_month and not invoiced
      if (ts.month === year_month && !ts.invoice_id) {
        unbilledCount++;
      }
    });
    
    if (unbilledCount > 0) {
      console.warn(`[Controller] Found ${unbilledCount} unbilled timesheets for ${year_month}. Generating alert.`);
      await db.collection("tasks").add({
        task_id: `REC-${Date.now()}`,
        title: `Revenue Reconciliation Alert: ${year_month}`,
        description: `Found ${unbilledCount} approved timesheets without corresponding invoices.`,
        task_type: "RECONCILIATION",
        creation_method: "SYSTEM",
        created_by: "controller_ai",
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        assigned_to_role: "CEO",
        priority: "HIGH",
        state: "OPEN"
      });
    } else {
      console.log(`[Controller] Revenue reconciliation passed for ${year_month}. All approved timesheets are invoiced.`);
    }
  } catch (err) {
    console.error("[Controller] controllerMonthlyOpsHandler error:", err);
  }
}

// ═══════════════════════════════════════════════════════════════════
// HTTP wrapper — "Create Payroll Run" from the Finance / CEO UI.
// CEO + finance role only. Returns the DRAFT run id; the page then opens
// the ApprovalButton + signature flow.
// ═══════════════════════════════════════════════════════════════════
async function createPayrollRunHandler(req, res, { verifyAuth, getUserAccessProfile, ALLOWED_ORIGINS } = {}) {
  // CORS handled by the onRequest wrapper (cors: ALLOWED_ORIGINS).
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  try {
    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) return res.status(401).json({ error: "Missing auth token" });
    const decoded = await admin.auth().verifyIdToken(authHeader.slice(7));
    const profile = (getUserAccessProfile && (await getUserAccessProfile(decoded.uid))) || null;
    const allowedRoles = ["ceo", "finance"];
    const userRole = profile?.role_id || (decoded.email === "m.alqumri@datalake.sa" ? "ceo" : null);
    if (!userRole || !allowedRoles.includes(userRole)) {
      return res.status(403).json({ error: "Only CEO or Finance may create a payroll run" });
    }

    const { year_month } = req.body || {};
    if (!year_month || !/^\d{4}-\d{2}$/.test(year_month)) {
      return res.status(400).json({ error: "year_month must be YYYY-MM" });
    }

    // Idempotency: refuse to overwrite an APPROVED run.
    const runId = `PR-${year_month}`;
    const existing = await db.collection("payroll_runs").doc(runId).get();
    if (existing.exists && existing.data().status === "APPROVED") {
      return res.status(409).json({ error: `Payroll for ${year_month} already APPROVED — cannot recreate` });
    }

    const result = await calculatePayrollHandler({ year_month, actor: profile?.email || decoded.email });

    await db.collection("task_audit_log").add({
      event: "PAYROLL_RUN_CREATED",
      action_by: profile?.email || decoded.email,
      action_at: admin.firestore.FieldValue.serverTimestamp(),
      details: result,
      ip_address: req.ip || req.headers["x-forwarded-for"] || "unknown",
    });

    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error("createPayrollRun error:", err);
    return res.status(500).json({ error: err.message || "Internal error" });
  }
}

// ═══════════════════════════════════════════════════════════════════
// Firestore trigger: when payroll_runs/{id}.status flips DRAFT → APPROVED,
// publish to datalake.payroll.approved so generateWPSFile + generateGOSI
// both fire. This is the missing bridge between CEO approval and the
// downstream output generators.
// ═══════════════════════════════════════════════════════════════════
async function publishPayrollApprovedHandler(event) {
  try {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!before || !after) return;
    if (before.status === "APPROVED" || after.status !== "APPROVED") return;

    const payrollRunId = event.params.payrollRunId;
    await pubsub.topic("datalake.payroll.approved").publishMessage({ json: { payroll_run_id: payrollRunId, period: after.period } });
    console.log(`[Payroll] APPROVED → published datalake.payroll.approved for ${payrollRunId}`);
  } catch (err) {
    console.error("publishPayrollApproved error:", err);
  }
}

// ═══════════════════════════════════════════════════════════════════
// HTTP wrapper — "My Payslips" feed for an employee.
// Lists every payroll_runs/* the calling user appears in (matched by
// employee_id or email). Used by /employee/documents.
// ═══════════════════════════════════════════════════════════════════
async function listMyPayslipsHandler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "GET or POST" });
  try {
    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) return res.status(401).json({ error: "Missing auth token" });
    const decoded = await admin.auth().verifyIdToken(authHeader.slice(7));
    const email = String(decoded.email || "").toLowerCase();

    // Resolve the employee_id for this user.
    let employee_id = null;
    const empQ = await db.collection("employees").where("email", "==", email).limit(1).get();
    if (!empQ.empty) employee_id = empQ.docs[0].data().employee_id || empQ.docs[0].id;
    if (!employee_id) {
      const usrQ = await db.collection("users").where("email", "==", email).limit(1).get();
      if (!usrQ.empty) employee_id = usrQ.docs[0].data().employee_id || null;
    }
    if (!employee_id) return res.status(200).json({ payslips: [], note: "No employee record matched this account." });

    const runsSnap = await db.collection("payroll_runs").where("status", "==", "APPROVED").get();
    const payslips = [];
    runsSnap.forEach(d => {
      const r = d.data();
      const line = (r.employees || []).find(e => e.employee_id === employee_id);
      if (!line) return;
      payslips.push({
        payroll_run_id: d.id,
        period: r.period || d.id.replace(/^PR-/, ""),
        base_salary: line.base_salary,
        housing: line.housing,
        transport: line.transport,
        gosi_employee: line.gosi_employee,
        net_pay: line.net_pay,
        approved_at: r.approved_at?.toMillis?.() || null,
      });
    });
    payslips.sort((a, b) => (b.period || "").localeCompare(a.period || ""));
    return res.status(200).json({ employee_id, payslips });
  } catch (err) {
    console.error("listMyPayslips error:", err);
    return res.status(500).json({ error: err.message || "Internal error" });
  }
}

module.exports = {
  calculatePayrollHandler,
  generateWPSFileHandler,
  generateGOSIReportHandler,
  controllerMonthlyOpsHandler,
  createPayrollRunHandler,
  publishPayrollApprovedHandler,
  listMyPayslipsHandler,
};
