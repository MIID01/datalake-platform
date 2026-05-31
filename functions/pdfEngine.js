"use strict";

const admin = require("firebase-admin");
const PDFDocument = require("pdfkit");
const db = admin.firestore();

// ══════════════════════════════════════════════════════════════════
// generatePDFHandler (HTTP Endpoint)
// POST /generatePDF with { template, docId, options }
// ══════════════════════════════════════════════════════════════════
async function generatePDFHandler(req, res, { verifyAuth, getUserAccessProfile, ALLOWED_ORIGINS }) {
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Origin", ALLOWED_ORIGINS.includes(req.headers.origin) ? req.headers.origin : "");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return res.status(204).send("");
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const decoded = await verifyAuth(req);
    const profile = await getUserAccessProfile(decoded.uid);
    if (!["ceo", "finance", "hr"].includes(profile.role_id)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    const { template, docId, options } = req.body;
    if (!template || !docId) {
      return res.status(400).json({ error: "Missing template or docId" });
    }

    // Default tenant branding
    let branding = {
      company_name: "Datalake Saudi Arabia LLC",
      primary_color: "#022873",
      secondary_color: "#1598CC",
      footer_text: "Datalake Saudi Arabia LLC, Riyadh Al-Yarmouk 13243, CR:1009194773 NUN:7048904952",
      logo_url: "gs://datalake-grc-library/brand/logo.png",
      stamp_url: "gs://datalake-grc-library/brand/company-stamp.png",
    };

    const tenantId = profile.tenant_id || "datalake";
    const brandingDoc = await db.collection("tenants").doc(tenantId).collection("branding").doc("config").get();
    if (brandingDoc.exists) {
      branding = { ...branding, ...brandingDoc.data() };
    }

    // Build the PDF
    const buffers = [];
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    
    doc.on('data', buffers.push.bind(buffers));
    
    let isFinished = false;
    const finishedPromise = new Promise((resolve) => {
      doc.on('end', () => { isFinished = true; resolve(); });
    });

    // Handle branding colors
    const primaryColor = branding.primary_color || "#022873";
    const secondaryColor = branding.secondary_color || "#1598CC";

    // Header
    doc.fillColor(primaryColor).fontSize(20).text(branding.company_name, { align: 'left' });
    doc.fontSize(12).fillColor('black').text(`Document ID: ${docId}`, { align: 'right' });
    doc.moveDown(2);

    // Fetch data based on template
    if (template === "invoice") {
      const docSnap = await db.collection("invoices").doc(docId).get();
      if (!docSnap.exists) throw new Error("Invoice not found");
      const data = docSnap.data();

      doc.fontSize(16).fillColor(primaryColor).text("TAX INVOICE / فاتورة ضريبية", { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).fillColor('black')
         .text(`Client ID: ${data.client_id || 'N/A'}`)
         .text(`Period: ${data.period || 'N/A'}`)
         .text(`Subtotal: SAR ${data.amount || 0}`)
         .text(`VAT (15%): SAR ${(data.amount || 0) * 0.15}`)
         .text(`Total: SAR ${(data.amount || 0) * 1.15}`);

    } else if (template === "payslip") {
      // docId can be either:
      //   • "PR-2026-05"               → run-level summary (totals only)
      //   • "PR-2026-05__DLSA1003"     → per-employee payslip
      const sep = docId.indexOf("__");
      const runId = sep > 0 ? docId.slice(0, sep) : docId;
      const employeeId = sep > 0 ? docId.slice(sep + 2) : null;
      const docSnap = await db.collection("payroll_runs").doc(runId).get();
      if (!docSnap.exists) throw new Error("Payroll run not found: " + runId);
      const data = docSnap.data();

      if (!employeeId) {
        // Run-level summary
        doc.fontSize(16).fillColor(primaryColor).text("CONFIDENTIAL — PAYROLL RUN SUMMARY", { align: 'center' });
        doc.moveDown();
        doc.fontSize(12).fillColor('black')
           .text(`Period:           ${data.period || 'N/A'}`)
           .text(`Employees paid:   ${data.employee_count || (data.employees?.length || 0)}`)
           .text(`Pending contract: ${data.pending_contract_count || 0}`)
           .text(`Total Gross:      SAR ${Math.round(data.total_gross || 0).toLocaleString()}`)
           .text(`Total GOSI (er.): SAR ${Math.round(data.total_gosi_employee || 0).toLocaleString()}`)
           .text(`Total Net:        SAR ${Math.round(data.total_net || 0).toLocaleString()}`)
           .text(`Status:           ${data.status || '—'}`);
      } else {
        const line = (data.employees || []).find(e => e.employee_id === employeeId);
        if (!line) throw new Error(`Employee ${employeeId} not found in run ${runId}`);

        const empSnap = await db.collection("employees").doc(employeeId).get();
        const emp = empSnap.exists ? empSnap.data() : {};
        const fullName = line.name || emp.full_name || employeeId;
        const iban = String(emp.bank_iban || "").trim();
        const maskedIban = iban
          ? iban.slice(0, 4) + " •••• •••• " + iban.slice(-4)
          : "(no IBAN on record)";

        doc.fontSize(16).fillColor(primaryColor).text("CONFIDENTIAL PAYSLIP", { align: 'center' });
        doc.fontSize(9).fillColor('#555').text("This document contains personal compensation data — handle per PDPL Art. 5", { align: 'center' });
        doc.moveDown(1);

        doc.fontSize(11).fillColor('black')
           .text(`Employee:    ${fullName}`)
           .text(`Employee ID: ${employeeId}`)
           .text(`Period:      ${data.period || 'N/A'}`)
           .text(`Nationality: ${line.nationality || '—'}  (GOSI bracket: ${line.gosi_type || '—'})`)
           .text(`Bank IBAN:   ${maskedIban}`);
        doc.moveDown(0.8);

        doc.fontSize(12).fillColor(primaryColor).text("Earnings");
        doc.fontSize(11).fillColor('black')
           .text(`  Basic salary       SAR ${Math.round(line.base_salary || 0).toLocaleString().padStart(12)}`)
           .text(`  Housing allowance  SAR ${Math.round(line.housing || 0).toLocaleString().padStart(12)}`)
           .text(`  Transport allow.   SAR ${Math.round(line.transport || 0).toLocaleString().padStart(12)}`)
           .text(`  Reimbursements     SAR ${Math.round(line.reimbursements || 0).toLocaleString().padStart(12)}`);
        const grossOne = (Number(line.base_salary || 0) + Number(line.housing || 0) + Number(line.transport || 0) + Number(line.reimbursements || 0));
        doc.text(`  Gross              SAR ${Math.round(grossOne).toLocaleString().padStart(12)}`);
        doc.moveDown(0.5);

        doc.fontSize(12).fillColor(primaryColor).text("Deductions");
        doc.fontSize(11).fillColor('black')
           .text(`  GOSI (employee)    SAR ${Math.round(line.gosi_employee || 0).toLocaleString().padStart(12)}`)
           .text(`  Other deductions   SAR ${Math.round(line.deductions || 0).toLocaleString().padStart(12)}`);
        doc.moveDown(0.5);

        doc.fontSize(13).fillColor(primaryColor).text("Net Pay");
        doc.fontSize(13).fillColor('black')
           .text(`  SAR ${Math.round(line.net_pay || 0).toLocaleString()}`);
        doc.moveDown(1);

        doc.fontSize(9).fillColor('#555')
           .text(`Payroll Run ID: ${runId} · Status: ${data.status || '—'}`)
           .text(`Approved at: ${data.approved_at?.toDate ? data.approved_at.toDate().toISOString() : '—'}  ·  Approved by: ${data.approved_by || '—'}`);
      }

    } else if (template === "timesheet") {
      const docSnap = await db.collection("timesheets").doc(docId).get();
      if (!docSnap.exists) throw new Error("Timesheet not found");
      const data = docSnap.data();
      
      doc.fontSize(16).fillColor(primaryColor).text("TIMESHEET", { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).fillColor('black')
         .text(`Employee ID: ${data.employee_id || 'N/A'}`)
         .text(`Period: ${data.period || 'N/A'}`)
         .text(`Total Hours: ${data.total_hours || 0}`);

    } else if (template === "monthly_report") {
      const docSnap = await db.collection("monthly_reports").doc(docId).get();
      if (!docSnap.exists) throw new Error("Monthly Report not found");
      const data = docSnap.data();

      doc.fontSize(16).fillColor(primaryColor).text("CEO MONTHLY REPORT", { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).fillColor('black')
         .text(`Period: ${data.period || 'N/A'}`)
         .text(`Revenue: SAR ${data.summary?.revenue_total || 0}`)
         .text(`Margin: ${data.summary?.margin_pct || 0}%`);

    } else if (template === "contract_summary") {
      const docSnap = await db.collection("contracts").doc(docId).get();
      if (!docSnap.exists) throw new Error("Contract not found");
      const data = docSnap.data();

      doc.fontSize(16).fillColor(primaryColor).text("INTERNAL CONTRACT SUMMARY", { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).fillColor('black')
         .text(`Employee ID: ${data.employee_id || 'N/A'}`)
         .text(`Start Date: ${data.contract_start_date || 'N/A'}`);

    } else if (template === "expense_report") {
      doc.fontSize(16).fillColor(primaryColor).text("EXPENSE REPORT", { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).fillColor('black').text(`Document ID: ${docId}`);

    } else if (template === "pdpl_consent") {
      // PDPL Article 5 / Article 18 — proof that consent was given.
      // docId is the employees/{employee_id} doc id (e.g. "DLSA1003").
      // Loads the employee record, the onboarding subcollection (one row per
      // policy acknowledgment), and the matching users row (IP, role).
      const empSnap = await db.collection("employees").doc(docId).get();
      if (!empSnap.exists) throw new Error(`Employee ${docId} not found`);
      const emp = empSnap.data();

      // Find the linked users row by employee_id, uid, or email — same shape as the directory join.
      let userData = null;
      if (emp.uid) {
        const u = await db.collection("users").doc(emp.uid).get();
        if (u.exists) userData = u.data();
      }
      if (!userData) {
        const q = await db.collection("users").where("employee_id", "==", docId).limit(1).get();
        if (!q.empty) userData = q.docs[0].data();
      }
      if (!userData && emp.email) {
        const q = await db.collection("users")
          .where("email", "==", String(emp.email).toLowerCase()).limit(1).get();
        if (!q.empty) userData = q.docs[0].data();
      }
      userData = userData || {};

      // Onboarding evidence subcollection. New rows live at
      // employees/{id}/onboarding_evidence/{policy_id} with the spec shape:
      // { policy_id, policy_name, acknowledged_at, ip_address, user_agent }.
      // Fall back to the legacy `onboarding` collection so historical rows
      // (pre-rename) still surface on the certificate.
      let ackSnap = await db.collection("employees").doc(docId).collection("onboarding_evidence").get();
      if (ackSnap.empty) {
        ackSnap = await db.collection("employees").doc(docId).collection("onboarding").get();
      }
      const acks = ackSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => String(a.policy_id || a.item_id || a.id).localeCompare(String(b.policy_id || b.item_id || b.id)));

      const granted = userData.onboarding_complete === true || emp.onboarding_complete === true;
      const consentState = userData.pdpl_consent_state || emp.pdpl_consent_state || (granted ? "GRANTED" : "NOT_GRANTED");
      const consentAt = userData.pdpl_consent_at
        || emp.pdpl_consent_at
        || userData.onboarding_completed_at
        || emp.onboarding_completed_at
        || null;
      const consentIp = userData.pdpl_consent_ip || userData.last_login_ip || "not captured (network policy)";
      const fullName = emp.full_name || emp.name || userData.display_name || docId;

      doc.fontSize(18).fillColor(primaryColor).text("PDPL Consent Certificate", { align: 'center' });
      doc.moveDown(0.4);
      doc.fontSize(10).fillColor('#555').text("Saudi Personal Data Protection Law (PDPL) — Article 5 record of consent", { align: 'center' });
      doc.moveDown(1.2);

      doc.fontSize(12).fillColor('black')
        .text(`Employee:           ${fullName}`)
        .text(`Employee ID:        ${docId}`)
        .text(`Email:              ${emp.email || userData.email || '—'}`)
        .text(`Job Title:          ${emp.job_title || '—'}`)
        .moveDown(0.6)
        .text(`Consent state:      ${consentState}`)
        .text(`Granted at:         ${consentAt && consentAt.toDate ? consentAt.toDate().toISOString() : (consentAt || '—')}`)
        .text(`From IP address:    ${consentIp}`)
        .text(`Captured on:        Datalake Platform (datalake.sa)`);

      doc.moveDown(1);
      doc.fontSize(13).fillColor(primaryColor).text("Policies acknowledged");
      doc.moveDown(0.3);

      if (acks.length === 0) {
        doc.fontSize(11).fillColor('#999').text("No acknowledgment rows were found for this employee.");
      } else {
        for (const a of acks) {
          const item = a.policy_name || a.policy_id || a.item_id || a.id;
          const atRaw = a.acknowledged_at || a.completed_at;
          const at = atRaw && atRaw.toDate ? atRaw.toDate().toISOString() : (atRaw || '—');
          const by = a.acknowledged_by || a.employee_email || '—';
          const ip = a.ip_address || '—';
          doc.fontSize(11).fillColor('black')
            .text(`  • ${item}`)
            .fillColor('#555').fontSize(10)
            .text(`     acknowledged_by: ${by}`)
            .text(`     at:              ${at}`)
            .text(`     ip_address:      ${ip}`)
            .moveDown(0.3)
            .fillColor('black');
        }
      }

      doc.moveDown(1);
      doc.fontSize(9).fillColor('#666').text(
        "This certificate is generated from the Datalake platform's onboarding ledger at the moment of download. " +
        "Consent rows are stored append-only at employees/{employee_id}/onboarding_evidence/ and cannot be backdated. " +
        "If this employee has not actually clicked through the four onboarding policies, the Consent state will be NOT_GRANTED.",
        { align: 'justify' }
      );
    } else {
      throw new Error(`Unknown template: ${template}`);
    }

    // Footer
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fillColor(secondaryColor).text(
        `${branding.footer_text} | Page ${i + 1} of ${pages.count}`,
        50, doc.page.height - 50,
        { align: 'center' }
      );
    }

    doc.end();
    await finishedPromise;
    const pdfData = Buffer.concat(buffers);

    // Save to GCS
    const bucketName = "datalake-worm-finance";
    const bucket = admin.storage().bucket(bucketName);
    const timestamp = Date.now();
    const filePath = `pdfs/${template}/${docId}_${timestamp}.pdf`;
    
    // Create bucket object if it doesn't exist? Assume bucket exists.
    try {
      const file = bucket.file(filePath);
      await file.save(pdfData, {
        contentType: "application/pdf",
        metadata: {
          cacheControl: "private, max-age=0",
          metadata: { template, docId, tenantId },
        },
      });
      console.log(`[PDF Engine] Saved PDF to ${filePath}`);
    } catch (gcsError) {
      console.error("[PDF Engine] GCS save error (ignoring for response):", gcsError);
    }

    // Send HTTP response
    res.set("Access-Control-Allow-Origin", ALLOWED_ORIGINS.includes(req.headers.origin) ? req.headers.origin : "");
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="${template}_${docId}.pdf"`);
    res.status(200).send(pdfData);

  } catch (err) {
    console.error("[PDF Engine] Error:", err);
    return res.status(500).json({ error: err.message });
  }
}

module.exports = {
  generatePDFHandler
};
