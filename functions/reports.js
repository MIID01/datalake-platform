"use strict";

const admin = require("firebase-admin");
const db = admin.firestore();
const { logToBigQuery } = require("./lib/bigquery");

// ═══════════════════════════════════════════════════════════════════
// generateMonthlyReportHandler (Pub/Sub Subscriber to datalake.monthly.trigger)
// ═══════════════════════════════════════════════════════════════════
async function generateMonthlyReportHandler(event) {
  console.log("[Reports] Running generateMonthlyReportHandler...");
  try {
    const { year, month, year_month } = event.data.message.json;
    
    // 1. Gather Finance Data
    const payrollSnap = await db.collection("payroll_runs").where("period", "==", year_month).get();
    let payroll_total = 0;
    if (!payrollSnap.empty) {
      payroll_total = payrollSnap.docs[0].data().total_gross || 0;
    }

    const startDate = `${year_month}-01`;
    const endDate = `${year_month}-31`;
    const invoiceSnap = await db.collection("invoices")
      .where("period_start", ">=", startDate)
      .where("period_start", "<=", endDate)
      .get();
    let revenue_total = 0;
    let invoices_sent = invoiceSnap.size;
    let invoices_paid = 0;
    let invoices_overdue = 0;
    invoiceSnap.docs.forEach(d => {
      const inv = d.data();
      revenue_total += inv.total || 0;
      if (inv.status === "PAID") invoices_paid++;
      if (inv.status === "OVERDUE") invoices_overdue++;
    });

    const gross_margin = revenue_total - payroll_total;
    const margin_pct = revenue_total > 0 ? (gross_margin / revenue_total) * 100 : 0;

    // 2. Gather HR Data
    const usersSnap = await db.collection("users").where("role_id", "==", "engineer").get();
    const engineerIds = new Set(usersSnap.docs.map(d => d.id));

    const employeesSnap = await db.collection("employees")
      .where("employment_status", "==", "ACTIVE")
      .get();
    
    const expiringContracts = [];
    let active_engineers_count = 0;
    const alertThreshold = new Date();
    alertThreshold.setDate(alertThreshold.getDate() + 60);
    
    employeesSnap.docs.forEach(doc => {
      const emp = doc.data();
      const empId = emp.employee_id || doc.id;
      if (engineerIds.has(empId)) {
        active_engineers_count++;
      }

      if (emp.contract_end && new Date(emp.contract_end) <= alertThreshold) {
        expiringContracts.push({
          employee_id: empId,
          name: emp.full_name,
          end_date: emp.contract_end,
          days_remaining: Math.ceil((new Date(emp.contract_end) - new Date()) / (1000 * 60 * 60 * 24))
        });
      }
    });

    const leaveSnap = await db.collection("leave_requests")
      .where("status", "==", "APPROVED")
      .get(); // simplified without date filters for this example

    let total_days_taken = 0;
    const leave_by_type = {};
    leaveSnap.docs.forEach(d => {
      const l = d.data();
      total_days_taken += l.working_days || 0;
      const type = l.leave_type || "unknown";
      leave_by_type[type] = (leave_by_type[type] || 0) + (l.working_days || 0);
    });

    // 3. Gather Compliance Data
    const capasSnap = await db.collection("capas").where("status", "!=", "CLOSED").get();
    let open_capas = 0;
    let overdue_capas = 0;
    capasSnap.docs.forEach(d => {
      open_capas++;
      if (d.data().status === 'OVERDUE') overdue_capas++;
    });

    const violationsSnap = await db.collection("compliance_violations").where("status", "==", "OPEN").get();

    const clientsSnap = await db.collection("clients").get();
    let active_clients = clientsSnap.size;

    // 4. Build Report
    const report = {
      period: year_month,
      generated_at: admin.firestore.FieldValue.serverTimestamp(),
      generated_by: "system:monthly_ops",
      summary: {
        revenue_total,
        payroll_total,
        gross_margin,
        margin_pct: Number(margin_pct.toFixed(2)),
        active_engineers: active_engineers_count,
        active_clients: active_clients,
        new_hires: 0, // Placeholder
        departures: 0 // Placeholder
      },
      compliance: {
        scan_status: violationsSnap.empty ? "PASS" : "FINDINGS",
        findings_count: violationsSnap.size,
        critical_count: violationsSnap.docs.filter(d => d.data().severity === 'CRITICAL').length,
        high_count: violationsSnap.docs.filter(d => d.data().severity === 'HIGH').length,
        open_capas,
        overdue_capas,
        evidence_integrity_pass_rate: null
      },
      hr: {
        expiring_contracts: expiringContracts,
        leave_summary: {
          total_days_taken,
          by_type: leave_by_type
        },
        pdpl_purged_count: 0 // Placeholder, could query audit logs
      },
      finance: {
        invoices_sent,
        invoices_paid,
        invoices_overdue,
        po_utilization: {} // Placeholder
      },
      ai_agent_activity: {
        gatekeeper_actions: 0,
        controller_actions: 0,
        auditor_actions: 0
      }
    };

    await db.collection("monthly_reports").doc(year_month).set(report);
    
    await logToBigQuery("datalake_audit", "system_events", {
      event_type: "GENERATE_MONTHLY_REPORT",
      details: `Generated report for ${year_month}`,
      timestamp: new Date()
    });

    console.log(`[Reports] Generated CEO monthly report for ${year_month}`);
  } catch (err) {
    console.error("[Reports] generateMonthlyReportHandler error:", err);
  }
}

module.exports = {
  generateMonthlyReportHandler
};
