/**
 * AI Services Integration Test Runner
 * Tests all AI endpoints against deployed Cloud Functions
 * Run from functions/: node ../ai-services/test-files/run-tests.cjs
 */
const fs = require("fs");
const path = require("path");
const { GoogleAuth } = require("google-auth-library");

const PROJECT_ID = "datalake-production-sa";
const REGION = "me-central2";

// Cloud Function URLs
const FUNCTIONS_BASE = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net`;
const TIMESHEET_VALIDATE_URL = `${FUNCTIONS_BASE}/controllerTimesheetValidate`;
const CONTRACT_REVIEW_URL = `${FUNCTIONS_BASE}/auditorContractReview`;

const results = [];

async function getIdToken(targetUrl) {
  const auth = new GoogleAuth();
  const client = await auth.getIdTokenClient(targetUrl);
  const headers = await client.getRequestHeaders();
  return headers.Authorization;
}

async function testTimesheetValidation(testFile, expectedOutcome) {
  const testName = path.basename(testFile);
  console.log(`\n── Testing ${testName} (expected: ${expectedOutcome}) ──`);
  try {
    const data = JSON.parse(fs.readFileSync(testFile, "utf8"));
    const token = await getIdToken(TIMESHEET_VALIDATE_URL);
    
    const res = await fetch(TIMESHEET_VALIDATE_URL, {
      method: "POST",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({ timesheet_data: data }),
    });

    const body = await res.json();
    console.log(`  Status: ${res.status}`);
    console.log(`  Valid: ${body.result?.valid}`);
    console.log(`  Issues: ${(body.result?.issues || []).length}`);
    if (body.result?.issues?.length) {
      body.result.issues.forEach((i, idx) => console.log(`    ${idx+1}. ${i}`));
    }

    const passed = expectedOutcome === "PASS" 
      ? body.result?.valid === true && (body.result?.issues || []).length === 0
      : body.result?.valid === false && (body.result?.issues || []).length >= 5;
    
    results.push({ test: testName, expected: expectedOutcome, actual: passed ? expectedOutcome : "UNEXPECTED", pass: passed, issues: (body.result?.issues || []).length });
    console.log(`  RESULT: ${passed ? "✅ PASS" : "❌ FAIL"}`);
  } catch (err) {
    console.error(`  ERROR: ${err.message}`);
    results.push({ test: testName, expected: expectedOutcome, actual: "ERROR", pass: false, error: err.message });
  }
}

async function testContractReview() {
  const testName = "TEST_CONTRACT_001_Emkan_MSA";
  console.log(`\n── Testing ${testName} ──`);
  try {
    const contractText = `
MASTER SERVICES AGREEMENT
Between: Emkan Technologies Co. ("Provider") and Datalake Information Technology Co. ("Client")
Date: 1 January 2026

Article 1 - Scope of Services
Provider shall deliver IT consulting and staff augmentation services.

Article 2 - Term
This agreement is effective for 12 months from the signing date.

Article 3 - Fees
Monthly fees as per each Statement of Work. All amounts in SAR. VAT at 15% applies.

Article 4 - Confidentiality
Both parties shall maintain confidentiality of proprietary information.

Article 5 - Termination
Either party may terminate with 30 days written notice.

Article 6 - Governing Law
This Agreement shall be governed by the laws of the Kingdom of Saudi Arabia.
`;

    const token = await getIdToken(CONTRACT_REVIEW_URL);
    const res = await fetch(CONTRACT_REVIEW_URL, {
      method: "POST",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({ contract_text: contractText, contract_type: "MSA" }),
    });

    const body = await res.json();
    console.log(`  Status: ${res.status}`);
    console.log(`  Risk Level: ${body.result?.risk_level}`);
    console.log(`  Findings: ${(body.result?.findings || []).length}`);
    console.log(`  Missing Clauses: ${(body.result?.missing_clauses || []).length}`);
    if (body.result?.missing_clauses?.length) {
      body.result.missing_clauses.forEach((c, i) => console.log(`    ${i+1}. ${c}`));
    }

    // Should flag missing SAMA/NCA clauses
    const hasMissing = (body.result?.missing_clauses || []).length > 0 || 
                       (body.result?.findings || []).length > 0;
    results.push({ 
      test: testName, expected: "FLAG_MISSING", actual: hasMissing ? "FLAG_MISSING" : "NO_FLAGS", 
      pass: hasMissing, risk: body.result?.risk_level, findings: (body.result?.findings || []).length 
    });
    console.log(`  RESULT: ${hasMissing ? "✅ PASS (flagged missing clauses)" : "❌ FAIL (no flags)"}`);
  } catch (err) {
    console.error(`  ERROR: ${err.message}`);
    results.push({ test: testName, expected: "FLAG_MISSING", actual: "ERROR", pass: false, error: err.message });
  }
}

async function main() {
  console.log("=== DATALAKE AI SERVICES INTEGRATION TESTS ===\n");
  console.log(`Project: ${PROJECT_ID}`);
  console.log(`Region: ${REGION}`);
  console.log(`Time: ${new Date().toISOString()}\n`);

  // Test 1: Valid timesheet
  await testTimesheetValidation(
    path.resolve(__dirname, "TEST_TIMESHEET_001_entries.json"),
    "PASS"
  );

  // Test 2: Bad timesheet
  await testTimesheetValidation(
    path.resolve(__dirname, "TEST_TIMESHEET_002_BAD_entries.json"),
    "FAIL"
  );

  // Test 3: Contract review
  await testContractReview();

  // Summary
  console.log("\n\n=== TEST RESULTS SUMMARY ===");
  console.log("┌───────────────────────────────────────────┬──────────┬──────────┬────────┐");
  console.log("│ Test                                      │ Expected │ Actual   │ Result │");
  console.log("├───────────────────────────────────────────┼──────────┼──────────┼────────┤");
  for (const r of results) {
    const name = r.test.substring(0, 41).padEnd(41);
    const exp = r.expected.padEnd(8);
    const act = r.actual.padEnd(8);
    const res = r.pass ? "✅ PASS" : "❌ FAIL";
    console.log(`│ ${name} │ ${exp} │ ${act} │ ${res} │`);
  }
  console.log("└───────────────────────────────────────────┴──────────┴──────────┴────────┘");
  console.log(`\nTotal: ${results.length} | Passed: ${results.filter(r => r.pass).length} | Failed: ${results.filter(r => !r.pass).length}`);
}

main().catch(err => { console.error("Test runner failed:", err); process.exit(1); });
