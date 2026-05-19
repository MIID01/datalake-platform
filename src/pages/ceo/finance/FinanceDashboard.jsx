import React, { useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, ComposedChart
} from 'recharts'
import { DollarSign, Users, Percent, FileText, AlertCircle } from 'lucide-react'

const COLORS = ['#1598CC', '#2ECC71', '#F5B041', '#E74C3C', '#9B59B6', '#34495E']

function StatCard({ icon: Icon, label, value, color }) {
  return (
    <div className="stat-card" style={{ '--stat-accent': color }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="stat-label">{label}</div>
          <div className="stat-value" style={{ color, fontSize: '1.75rem' }}>{value}</div>
        </div>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: `${color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', color }}>
          <Icon size={20} />
        </div>
      </div>
    </div>
  )
}

export default function FinanceDashboard({ invoices, timesheets, projects, expenses }) {
  // Aggregate data for charts
  const { revenueTrend, invoiceAging, clientRevenue, marginTrend, kpis } = useMemo(() => {
    const now = new Date()
    const currentMonth = now.getMonth()
    const currentYear = now.getFullYear()

    let revenueMTD = 0
    let outstanding = 0
    let overdue = 0
    let expensesMTD = 0

    // 12-month trend array
    const months = Array(12).fill().map((_, i) => {
      const d = new Date(currentYear, currentMonth - 11 + i, 1)
      return { month: d.toLocaleString('default', { month: 'short', year: '2-digit' }), revenue: 0, margin: 0, cost: 0, dateObj: d }
    })

    const clientRevMap = {}
    const agingMap = { current: 0, d30: 0, d60: 0, d90: 0 }

    invoices.forEach(inv => {
      const isSentOrPaid = inv.status === 'SENT' || inv.status === 'PAID'
      const isOverdue = inv.status === 'OVERDUE' || (inv.status === 'SENT' && inv.due_date && new Date(inv.due_date) < now)
      
      const invDate = inv.created_at ? (inv.created_at.toDate ? inv.created_at.toDate() : new Date(inv.created_at)) : now
      const amt = Number(inv.total || inv.amount || 0)

      // KPIs
      if (isSentOrPaid && invDate.getMonth() === currentMonth && invDate.getFullYear() === currentYear) {
        revenueMTD += amt
      }
      if (inv.status === 'SENT' && !isOverdue) outstanding += amt
      if (isOverdue) overdue += amt

      // Trends
      if (isSentOrPaid) {
        const monthMatch = months.find(m => m.dateObj.getMonth() === invDate.getMonth() && m.dateObj.getFullYear() === invDate.getFullYear())
        if (monthMatch) monthMatch.revenue += amt

        // Client Revenue
        const cName = inv.client_name || inv.client || 'Unknown'
        clientRevMap[cName] = (clientRevMap[cName] || 0) + amt
      }

      // Aging
      if (inv.status === 'SENT' || inv.status === 'OVERDUE') {
        const due = inv.due_date ? new Date(inv.due_date) : new Date(invDate.getTime() + 30*24*60*60*1000)
        const diffDays = Math.floor((now - due) / (1000 * 60 * 60 * 24))
        if (diffDays <= 0) agingMap.current += amt
        else if (diffDays <= 30) agingMap.d30 += amt
        else if (diffDays <= 60) agingMap.d60 += amt
        else agingMap.d90 += amt
      }
    })

    expenses.forEach(e => {
      const d = new Date(e.date)
      const amt = Number(e.amount || 0)
      if (d.getMonth() === currentMonth && d.getFullYear() === currentYear) expensesMTD += amt
      const monthMatch = months.find(m => m.dateObj.getMonth() === d.getMonth() && m.dateObj.getFullYear() === d.getFullYear())
      if (monthMatch) monthMatch.cost += amt
    })

    // Engineer Payroll (Appx 20K per active timesheet per month)
    timesheets.forEach(ts => {
      const tsDate = new Date(ts.period_year, ts.period_month - 1, 1)
      const monthMatch = months.find(m => m.dateObj.getMonth() === tsDate.getMonth() && m.dateObj.getFullYear() === tsDate.getFullYear())
      if (monthMatch) monthMatch.cost += 20000
    })

    months.forEach(m => {
      m.margin = m.revenue > 0 ? ((m.revenue - m.cost) / m.revenue) * 100 : 0
    })

    return {
      revenueTrend: months,
      marginTrend: months,
      clientRevenue: Object.entries(clientRevMap).map(([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value).slice(0, 5),
      invoiceAging: [
        { name: 'Accounts Receivable', Current: agingMap.current, '1-30 Days': agingMap.d30, '31-60 Days': agingMap.d60, '90+ Days': agingMap.d90 }
      ],
      kpis: { revenueMTD, outstanding, overdue, expensesMTD }
    }
  }, [invoices, timesheets, projects, expenses])

  const formatSAR = (v) => `SAR ${(v / 1000).toFixed(0)}k`

  return (
    <div className="animate-fade-in-up">
      <div className="grid-4" style={{ marginBottom: 24, gap: 16 }}>
        <StatCard icon={DollarSign} label="Revenue MTD" value={`SAR ${kpis.revenueMTD.toLocaleString()}`} color="var(--green)" />
        <StatCard icon={FileText} label="Outstanding" value={`SAR ${kpis.outstanding.toLocaleString()}`} color="var(--amber)" />
        <StatCard icon={AlertCircle} label="Overdue" value={`SAR ${kpis.overdue.toLocaleString()}`} color="var(--red)" />
        <StatCard icon={Users} label="Expenses MTD" value={`SAR ${kpis.expensesMTD.toLocaleString()}`} color="var(--purple)" />
      </div>

      <div className="grid-2" style={{ gap: 24, marginBottom: 24 }}>
        {/* Revenue Trend */}
        <div className="chart-card">
          <div className="chart-card-header"><h3 className="chart-card-title">12-Month Revenue Trend</h3></div>
          <div style={{ width: '100%', height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={revenueTrend} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" vertical={false} />
                <XAxis dataKey="month" tick={{ fill: 'var(--text-tertiary)', fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'var(--text-tertiary)', fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={formatSAR} />
                <RechartsTooltip cursor={{ fill: 'var(--bg-elevated)' }} contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} formatter={v => `SAR ${v.toLocaleString()}`} />
                <Bar dataKey="revenue" fill="var(--green)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Invoice Aging */}
        <div className="chart-card">
          <div className="chart-card-header"><h3 className="chart-card-title">Invoice Aging</h3></div>
          <div style={{ width: '100%', height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={invoiceAging} layout="vertical" margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" horizontal={false} />
                <XAxis type="number" tick={{ fill: 'var(--text-tertiary)', fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={formatSAR} />
                <YAxis dataKey="name" type="category" hide />
                <RechartsTooltip cursor={{ fill: 'var(--bg-elevated)' }} contentStyle={{ borderRadius: 8, border: 'none' }} formatter={v => `SAR ${v.toLocaleString()}`} />
                <Legend />
                <Bar dataKey="Current" stackId="a" fill="var(--green)" radius={[4, 0, 0, 4]} barSize={40} />
                <Bar dataKey="1-30 Days" stackId="a" fill="var(--amber)" />
                <Bar dataKey="31-60 Days" stackId="a" fill="#E67E22" />
                <Bar dataKey="90+ Days" stackId="a" fill="var(--red)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid-2" style={{ gap: 24 }}>
        {/* Margin Trend */}
        <div className="chart-card">
          <div className="chart-card-header"><h3 className="chart-card-title">Gross Margin Trend (%)</h3></div>
          <div style={{ width: '100%', height: 250 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={marginTrend} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" vertical={false} />
                <XAxis dataKey="month" tick={{ fill: 'var(--text-tertiary)', fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'var(--text-tertiary)', fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
                <RechartsTooltip cursor={{ fill: 'var(--bg-elevated)' }} contentStyle={{ borderRadius: 8, border: 'none' }} formatter={v => `${v.toFixed(1)}%`} />
                <Line type="monotone" dataKey="margin" stroke="var(--sky-blue)" strokeWidth={3} dot={{ r: 4, fill: 'var(--bg-card)' }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Revenue by Client */}
        <div className="chart-card">
          <div className="chart-card-header"><h3 className="chart-card-title">Top 5 Clients by Revenue</h3></div>
          <div style={{ width: '100%', height: 250, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={clientRevenue} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={5} dataKey="value">
                  {clientRevenue.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <RechartsTooltip contentStyle={{ borderRadius: 8, border: 'none' }} formatter={v => `SAR ${v.toLocaleString()}`} />
                <Legend verticalAlign="middle" align="right" layout="vertical" iconType="circle" />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  )
}
