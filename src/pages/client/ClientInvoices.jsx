import { clientInvoices } from '../../data/mockClient'
import { Download, Eye, CheckCircle, Clock } from 'lucide-react'

const statusColors = { Paid: 'badge-success', Pending: 'badge-warning', Overdue: 'badge-critical', Draft: 'badge-neutral' }

export default function ClientInvoices() {
  const totalPaid = clientInvoices.filter(i => i.status === 'Paid').reduce((s, i) => s + i.amount, 0)
  const totalPending = clientInvoices.filter(i => i.status === 'Pending').reduce((s, i) => s + i.amount, 0)

  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 24 }}>Invoices</h1>

      {/* Summary */}
      <div className="grid-3" style={{ marginBottom: 24 }}>
        <div className="eng-stat-card animate-fade-in-up stagger-1" style={{ '--stat-color': 'var(--green)', '--stat-bg': 'var(--green-dim)' }}>
          <div className="stat-value" style={{ color: 'var(--green)' }}>SAR {totalPaid.toLocaleString()}</div>
          <div className="stat-label">Total Paid</div>
        </div>
        <div className="eng-stat-card animate-fade-in-up stagger-2" style={{ '--stat-color': 'var(--amber)', '--stat-bg': 'var(--warning-dim)' }}>
          <div className="stat-value" style={{ color: 'var(--amber)' }}>SAR {totalPending.toLocaleString()}</div>
          <div className="stat-label">Pending</div>
        </div>
        <div className="eng-stat-card animate-fade-in-up stagger-3" style={{ '--stat-color': 'var(--steel-blue)', '--stat-bg': 'var(--steel-blue-dim)' }}>
          <div className="stat-value" style={{ color: 'var(--steel-blue)' }}>{clientInvoices.length}</div>
          <div className="stat-label">Total Invoices</div>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="data-table">
          <thead>
            <tr><th>Invoice ID</th><th>Period</th><th>POs</th><th>Amount</th><th>Issued</th><th>Due Date</th><th>Paid Date</th><th>Status</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {clientInvoices.map(inv => (
              <tr key={inv.id}>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', fontWeight: 600 }}>{inv.id}</td>
                <td style={{ fontWeight: 600 }}>{inv.period}</td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>{inv.pos.join(', ')}</td>
                <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>SAR {inv.amount.toLocaleString()}</td>
                <td>{inv.issuedDate ? new Date(inv.issuedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}</td>
                <td>{inv.dueDate ? new Date(inv.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}</td>
                <td>{inv.paidDate ? new Date(inv.paidDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}</td>
                <td><span className={`badge ${statusColors[inv.status]}`}>{inv.status}</span></td>
                <td>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-ghost btn-sm"><Eye size={14} /> View</button>
                    {inv.status === 'Paid' && <button className="btn btn-ghost btn-sm"><Download size={14} /></button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
