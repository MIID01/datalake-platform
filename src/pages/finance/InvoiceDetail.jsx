import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useOutletContext } from 'react-router-dom'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { ArrowLeft, FileText, Loader, CheckCircle2 } from 'lucide-react'

const SAR = (n) => `SAR ${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const STATUS_BADGE = {
  DRAFT: 'badge-info',
  SENT: 'badge-warning',
  PAID: 'badge-success',
  OVERDUE: 'badge-critical',
}

function formatDate(v) {
  if (!v) return '—'
  try {
    const d = v?.toDate ? v.toDate() : new Date(v)
    if (Number.isNaN(d.getTime())) return '—'
    return d.toLocaleDateString()
  } catch { return '—' }
}

export default function InvoiceDetail() {
  const { invoiceId } = useParams()
  const ctx = useOutletContext() || {}
  const { invoices = [] } = ctx

  // Seed from the layout-loaded list if available so the page renders instantly,
  // then fall back to a direct doc subscription so we always have the latest.
  const seed = useMemo(
    () => invoices.find(inv => inv.id === invoiceId || inv.invoice_id === invoiceId) || null,
    [invoices, invoiceId],
  )
  const [invoice, setInvoice] = useState(seed)
  const [loading, setLoading] = useState(!seed)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!invoiceId) return
    const unsub = onSnapshot(
      doc(db, 'invoices', invoiceId),
      snap => {
        if (snap.exists()) {
          setInvoice({ id: snap.id, ...snap.data() })
          setError(null)
        } else if (!seed) {
          setError(new Error('Invoice not found.'))
        }
        setLoading(false)
      },
      err => { setError(err); setLoading(false) },
    )
    return () => unsub()
  }, [invoiceId, seed])

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>
        <Loader size={20} style={{ marginRight: 8, verticalAlign: -4 }} /> Loading invoice…
      </div>
    )
  }
  if (error || !invoice) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <h3 style={{ fontSize: '1.2rem', marginBottom: 8, color: 'var(--red)' }}>Unable to load invoice</h3>
        <p style={{ color: 'var(--text-secondary)' }}>{error?.message || 'Invoice not found.'}</p>
        <Link to="/finance/invoices" className="btn btn-ghost" style={{ marginTop: 16 }}>
          <ArrowLeft size={14} /> Back to invoices
        </Link>
      </div>
    )
  }

  const status = (invoice.status || 'DRAFT').toUpperCase()
  const lineItems = invoice.line_items || []

  return (
    <div className="animate-fade-in-up">
      <div style={{ marginBottom: 20 }}>
        <Link to="/finance/invoices" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text-tertiary)', textDecoration: 'none', fontSize: '0.85rem' }}>
          <ArrowLeft size={16} /> Back to invoices
        </Link>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 8, gap: 16 }}>
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
              <FileText size={22} /> {invoice.invoice_number || invoice.id}
            </h1>
            <p style={{ color: 'var(--text-tertiary)', fontSize: '0.9rem', marginTop: 4 }}>
              {invoice.client_name || '—'}
              {invoice.po_number ? <> · PO <code style={{ fontFamily: 'var(--font-mono)' }}>{invoice.po_number}</code></> : null}
            </p>
            {/* Async integration status — Pub/Sub-fired on invoice approval. */}
            {(invoice.zoho_synced || invoice.zatca_generated) && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                {invoice.zoho_synced && (
                  <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <CheckCircle2 size={12} /> Synced to Zoho
                  </span>
                )}
                {invoice.zatca_generated && (
                  <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <CheckCircle2 size={12} /> ZATCA XML generated
                  </span>
                )}
              </div>
            )}
          </div>
          <span className={`badge ${STATUS_BADGE[status] || 'badge-neutral'}`} style={{ fontSize: '0.85rem' }}>{status}</span>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="grid-2" style={{ gap: 16 }}>
          <Field label="Issue Date" value={formatDate(invoice.created_at)} />
          <Field label="Period" value={`${formatDate(invoice.period_start)} → ${formatDate(invoice.period_end)}`} />
          <Field label="Created By" value={invoice.created_by || '—'} />
          <Field
            label={Array.isArray(invoice.timesheet_ids) && invoice.timesheet_ids.length > 1 ? 'Timesheets' : 'Timesheet'}
            value={(invoice.timesheet_ids && invoice.timesheet_ids.length > 0 ? invoice.timesheet_ids.join(', ') : (invoice.timesheet_id || '—'))}
            mono
          />
          <Field label="Currency" value={invoice.currency || 'SAR'} />
          <Field label="Seller VAT" value={invoice.seller_vat || '—'} mono />
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: 12 }}>Line Items</h3>
        <table style={{ width: '100%', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-primary)', textAlign: 'left', color: 'var(--text-tertiary)', fontSize: '0.78rem' }}>
              <th style={{ paddingBottom: 8, fontWeight: 500 }}>Description</th>
              <th style={{ paddingBottom: 8, fontWeight: 500, width: 80 }}>Qty</th>
              <th style={{ paddingBottom: 8, fontWeight: 500, width: 140, textAlign: 'right' }}>Unit Price</th>
              <th style={{ paddingBottom: 8, fontWeight: 500, width: 140, textAlign: 'right' }}>Line Total</th>
            </tr>
          </thead>
          <tbody>
            {lineItems.length === 0 ? (
              <tr><td colSpan={4} style={{ padding: 16, textAlign: 'center', color: 'var(--text-tertiary)' }}>No line items.</td></tr>
            ) : lineItems.map((li, i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--border-primary)' }}>
                <td style={{ padding: '12px 0' }}>{li.description}</td>
                <td style={{ padding: '12px 0' }}>{li.quantity}</td>
                <td style={{ padding: '12px 0', textAlign: 'right' }}>{SAR(li.unit_price)}</td>
                <td style={{ padding: '12px 0', textAlign: 'right', fontWeight: 600 }}>{SAR(li.total ?? (Number(li.quantity) * Number(li.unit_price)))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <div style={{ width: 280 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border-primary)' }}>
              <span>Subtotal</span><span>{SAR(invoice.subtotal)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border-primary)' }}>
              <span>VAT ({Math.round((invoice.vat_rate || 0.15) * 100)}%)</span><span>{SAR(invoice.vat_amount)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', fontWeight: 700, fontSize: '1.1rem' }}>
              <span>Total</span><span>{SAR(invoice.total)}</span>
            </div>
          </div>
        </div>
      </div>

      {invoice.notes && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: 8 }}>Notes</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', whiteSpace: 'pre-wrap' }}>{invoice.notes}</p>
        </div>
      )}

      {/* Zoho sync and ZATCA XML are auto-fired (Pub/Sub on datalake.invoice.approved)
          — status badges above will appear once they complete. */}
    </div>
  )
}

function Field({ label, value, mono }) {
  return (
    <div>
      <div className="stat-label" style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{label}</div>
      <div style={mono ? { fontFamily: 'var(--font-mono)', fontSize: '0.85rem' } : { fontWeight: 600 }}>{value}</div>
    </div>
  )
}
