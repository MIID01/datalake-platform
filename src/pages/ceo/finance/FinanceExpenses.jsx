import React, { useState, useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer } from 'recharts'
import { Upload, CheckCircle, Search, XCircle } from 'lucide-react'

export default function FinanceExpenses({ expenses }) {
  const [filterCategory, setFilterCategory] = useState('All')
  const [approving, setApproving] = useState(null)

  const { budgetData, filteredExpenses } = useMemo(() => {
    // Generate Budget vs Actual chart data (Mock budget, actual from expenses)
    const categoryMap = {}
    
    // Group expenses by category
    const actualExpenses = expenses.filter(e => {
      const d = new Date(e.date)
      return d.getMonth() === new Date().getMonth() && d.getFullYear() === new Date().getFullYear()
    })

    actualExpenses.forEach(e => {
      const cat = e.category || 'Uncategorized'
      categoryMap[cat] = (categoryMap[cat] || 0) + Number(e.amount || 0)
    })

    const chartData = [
      { category: 'Software & Cloud', budget: 50000, actual: categoryMap['Software'] || 45000 },
      { category: 'Travel', budget: 30000, actual: categoryMap['Travel'] || 12000 },
      { category: 'Office', budget: 15000, actual: categoryMap['Office'] || 16500 },
      { category: 'Marketing', budget: 40000, actual: categoryMap['Marketing'] || 20000 },
    ]

    // List Filtering
    const list = expenses.filter(e => filterCategory === 'All' || (e.category || 'Uncategorized') === filterCategory)

    return { budgetData: chartData, filteredExpenses: list }
  }, [expenses, filterCategory])

  const handleApprove = (id) => {
    setApproving(id)
    setTimeout(() => {
      alert("Expense approved.")
      setApproving(null)
    }, 1000)
  }

  const formatSAR = (v) => `SAR ${(v / 1000).toFixed(0)}k`

  return (
    <div className="animate-fade-in-up">
      <div className="grid-2" style={{ gap: 24, marginBottom: 24 }}>
        <div className="card" style={{ gridColumn: 'span 2' }}>
          <h3 className="chart-card-title" style={{ marginBottom: 20 }}>OpEx Budget vs Actual (MTD)</h3>
          <div style={{ width: '100%', height: 350 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={budgetData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" vertical={false} />
                <XAxis dataKey="category" tick={{ fill: 'var(--text-tertiary)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'var(--text-tertiary)' }} axisLine={false} tickLine={false} tickFormatter={formatSAR} />
                <RechartsTooltip cursor={{ fill: 'var(--bg-elevated)' }} contentStyle={{ borderRadius: 8, border: 'none' }} formatter={v => `SAR ${v.toLocaleString()}`} />
                <Legend />
                <Bar dataKey="budget" name="Budget" fill="var(--sky-blue)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="actual" name="Actual" fill="var(--purple)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="flex-between" style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-primary)' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Expense Tracking</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <select className="form-select" value={filterCategory} onChange={e => setFilterCategory(e.target.value)} style={{ width: 200, padding: '6px 12px' }}>
              <option value="All">All Categories</option>
              <option value="Software">Software & Cloud</option>
              <option value="Travel">Travel</option>
              <option value="Office">Office</option>
              <option value="Marketing">Marketing</option>
            </select>
            <button className="btn btn-primary btn-sm"><Upload size={16} /> Upload Receipt</button>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Category</th>
                <th>Amount</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredExpenses.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'var(--text-tertiary)' }}>No expenses recorded.</td></tr>
              ) : filteredExpenses.map((exp, i) => {
                const st = (exp.status || 'PENDING').toUpperCase()
                return (
                  <tr key={exp.id || i}>
                    <td>{new Date(exp.date).toLocaleDateString()}</td>
                    <td style={{ fontWeight: 600 }}>{exp.description}</td>
                    <td>{exp.category || 'Uncategorized'}</td>
                    <td style={{ fontWeight: 600 }}>SAR {Number(exp.amount).toLocaleString()}</td>
                    <td>
                      <span className={`badge ${st === 'APPROVED' ? 'badge-success' : st === 'REJECTED' ? 'badge-critical' : 'badge-warning'}`}>
                        {st}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                      {st === 'PENDING' ? (
                        <>
                          <button className="btn btn-success btn-sm" onClick={() => handleApprove(exp.id)} disabled={approving === exp.id}><CheckCircle size={14} /> Approve</button>
                          <button className="btn btn-outline btn-sm"><XCircle size={14} /> Reject</button>
                        </>
                      ) : (
                        <button className="btn btn-ghost btn-sm">View Receipt</button>
                      )}
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
