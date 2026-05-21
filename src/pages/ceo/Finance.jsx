import React, { useState, useEffect } from 'react'
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import FinanceDashboard from './finance/FinanceDashboard'
import FinanceInvoices from './finance/FinanceInvoices'
import FinanceCashFlow from './finance/FinanceCashFlow'
import FinanceExpenses from './finance/FinanceExpenses'

export default function Finance() {
  const [activeTab, setActiveTab] = useState('dashboard')
  
  const [invoices, setInvoices] = useState([])
  const [projects, setProjects] = useState([])
  const [timesheets, setTimesheets] = useState([])
  const [expenses, setExpenses] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let loadedCount = 0
    const checkLoaded = () => { loadedCount++; if (loadedCount >= 3) setLoading(false) }

    const unsubInvoices = onSnapshot(query(collection(db, 'invoices'), orderBy('created_at', 'desc')), snap => {
      setInvoices(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      checkLoaded()
    }, err => console.warn(err))

    const unsubProjects = onSnapshot(collection(db, 'projects'), snap => {
      setProjects(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      checkLoaded()
    }, err => console.warn(err))

    const unsubTimesheets = onSnapshot(collection(db, 'timesheets'), snap => {
      setTimesheets(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      checkLoaded()
    }, err => console.warn(err))

    const unsubExpenses = onSnapshot(collection(db, 'expenses'), snap => {
      setExpenses(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      // Not blocking initial load to keep it fast
    }, err => console.warn(err))

    return () => { unsubInvoices(); unsubProjects(); unsubTimesheets(); unsubExpenses(); }
  }, [])

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 24 }}>Finance Suite</h1>
        <p>Loading financial data...</p>
      </div>
    )
  }

  const tabs = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'invoices', label: 'Invoices & Billing' },
    { id: 'cashflow', label: 'Cash Flow & Scenarios' },
    { id: 'expenses', label: 'Expenses (OpEx)' },
  ]

  return (
    <div>
      <div className="flex-between" style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Finance Suite</h1>
      </div>

      <div style={{ display: 'flex', gap: 24, borderBottom: '1px solid var(--border-primary)', marginBottom: 24 }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              background: 'none',
              border: 'none',
              padding: '12px 0',
              fontSize: '1rem',
              fontWeight: 600,
              color: activeTab === tab.id ? 'var(--sky-blue)' : 'var(--text-tertiary)',
              borderBottom: activeTab === tab.id ? '2px solid var(--sky-blue)' : '2px solid transparent',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div>
        {activeTab === 'dashboard' && <FinanceDashboard invoices={invoices} timesheets={timesheets} projects={projects} expenses={expenses} />}
        {activeTab === 'invoices' && <FinanceInvoices invoices={invoices} timesheets={timesheets} projects={projects} />}
        {activeTab === 'cashflow' && <FinanceCashFlow invoices={invoices} timesheets={timesheets} projects={projects} expenses={expenses} />}
        {activeTab === 'expenses' && <FinanceExpenses expenses={expenses} />}
      </div>
    </div>
  )
}
