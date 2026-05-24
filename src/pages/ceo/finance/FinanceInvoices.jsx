import React, { useState, useMemo } from 'react'
import { Eye, CheckCircle, Plus, Search, FileText } from 'lucide-react'

const statusColors = { DRAFT: 'badge-info', SENT: 'badge-warning', PAID: 'badge-success', OVERDUE: 'badge-critical' }

export default function FinanceInvoices({ invoices, timesheets = [], projects = [] }) {
  const [filterStatus, setFilterStatus] = useState('All')
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedInvoice, setSelectedInvoice] = useState(null)
  const [approving, setApproving] = useState(null)
  const [paymentModalOpen, setPaymentModalOpen] = useState(false)
  const [generateModalOpen, setGenerateModalOpen] = useState(false)
  const [selectedTimesheetId, setSelectedTimesheetId] = useState('')

  const filteredInvoices = useMemo(() => {
    return invoices.filter(inv => {
      const matchStatus = filterStatus === 'All' || (inv.status || 'DRAFT').toUpperCase() === filterStatus.toUpperCase()
      const search = searchTerm.toLowerCase()
      const matchSearch = !search || 
        (inv.invoice_number && inv.invoice_number.toLowerCase().includes(search)) ||
        (inv.client_name && inv.client_name.toLowerCase().includes(search))
      return matchStatus && matchSearch
    })
  }, [invoices, filterStatus, searchTerm])

  const billableTimesheets = useMemo(() => {
    return timesheets.filter(t => (t.state === 'CLIENT_SIGNED' || t.status === 'CLIENT_SIGNED') && !t.invoice_id)
  }, [timesheets])

  const handleApprove = async (id, e) => {
    e.stopPropagation()
    setApproving(id)
    // Simulate push to Zoho and ZATCA
    setTimeout(() => {
      alert("Invoice pushed to Zoho Books and ZATCA successfully.")
      setApproving(null)
    }, 1500)
  }

  const handleRecordPayment = (e) => {
    e.stopPropagation()
    setPaymentModalOpen(true)
  }

  const handleGenerateInvoice = () => {
    if (!selectedTimesheetId) return
    alert(`Generated Draft Invoice for timesheet ${selectedTimesheetId}!`)
    setGenerateModalOpen(false)
    setSelectedTimesheetId('')
  }

  return (
    <div className="animate-fade-in-up">
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ position: 'relative', width: 300 }}>
            <Search size={18} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
            <input 
              type="text" 
              className="form-input" 
              placeholder="Search by client or ID..." 
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              style={{ paddingLeft: 40 }}
            />
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {['All', 'Draft', 'Sent', 'Overdue', 'Paid'].map(f => (
              <button key={f} className={`btn btn-sm ${filterStatus === f ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFilterStatus(f)}>{f}</button>
            ))}
            <button className="btn btn-primary btn-sm" style={{ marginLeft: 12 }} onClick={() => setGenerateModalOpen(true)}>
              <Plus size={16} /> New Invoice
            </button>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Invoice ID</th>
                <th>Client</th>
                <th>Amount</th>
                <th>Date</th>
                <th>Due Date</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredInvoices.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 32, color: 'var(--text-tertiary)' }}>No invoices found.</td></tr>
              ) : filteredInvoices.map(inv => {
                const st = (inv.status || 'DRAFT').toUpperCase()
                const isDraft = st === 'DRAFT'
                const isSent = st === 'SENT' || st === 'OVERDUE'
                return (
                  <tr key={inv.id} onClick={() => setSelectedInvoice(inv)} style={{ cursor: 'pointer' }}>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>{inv.invoice_number || inv.id.slice(0,8)}</td>
                    <td style={{ fontWeight: 600 }}>{inv.client_name || inv.client}</td>
                    <td style={{ fontWeight: 600 }}>SAR {(inv.total || inv.amount || 0).toLocaleString()}</td>
                    <td>{inv.created_at ? new Date(inv.created_at.toDate ? inv.created_at.toDate() : inv.created_at).toLocaleDateString() : '—'}</td>
                    <td>{inv.due_date ? new Date(inv.due_date).toLocaleDateString() : '—'}</td>
                    <td><span className={`badge ${statusColors[st] || 'badge-neutral'}`}>{st}</span></td>
                    <td style={{ textAlign: 'right' }}>
                      {isDraft ? (
                        <button className="btn btn-success btn-sm" onClick={(e) => handleApprove(inv.id, e)} disabled={approving === inv.id}>
                          <CheckCircle size={14} /> {approving === inv.id ? 'Syncing...' : 'Approve & Send'}
                        </button>
                      ) : isSent ? (
                        <button className="btn btn-outline btn-sm" onClick={handleRecordPayment}>Record Payment</button>
                      ) : (
                        <button className="btn btn-ghost btn-sm" onClick={() => setSelectedInvoice(inv)}><Eye size={14} /> View</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Invoice Detail Modal */}
      {selectedInvoice && !paymentModalOpen && (
        <div className="modal-overlay" onClick={() => setSelectedInvoice(null)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div className="modal-content card animate-fade-in-up" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 700 }}>
            <div className="flex-between" style={{ marginBottom: 24, borderBottom: '1px solid var(--border-primary)', paddingBottom: 16 }}>
              <div>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}><FileText size={20} /> {selectedInvoice.invoice_number || selectedInvoice.id}</h2>
                <p style={{ color: 'var(--text-tertiary)', fontSize: '0.9rem', marginTop: 4 }}>{selectedInvoice.client_name || selectedInvoice.client}</p>
              </div>
              <span className={`badge ${statusColors[(selectedInvoice.status || 'DRAFT').toUpperCase()]}`}>{selectedInvoice.status || 'DRAFT'}</span>
            </div>
            
            <div className="grid-2" style={{ gap: 24, marginBottom: 24 }}>
              <div>
                <div className="stat-label">Issue Date</div>
                <div style={{ fontWeight: 600 }}>{selectedInvoice.created_at ? new Date(selectedInvoice.created_at.toDate ? selectedInvoice.created_at.toDate() : selectedInvoice.created_at).toLocaleDateString() : '—'}</div>
              </div>
              <div>
                <div className="stat-label">Due Date</div>
                <div style={{ fontWeight: 600 }}>{selectedInvoice.due_date ? new Date(selectedInvoice.due_date).toLocaleDateString() : '—'}</div>
              </div>
            </div>

            <div style={{ background: 'var(--bg-subtle)', borderRadius: 8, padding: 16, marginBottom: 24 }}>
              <h4 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: 12 }}>Line Items</h4>
              <table style={{ width: '100%', fontSize: '0.9rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-primary)', textAlign: 'left', color: 'var(--text-tertiary)' }}>
                    <th style={{ paddingBottom: 8 }}>Description</th>
                    <th style={{ paddingBottom: 8 }}>Qty</th>
                    <th style={{ paddingBottom: 8 }}>Rate</th>
                    <th style={{ paddingBottom: 8, textAlign: 'right' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(selectedInvoice.line_items || [{ description: 'IT Consulting Services', quantity: 1, rate: selectedInvoice.total || 0, amount: selectedInvoice.total || 0 }]).map((item, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border-primary)' }}>
                      <td style={{ padding: '12px 0' }}>{item.description}</td>
                      <td style={{ padding: '12px 0' }}>{item.quantity}</td>
                      <td style={{ padding: '12px 0' }}>SAR {Number(item.rate).toLocaleString()}</td>
                      <td style={{ padding: '12px 0', textAlign: 'right', fontWeight: 600 }}>SAR {Number(item.amount).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                <div style={{ width: 250 }}>
                  <div className="flex-between" style={{ padding: '8px 0', borderBottom: '1px solid var(--border-primary)' }}><span>Subtotal</span><span>SAR {(selectedInvoice.total || 0).toLocaleString()}</span></div>
                  <div className="flex-between" style={{ padding: '8px 0', borderBottom: '1px solid var(--border-primary)' }}><span>VAT (15%)</span><span>SAR {((selectedInvoice.total || 0) * 0.15).toLocaleString()}</span></div>
                  <div className="flex-between" style={{ padding: '8px 0', fontWeight: 700, fontSize: '1.1rem' }}><span>Total</span><span>SAR {((selectedInvoice.total || 0) * 1.15).toLocaleString()}</span></div>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <button className="btn btn-ghost" onClick={() => setSelectedInvoice(null)}>Close</button>
              {(selectedInvoice.status || 'DRAFT').toUpperCase() === 'DRAFT' && (
                <button className="btn btn-success" onClick={(e) => handleApprove(selectedInvoice.id, e)}>Approve & Send to Zoho</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Record Payment Modal */}
      {paymentModalOpen && (
        <div className="modal-overlay" onClick={() => setPaymentModalOpen(false)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div className="modal-content card animate-fade-in-up" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 400 }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: 16 }}>Record Payment</h2>
            <div style={{ marginBottom: 16 }}>
              <label className="form-label">Amount (SAR)</label>
              <input type="number" className="form-input" defaultValue={selectedInvoice?.total || 0} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label className="form-label">Payment Date</label>
              <input type="date" className="form-input" defaultValue={new Date().toISOString().split('T')[0]} />
            </div>
            <div style={{ marginBottom: 24 }}>
              <label className="form-label">Reference / Transfer ID</label>
              <input type="text" className="form-input" placeholder="e.g. TR-9988112" />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <button className="btn btn-ghost" onClick={() => setPaymentModalOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => { alert('Payment recorded!'); setPaymentModalOpen(false); setSelectedInvoice(null); }}>Record Payment</button>
            </div>
          </div>
        </div>
      )}

      {/* Generate Invoice Modal */}
      {generateModalOpen && (
        <div className="modal-overlay" onClick={() => setGenerateModalOpen(false)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div className="modal-content card animate-fade-in-up" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 500 }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: 16 }}>Generate Invoice</h2>
            <div style={{ marginBottom: 24 }}>
              <label className="form-label">Select Timesheet to Bill</label>
              <select className="form-input" value={selectedTimesheetId} onChange={e => setSelectedTimesheetId(e.target.value)}>
                <option value="">-- Select CLIENT_SIGNED Timesheet --</option>
                {billableTimesheets.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.client_name || 'Unknown Client'} — {t.period_month}/{t.period_year} ({t.total_hours} hrs)
                  </option>
                ))}
              </select>
              {billableTimesheets.length === 0 && (
                <div style={{ fontSize: '0.8rem', color: 'var(--amber)', marginTop: 8 }}>
                  No billable (CLIENT_SIGNED without an invoice) timesheets found.
                </div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <button className="btn btn-ghost" onClick={() => setGenerateModalOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleGenerateInvoice} disabled={!selectedTimesheetId}>
                Generate Invoice Draft
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
