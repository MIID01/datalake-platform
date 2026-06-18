const admin = require("firebase-admin");
const { PubSub } = require("@google-cloud/pubsub");
const pubsub = new PubSub();
const { logToBigQuery } = require("./lib/bigquery");
const { COMPANY } = require("./lib/company-legal");
const { getGmailClient } = require("./lib/gmail");
const { renderPayslipPdf } = require("./lib/payslip-pdf");

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
    let total_bonuses = 0;
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
      // salary_monthly is included because the contract→employee sync writes it.
      const base_salary = Number(emp.salary_monthly_sar || emp.salary_sar || emp.salary_monthly || emp.salary || 0);
      // Auto-mapped-from-contract salaries are flagged unverified until HR reviews
      // the contract; only an explicit `false` means unverified (legacy/manual = verified).
      const salary_verified = emp.salary_verified !== false;
      const housing = Number(emp.housing_allowance_sar || emp.contract_extracted_fields?.housing_allowance_sar || 0);
      const transport = Number(emp.transport_allowance_sar || emp.contract_extracted_fields?.transport_allowance_sar || 0);

      // No contract / no salary data → list in pending_contract and skip the
      // payroll math. We don't want a "SAR 0 net" row in WPS for someone whose
      // contract isn't loaded yet — that's the bug from the user's spec.
      if (base_salary <= 0) {
        // Distinguish "no salary on file" from "salary is in a foreign currency
        // awaiting SAR conversion" so Finance knows it's a conversion task, not a
        // missing contract. We never pay a non-SAR amount as if it were SAR.
        const fx = emp.salary_currency && String(emp.salary_currency).toUpperCase() !== 'SAR';
        pending_contract.push({
          employee_id: empId,
          name: emp.full_name || emp.name || empId,
          nationality: emp.nationality || null,
          reason: fx ? 'needs_currency_conversion' : 'no_salary_data',
          currency: emp.salary_currency || null,
          foreign_amount: emp.salary_monthly_foreign || null,
        });
        continue;
      }
      
      // GOSI Calculation (based on Nationality)
      const isSaudi = (emp.nationality || '').toLowerCase() === 'saudi';
      const gosi_employee = isSaudi ? base_salary * 0.0975 : 0;
      const gosi_employer = isSaudi ? base_salary * 0.1175 : base_salary * 0.02;

      // Fetch Deductions (installment-aware). We compute what THIS run deducts
      // but do NOT mutate the deduction docs here — consumption happens on
      // approval (consumePayrollDeductions) so re-creating a DRAFT is idempotent.
      let total_deductions = 0;
      let total_additions = 0; // bonuses / positive adjustments (direction === "add")
      const deduction_lines = [];
      const deductionsSnapshot = await db.collection("deductions")
        .where("employee_id", "==", empId)
        .where("status", "==", "ACTIVE")
        .get();

      deductionsSnapshot.docs.forEach(d => {
        const dd = d.data();
        if (dd.start_period && dd.start_period > yearMonth) return; // not started yet
        const remaining = Number(dd.remaining_balance != null ? dd.remaining_balance
          : (dd.total_amount != null ? dd.total_amount : dd.amount || 0));
        if (remaining <= 0) return;
        // monthly installment amount; one-off entries take the whole balance.
        const monthly = Number(dd.monthly_amount || dd.amount || dd.total_amount || 0);
        const thisAmount = Math.min(monthly > 0 ? monthly : remaining, remaining);
        if (thisAmount <= 0) return;
        // A bonus (direction "add") is paid TO the employee; everything else is
        // subtracted. Same balance/installment machinery, opposite sign on net.
        const direction = dd.direction === "add" ? "add" : "deduct";
        if (direction === "add") total_additions += thisAmount;
        else total_deductions += thisAmount;
        deduction_lines.push({
          deduction_id: d.id,
          description: dd.description || dd.reason || (direction === "add" ? "Bonus" : "Deduction"),
          category: dd.category || null,
          direction,
          type: dd.type || "one_off",
          amount: thisAmount,
          installment_no: Number(dd.installments_paid || 0) + 1,
          installments: Number(dd.installments || 1),
          remaining_after: Math.max(0, remaining - thisAmount),
        });
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

      // Calculate Net Pay (bonuses add, deductions subtract)
      const net_pay = base_salary + housing + transport - gosi_employee - total_deductions + total_reimbursements + total_additions;

      // Accumulate totals
      total_gross += (base_salary + housing + transport + total_additions);
      total_net += net_pay;
      total_gosi_employee += gosi_employee;
      total_gosi_employer += gosi_employer;
      total_bonuses += total_additions;

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
        bonuses: total_additions,
        deduction_lines,
        reimbursements: total_reimbursements,
        net_pay,
        salary_verified,
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
      total_bonuses,
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
  const { payroll_run_id } = event.data?.message?.json || {};
  console.log("[Controller AI] Starting generateWPSFile...");
  try {
    if (!payroll_run_id) throw new Error("Missing payroll_run_id in event payload.");

    const payrollDoc = await db.collection("payroll_runs").doc(payroll_run_id).get();
    if (!payrollDoc.exists) throw new Error(`Payroll run ${payroll_run_id} not found.`);

    const payroll = payrollDoc.data();
    if (payroll.status !== "APPROVED") {
      console.warn(`[Controller AI] Payroll ${payroll_run_id} is not APPROVED (status: ${payroll.status}). Skipping WPS generation.`);
      return;
    }

    // Employer MOL (Ministry of Labour establishment number) is mandatory for a
    // valid WPS/SIF file. We NEVER emit a placeholder — the bank would reject it
    // and it would misrepresent a real payment file. Block honestly if unset.
    const employerMOLNumber = String(COMPANY.mol_number || "").trim();
    if (!employerMOLNumber) {
      console.error("[WPS] MOL not configured — not emitting a WPS file.");
      await payrollDoc.ref.update({
        wps_status: "BLOCKED_NO_MOL",
        wps_error: "Establishment MOL number not configured. Set COMPANY.mol_number in company-legal.js, then regenerate the WPS file.",
      });
      return;
    }

    // WPS Saudi Arabia SIF/CSV Format Generation
    // Columns: Employee Name, ID/Iqama, Bank Name, IBAN, Net Salary, Employer MOL, Remarks
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
      wps_status: "GENERATED",
      wps_error: null,
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
    if (payroll_run_id) {
      await db.collection("payroll_runs").doc(payroll_run_id)
        .update({ wps_status: "FAILED", wps_error: String(error.message || error).slice(0, 500) })
        .catch(() => {});
    }
  }
}

async function generateGOSIReportHandler(event) {
  const { payroll_run_id } = event.data?.message?.json || {};
  console.log("[Controller AI] Starting generateGOSIReport...");
  try {
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
      gosi_status: "GENERATED",
      gosi_error: null,
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
    if (payroll_run_id) {
      await db.collection("payroll_runs").doc(payroll_run_id)
        .update({ gosi_status: "FAILED", gosi_error: String(error.message || error).slice(0, 500) })
        .catch(() => {});
    }
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

    // Consume installment deductions now that the run is final.
    await consumePayrollDeductions(after);

    // Auto-email each employee their payslip PDF (also stays in the portal).
    await emailPayslipsForRun(after, payrollRunId);
  } catch (err) {
    console.error("publishPayrollApproved error:", err);
  }
}

// Build a base64url RFC-2822 email with a single PDF attachment.
function buildPdfEmail({ from, to, subject, bodyText, filename, pdf }) {
  const b = `b_${Date.now().toString(16)}`;
  const msg = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${b}"`,
    "",
    `--${b}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    bodyText,
    "",
    `--${b}`,
    `Content-Type: application/pdf; name="${filename}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${filename}"`,
    "",
    pdf.toString("base64"),
    "",
    `--${b}--`,
  ].join("\r\n");
  return Buffer.from(msg).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// On final approval, render + email each employee their payslip. Best-effort per
// employee (one failure doesn't block the rest); records sent/failed on the run.
async function emailPayslipsForRun(run, runId) {
  try {
    const empSnap = await db.collection("employees").get();
    const byId = new Map();
    empSnap.forEach(d => { const e = d.data(); byId.set(e.employee_id || d.id, e); });

    const gmail = await getGmailClient();
    const sent = [];
    const failed = [];
    for (const line of (run.employees || [])) {
      const emp = byId.get(line.employee_id) || {};
      const to = String(emp.email || "").trim();
      if (!to) { failed.push({ employee_id: line.employee_id, reason: "no_email" }); continue; }
      try {
        const pdf = await renderPayslipPdf({ run, employeeId: line.employee_id, employee: emp });
        const raw = buildPdfEmail({
          from: "Datalake HR <hr@datalake.sa>",
          to,
          subject: `Your payslip — ${run.period}`,
          bodyText: `Dear ${line.name || ""},\n\nPlease find attached your payslip for ${run.period}. It is also available in your employee portal under Documents.\n\nThis document contains personal compensation data — please keep it confidential.\n\nDatalake HR\nhr@datalake.sa`,
          filename: `payslip-${run.period}-${line.employee_id}.pdf`,
          pdf,
        });
        const r = await gmail.users.messages.send({ userId: "hr@datalake.sa", requestBody: { raw } });
        sent.push({ employee_id: line.employee_id, to, gmail_message_id: r.data.id });
      } catch (e) {
        failed.push({ employee_id: line.employee_id, reason: String(e.message || e).slice(0, 200) });
      }
    }
    await db.collection("payroll_runs").doc(runId).update({
      payslips_emailed_at: admin.firestore.FieldValue.serverTimestamp(),
      payslips_emailed_count: sent.length,
      payslips_email_failed: failed,
    }).catch(() => {});
    console.log(`[Payroll] payslips emailed for ${runId}: ${sent.length} ok, ${failed.length} failed`);
  } catch (e) {
    console.error("[Payroll] emailPayslipsForRun error:", e.message);
  }
}

// Decrement each deduction's balance by what this APPROVED run actually took.
// Idempotent per (deduction, period): re-running won't double-consume, and a
// deduction is marked COMPLETED once its balance reaches zero.
async function consumePayrollDeductions(after) {
  const period = after.period;
  for (const emp of (after.employees || [])) {
    for (const line of (emp.deduction_lines || [])) {
      if (!line.deduction_id || !(Number(line.amount) > 0)) continue;
      const ref = db.collection("deductions").doc(line.deduction_id);
      try {
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists) return;
          const dd = snap.data();
          const applied = Array.isArray(dd.applied_periods) ? dd.applied_periods : [];
          if (applied.some(a => a.period === period)) return; // already consumed
          const remaining = Number(dd.remaining_balance != null ? dd.remaining_balance
            : (dd.total_amount != null ? dd.total_amount : dd.amount || 0));
          const take = Math.min(Number(line.amount), remaining);
          const newRemaining = Math.max(0, remaining - take);
          tx.update(ref, {
            remaining_balance: newRemaining,
            amount_deducted_to_date: Number(dd.amount_deducted_to_date || 0) + take,
            installments_paid: Number(dd.installments_paid || 0) + 1,
            applied_periods: [...applied, { period, amount: take }],
            status: newRemaining <= 0 ? "COMPLETED" : (dd.status || "ACTIVE"),
            updated_at: admin.firestore.FieldValue.serverTimestamp(),
          });
        });
      } catch (e) {
        console.error(`[Payroll] deduction consume failed for ${line.deduction_id}:`, e.message);
      }
    }
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

// ═══════════════════════════════════════════════════════════════════
// HTTP wrapper — verify / set an employee's SAR salary. HR/Finance/CEO.
// Flips salary_verified=true; if salary_monthly_sar is supplied (e.g. Finance
// converting a foreign-currency contract), writes the SAR figure and clears the
// foreign marker. Applies to the NEXT payroll run (existing DRAFTs are snapshots
// — recreate the run to pick it up).
// ═══════════════════════════════════════════════════════════════════
async function verifyEmployeeSalaryHandler(req, res, { getUserAccessProfile } = {}) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  try {
    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) return res.status(401).json({ error: "Missing auth token" });
    const decoded = await admin.auth().verifyIdToken(authHeader.slice(7));
    const profile = (getUserAccessProfile && await getUserAccessProfile(decoded.uid)) || null;
    const role = profile?.role_id || (decoded.email === "m.alqumri@datalake.sa" ? "ceo" : null);
    if (!role || !["ceo", "finance", "hr"].includes(role)) return res.status(403).json({ error: "Requires HR, Finance or CEO" });

    const { employee_id, salary_monthly_sar } = req.body || {};
    if (!employee_id) return res.status(400).json({ error: "employee_id required" });
    const ref = db.collection("employees").doc(employee_id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Employee not found" });

    const now = admin.firestore.FieldValue.serverTimestamp();
    const update = { salary_verified: true, salary_verified_by: profile?.email || decoded.email, salary_verified_at: now, updated_at: now };
    const setAmount = salary_monthly_sar !== undefined && salary_monthly_sar !== null && salary_monthly_sar !== "";
    if (setAmount) {
      const amt = Number(salary_monthly_sar);
      if (!(amt > 0)) return res.status(400).json({ error: "salary_monthly_sar must be a positive number" });
      update.salary_monthly_sar = amt;
      update.salary_monthly = amt;
      update.salary = amt;
      update.salary_currency = "SAR";
      update.salary_monthly_foreign = admin.firestore.FieldValue.delete();
      update.salary_source = "manual_verified";
    }
    await ref.set(update, { merge: true });

    await db.collection("task_audit_log").add({
      event: "EMPLOYEE_SALARY_VERIFIED",
      action_by: profile?.email || decoded.email, action_at: now,
      details: { employee_id, set_salary_sar: setAmount ? Number(salary_monthly_sar) : null, flag_only: !setAmount },
      ip_address: req.ip || req.headers["x-forwarded-for"] || "unknown",
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("verifyEmployeeSalary error:", err);
    return res.status(500).json({ error: err.message || "Internal error" });
  }
}

// Reverse the installment consumption a cancelled run had applied: re-credit
// each deduction's balance for that period (idempotent — only entries actually
// recorded for the period are unwound).
async function reversePayrollDeductions(after) {
  const period = after.period;
  for (const emp of (after.employees || [])) {
    for (const line of (emp.deduction_lines || [])) {
      if (!line.deduction_id) continue;
      const ref = db.collection("deductions").doc(line.deduction_id);
      try {
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists) return;
          const dd = snap.data();
          const applied = Array.isArray(dd.applied_periods) ? dd.applied_periods : [];
          const entry = applied.find(a => a.period === period);
          if (!entry) return; // nothing consumed for this period
          tx.update(ref, {
            remaining_balance: Number(dd.remaining_balance || 0) + Number(entry.amount || 0),
            amount_deducted_to_date: Math.max(0, Number(dd.amount_deducted_to_date || 0) - Number(entry.amount || 0)),
            installments_paid: Math.max(0, Number(dd.installments_paid || 0) - 1),
            applied_periods: applied.filter(a => a.period !== period),
            status: "ACTIVE",
            updated_at: admin.firestore.FieldValue.serverTimestamp(),
          });
        });
      } catch (e) {
        console.error(`[Payroll] deduction reversal failed for ${line.deduction_id}:`, e.message);
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// HTTP wrapper — cancel a payroll run. CEO ONLY. Sets status=CANCELLED,
// records the reason + audit, and reverses any installment deductions the run
// consumed. WPS/GOSI WORM files are immutable and remain on record (the run is
// marked void, not deleted) — re-create a fresh run if you need to re-pay.
// ═══════════════════════════════════════════════════════════════════
async function cancelPayrollRunHandler(req, res, { getUserAccessProfile } = {}) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  try {
    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) return res.status(401).json({ error: "Missing auth token" });
    const decoded = await admin.auth().verifyIdToken(authHeader.slice(7));
    const profile = (getUserAccessProfile && await getUserAccessProfile(decoded.uid)) || null;
    const role = profile?.role_id || (decoded.email === "m.alqumri@datalake.sa" ? "ceo" : null);
    if (role !== "ceo") return res.status(403).json({ error: "Only the CEO can cancel a payroll run" });

    const { payroll_run_id, reason } = req.body || {};
    if (!payroll_run_id) return res.status(400).json({ error: "payroll_run_id required" });
    if (!reason || !String(reason).trim()) return res.status(400).json({ error: "A cancellation reason is required" });

    const ref = db.collection("payroll_runs").doc(payroll_run_id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Payroll run not found" });
    const run = snap.data();
    if (!["APPROVED", "FINANCE_APPROVED", "DRAFT"].includes(run.status)) {
      return res.status(409).json({ error: `Run is ${run.status} — cannot cancel` });
    }
    if (run.status === "CANCELLED") return res.status(409).json({ error: "Run already cancelled" });

    // Only an APPROVED run had its deductions consumed — reverse those.
    if (run.status === "APPROVED") await reversePayrollDeductions(run);

    const now = admin.firestore.FieldValue.serverTimestamp();
    await ref.update({
      status: "CANCELLED",
      cancelled_by: profile?.email || decoded.email,
      cancelled_at: now,
      cancel_reason: String(reason).trim().slice(0, 500),
      previous_status: run.status,
      updated_at: now,
    });

    const audit = {
      event: "PAYROLL_RUN_CANCELLED", action_by: profile?.email || decoded.email, action_at: now,
      details: { payroll_run_id, previous_status: run.status, reason: String(reason).trim().slice(0, 500), deductions_reversed: run.status === "APPROVED" },
      ip_address: req.ip || req.headers["x-forwarded-for"] || "unknown",
    };
    await db.collection("task_audit_log").add(audit);
    await logToBigQuery("datalake_audit", "ai_actions", {
      agent_name: "Finance", action_type: "CANCEL_PAYROLL_RUN", entity_id: payroll_run_id,
      result: "SUCCESS", duration_ms: 0, regulatory_reference: "Payroll cancellation", timestamp: new Date(),
    }).catch(() => {});

    return res.status(200).json({ success: true, status: "CANCELLED", deductions_reversed: run.status === "APPROVED" });
  } catch (err) {
    console.error("cancelPayrollRun error:", err);
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
  verifyEmployeeSalaryHandler,
  cancelPayrollRunHandler,
};
