import { useState } from 'react'
import { financeData } from '../../data/mockCEO'
import { useCountUp } from '../../hooks/useUtils'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { TrendingUp, TrendingDown, DollarSign, FileText, Users as UsersIcon, Percent, BarChart3, AlertCircle, CheckCircle, Eye } from 'lucide-react'

function FinanceCard({ icon: Icon, label, value, unit, extra, color, delay }) {
  const displayVal = useCountUp(typeof value === 'number' ? value : 0, 800)
  const format = (v) => {
    if (unit === 'SAR') return `SAR ${v.toLocaleString()}`
    if (unit === '%') return `${value}%`
    return v
  }
  return (
    <div className={`stat-card animate-fade-in-up stagger-${delay}`} style={{ '--stat-accent': color, cursor: 'pointer' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="stat-label">{label}</div>
          <div className="stat-value" style={{ color, fontSize: '2rem' }}>{format(displayVal)}</div>
        </div>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: `${color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', color }}>
          <Icon size={20} />
        </div>
      </div>
      {extra && <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: 8 }}>{extra}</div>}
    </div>
  )
}

const statusColors = { Draft: 'badge-info', Sent: 'badge-warning', Paid: 'badge-success', Overdue: 'badge-critical' }

export default function Finance() {
  const [filter, setFilter] = useState('All')
  const { overview, invoices, cashFlow } = financeData

  const filteredInvoices = filter === 'All' ? invoices : invoices.filter(i => i.status === filter)

  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 24 }}>Finance</h1>

      {/* Overview Cards */}
      <div className="grid-3" style={{ marginBottom: 28 }}>
        <FinanceCard icon={DollarSign} label="Revenue MTD" value={overview.revenueMTD.value} unit="SAR" color="var(--green)" delay={1} extra={`↑ ${overview.revenueMTD.trend}% vs last month`} />
        <FinanceCard icon={FileText} label="Outstanding Invoices" value={overview.outstanding.value} unit="SAR" color="var(--amber)" delay={2} extra={`${overview.outstanding.count} invoices pending`} />
        <FinanceCard icon={UsersIcon} label="Payroll MTD" value={overview.payrollMTD.value} unit="SAR" color="var(--sky-blue)" delay={3} extra={`${overview.payrollMTD.headcount} engineers`} />
        <FinanceCard icon={Percent} label="Gross Margin" value={overview.grossMargin.value} unit="%" color="var(--green)" delay={4} extra={`↑ ${overview.grossMargin.trend}% improvement`} />
        <FinanceCard icon={BarChart3} label="PO Utilization" value={overview.poUtilization.value} unit="%" color="var(--sky-blue)" delay={5} />
        <FinanceCard icon={AlertCircle} label="Overdue Payments" value={overview.overduePayments.value} unit="SAR" color="var(--red)" delay={1} extra={`${overview.overduePayments.count} invoices past due`} />
      </div>

      {/* Cash Flow Chart */}
      <div className="chart-card animate-fade-in-up" style={{ marginBottom: 28 }}>
        <div className="chart-card-header">
          <h3 className="chart-card-title">Cash Flow Forecast (12 Months)</h3>
        </div>
        <div style={{ height: 300 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={cashFlow}>
              <defs>
                <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--green)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="var(--green)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gExp" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--red)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="var(--red)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" />
              <XAxis dataKey="month" tick={{ fill: 'var(--text-tertiary)', fontSize: 12 }} axisLine={{ stroke: 'var(--border-primary)' }} />
              <YAxis tick={{ fill: 'var(--text-tertiary)', fontSize: 12 }} axisLine={{ stroke: 'var(--border-primary)' }} tickFormatter={v => `${(v / 1000).toFixed(0)}K`} />
              <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-card)', borderRadius: 10, color: 'var(--text-primary)' }} formatter={(v) => `SAR ${v.toLocaleString()}`} />
              <Legend />
              <Area type="monotone" dataKey="revenue" name="Revenue" stroke="var(--green)" fill="url(#gRev)" strokeWidth={2} />
              <Area type="monotone" dataKey="expenses" name="Expenses" stroke="var(--red)" fill="url(#gExp)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Invoice Table */}
      <div className="card animate-fade-in-up" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>Invoice Management</h3>
          <div style={{ display: 'flex', gap: 6 }}>
            {['All', 'Draft', 'Sent', 'Paid', 'Overdue'].map(f => (
              <button key={f} className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFilter(f)}>{f}</button>
            ))}
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
                <th>PO</th>
                <th>Engineer</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredInvoices.map(inv => (
                <tr key={inv.id}>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>{inv.id}</td>
                  <td style={{ fontWeight: 600 }}>{inv.client}</td>
                  <td style={{ fontWeight: 600 }}>SAR {inv.amount.toLocaleString()}</td>
                  <td>{new Date(inv.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
                  <td>{new Date(inv.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
                  <td><span className={`badge ${statusColors[inv.status]}`}>{inv.status}</span></td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>{inv.po}</td>
                  <td>{inv.engineer}</td>
                  <td>
                    {inv.status === 'Draft' ? (
                      <button className="btn btn-success btn-sm"><CheckCircle size={14} /> Approve</button>
                    ) : (
                      <button className="btn btn-ghost btn-sm"><Eye size={14} /> View</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
