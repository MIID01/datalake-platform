// Revenue Loop E2E Test — writes directly to Firestore via Admin SDK
// Tests: candidate → project → assignment → timesheet → CTO approve → client sign → finance notify
const admin = require("firebase-admin");
const crypto = require("crypto");

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

async function runTest() {
  const results = {};
  const now = admin.firestore.FieldValue.serverTimestamp();

  console.log("=== REVENUE LOOP TEST START ===");
  console.log("Candidate: C-2026-9226 (from live careers submission)\n");

  // STEP 1: Verify candidate exists
  console.log("[1] Verifying candidate C-2026-9226...");
  const candidateDoc = await db.collection("talent_pool").doc("C-2026-9226").get();
  if (candidateDoc.exists) {
    const c = candidateDoc.data();
    console.log(`  ✓ Found: ${c.full_name} (${c.email})`);
    results.step1_candidate = "VERIFIED";
  } else {
    console.log("  ✗ Candidate not found!");
    results.step1_candidate = "NOT_FOUND";
  }

  // STEP 2: Create test project
  console.log("\n[2] Creating test project...");
  const projectId = `PRJ-2026-TEST${Math.floor(Math.random() * 9000) + 1000}`;
  await db.collection("projects").doc(projectId).set({
    project_id: projectId,
    project_name: "Revenue Loop Test — Emkan Q2",
    client_name: "Emkan Finance",
    client_approver_name: "Ahmad Al-Shahrani",
    client_approver_email: "ahmad@emkan.com",
    start_date: admin.firestore.Timestamp.fromDate(new Date()),
    end_date: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 90 * 24 * 3600000)),
    po_number: "PO-TEST-001",
    po_value_sar: 120000,
    work_location_type: "HYBRID",
    billing_model: "TIME_AND_MATERIAL",
    rate_structure: "HOURLY",
    rate_amount_sar: 500,
    status: "ACTIVE",
    engineers_count: 0,
    po_currency: "SAR",
    timesheet_approval_mode: "PER_ENGINEER",
    created_by: "test-script:m.alqumri@datalake.sa",
    created_at: now,
    updated_at: now,
  });
  console.log(`  ✓ Created project: ${projectId}`);
  results.step2_project = projectId;

  // STEP 3: Assign engineer to project
  console.log("\n[3] Assigning engineer...");
  const assignmentId = `ASN-TEST-${Date.now()}`;
  await db.collection("engineer_project_assignments").doc(assignmentId).set({
    assignment_id: assignmentId,
    project_id: projectId,
    project_name: "Revenue Loop Test — Emkan Q2",
    client_name: "Emkan Finance",
    engineer_id: "ENG-TEST-001",
    engineer_email: "ahmed.test@datalake.sa",
    engineer_name: "Ahmed Test Engineer",
    role_on_project: "Senior Data Engineer",
    start_date: admin.firestore.Timestamp.fromDate(new Date()),
    end_date: null,
    rate_sar: 500,
    allocation_percentage: 100,
    status: "ACTIVE",
    created_by: "test-script",
    created_at: now,
    updated_at: now,
  });
  await db.collection("projects").doc(projectId).update({
    engineers_count: admin.firestore.FieldValue.increment(1),
  });
  console.log(`  ✓ Created assignment: ${assignmentId}`);
  results.step3_assignment = assignmentId;

  // STEP 4: Create test timesheet (SUBMITTED state)
  console.log("\n[4] Creating test timesheet...");
  const timesheetId = `TS-2026-04-AHMEDTES-${projectId}`;
  const days = {};
  let totalH = 0, inHouseH = 0, remoteH = 0;
  for (let d = 1; d <= 30; d++) {
    const dow = new Date(2026, 3, d).getDay();
    if (dow === 5 || dow === 6) {
      days[String(d)] = { type: "weekend", hours: 0 };
    } else if (d <= 10) {
      days[String(d)] = { type: "in_house", hours: 8 };
      totalH += 8; inHouseH += 8;
    } else {
      days[String(d)] = { type: "remote", hours: 8 };
      totalH += 8; remoteH += 8;
    }
  }

  await db.collection("timesheets").doc(timesheetId).set({
    timesheet_id: timesheetId,
    engineer_email: "ahmed.test@datalake.sa",
    engineer_name: "Ahmed Test Engineer",
    project_id: projectId,
    project_name: "Revenue Loop Test — Emkan Q2",
    client_name: "Emkan Finance",
    client_approver_email: "ahmad@emkan.com",
    client_approver_name: "Ahmad Al-Shahrani",
    period_month: 4,
    period_year: 2026,
    period_label: "April 2026",
    days: days,
    total_hours: totalH,
    in_house_hours: inHouseH,
    remote_hours: remoteH,
    leave_hours: 0,
    state: "SUBMITTED",
    submitted_at: now,
    cto_action_at: null, cto_action_by: null, cto_decision: null, cto_notes: null,
    ceo_escalated_at: null, ceo_action_at: null, ceo_action_by: null,
    client_action_at: null, client_signature_hash: null, client_signature_method: null, client_action_ip: null,
    rejection_reason: null,
    audit_trail: [{ timestamp: new Date().toISOString(), event: "SUBMITTED", actor: "ahmed.test@datalake.sa" }],
    created_at: now,
    updated_at: now,
  });
  console.log(`  ✓ Created timesheet: ${timesheetId} (${totalH}h total, ${inHouseH}h office, ${remoteH}h remote)`);
  results.step4_timesheet = { id: timesheetId, hours: totalH };

  // STEP 5: CTO approval
  console.log("\n[5] CTO approval...");
  await db.collection("timesheets").doc(timesheetId).update({
    state: "CTO_APPROVED",
    cto_action_at: now,
    cto_action_by: "cto@datalake.sa",
    cto_decision: "APPROVE",
    cto_notes: "Test approval — revenue loop verification",
    updated_at: now,
    audit_trail: admin.firestore.FieldValue.arrayUnion({
      timestamp: new Date().toISOString(),
      event: "CTO_APPROVED",
      actor: "cto@datalake.sa",
      notes: "Test approval",
    }),
  });

  // Create client sign task
  const clientTaskId = `TSK-TEST-${Date.now()}`;
  await db.collection("tasks").doc(clientTaskId).set({
    task_id: clientTaskId,
    title: `Sign timesheet: Ahmed Test Engineer — April 2026`,
    description: `Test: please sign approved timesheet ${timesheetId}`,
    task_type: "SIGN",
    creation_method: "RULE_TRIGGERED",
    created_by: "test-script:ctoApproveTimesheet",
    created_at: now,
    assigned_to_type: "INDIVIDUAL",
    assigned_to_id: "ahmad@emkan.com",
    assigned_to_role: "CLIENT_APPROVER",
    priority: "NORMAL",
    related_entity_type: "TIMESHEET",
    related_entity_id: timesheetId,
    state: "OPEN",
    completed_at: null, completed_by: null,
    verification_status: "PENDING_VERIFICATION",
    recurrence: "ONE_TIME",
    notes: null,
  });
  console.log(`  ✓ Timesheet CTO_APPROVED, client task created: ${clientTaskId}`);
  results.step5_cto = "CTO_APPROVED";

  // STEP 6: Client signature
  console.log("\n[6] Client signature...");
  const sigHash = crypto.createHash("sha256")
    .update(`${timesheetId}|ahmad@emkan.com|DRAW|${Date.now()}`)
    .digest("hex");

  await db.collection("timesheets").doc(timesheetId).update({
    state: "CLIENT_SIGNED",
    client_action_at: now,
    client_signature_hash: sigHash,
    client_signature_method: "DRAW",
    client_action_ip: "test-script",
    updated_at: now,
    audit_trail: admin.firestore.FieldValue.arrayUnion({
      timestamp: new Date().toISOString(),
      event: "CLIENT_SIGNED",
      actor: "ahmad@emkan.com",
      signature_hash: sigHash,
    }),
  });

  // Finance notification
  await db.collection("finance_notifications").add({
    type: "INVOICE_READY_TO_PREPARE",
    timesheet_id: timesheetId,
    project_id: projectId,
    project_name: "Revenue Loop Test — Emkan Q2",
    client_name: "Emkan Finance",
    engineer_name: "Ahmed Test Engineer",
    period_label: "April 2026",
    total_hours: totalH,
    created_at: now,
    processed: false,
  });
  console.log(`  ✓ Client signed. Signature: ${sigHash.substring(0, 16)}...`);
  console.log(`  ✓ Finance notification created: INVOICE_READY_TO_PREPARE`);
  results.step6_client = { state: "CLIENT_SIGNED", sig: sigHash.substring(0, 16) };

  // Audit log
  await db.collection("task_audit_log").add({
    event: "REVENUE_LOOP_TEST_COMPLETE",
    timesheet_id: timesheetId,
    project_id: projectId,
    action_by: "test-script:m.alqumri@datalake.sa",
    action_at: now,
    details: { total_hours: totalH, signature_hash: sigHash },
  });

  // STEP 7: Verify all collections have data
  console.log("\n[7] Collection verification...");
  const collections = [
    "talent_pool", "tasks", "evaluations", "projects",
    "engineer_project_assignments", "timesheets",
    "finance_notifications", "task_audit_log",
  ];
  const collResults = {};
  for (const coll of collections) {
    const snap = await db.collection(coll).limit(1).get();
    const status = snap.empty ? "EMPTY ✗" : "HAS DATA ✓";
    console.log(`  ${coll}: ${status}`);
    collResults[coll] = !snap.empty;
  }
  results.step7_collections = collResults;

  // STEP 8: Final timesheet state verification
  console.log("\n[8] Final timesheet state...");
  const finalTs = await db.collection("timesheets").doc(timesheetId).get();
  const tsData = finalTs.data();
  console.log(`  State: ${tsData.state}`);
  console.log(`  Audit trail entries: ${tsData.audit_trail?.length || 0}`);
  console.log(`  Signature hash: ${tsData.client_signature_hash?.substring(0, 16)}...`);
  results.step8_final = {
    state: tsData.state,
    audit_entries: tsData.audit_trail?.length,
    has_signature: !!tsData.client_signature_hash,
  };

  console.log("\n=== REVENUE LOOP TEST COMPLETE ===");
  console.log("\nResults:");
  console.log(JSON.stringify(results, null, 2));
}

runTest().catch(err => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
