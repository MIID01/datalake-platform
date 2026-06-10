// functions/test/quote-flow.test.cjs
//
// Emulator verification for the CRM quote/discount approval flow.
// Run with the Firestore emulator up:
//   firebase emulators:exec --only firestore "node test/quote-flow.test.cjs"
//
// Two layers:
//   A. Handler tests (Admin SDK vs the emulator) — the server-side gate logic:
//      role checks, state machine, server-recomputed totals, evidence rows,
//      pending_approvals lifecycle, deal stamping. Plus the sendDealEmail role gate.
//   B. Rules tests (@firebase/rules-unit-testing) — the defense-in-depth half:
//      a client (sales) can create DRAFT + submit to PENDING_FINANCE, but CANNOT
//      write an APPROVED / PENDING_CEO state or forge an approval_evidence row.

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, setDoc, updateDoc } = require('firebase/firestore');

const PROJECT_ID = 'datalake-production-sa';
const HOST = '127.0.0.1';
const PORT = 8080;

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  PASS  ${name}`);
  else { console.error(`  FAIL  ${name}`); failures++; }
}

// ── Admin SDK (bypasses rules) — seeding + handler invocation ──
process.env.FIRESTORE_EMULATOR_HOST = `${HOST}:${PORT}`;
admin.initializeApp({ projectId: PROJECT_ID });
const adb = admin.firestore();

// require handlers AFTER admin init (they call admin.firestore() at module load)
const { financeReviewDealQuoteHandler, approveDealQuoteHandler, computeQuoteTotals } = require('../dealQuotes');

const ALLOWED_ORIGINS = ['http://localhost:5173'];
const helpersFor = (uid, role, email) => ({
  ALLOWED_ORIGINS,
  verifyAuth: async () => ({ uid, email }),
  getUserAccessProfile: async () => ({ uid, email, role_id: role }),
});
const mockReq = (body) => ({ method: 'POST', body, headers: { origin: 'http://localhost:5173', 'user-agent': 'test' }, ip: '127.0.0.1' });
function mockRes() { const r = { _s: 0, _j: null }; r.set = () => r; r.status = (c) => { r._s = c; return r; }; r.json = (j) => { r._j = j; return r; }; r.send = () => r; return r; }

// A PENDING_FINANCE quote whose stored total (999) is DELIBERATELY wrong — line
// items are 2 × 100 = 200, 10% off ⇒ 180. The gate functions must recompute to 180.
const baseQuote = () => ({
  deal_id: 'deal1', client_id: 'c1', deal_title: 'Test deal', client_name: 'ACME',
  line_items: [{ description: 'svc', qty: 2, unit_price_sar: 100, line_total_sar: 200 }],
  subtotal_sar: 999, discount_pct: 10, discount_sar: 0, total_sar: 999, // tampered
  currency: 'SAR', created_by: 'sales@datalake.sa',
});
const EXPECTED_TOTAL = computeQuoteTotals(baseQuote().line_items, 10).total_sar; // 180

async function runHandlerTests() {
  console.log('\n[A] Handler tests — server-side gate');
  await adb.collection('deals').doc('deal1').set({ title: 'Test deal', client_id: 'c1' });
  await adb.collection('deal_quotes').doc('q1').set({ ...baseQuote(), status: 'PENDING_FINANCE' });

  // 1. finance APPROVE → PENDING_CEO, recomputed total, pending_approvals row, evidence
  let res = mockRes();
  await financeReviewDealQuoteHandler(mockReq({ quote_id: 'q1', decision: 'APPROVE' }), res, helpersFor('uFin', 'finance', 'khaled@datalake.sa'));
  check('financeReview as finance → 200', res._s === 200);
  let q1 = (await adb.collection('deal_quotes').doc('q1').get()).data();
  check('quote → PENDING_CEO', q1.status === 'PENDING_CEO');
  check(`total recomputed server-side (tampered 999 → ${EXPECTED_TOTAL})`, q1.total_sar === EXPECTED_TOTAL);
  const pa = await adb.collection('pending_approvals').doc('q1').get();
  check('pending_approvals row created (type quote)', pa.exists && pa.data().type === 'quote' && pa.data().amount === EXPECTED_TOTAL);
  let ev = await adb.collection('deal_quotes').doc('q1').collection('approval_evidence').get();
  check('finance evidence row written', ev.size === 1 && ev.docs[0].data().action === 'FINANCE_REVIEW_QUOTE');

  // 2. non-finance rejected
  await adb.collection('deal_quotes').doc('q2').set({ ...baseQuote(), status: 'PENDING_FINANCE' });
  res = mockRes();
  await financeReviewDealQuoteHandler(mockReq({ quote_id: 'q2', decision: 'APPROVE' }), res, helpersFor('uEmp', 'employee', 'e@datalake.sa'));
  check('financeReview as employee → 403', res._s === 403);

  // 3. CEO approve q1 (PENDING_CEO) → APPROVED, evidence, queue cleared, deal stamped
  res = mockRes();
  await approveDealQuoteHandler(mockReq({ quote_id: 'q1', decision: 'APPROVE' }), res, helpersFor('uCeo', 'ceo', 'm.alqumri@datalake.sa'));
  check('approveDealQuote as ceo → 200', res._s === 200);
  q1 = (await adb.collection('deal_quotes').doc('q1').get()).data();
  check('quote → APPROVED', q1.status === 'APPROVED');
  check('pending_approvals row cleared', !(await adb.collection('pending_approvals').doc('q1').get()).exists);
  const deal = (await adb.collection('deals').doc('deal1').get()).data();
  check('deal stamped with approved_quote refs', deal.approved_quote_id === 'q1' && deal.approved_quote_total_sar === EXPECTED_TOTAL);
  ev = await adb.collection('deal_quotes').doc('q1').collection('approval_evidence').get();
  check('CEO evidence row present', ev.docs.some(d => d.data().action === 'CEO_APPROVE_QUOTE'));

  // 4. CEO gate — finance cannot do the CEO approval
  await adb.collection('deal_quotes').doc('q3').set({ ...baseQuote(), status: 'PENDING_CEO' });
  res = mockRes();
  await approveDealQuoteHandler(mockReq({ quote_id: 'q3', decision: 'APPROVE' }), res, helpersFor('uFin', 'finance', 'k@datalake.sa'));
  check('approveDealQuote as finance → 403', res._s === 403);

  // 5. wrong-state guard
  await adb.collection('deal_quotes').doc('q4').set({ ...baseQuote(), status: 'DRAFT' });
  res = mockRes();
  await financeReviewDealQuoteHandler(mockReq({ quote_id: 'q4', decision: 'APPROVE' }), res, helpersFor('uFin', 'finance', 'k@datalake.sa'));
  check('financeReview on DRAFT → 400', res._s === 400);

  // 6. REJECT requires notes
  await adb.collection('deal_quotes').doc('q5').set({ ...baseQuote(), status: 'PENDING_FINANCE' });
  res = mockRes();
  await financeReviewDealQuoteHandler(mockReq({ quote_id: 'q5', decision: 'REJECT' }), res, helpersFor('uFin', 'finance', 'k@datalake.sa'));
  check('financeReview REJECT without notes → 400', res._s === 400);

  // 7. sendDealEmail role gate (non-CRM → 403). Guarded — module pulls gmail at load.
  try {
    const { sendDealEmailHandler } = require('../deals');
    res = mockRes();
    await sendDealEmailHandler(mockReq({ deal_id: 'deal1', to: 'x@y.com', subject: 's', body: 'b' }), res, helpersFor('uEmp', 'employee', 'e@datalake.sa'));
    check('sendDealEmail as employee → 403', res._s === 403);
  } catch (e) {
    console.warn('  SKIP  sendDealEmail role gate (module load):', e.message);
  }
}

async function runRulesTests() {
  console.log('\n[B] Rules tests — client cannot write an approved state');
  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { host: HOST, port: PORT, rules: fs.readFileSync(path.join(__dirname, '..', '..', 'firestore.rules'), 'utf8') },
  });

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', 'salesUid'), { email: 'sales@datalake.sa', role_id: 'sales', status: 'active' });
    await setDoc(doc(db, 'deal_quotes', 'rqPF'), { deal_id: 'd', status: 'PENDING_FINANCE', line_items: [], total_sar: 0 });
    await setDoc(doc(db, 'deal_quotes', 'rqDraft'), { deal_id: 'd', status: 'DRAFT', line_items: [], total_sar: 0, created_by: 'sales@datalake.sa' });
  });

  const sales = testEnv.authenticatedContext('salesUid', { email: 'sales@datalake.sa' }).firestore();
  const ok = (p) => p.then(() => true, () => false);

  check('sales CAN create a DRAFT quote',
    await ok(assertSucceeds(setDoc(doc(sales, 'deal_quotes', 'newDraft'), { deal_id: 'd', status: 'DRAFT', line_items: [], total_sar: 0 }))));
  check('sales CAN submit DRAFT → PENDING_FINANCE',
    await ok(assertSucceeds(updateDoc(doc(sales, 'deal_quotes', 'rqDraft'), { status: 'PENDING_FINANCE' }))));
  check('sales CANNOT set status APPROVED (PERMISSION_DENIED)',
    await ok(assertFails(updateDoc(doc(sales, 'deal_quotes', 'rqPF'), { status: 'APPROVED' }))));
  check('sales CANNOT set status PENDING_CEO (PERMISSION_DENIED)',
    await ok(assertFails(updateDoc(doc(sales, 'deal_quotes', 'rqPF'), { status: 'PENDING_CEO' }))));
  check('sales CANNOT forge an approval_evidence row',
    await ok(assertFails(setDoc(doc(sales, 'deal_quotes', 'rqPF', 'approval_evidence', 'x'), { action: 'forge' }))));

  await testEnv.cleanup();
}

(async () => {
  try {
    await runHandlerTests();
    await runRulesTests();
  } catch (e) {
    console.error('Test harness error:', e);
    failures++;
  }
  console.log(`\n${failures === 0 ? '✅ ALL TESTS PASSED' : '❌ ' + failures + ' TEST(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
})();
