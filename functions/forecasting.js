const admin = require("firebase-admin");

/**
 * Calculates cash flow forecasts (13-week, 12-month, 3-year).
 * DTLK-PROC-FIN-002
 */

async function calculateForecasts() {
  const db = admin.firestore();
  
  // 1. Fetch data
  const [invoicesSnap, projectsSnap, timesheetsSnap, expensesSnap] = await Promise.all([
    db.collection("invoices").get(),
    db.collection("projects").where("status", "==", "ACTIVE").get(),
    db.collection("timesheets").where("state", "in", ["CLIENT_SIGNED", "CTO_APPROVED"]).get(),
    db.collection("expenses").where("status", "==", "APPROVED").get()
  ]);

  const invoices = invoicesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const projects = projectsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const timesheets = timesheetsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const expenses = expensesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  const now = new Date();
  // Ensure we use AST timezone or start of day
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // 2. Calculate average days to pay per client (DSO)
  const clientDSO = {};
  invoices.forEach(inv => {
    if (inv.status === "PAID" && inv.paid_at && inv.created_at) {
      const created = inv.created_at.toDate ? inv.created_at.toDate() : new Date(inv.created_at);
      const paid = inv.paid_at.toDate ? inv.paid_at.toDate() : new Date(inv.paid_at);
      const days = (paid - created) / (1000 * 60 * 60 * 24);
      if (!clientDSO[inv.client_name]) clientDSO[inv.client_name] = { totalDays: 0, count: 0 };
      clientDSO[inv.client_name].totalDays += days;
      clientDSO[inv.client_name].count++;
    }
  });

  const getDSO = (clientName) => {
    if (clientDSO[clientName] && clientDSO[clientName].count > 0) {
      return clientDSO[clientName].totalDays / clientDSO[clientName].count;
    }
    return 30; // Default 30 days
  };

  // 3. Initialize Buckets
  const forecast13Week = [];
  const forecast12Month = [];
  const forecast3Year = [];

  // Generate 13 weeks
  for (let i = 0; i < 13; i++) {
    const start = new Date(today);
    start.setDate(today.getDate() + (i * 7));
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    forecast13Week.push({ 
      period: `Week ${i+1}`, 
      start: start.getTime(), 
      end: end.getTime(), 
      inflows: 0, 
      outflows: 0,
      details: { invoices: 0, unbilled_timesheets: 0, payroll: 0, expenses: 0 }
    });
  }

  // Generate 12 months
  for (let i = 0; i < 12; i++) {
    const start = new Date(today.getFullYear(), today.getMonth() + i, 1);
    const end = new Date(today.getFullYear(), today.getMonth() + i + 1, 0);
    forecast12Month.push({ 
      period: start.toLocaleString('default', { month: 'short', year: '2-digit' }), 
      start: start.getTime(), 
      end: end.getTime(), 
      inflows: 0, 
      outflows: 0,
      details: { invoices: 0, unbilled_timesheets: 0, payroll: 0, expenses: 0 }
    });
  }

  // Generate 3 years (by quarter)
  for (let i = 0; i < 12; i++) {
    const qStartMonth = Math.floor(today.getMonth() / 3) * 3 + (i * 3);
    const start = new Date(today.getFullYear(), qStartMonth, 1);
    const end = new Date(today.getFullYear(), qStartMonth + 3, 0);
    const qNumber = Math.floor((start.getMonth() / 3)) + 1;
    forecast3Year.push({ 
      period: `Q${qNumber} '${String(start.getFullYear()).slice(-2)}`, 
      start: start.getTime(), 
      end: end.getTime(), 
      inflows: 0, 
      outflows: 0,
      details: { invoices: 0, unbilled_timesheets: 0, payroll: 0, expenses: 0 }
    });
  }

  const addToBuckets = (dateMs, amount, type) => {
    // 13-week
    const week = forecast13Week.find(w => dateMs >= w.start && dateMs <= w.end);
    if (week) {
      if (amount > 0) { week.inflows += amount; week.details[type] += amount; }
      else { week.outflows += Math.abs(amount); week.details[type] += Math.abs(amount); }
    }
    // 12-month
    const month = forecast12Month.find(m => dateMs >= m.start && dateMs <= m.end);
    if (month) {
      if (amount > 0) { month.inflows += amount; month.details[type] += amount; }
      else { month.outflows += Math.abs(amount); month.details[type] += Math.abs(amount); }
    }
    // 3-year
    const quarter = forecast3Year.find(q => dateMs >= q.start && dateMs <= q.end);
    if (quarter) {
      if (amount > 0) { quarter.inflows += amount; quarter.details[type] += amount; }
      else { quarter.outflows += Math.abs(amount); quarter.details[type] += Math.abs(amount); }
    }
  };

  // 4. Map Outstanding Invoices
  invoices.forEach(inv => {
    if (inv.status === "SENT" || inv.status === "OVERDUE") {
      const dso = getDSO(inv.client_name);
      const created = inv.created_at?.toDate ? inv.created_at.toDate() : new Date(inv.created_at || today);
      const expectedPaymentDate = new Date(created);
      expectedPaymentDate.setDate(expectedPaymentDate.getDate() + dso);
      
      // If expected payment is in the past, assume it will be paid within 7 days
      if (expectedPaymentDate < today) expectedPaymentDate.setDate(today.getDate() + 7);

      addToBuckets(expectedPaymentDate.getTime(), inv.total || 0, 'invoices');
    }
  });

  // 5. Map Approved Unbilled Timesheets
  const billedTimesheetIds = new Set(invoices.map(i => i.timesheet_id).filter(Boolean));
  timesheets.forEach(ts => {
    if (!billedTimesheetIds.has(ts.timesheet_id)) {
      // Find rate
      const proj = projects.find(p => p.project_id === ts.project_id);
      const rate = proj ? Number(proj.rate_amount_sar || 0) : 0;
      const expectedRevenue = (ts.total_hours || 0) * rate;
      
      // Assume invoiced at end of period, paid after DSO
      const dso = getDSO(ts.client_name);
      const expectedPaymentDate = new Date(today);
      expectedPaymentDate.setDate(today.getDate() + 15 + dso); // 15 days to invoice + DSO

      addToBuckets(expectedPaymentDate.getTime(), expectedRevenue * 1.15, 'unbilled_timesheets'); // + VAT
    }
  });

  // 6. Predict Future Payroll
  // Simple heuristic: 20k per active engineer per month on the 25th
  const uniqueEngineers = new Set(timesheets.map(t => t.engineer_id));
  const estimatedMonthlyPayroll = uniqueEngineers.size * 20000;
  
  for (let i = 0; i < 36; i++) {
    const pDate = new Date(today.getFullYear(), today.getMonth() + i, 25);
    addToBuckets(pDate.getTime(), -estimatedMonthlyPayroll, 'payroll');
  }

  // 7. Predict Recurring Expenses (Office, GCP)
  // Assume flat 150k monthly operating expense spread across the month
  for (let i = 0; i < 36; i++) {
    const eDate = new Date(today.getFullYear(), today.getMonth() + i, 15);
    addToBuckets(eDate.getTime(), -150000, 'expenses');
  }

  // 8. Calculate Cumulative Cash Balance
  // Assume starting cash is sum of paid invoices - past payroll/expenses (rough estimate for mock)
  let startingCash = 500000; // Mock starting cash balance since Zoho is disconnected

  const calculateCumulative = (arr) => {
    let current = startingCash;
    arr.forEach(item => {
      current = current + item.inflows - item.outflows;
      item.ending_balance = current;
    });
  };

  calculateCumulative(forecast13Week);
  calculateCumulative(forecast12Month);
  calculateCumulative(forecast3Year);

  // Save to Firestore
  await db.collection("finance").doc("forecast").set({
    last_updated: admin.firestore.FieldValue.serverTimestamp(),
    forecast13Week,
    forecast12Month,
    forecast3Year,
    dsoMetrics: clientDSO
  });

  return { success: true, message: "Forecast calculated successfully." };
}

// Cloud Function endpoint
async function recalculateForecastHandler(req, res, { verifyAuth, getUserAccessProfile, ALLOWED_ORIGINS }) {
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Origin", ALLOWED_ORIGINS.includes(req.headers.origin) ? req.headers.origin : "");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return res.status(204).send("");
  }
  
  try {
    const decoded = await verifyAuth(req);
    const profile = await getUserAccessProfile(decoded.uid);
    if (profile.role_id !== "ceo" && profile.role_id !== "finance") {
      return res.status(403).json({ error: "Permission denied" });
    }

    const result = await calculateForecasts();
    return res.status(200).json(result);
  } catch (err) {
    console.error("recalculateForecast error:", err);
    return res.status(500).json({ error: err.message });
  }
}

module.exports = {
  calculateForecasts,
  recalculateForecastHandler
};
