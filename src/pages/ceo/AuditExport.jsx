import { useState, useMemo, useEffect } from 'react'
import {
  collection, collectionGroup, query, where, getDocs, Timestamp,
} from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { COMPANY, LEGAL_FOOTER_EN } from '../../lib/company-legal'
import { Calendar, Download, FileText, ShieldCheck, Loader, AlertCircle, FileSpreadsheet } from 'lucide-react'
import jsPDF from 'jspdf'

// /ceo/audit-export — read-heavy audit data pull for external auditors.
// Pulls every approval_evidence row (across invoices, payroll, contracts, hires),
// PDPL consents, compliance scans, and active contracts in the chosen date
// range. Renders a manifest table + downloadable CSV and branded PDF.

const SCOPES = [
  { id: 'approvals',     label: 'Approvals & Signatures', desc: 'Every approval_evidence row (invoices, payroll, contracts, hires).' },
  { id: 'pdpl',          label: 'PDPL Consents',          desc: 'Onboarding consent rows from employees/{id}/onboarding_evidence.' },
  { id: 'payroll',       label: 'Payroll Records',        desc: 'payroll/{run_id} runs and per-employee line items.' },
  { id: 'compliance',    label: 'Compliance Scans',       desc: 'compliance/* deadline + control scan records (incl. SAMA-OUT-NOC-001).' },
  { id: 'materiality',   label: 'SAMA Materiality Assessments', desc: 'projects/* sama_materiality determinations + NOC status.' },
  { id: 'iqama',         label: 'Iqama Lifecycle',        desc: 'iqama_records/* status + iqama_evidence rows (issue, renewal, transfer).' },
  { id: 'contracts',     label: 'Contracts',              desc: 'contracts/* documents, extraction status, signatures.' },
  { id: 'timesheets',    label: 'Timesheets',             desc: 'timesheets/* in the period with audit_trail.' },
]

function startOfMonthIso(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), 1)
  return x.toISOString().slice(0, 10)
}
function todayIso() { return new Date().toISOString().slice(0, 10) }

export default function AuditExport() {
  const [fromDate, setFromDate] = useState(startOfMonthIso(new Date()))
  const [toDate, setToDate] = useState(todayIso())
  const [selected, setSelected] = useState(Object.fromEntries(SCOPES.map(s => [s.id, true])))
  // ensure new scopes default to selected even if older state lingered
  useEffect(() => {
    setSelected(prev => {
      const next = { ...prev }
      SCOPES.forEach(s => { if (next[s.id] == null) next[s.id] = true })
      return next
    })
  }, [])
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [generatedAt, setGeneratedAt] = useState(null)

  const fromTs = useMemo(() => Timestamp.fromDate(new Date(fromDate + 'T00:00:00Z')), [fromDate])
  const toTs = useMemo(() => Timestamp.fromDate(new Date(toDate + 'T23:59:59Z')), [toDate])

  const toggle = (id) => setSelected(prev => ({ ...prev, [id]: !prev[id] }))

  const run = async () => {
    setLoading(true); setError(null); setRows(null)
    try {
      const all = []
      const pushed = (origin, row) => all.push({ origin, ...row })

      if (selected.approvals) {
        const snap = await getDocs(
          query(collectionGroup(db, 'approval_evidence'),
            where('approved_at', '>=', fromTs), where('approved_at', '<=', toTs))
        )
        snap.forEach(d => {
          const r = d.data()
          pushed('approval_evidence', {
            id: d.id,
            parent_collection: r.parent_collection || (d.ref.parent.parent?.parent?.id) || '',
            parent_id: r.parent_id || (d.ref.parent.parent?.id) || '',
            actor: r.approver_email || r.approver_name || '',
            role: r.approver_role || '',
            action: r.action || r.label || '',
            at: tsString(r.approved_at),
            ip: r.ip_address || '',
            user_agent: (r.user_agent || '').slice(0, 60),
            evidence_url: r.evidence_url || '',
            evidence_sha256: r.evidence_sha256 || '',
            signature_method: r.signature_method || '',
            signature_url: r.signature_url || '',
          })
        })
      }

      if (selected.pdpl) {
        const snap = await getDocs(
          query(collectionGroup(db, 'onboarding_evidence'),
            where('acknowledged_at', '>=', fromTs), where('acknowledged_at', '<=', toTs))
        )
        snap.forEach(d => {
          const r = d.data()
          pushed('onboarding_evidence', {
            id: d.id, parent_collection: 'employees',
            parent_id: d.ref.parent.parent?.id || '',
            actor: r.employee_email || '',
            role: 'EMPLOYEE',
            action: `PDPL: ${r.policy_name || r.policy_id || d.id}`,
            at: tsString(r.acknowledged_at),
            ip: r.ip_address || '',
            user_agent: (r.user_agent || '').slice(0, 60),
            evidence_url: '', evidence_sha256: '',
            signature_method: 'click_ack', signature_url: '',
          })
        })
      }

      if (selected.payroll) {
        const snap = await getDocs(
          query(collection(db, 'payroll'),
            where('created_at', '>=', fromTs), where('created_at', '<=', toTs))
        )
        snap.forEach(d => {
          const r = d.data()
          pushed('payroll', {
            id: d.id, parent_collection: 'payroll', parent_id: d.id,
            actor: r.created_by || '', role: '',
            action: `Payroll run ${r.period_label || ''} — SAR ${r.total_payroll_sar || r.total_payroll || ''}`,
            at: tsString(r.created_at), ip: '', user_agent: '',
            evidence_url: r.payslip_url || '', evidence_sha256: '',
            signature_method: '', signature_url: '',
          })
        })
      }

      if (selected.compliance) {
        const snap = await getDocs(query(collection(db, 'compliance')))
        snap.forEach(d => {
          const r = d.data()
          if (r.scan_at && (r.scan_at.toMillis?.() < fromTs.toMillis() || r.scan_at.toMillis?.() > toTs.toMillis())) return
          pushed('compliance', {
            id: d.id, parent_collection: 'compliance', parent_id: d.id,
            actor: r.actor || 'system', role: r.framework || '',
            action: r.title || r.control_name || d.id,
            at: tsString(r.scan_at) || tsString(r.due_date) || '',
            ip: '', user_agent: '',
            evidence_url: r.evidence_url || '', evidence_sha256: r.evidence_sha256 || '',
            signature_method: '', signature_url: '',
          })
        })
      }

      if (selected.contracts) {
        const snap = await getDocs(collection(db, 'contracts'))
        snap.forEach(d => {
          const r = d.data()
          const at = r.contract_pdf_uploaded_at || r.contract_extracted_at
          if (at?.toMillis && (at.toMillis() < fromTs.toMillis() || at.toMillis() > toTs.toMillis())) return
          pushed('contracts', {
            id: d.id, parent_collection: 'contracts', parent_id: d.id,
            actor: r.contract_pdf_uploaded_by || '', role: 'HR',
            action: `Contract for ${r.employee_id || r.candidate_name || '?'} — status ${r.contract_extraction_status || '?'}`,
            at: tsString(at), ip: '', user_agent: '',
            evidence_url: r.contract_pdf_storage_path ? `gs://datalake-worm-hr/${r.contract_pdf_storage_path}` : '',
            evidence_sha256: r.evidence_sha256 || '',
            signature_method: '', signature_url: '',
          })
        })
      }

      if (selected.iqama) {
        // iqama_evidence rows from every employee — covers every stage advance
        // (request → docs → submitted → issued → renewal → transfer).
        const evSnap = await getDocs(
          query(collectionGroup(db, 'iqama_evidence'),
            where('approved_at', '>=', fromTs), where('approved_at', '<=', toTs))
        )
        evSnap.forEach(d => {
          const r = d.data()
          pushed('iqama_evidence', {
            id: d.id,
            parent_collection: 'iqama_records',
            parent_id: r.parent_id || (d.ref.parent.parent?.id) || '',
            actor: r.approver_email || '',
            role: r.approver_role || 'HR',
            action: r.action || r.label || '',
            at: tsString(r.approved_at),
            ip: r.ip_address || '',
            user_agent: (r.user_agent || '').slice(0, 60),
            evidence_url: r.evidence_url || '',
            evidence_sha256: r.evidence_sha256 || '',
            signature_method: 'hr-action', signature_url: '',
          })
        })
        // Also dump the current state of every iqama_records doc so an
        // auditor can reconcile the running state against the evidence trail.
        const recSnap = await getDocs(collection(db, 'iqama_records'))
        recSnap.forEach(d => {
          const r = d.data()
          pushed('iqama_record', {
            id: d.id, parent_collection: 'iqama_records', parent_id: d.id,
            actor: r.updated_by || r.created_by || '',
            role: 'HR',
            action: `Status=${r.status || 'NONE'} · stage=${r.current_stage || '—'} · iqama=${r.iqama_number || '—'} · expiry=${r.expiry_date || '—'}`,
            at: tsString(r.updated_at) || tsString(r.created_at),
            ip: '', user_agent: '',
            evidence_url: '', evidence_sha256: '',
            signature_method: '', signature_url: '',
          })
        })
      }

      if (selected.materiality) {
        // SAMA materiality is stored on the engagement (projects) doc itself.
        // We're not date-filtering here because the assessment is a point-in-
        // time regulatory determination — auditors want every active record.
        const snap = await getDocs(collection(db, 'projects'))
        snap.forEach(d => {
          const r = d.data()
          const m = r.sama_materiality
          if (!m) return
          pushed('sama_materiality', {
            id: d.id, parent_collection: 'projects', parent_id: d.id,
            actor: m.assessed_by || '', role: 'CEO',
            action: `${m.determination || 'UNKNOWN'} · NOC: ${m.noc_status || 'NONE'} · ${r.project_name || ''} (${r.client_name || ''})`,
            at: tsString(m.assessed_at) || tsString(r.created_at),
            ip: '', user_agent: '',
            evidence_url: '', evidence_sha256: '',
            signature_method: m.assessment_signed ? 'ceo-signed' : '',
            signature_url: '',
          })
        })
      }

      if (selected.timesheets) {
        const snap = await getDocs(
          query(collection(db, 'timesheets'),
            where('submitted_at', '>=', fromTs), where('submitted_at', '<=', toTs))
        )
        snap.forEach(d => {
          const r = d.data()
          pushed('timesheets', {
            id: d.id, parent_collection: 'timesheets', parent_id: d.id,
            actor: r.engineer_email || '', role: 'ENGINEER',
            action: `${r.period_label || ''} — ${r.total_hours || 0}h — state ${r.state || '?'}`,
            at: tsString(r.submitted_at), ip: '', user_agent: '',
            evidence_url: r.signed_pdf_url || '', evidence_sha256: r.client_signature_hash || '',
            signature_method: r.client_signature_method || '',
            signature_url: r.client_signature_image || '',
          })
        })
      }

      all.sort((a, b) => (b.at || '').localeCompare(a.at || ''))
      setRows(all)
      setGeneratedAt(new Date().toISOString())
    } catch (e) {
      console.error('Audit export failed:', e)
      setError(e.message || 'Failed to build audit package')
    } finally {
      setLoading(false)
    }
  }

  const downloadCsv = () => {
    if (!rows?.length) return
    const headers = ['origin', 'parent_collection', 'parent_id', 'id', 'actor', 'role', 'action', 'at', 'ip', 'user_agent', 'evidence_url', 'evidence_sha256', 'signature_method', 'signature_url']
    const csv = [headers.join(',')]
      .concat(rows.map(r => headers.map(h => csvCell(r[h])).join(',')))
      .join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    triggerDownload(blob, `datalake-audit-${fromDate}_to_${toDate}.csv`)
  }

  const downloadPdf = () => {
    if (!rows?.length) return
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const pageW = pdf.internal.pageSize.getWidth()
    const pageH = pdf.internal.pageSize.getHeight()

    const drawHeader = (pageNum, totalPages) => {
      pdf.setFillColor(2, 40, 115)
      pdf.rect(0, 0, pageW, 18, 'F')
      pdf.setTextColor(255, 255, 255)
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11)
      pdf.text('Datalake Audit Export', 10, 11)
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8)
      pdf.text(`${fromDate} → ${toDate}`, pageW - 10, 8, { align: 'right' })
      pdf.text(`Page ${pageNum} of ${totalPages}`, pageW - 10, 13, { align: 'right' })
      pdf.setTextColor(2, 40, 115)
    }
    const drawFooter = () => {
      pdf.setFontSize(7); pdf.setTextColor(100)
      pdf.text(LEGAL_FOOTER_EN, pageW / 2, pageH - 6, { align: 'center' })
      pdf.text(`Generated ${new Date().toISOString()} · ${rows.length} rows`, pageW / 2, pageH - 3, { align: 'center' })
    }

    const cols = [
      { key: 'origin',     w: 22, h: 'Origin' },
      { key: 'parent_id',  w: 30, h: 'Parent' },
      { key: 'actor',      w: 42, h: 'Actor' },
      { key: 'role',       w: 18, h: 'Role' },
      { key: 'action',     w: 80, h: 'Action' },
      { key: 'at',         w: 36, h: 'When (UTC)' },
      { key: 'ip',         w: 25, h: 'IP' },
      { key: 'evidence_sha256', w: 24, h: 'Hash' },
    ]
    const totalW = cols.reduce((a, c) => a + c.w, 0)
    const startX = (pageW - totalW) / 2
    let y = 24

    const rowsPerPage = Math.floor((pageH - 36) / 6)
    const totalPages = Math.max(1, Math.ceil(rows.length / rowsPerPage))

    const drawRow = (row, isHeader) => {
      pdf.setFont('helvetica', isHeader ? 'bold' : 'normal')
      pdf.setFontSize(isHeader ? 8 : 7)
      let x = startX
      cols.forEach(c => {
        const val = isHeader ? c.h : String(row[c.key] ?? '').slice(0, Math.floor(c.w / 2))
        pdf.text(val, x + 1, y + 4)
        x += c.w
      })
      pdf.setDrawColor(220); pdf.line(startX, y + 5, startX + totalW, y + 5)
      y += 6
    }

    rows.forEach((r, i) => {
      if (i === 0 || y > pageH - 18) {
        if (i > 0) { drawFooter(); pdf.addPage(); y = 24 }
        drawHeader(Math.ceil((i + 1) / rowsPerPage), totalPages)
        drawRow({}, true)
      }
      drawRow(r, false)
    })
    drawFooter()
    pdf.save(`datalake-audit-${fromDate}_to_${toDate}.pdf`)
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
          <ShieldCheck size={22} color="#022873" />
          Audit Export
        </h1>
        <p style={{ fontSize: '0.86rem', color: 'var(--text-secondary)', marginTop: 6 }}>
          Pulls the evidence chain (approver, timestamp, IP, signature, hash) for everything in scope and packages it as a CSV manifest plus a branded PDF for {COMPANY.legal_name_en}.
        </p>
      </div>

      <div style={panel()}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 18 }}>
          <div>
            <label style={lbl()}>From</label>
            <input type="date" value={fromDate} max={toDate} onChange={e => setFromDate(e.target.value)} style={input()} />
          </div>
          <div>
            <label style={lbl()}>To</label>
            <input type="date" value={toDate} min={fromDate} max={todayIso()} onChange={e => setToDate(e.target.value)} style={input()} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10, marginBottom: 18 }}>
          {SCOPES.map(s => (
            <label key={s.id} style={{
              display: 'flex', gap: 10, padding: '10px 12px', borderRadius: 8,
              border: selected[s.id] ? '1px solid #022873' : '1px solid var(--border-primary, #E5E7EB)',
              background: selected[s.id] ? 'rgba(2,40,115,0.04)' : 'var(--bg-surface, #fff)',
              cursor: 'pointer',
            }}>
              <input type="checkbox" checked={!!selected[s.id]} onChange={() => toggle(s.id)} style={{ marginTop: 3 }} />
              <div>
                <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)' }}>{s.label}</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 2 }}>{s.desc}</div>
              </div>
            </label>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={run} disabled={loading || Object.values(selected).every(v => !v)} className="write-action" style={primaryBtn(loading)}>
            {loading ? <Loader size={14} className="spin" /> : <Calendar size={14} />} Generate Audit Package
          </button>
          {rows && rows.length > 0 && (
            <>
              <button onClick={downloadCsv} style={secondaryBtn()}><FileSpreadsheet size={14} /> Download CSV</button>
              <button onClick={downloadPdf} style={secondaryBtn()}><FileText size={14} /> Download PDF</button>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                {rows.length.toLocaleString()} rows · generated {generatedAt && new Date(generatedAt).toLocaleString()}
              </span>
            </>
          )}
        </div>
      </div>

      {error && (
        <div style={{ ...panel(), borderColor: '#fecaca', background: '#fff5f5' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: '#991b1b' }}>
            <AlertCircle size={16} /> {error}
          </div>
        </div>
      )}

      {rows && rows.length === 0 && (
        <div style={panel()}>
          <p style={{ color: 'var(--text-secondary)', textAlign: 'center', margin: 0, fontSize: '0.9rem' }}>
            No evidence rows in this window. Widen the date range or check the selected scopes.
          </p>
        </div>
      )}

      {rows && rows.length > 0 && (
        <div style={{ ...panel(), padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
              <thead>
                <tr style={{ background: 'var(--bg-surface, #F4F6F9)' }}>
                  <th style={th()}>Origin</th>
                  <th style={th()}>Parent</th>
                  <th style={th()}>Actor</th>
                  <th style={th()}>Role</th>
                  <th style={th()}>Action</th>
                  <th style={th()}>When (UTC)</th>
                  <th style={th()}>IP</th>
                  <th style={th()}>Signature</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 500).map((r, i) => (
                  <tr key={r.origin + ':' + r.id + ':' + i} style={{ borderTop: '1px solid var(--border-primary, #E5E7EB)' }}>
                    <td style={td()}><span style={pill(originColor(r.origin))}>{r.origin}</span></td>
                    <td style={{ ...td(), fontFamily: 'monospace', fontSize: '0.72rem' }}>{r.parent_id}</td>
                    <td style={td()}>{r.actor}</td>
                    <td style={td()}>{r.role}</td>
                    <td style={td()}>{r.action}</td>
                    <td style={{ ...td(), whiteSpace: 'nowrap' }}>{r.at}</td>
                    <td style={td()}>{r.ip}</td>
                    <td style={td()}>{r.signature_method || (r.signature_url ? 'signed' : '')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 500 && (
              <div style={{ padding: 12, textAlign: 'center', fontSize: '0.78rem', color: 'var(--text-secondary)', background: 'var(--bg-surface, #F4F6F9)' }}>
                Showing first 500 — the CSV / PDF download contains all {rows.length.toLocaleString()} rows.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function tsString(v) {
  if (!v) return ''
  try { return (v.toDate ? v.toDate() : new Date(v)).toISOString().replace('T', ' ').slice(0, 19) }
  catch { return '' }
}
function csvCell(v) {
  if (v == null) return ''
  const s = String(v).replace(/"/g, '""')
  return /[,\n"]/.test(s) ? `"${s}"` : s
}
function triggerDownload(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function originColor(origin) {
  return {
    approval_evidence: '#022873', onboarding_evidence: '#9C27B0',
    payroll: '#34BF3A', compliance: '#EF5829', contracts: '#1598CC',
    timesheets: '#F39C12',
  }[origin] || '#64748b'
}

const panel = () => ({
  background: 'var(--bg-surface, #fff)', border: '1px solid var(--border-primary, #E5E7EB)',
  borderRadius: 12, padding: 22, marginBottom: 16,
})
const lbl = () => ({ fontSize: '0.74rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6, display: 'block' })
const input = () => ({ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-primary, #E5E7EB)', background: 'var(--bg-surface, #fff)', color: 'var(--text-primary)', fontSize: '0.85rem', boxSizing: 'border-box', fontFamily: 'inherit' })
const primaryBtn = (loading) => ({ padding: '10px 18px', borderRadius: 8, border: '1px solid #022873', background: loading ? '#94a3b8' : '#022873', color: '#fff', cursor: loading ? 'not-allowed' : 'pointer', fontSize: '0.86rem', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: 'inherit' })
const secondaryBtn = () => ({ padding: '10px 16px', borderRadius: 8, border: '1px solid var(--border-primary, #E5E7EB)', background: 'var(--bg-surface, #fff)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '0.84rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'inherit' })
const th = () => ({ padding: '10px 12px', textAlign: 'left', fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' })
const td = () => ({ padding: '10px 12px', fontSize: '0.82rem', color: 'var(--text-primary)' })
const pill = (color) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 999, background: color + '22', color, fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' })
