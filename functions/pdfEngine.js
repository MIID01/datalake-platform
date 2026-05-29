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
      const docSnap = await db.collection("payroll_runs").doc(docId).get();
      if (!docSnap.exists) throw new Error("Payroll not found");
      const data = docSnap.data();

      doc.fontSize(16).fillColor(primaryColor).text("CONFIDENTIAL PAYSLIP", { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).fillColor('black')
         .text(`Period: ${data.period || 'N/A'}`)
         .text(`Total Gross: SAR ${data.total_gross || 0}`)
         .text(`Total Net: SAR ${data.total_net || 0}`);

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
