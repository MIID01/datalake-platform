import { useState, useEffect, useMemo } from 'react'
import { collection, query, onSnapshot, updateDoc, doc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { CheckCircle, XCircle, DollarSign, FileText } from 'lucide-react'

export default function CEOExpenses() {
  const [expenses, setExpenses] = useState([])

  useEffect(() => {
    const q = query(collection(db, 'expenses'))
    const unsub = onSnapshot(q, snap => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      data.sort((a, b) => (b.created_at?.seconds || 0) - (a.created_at?.seconds || 0))
      setExpenses(data)
    })
    return () => unsub()
  }, [])

  const handleAction = async (id, action) => {
    try {
      let updates = { updated_at: serverTimestamp() }
      if (action === 'approve') {
        updates.status = 'APPROVED'
        updates.approved_by = 'ceo'
        updates.approved_at = serverTimestamp()
      } else if (action === 'reimburse') {
        updates.status = 'REIMBURSED'
        updates.reimbursed_at = serverTimestamp()
      } else if (action === 'reject') {
        updates.status = 'REJECTED'
      }
      await updateDoc(doc(db, 'expenses', id), updates)
    } catch (err) {
      console.error(err)
    }
  }

  const fmtDate = (dateStr) => {
    if (!dateStr) return '—'
    return new Date(dateStr + 'T12:00:00').toLocaleDateString()
  }

  const { currentMonthActuals, categories } = useMemo(() => {
    let total = 0
    const catMap = {}

    expenses.forEach(exp => {
      if (exp.status === 'APPROVED' || exp.status === 'REIMBURSED' || exp.status === 'SUBMITTED') {
        const amt = Number(exp.amount) || 0
        total += amt
        const cat = exp.category || 'Other'
        catMap[cat] = (catMap[cat] || 0) + amt
      }
    })

    return {
      currentMonthActuals: total,
      categories: Object.entries(catMap).map(([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value)
    }
  }, [expenses])

  const budget = 150000
  const budgetUtilization = budget > 0 ? (currentMonthActuals / budget) * 100 : 0

  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 24 }}>Company Expenses</h1>

      <div className="grid-3" style={{ marginBottom: 28 }}>
        <div className="stat-card" style={{ '--stat-accent': 'var(--purple)' }}>
          <div className="stat-label">Monthly Budget</div>
          <div className="stat-value" style={{ color: 'var(--purple)' }}>SAR {budget.toLocaleString()}</div>
        </div>
        <div className="stat-card" style={{ '--stat-accent': budgetUtilization > 90 ? 'var(--red)' : 'var(--amber)' }}>
          <div className="stat-label">Actuals (Submitted/Approved)</div>
          <div className="stat-value" style={{ color: budgetUtilization > 90 ? 'var(--red)' : 'var(--amber)' }}>SAR {currentMonthActuals.toLocaleString()}</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginTop: 8 }}>{budgetUtilization.toFixed(1)}% of budget used</div>
        </div>
        <div className="card" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div className="stat-label" style={{ marginBottom: 12 }}>Category Breakdown</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxHeight: 60, overflowY: 'auto' }}>
            {categories.length === 0 ? <div style={{color:'var(--text-tertiary)'}}>No data</div> : categories.map(c => (
              <span key={c.name} className="badge badge-neutral" style={{ fontSize: '0.75rem' }}>{c.name}: SAR {c.value.toLocaleString()}</span>
            ))}
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {expenses.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-tertiary)' }}>No expenses submitted</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Employee</th>
                <th>Category</th>
                <th>Amount</th>
                <th>Receipt</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map(exp => (
                <tr key={exp.id}>
                  <td>{fmtDate(exp.date)}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{exp.engineer_name}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>{exp.engineer_email}</div>
                  </td>
                  <td><span className="badge badge-info">{exp.category}</span></td>
                  <td style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>SAR {Number(exp.amount).toFixed(2)}</td>
                  <td>
                    {exp.receipt_url ? (
                      <a href={exp.receipt_url} target="_blank" rel="noreferrer" style={{ color: 'var(--sky-blue)', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <FileText size={14} /> View
                      </a>
                    ) : <span style={{ color: 'var(--text-tertiary)' }}>None</span>}
                  </td>
                  <td>
                    <span className={`badge ${exp.status === 'SUBMITTED' ? 'badge-warning' : exp.status === 'APPROVED' ? 'badge-info' : exp.status === 'REIMBURSED' ? 'badge-success' : 'badge-error'}`}>
                      {exp.status}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {exp.status === 'SUBMITTED' && (
                        <>
                          <button className="btn btn-info btn-sm" onClick={() => handleAction(exp.id, 'approve')}>Approve</button>
                          <button className="btn btn-danger btn-sm" onClick={() => handleAction(exp.id, 'reject')}>Reject</button>
                        </>
                      )}
                      {exp.status === 'APPROVED' && (
                        <button className="btn btn-success btn-sm" onClick={() => handleAction(exp.id, 'reimburse')}>
                          Mark Reimbursed
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
