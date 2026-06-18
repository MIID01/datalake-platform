/**
 * deductions.js — per-employee payroll deductions (one-off or multi-month
 * installments). The `deductions` collection is the source of truth; payroll
 * (finance.js) reads ACTIVE deductions, applies the right installment each run,
 * and consumes the balance on approval (consumePayrollDeductions).
 *
 * Writes go through these functions only (validation + audit). Reads are
 * rules-gated to HR/Finance/CEO. Amounts are SAR.
 *
 * createDeduction / listDeductions / cancelDeduction — HR, Finance or CEO.
 */

const admin = require("firebase-admin");
const db = admin.firestore();

const ALLOWED = ["ceo", "finance", "hr"];

// HR deduction categories (the dropdown). Keep in sync with the frontend list
// in src/pages/hr/HRDeductions.jsx. Stored for reporting; does not change math.
const CATEGORIES = ["loan", "advance", "bounce", "fine", "absence", "damage", "gosi_adjustment", "other"];

async function authorize(req, { getUserAccessProfile }) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) return { error: 401, message: "Missing auth token" };
  const decoded = await admin.auth().verifyIdToken(authHeader.slice(7));
  const profile = (getUserAccessProfile && (await getUserAccessProfile(decoded.uid))) || null;
  const role = profile?.role_id || (decoded.email === "m.alqumri@datalake.sa" ? "ceo" : null);
  if (!role || !ALLOWED.includes(role)) return { error: 403, message: "Requires HR, Finance or CEO" };
  return { email: profile?.email || decoded.email, role };
}

async function createDeductionHandler(req, res, helpers = {}) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  try {
    const auth = await authorize(req, helpers);
    if (auth.error) return res.status(auth.error).json({ error: auth.message });

    const { employee_id, description, total_amount, type, installments, start_period, category } = req.body || {};
    if (!employee_id) return res.status(400).json({ error: "employee_id is required" });
    const cat = CATEGORIES.includes(category) ? category : "other";
    const total = Number(total_amount);
    if (!(total > 0)) return res.status(400).json({ error: "total_amount must be a positive number" });
    const dtype = type === "installment" ? "installment" : "one_off";
    let installmentsN = 1;
    if (dtype === "installment") {
      installmentsN = parseInt(installments, 10);
      if (!(installmentsN >= 2)) return res.status(400).json({ error: "installment deductions need at least 2 installments" });
    }
    const period = (start_period && /^\d{4}-\d{2}$/.test(start_period))
      ? start_period
      : new Date().toISOString().slice(0, 7);

    // Monthly amount: split evenly; the final run takes whatever balance remains,
    // so rounding never over- or under-charges (payroll caps at remaining_balance).
    const monthly_amount = dtype === "installment"
      ? Math.round((total / installmentsN) * 100) / 100
      : total;

    // Denormalise the employee name for display.
    let employee_name = employee_id;
    try {
      const empSnap = await db.collection("employees").doc(employee_id).get();
      if (empSnap.exists) employee_name = empSnap.data().full_name || empSnap.data().name || employee_id;
    } catch (_) { /* best-effort */ }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const docRef = await db.collection("deductions").add({
      employee_id,
      employee_name,
      category: cat,
      description: String(description || "Deduction").slice(0, 200),
      type: dtype,
      total_amount: total,
      monthly_amount,
      installments: installmentsN,
      installments_paid: 0,
      amount_deducted_to_date: 0,
      remaining_balance: total,
      applied_periods: [],
      start_period: period,
      currency: "SAR",
      status: "ACTIVE",
      created_by: auth.email,
      created_at: now,
      updated_at: now,
    });

    await db.collection("task_audit_log").add({
      event: "DEDUCTION_CREATED",
      action_by: auth.email,
      action_at: now,
      details: { deduction_id: docRef.id, employee_id, employee_name, category: cat, type: dtype, total_amount: total, installments: installmentsN, monthly_amount, start_period: period },
      ip_address: req.ip || req.headers["x-forwarded-for"] || "unknown",
    });

    return res.status(200).json({ success: true, deduction_id: docRef.id });
  } catch (err) {
    console.error("createDeduction error:", err);
    return res.status(500).json({ error: err.message || "Internal error" });
  }
}

async function listDeductionsHandler(req, res, helpers = {}) {
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "GET or POST" });
  try {
    const auth = await authorize(req, helpers);
    if (auth.error) return res.status(auth.error).json({ error: auth.message });

    const employee_id = (req.body && req.body.employee_id) || req.query?.employee_id || null;
    let q = db.collection("deductions");
    if (employee_id) q = q.where("employee_id", "==", employee_id);
    const snap = await q.get();
    const deductions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return res.status(200).json({ deductions });
  } catch (err) {
    console.error("listDeductions error:", err);
    return res.status(500).json({ error: err.message || "Internal error" });
  }
}

async function cancelDeductionHandler(req, res, helpers = {}) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  try {
    const auth = await authorize(req, helpers);
    if (auth.error) return res.status(auth.error).json({ error: auth.message });

    const { deduction_id } = req.body || {};
    if (!deduction_id) return res.status(400).json({ error: "deduction_id is required" });
    const ref = db.collection("deductions").doc(deduction_id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Deduction not found" });
    if (snap.data().status === "COMPLETED") return res.status(409).json({ error: "Deduction already completed" });

    const now = admin.firestore.FieldValue.serverTimestamp();
    await ref.update({ status: "CANCELLED", cancelled_by: auth.email, cancelled_at: now, updated_at: now });

    await db.collection("task_audit_log").add({
      event: "DEDUCTION_CANCELLED",
      action_by: auth.email,
      action_at: now,
      details: { deduction_id, employee_id: snap.data().employee_id, remaining_balance: snap.data().remaining_balance },
      ip_address: req.ip || req.headers["x-forwarded-for"] || "unknown",
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("cancelDeduction error:", err);
    return res.status(500).json({ error: err.message || "Internal error" });
  }
}

module.exports = { createDeductionHandler, listDeductionsHandler, cancelDeductionHandler };
