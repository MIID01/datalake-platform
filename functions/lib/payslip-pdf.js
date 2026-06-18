"use strict";

// Self-contained payslip PDF renderer used by the auto-email path (the portal
// download is rendered by pdfEngine.js — keep the two layouts consistent).
// English for now; Arabic bilingual is a follow-up (needs an embedded Arabic
// font + reshaping/bidi, verified visually).

const PDFDocument = require("pdfkit");
const { COMPANY, LEGAL_FOOTER_EN } = require("./company-legal");

const NAVY = "#022873";
const money = (n) => "SAR " + Math.round(Number(n) || 0).toLocaleString();

// run: payroll_runs doc data; employeeId: the line's employee_id; employee:
// employees doc data (for IBAN). Returns a Promise<Buffer>.
function renderPayslipPdf({ run, employeeId, employee = {} }) {
  return new Promise((resolve, reject) => {
    const line = (run.employees || []).find((e) => e.employee_id === employeeId);
    if (!line) return reject(new Error(`Employee ${employeeId} not in run`));

    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Header
    doc.fillColor(NAVY).fontSize(18).text(COMPANY.legal_name_en, { align: "left" });
    doc.moveDown(0.2);
    doc.strokeColor(NAVY).lineWidth(1).moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke();
    doc.moveDown(0.8);

    doc.fillColor(NAVY).fontSize(16).text("CONFIDENTIAL PAYSLIP", { align: "center" });
    doc.fillColor("#555").fontSize(9).text("This document contains personal compensation data — handle per PDPL Art. 5", { align: "center" });
    doc.moveDown(1);

    const iban = String(employee.bank_iban || "").trim();
    const maskedIban = iban ? iban.slice(0, 4) + " •••• •••• " + iban.slice(-4) : "(no IBAN on record)";

    doc.fillColor("black").fontSize(11)
      .text(`Employee:    ${line.name || employee.full_name || employeeId}`)
      .text(`Employee ID: ${employeeId}`)
      .text(`Period:      ${run.period || "N/A"}`)
      .text(`Nationality: ${line.nationality || "—"}  (GOSI bracket: ${line.gosi_type || "—"})`)
      .text(`Bank IBAN:   ${maskedIban}`);
    doc.moveDown(0.8);

    // Earnings
    doc.fontSize(12).fillColor(NAVY).text("Earnings");
    doc.fontSize(11).fillColor("black")
      .text(`  Basic salary       ${money(line.base_salary)}`)
      .text(`  Housing allowance  ${money(line.housing)}`)
      .text(`  Transport allow.   ${money(line.transport)}`);
    if (Number(line.bonuses || 0) > 0) doc.text(`  Bonuses            ${money(line.bonuses)}`);
    if (Number(line.reimbursements || 0) > 0) doc.text(`  Reimbursements     ${money(line.reimbursements)}`);
    const gross = Number(line.base_salary || 0) + Number(line.housing || 0) + Number(line.transport || 0) + Number(line.bonuses || 0) + Number(line.reimbursements || 0);
    doc.text(`  Gross              ${money(gross)}`);
    doc.moveDown(0.5);

    // Deductions (itemised)
    doc.fontSize(12).fillColor(NAVY).text("Deductions");
    doc.fontSize(11).fillColor("black").text(`  GOSI (employee)    ${money(line.gosi_employee)}`);
    const dedLines = (line.deduction_lines || []).filter((l) => l.direction !== "add" && Number(l.amount) > 0);
    if (dedLines.length) {
      dedLines.forEach((l) => doc.text(`  ${String(l.description || "Deduction").slice(0, 18)}  ${money(l.amount)}`));
    } else if (Number(line.deductions || 0) > 0) {
      doc.text(`  Other deductions   ${money(line.deductions)}`);
    }
    doc.moveDown(0.5);

    // Net
    doc.fontSize(13).fillColor(NAVY).text("Net Pay");
    doc.fontSize(13).fillColor("black").text(`  ${money(line.net_pay)}`);
    doc.moveDown(1);

    doc.fontSize(9).fillColor("#555")
      .text(`Payroll Run: ${run.period ? "PR-" + run.period : ""} · Status: ${run.status || "—"}`)
      .text(`Approved by: ${run.approved_by || "—"}`);

    // Legal footer
    doc.fontSize(7).fillColor("#888")
      .text(LEGAL_FOOTER_EN, 50, doc.page.height - 56, { width: doc.page.width - 100, align: "center" });

    doc.end();
  });
}

module.exports = { renderPayslipPdf };
