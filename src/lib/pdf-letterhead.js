// Shared letterhead for jsPDF (direct-draw) documents.
//
// Header  = Datalake color logo top-left on white, with an optional title/meta
//           block right-aligned.
// Footer  = a slim blue/green/orange brand band above the canonical legal line
//           (sourced from company-legal.js — NEVER hardcode the CR/address).
//
// Use on any jsPDF document so every exported/printed page carries the company
// letterhead consistently. html2canvas / DOM-based exports use <Letterhead>
// (src/components/Letterhead.jsx) instead.

import { LEGAL_FOOTER_EN } from './company-legal'
import { LETTERHEAD_LOGO_PNG, LETTERHEAD_LOGO_W, LETTERHEAD_LOGO_H } from './letterhead-logo-data'

// Brand tokens (RGB) — match the design system in CLAUDE.md / src/index.css.
export const BRAND = {
  navy:   [2, 40, 115],    // #022873
  blue:   [21, 152, 204],  // #1598CC
  green:  [52, 191, 58],   // #34BF3A
  orange: [239, 88, 41],   // #EF5829
  grey:   [110, 110, 110],
}

const LOGO_ASPECT = LETTERHEAD_LOGO_W / LETTERHEAD_LOGO_H

// Draw the letterhead header. Returns the Y (mm) where document content should
// start, so callers can lay out below it.
//   opts: { title?, meta?: string[], marginX?: number, logoH?: number, top?: number }
export function drawLetterheadHeader(pdf, opts = {}) {
  const { title, meta = [], marginX = 12, logoH = 12, top = 10 } = opts
  const pageW = pdf.internal.pageSize.getWidth()
  const logoW = logoH * LOGO_ASPECT

  pdf.addImage(LETTERHEAD_LOGO_PNG, 'PNG', marginX, top, logoW, logoH)

  if (title) {
    pdf.setTextColor(...BRAND.navy)
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(13)
    pdf.text(title, pageW - marginX, top + 4, { align: 'right' })
  }
  if (meta.length) {
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8)
    pdf.setTextColor(...BRAND.grey)
    meta.forEach((line, i) => {
      pdf.text(String(line), pageW - marginX, top + 9 + i * 4, { align: 'right' })
    })
  }

  // Thin navy rule under the header.
  pdf.setDrawColor(...BRAND.navy); pdf.setLineWidth(0.3)
  const ruleY = top + logoH + 2
  pdf.line(marginX, ruleY, pageW - marginX, ruleY)
  pdf.setTextColor(0, 0, 0)
  return ruleY + 5
}

// Draw the brand footer band + legal line on the current page.
//   opts: { extraLine?: string, marginX?: number }
export function drawLetterheadFooter(pdf, opts = {}) {
  const { extraLine, marginX = 12 } = opts
  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()

  // 3-colour brand band (blue / green / orange), full content width.
  const bandY = pageH - 13
  const bandH = 1.8
  const segW = (pageW - marginX * 2) / 3
  const segs = [BRAND.blue, BRAND.green, BRAND.orange]
  segs.forEach((c, i) => {
    pdf.setFillColor(...c)
    pdf.rect(marginX + i * segW, bandY, segW, bandH, 'F')
  })

  // Canonical legal line (single source of truth) + optional generated line.
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7)
  pdf.setTextColor(...BRAND.navy)
  pdf.text(LEGAL_FOOTER_EN, pageW / 2, pageH - 8, { align: 'center' })
  if (extraLine) {
    pdf.setFontSize(6.5); pdf.setTextColor(...BRAND.grey)
    pdf.text(String(extraLine), pageW / 2, pageH - 4.5, { align: 'center' })
  }
  pdf.setTextColor(0, 0, 0)
}
