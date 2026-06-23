// READ-ONLY — why can / can't each employee submit a timesheet?
// Two gates in the app: (1) an ACTIVE project assignment, (2) the onboarding/training
// chain lock (only if platform_settings/timesheet_gate.enabled). Deletes/changes NOTHING.
//   cd functions && node scripts/timesheet-submit-diagnostic.js
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "datalake-production-sa" });
const db = admin.firestore();
const pad = (s, n) => String(s ?? "—").slice(0, n).padEnd(n);

(async () => {
  // gate state
  const gateSnap = await db.collection("platform_settings").doc("timesheet_gate").get();
  const gate = gateSnap.exists ? gateSnap.data() : {};
  const gateOn = gate.enabled === true;
  console.log(`\nChain gate (onboarding+training before timesheet): ${gateOn ? "ON" : "OFF"}${gate.effective_date ? " · effective " + JSON.stringify(gate.effective_date) : ""}\n`);

  // projects -> id -> {name, status}
  const projects = {};
  (await db.collection("projects").get()).forEach((d) => { const p = d.data(); projects[d.id] = { name: p.project_name || d.id, status: String(p.status || "").toUpperCase() }; });

  // assignments grouped by engineer email
  const asnByEmail = {};
  (await db.collection("engineer_project_assignments").get()).forEach((d) => {
    const a = d.data();
    const key = String(a.engineer_email || "").toLowerCase();
    (asnByEmail[key] = asnByEmail[key] || []).push({ project_id: a.project_id, role: a.role_on_project || a.role || "", active: a.active, status: a.status, end: a.end_date });
  });

  // employees
  const emps = await db.collection("employees").get();
  console.log(`=== ${emps.size} employees ===`);
  console.log(pad("name", 22), pad("email", 30), pad("emp_status", 12), pad("active-proj assignment", 34), "CAN SUBMIT?");
  const blocked = [];
  emps.forEach((d) => {
    const e = d.data();
    const email = String(e.email || "").toLowerCase();
    const asns = asnByEmail[email] || [];
    const activeAsns = asns.filter((a) => projects[a.project_id] && projects[a.project_id].status === "ACTIVE");
    const hasProject = activeAsns.length > 0;
    const projDesc = activeAsns.length ? activeAsns.map((a) => `${projects[a.project_id].name}`).join(", ") : (asns.length ? `(has ${asns.length}, none ACTIVE)` : "NONE");
    const can = hasProject; // gate (onboarding/training) only adds a 2nd condition if ON
    if (!can) blocked.push(`${e.full_name || email} <${email}>`);
    console.log(pad(e.full_name || e.name, 22), pad(email, 30), pad(e.employment_status || e.status, 12), pad(projDesc, 34), can ? "yes" : "NO — no active project");
  });
  console.log(`\nBlocked from submitting (no active project assignment): ${blocked.length}`);
  blocked.forEach((b) => console.log("   - " + b));
  if (gateOn) console.log("\nNOTE: chain gate is ON — even 'yes' rows also need onboarding + mandatory training complete.");
  process.exit(0);
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
