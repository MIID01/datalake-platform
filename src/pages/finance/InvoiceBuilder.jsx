import { useMemo, useState } from 'react'
import { useNavigate, useOutletContext, Link } from 'react-router-dom'
import { auth } from '../../lib/firebase'
import { GENERATE_INVOICE_URL } from '../../lib/firebase'
import {
  ArrowLeft, Plus, Trash2, FileText, AlertTriangle, Loader,
} from 'lucide-react'

const VAT_RATE = 0.15
const SAR = (n) => `SAR ${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// Build the initial line item from a CLIENT_SIGNED timesheet.
function seedLineFromTimesheet(ts) {
  const periodLabel = ts.period_label
    || (ts.period_month && ts.period_year ? `${ts.period_month}/${ts.period_year}` : '')
  const hours = Number(ts.total_hours) || 0
  const desc = [ts.engineer_name || 'Engineer', periodLabel].filter(Boolean).join(' — ')
  return {
    description: hours ? `${desc} (${hours} hrs)` : desc,
    quantity: hours || 1,
    unit_price: 0,
  }
}

// Try to convert a Firestore Timestamp / ISO string / Date / number to YYYY-MM-DD.
function toDateInputValue(v) {
  if (!v) return ''
  try {
    const d = v?.toDate ? v.toDate() : new Date(v)
    if (Number.isNaN(d.getTime())) return ''
    return d.toISOString().slice(0, 10)
  } catch {
    return ''
  }
}

// Derive a sensible period_start / period_end from a timesheet shape.
function derivePeriod(ts) {
  if (ts.period_start && ts.period_end) {
    return { start: toDateInputValue(ts.period_start), end: toDateInputValue(ts.period_end) }
  }
  if (ts.period_month && ts.period_year) {
    const y = Number(ts.period_year)
    const m = Number(ts.period_month) - 1 // JS months are 0-indexed
    const start = new Date(Date.UTC(y, m, 1))
    const end = new Date(Date.UTC(y, m + 1, 0))
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
  }
  return { start: '', end: '' }
}

export default function InvoiceBuilder() {
  const navigate = useNavigate()
  const { timesheets = [], projects = [], loading, error } = useOutletContext() || {}

  // ── Selection state ──
  const [timesheetId, setTimesheetId] = useState('')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [lineItems, setLineItems] = useState([])
  const [notes, setNotes] = useState('')

  // ── Submission state ──
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)

  // Only CLIENT_SIGNED timesheets that haven't been invoiced yet.
  const billable = useMemo(() => {
    return timesheets.filter(t => {
      const state = (t.state || t.status || '').toUpperCase()
      return state === 'CLIENT_SIGNED' && !t.invoice_id
    })
  }, [timesheets])

  const selectedTs = useMemo(
    () => billable.find(t => t.id === timesheetId || t.timesheet_id === timesheetId) || null,
    [billable, timesheetId],
  )

  // Resolve the project for the selected timesheet (for PO + client display).
  const selectedProject = useMemo(() => {
    if (!selectedTs) return null
    const pid = selectedTs.project_id
    return projects.find(p => p.project_id === pid || p.id === pid) || null
  }, [selectedTs, projects])

  // Picking a timesheet seeds period + the first line item. Done in the handler
  // (not an effect) so we don't trigger cascading renders.
  const selectTimesheet = (id) => {
    setTimesheetId(id)
    const ts = billable.find(t => (t.id === id || t.timesheet_id === id))
    if (!ts) {
      setPeriodStart(''); setPeriodEnd(''); setLineItems([])
      return
    }
    const { start, end } = derivePeriod(ts)
    setPeriodStart(start)
    setPeriodEnd(end)
    setLineItems([seedLineFromTimesheet(ts)])
  }

  // ── Totals ──
  const totals = useMemo(() => {
    const subtotal = lineItems.reduce((sum, li) => sum + (Number(li.quantity) || 0) * (Number(li.unit_price) || 0), 0)
    const vat = Math.round(subtotal * VAT_RATE * 100) / 100
    const total = Math.round((subtotal + vat) * 100) / 100
    return { subtotal: Math.round(subtotal * 100) / 100, vat, total }
  }, [lineItems])

  // ── Line item editing ──
  const updateLine = (i, field, value) => {
    setLineItems(prev => prev.map((li, idx) => (idx === i ? { ...li, [field]: value } : li)))
  }
  const addLine = () => setLineItems(prev => [...prev, { description: '', quantity: 1, unit_price: 0 }])
  const removeLine = (i) => setLineItems(prev => prev.filter((_, idx) => idx !== i))

  // ── Validation ──
  const validationError = useMemo(() => {
    if (!selectedTs) return 'Select a CLIENT_SIGNED timesheet to bill.'
    if (!selectedProject?.client_id) return 'Selected timesheet\'s project has no client_id — fix the project record first.'
    if (!periodStart || !periodEnd) return 'Period start and end are required.'
    if (lineItems.length === 0) return 'Add at least one line item.'
    for (const li of lineItems) {
      if (!li.description?.trim()) return 'Every line item needs a description.'
      if (!(Number(li.quantity) > 0)) return 'Every line item needs a positive quantity.'
      if (!(Number(li.unit_price) > 0)) return 'Every line item needs a positive unit price.'
    }
    return null
  }, [selectedTs, selectedProject, periodStart, periodEnd, lineItems])

  // ── Submit ──
  // Contract (Phase 5 / 11a7f0f): { client_id, po_number, period_start, period_end,
  //                                  line_items[], notes?, timesheet_ids[] }
  // Backend role check is still "ceo" only — 403 on finance until widened.
  const handleSubmit = async () => {
    if (validationError) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const user = auth.currentUser
      if (!user) throw new Error('Not signed in.')
      const idToken = await user.getIdToken()

      const payload = {
        client_id: selectedProject.client_id,
        po_number: selectedProject?.po_number || null,
        period_start: periodStart,
        period_end: periodEnd,
        timesheet_ids: [selectedTs.timesheet_id || selectedTs.id],
        notes: notes || '',
        line_items: lineItems.map(li => ({
          description: li.description.trim(),
          quantity: Number(li.quantity),
          unit_price: Number(li.unit_price),
        })),
      }

      const res = await fetch(GENERATE_INVOICE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(payload),
      })

      const text = await res.text()
      let body = null
      try { body = text ? JSON.parse(text) : null } catch { /* non-JSON */ }

      if (!res.ok) {
        if (res.status === 403) {
          throw new Error('Invoice generation currently requires the CEO role. Ask the CEO to run this, or wait until the backend role check widens to Finance.')
        }
        throw new Error(body?.error || body?.detail || `Request failed (${res.status}).`)
      }

      const invoiceId = body?.invoice_id
      if (!invoiceId) throw new Error('Server returned no invoice_id.')
      navigate(`/finance/invoices/${invoiceId}`)
    } catch (err) {
      setSubmitError(err.message || String(err))
    } finally {
      setSubmitting(false)
    }
  }

  // ── Render ──
  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>
        <Loader size={20} style={{ marginRight: 8, verticalAlign: -4 }} /> Loading finance data…
      </div>
    )
  }
  if (error) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <h3 style={{ fontSize: '1.2rem', marginBottom: 8, color: 'var(--red)' }}>Unable to load finance data</h3>
        <p style={{ color: 'var(--text-secondary)' }}>{error.message || 'A network error occurred.'}</p>
      </div>
    )
  }

  return (
    <div className="animate-fade-in-up">
      <div style={{ marginBottom: 20 }}>
        <Link to="/finance/invoices" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text-tertiary)', textDecoration: 'none', fontSize: '0.85rem' }}>
          <ArrowLeft size={16} /> Back to invoices
        </Link>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
          <FileText size={22} /> New Invoice
        </h1>
        <p style={{ color: 'var(--text-tertiary)', fontSize: '0.9rem', marginTop: 4 }}>
          Compose an invoice from a client-signed timesheet. Saved as a DRAFT for review.
        </p>
      </div>

      {/* ── Step 1: pick timesheet ── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: 12 }}>1. Select a billable timesheet</h3>
        {billable.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--amber)', background: 'var(--warning-dim, rgba(239,88,41,0.08))', borderRadius: 8 }}>
            <AlertTriangle size={18} style={{ verticalAlign: -3, marginRight: 6 }} />
            No CLIENT_SIGNED timesheets are waiting to be invoiced.
          </div>
        ) : (
          <select
            className="form-input"
            value={timesheetId}
            onChange={e => selectTimesheet(e.target.value)}
          >
            <option value="">— Select timesheet —</option>
            {billable.map(t => {
              const id = t.id || t.timesheet_id
              const periodLabel = t.period_label || (t.period_month && t.period_year ? `${t.period_month}/${t.period_year}` : '')
              return (
                <option key={id} value={id}>
                  {t.engineer_name || 'Engineer'} — {t.client_name || 'Client'} — {periodLabel} ({t.total_hours || 0} hrs)
                </option>
              )
            })}
          </select>
        )}
      </div>

      {/* ── Step 2 onward only visible after a timesheet is picked ── */}
      {selectedTs && (
        <>
          <div className="card" style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: 12 }}>2. Invoice details</h3>
            <div className="grid-2" style={{ gap: 16 }}>
              <div className="form-group">
                <label className="form-label">Project</label>
                <input className="form-input" readOnly value={selectedTs.project_name || selectedProject?.project_name || '—'} />
              </div>
              <div className="form-group">
                <label className="form-label">Client</label>
                <input className="form-input" readOnly value={selectedTs.client_name || selectedProject?.client_name || '—'} />
              </div>
              <div className="form-group">
                <label className="form-label">PO Number</label>
                <input className="form-input" readOnly value={selectedProject?.po_number || '—'} />
              </div>
              <div className="form-group">
                <label className="form-label">Timesheet ID</label>
                <input className="form-input" readOnly style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }} value={selectedTs.timesheet_id || selectedTs.id} />
              </div>
              <div className="form-group">
                <label className="form-label">Period Start</label>
                <input type="date" className="form-input" value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Period End</label>
                <input type="date" className="form-input" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ fontSize: '0.95rem', fontWeight: 600, margin: 0 }}>3. Line items</h3>
              <button className="btn btn-ghost btn-sm" onClick={addLine}>
                <Plus size={14} /> Add line
              </button>
            </div>
            <table style={{ width: '100%', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-primary)', textAlign: 'left', color: 'var(--text-tertiary)', fontSize: '0.78rem' }}>
                  <th style={{ paddingBottom: 8, fontWeight: 500 }}>Description</th>
                  <th style={{ paddingBottom: 8, fontWeight: 500, width: 100 }}>Qty</th>
                  <th style={{ paddingBottom: 8, fontWeight: 500, width: 140 }}>Unit Price (SAR)</th>
                  <th style={{ paddingBottom: 8, fontWeight: 500, width: 140, textAlign: 'right' }}>Line Total</th>
                  <th style={{ paddingBottom: 8, width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {lineItems.map((li, i) => {
                  const lineTotal = (Number(li.quantity) || 0) * (Number(li.unit_price) || 0)
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border-primary)' }}>
                      <td style={{ padding: '8px 8px 8px 0' }}>
                        <input className="form-input" style={{ width: '100%' }} value={li.description} onChange={e => updateLine(i, 'description', e.target.value)} placeholder="e.g. Mohamed Dahas — March 2026 (160 hrs)" />
                      </td>
                      <td style={{ padding: '8px' }}>
                        <input type="number" min="0" step="0.5" className="form-input" style={{ width: '100%' }} value={li.quantity} onChange={e => updateLine(i, 'quantity', e.target.value)} />
                      </td>
                      <td style={{ padding: '8px' }}>
                        <input type="number" min="0" step="0.01" className="form-input" style={{ width: '100%' }} value={li.unit_price} onChange={e => updateLine(i, 'unit_price', e.target.value)} />
                      </td>
                      <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: 600 }}>{SAR(lineTotal)}</td>
                      <td style={{ padding: '8px 0', textAlign: 'right' }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => removeLine(i)} title="Remove line" style={{ color: 'var(--red)' }}>
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
                {lineItems.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: 16, textAlign: 'center', color: 'var(--text-tertiary)' }}>No line items.</td></tr>
                )}
              </tbody>
            </table>

            {/* Totals */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <div style={{ width: 280 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border-primary)' }}>
                  <span>Subtotal</span><span>{SAR(totals.subtotal)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border-primary)' }}>
                  <span>VAT (15%)</span><span>{SAR(totals.vat)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', fontWeight: 700, fontSize: '1.1rem' }}>
                  <span>Total</span><span>{SAR(totals.total)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: 12 }}>4. Notes (optional)</h3>
            <textarea
              className="form-input"
              rows={3}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Internal notes or memo to the client (appears on the invoice)."
            />
          </div>

          {/* Validation / submission */}
          {validationError && (
            <div style={{ padding: 12, marginBottom: 16, background: 'var(--warning-dim, rgba(239,88,41,0.08))', borderLeft: '3px solid var(--amber)', color: 'var(--amber)', fontSize: '0.85rem', borderRadius: 4 }}>
              <AlertTriangle size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
              {validationError}
            </div>
          )}
          {submitError && (
            <div style={{ padding: 12, marginBottom: 16, background: 'rgba(220,38,38,0.08)', borderLeft: '3px solid var(--red)', color: 'var(--red)', fontSize: '0.85rem', borderRadius: 4 }}>
              {submitError}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
            <Link to="/finance/invoices" className="btn btn-ghost">Cancel</Link>
            <button className="btn btn-primary" onClick={handleSubmit} disabled={!!validationError || submitting}>
              {submitting ? 'Creating…' : 'Create Draft Invoice'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
