import React, { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, Plus, Search } from 'lucide-react'

const statusColors = { DRAFT: 'badge-info', SENT: 'badge-warning', PAID: 'badge-success', OVERDUE: 'badge-critical' }

export default function FinanceInvoices({ invoices }) {
  const navigate = useNavigate()
  const [filterStatus, setFilterStatus] = useState('All')
  const [searchTerm, setSearchTerm] = useState('')

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

  const openInvoice = (id) => navigate(`/finance/invoices/${id}`)

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
            <button className="btn btn-primary btn-sm" style={{ marginLeft: 12 }} onClick={() => navigate('/finance/invoices/new')}>
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
                return (
                  <tr key={inv.id} onClick={() => openInvoice(inv.id)} style={{ cursor: 'pointer' }}>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>{inv.invoice_number || inv.id.slice(0,8)}</td>
                    <td style={{ fontWeight: 600 }}>{inv.client_name || inv.client}</td>
                    <td style={{ fontWeight: 600 }}>SAR {(inv.total || inv.amount || 0).toLocaleString()}</td>
                    <td>{inv.created_at ? new Date(inv.created_at.toDate ? inv.created_at.toDate() : inv.created_at).toLocaleDateString() : '—'}</td>
                    <td>{inv.due_date ? new Date(inv.due_date).toLocaleDateString() : '—'}</td>
                    <td><span className={`badge ${statusColors[st] || 'badge-neutral'}`}>{st}</span></td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); openInvoice(inv.id) }}>
                        <Eye size={14} /> View
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  )
}
