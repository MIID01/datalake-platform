import { useState, useEffect, useMemo } from 'react'
import { collection, addDoc, query, where, onSnapshot, serverTimestamp } from 'firebase/firestore'
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, auth } from '../../lib/firebase'
import { loadApprovalContext, describeExpenseApprover } from '../../lib/approval-routing'
import { Plus, CheckCircle, AlertTriangle, Loader, Receipt, Users } from 'lucide-react'

const CATEGORIES = ['Transportation', 'Meals', 'Accommodation', 'Office Supplies', 'Communication', 'Client Entertainment', 'Equipment', 'Training', 'Other']
const STATUS_CONFIG = {
  DRAFT: { label: 'Draft', color: '#78909C', bg: 'rgba(120,144,156,0.12)' },
  SUBMITTED: { label: 'Submitted', color: '#1598CC', bg: 'rgba(21,152,204,0.12)' },
  APPROVED: { label: 'Approved', color: '#34BF3A', bg: 'rgba(52,191,58,0.12)' },
  REIMBURSED: { label: 'Reimbursed', color: '#059669', bg: 'rgba(5,150,105,0.12)' },
  REJECTED: { label: 'Rejected', color: '#C0392B', bg: 'rgba(192,57,43,0.12)' },
}

export default function Expenses() {
  const [expenses, setExpenses] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [toast, setToast] = useState(null)
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    category: CATEGORIES[0],
    amount: '',
    description: '',
    billable: false,
  })
  const [file, setFile] = useState(null)

  const [userEmail, setUserEmail] = useState(null)
  const [userName, setUserName] = useState('')
  const [approvalContext, setApprovalContext] = useState(null)

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(user => {
      if (user) { setUserEmail(user.email); setUserName(user.displayName || user.email) }
    })
    return () => unsub()
  }, [])

  useEffect(() => {
    if (!userEmail) return
    let cancelled = false
    loadApprovalContext({ email: userEmail })
      .then(ctx => { if (!cancelled) setApprovalContext(ctx) })
      .catch(() => { if (!cancelled) setApprovalContext(null) })
    return () => { cancelled = true }
  }, [userEmail])

  useEffect(() => {
    if (!userEmail) return
    const q = query(collection(db, 'expenses'), where('engineer_email', '==', userEmail))
    const unsub = onSnapshot(q, snap => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      data.sort((a, b) => (b.created_at?.seconds || 0) - (a.created_at?.seconds || 0))
      setExpenses(data)
      setLoading(false)
    }, err => {
      console.warn('Expenses listener:', err.message)
      setError(err)
      setLoading(false)
    })
    return () => unsub()
  }, [userEmail])

  const pendingTotal = useMemo(() =>
    expenses.filter(e => e.status === 'SUBMITTED' || e.status === 'APPROVED')
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0),
  [expenses])

  const reimbursedTotal = useMemo(() =>
    expenses.filter(e => e.status === 'REIMBURSED')
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0),
  [expenses])

  const approverInfo = useMemo(
    () => describeExpenseApprover(approvalContext, { amount: form.amount, category: form.category }),
    [approvalContext, form.amount, form.category],
  )

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type }); setTimeout(() => setToast(null), 4000)
  }

  const handleSubmit = async () => {
    if (!form.date) { showToast('Date is required', 'error'); return }
    if (!form.amount || Number(form.amount) <= 0) { showToast('Amount must be greater than 0', 'error'); return }
    if (!form.description || form.description.length < 10) { showToast('Description must be at least 10 characters', 'error'); return }

    setSubmitting(true)
    try {
      const expId = `EXP-${Date.now()}-${Math.floor(Math.random() * 1000)}`
      const amount = Number(form.amount)
      let receiptUrl = null

      if (file) {
        const storage = getStorage()
        const fileRef = ref(storage, `expenses/${expId}-${file.name}`)
        await uploadBytes(fileRef, file)
        receiptUrl = await getDownloadURL(fileRef)
      }

      const isAuto = approverInfo.level === 'auto'
      await addDoc(collection(db, 'expenses'), {
        expense_id: expId,
        date: form.date,
        category: form.category,
        amount,
        description: form.description,
        billable: form.billable,
        status: isAuto ? 'APPROVED' : 'SUBMITTED',
        approval_level: (approverInfo.level || 'pm').toUpperCase(),
        routing: {
          level: approverInfo.level || null,
          approver: approverInfo.approver || null,
          project_id: approvalContext?.project?.project_id || null,
          datalake_pm: approvalContext?.datalakePm
            ? { name: approvalContext.datalakePm.name, email: approvalContext.datalakePm.email, uid: approvalContext.datalakePm.uid || null }
            : null,
        },
        approval_history: [],
        engineer_email: userEmail,
        engineer_name: userName,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
        approved_by: isAuto ? 'system:auto' : null,
        approved_at: isAuto ? serverTimestamp() : null,
        reimbursed_at: null,
        receipt_url: receiptUrl,
        rejection_reason: null,
      })
      showToast(`Expense ${expId} submitted (SAR ${amount.toFixed(2)})`)
      setForm({ date: new Date().toISOString().slice(0, 10), category: CATEGORIES[0], amount: '', description: '', billable: false })
      setFile(null)
      setShowForm(false)
    } catch (err) {
      showToast(`Failed: ${err.message}`, 'error')
    }
    setSubmitting(false)
  }

  const fmtDate = (dateStr) => {
    if (!dateStr) return '—'
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  if (error) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <h3 style={{ fontSize: '1.2rem', marginBottom: 8, color: 'var(--red)' }}>Unable to load page</h3>
        <p style={{ color: 'var(--text-secondary)' }}>{error.message || 'A network error occurred.'}</p>
        <button className="btn btn-primary" style={{ marginTop: 24 }} onClick={() => window.location.reload()}>Retry</button>
      </div>
    )
  }

  return (
    <div>
      {loading && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary)', zIndex: 10 }}>
          <Loader size={32} className="spin" style={{ color: 'var(--accent-primary)' }} />
        </div>
      )}
      {toast && (
        <div className="animate-fade-in-up" style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          padding: '12px 20px', borderRadius: 10, fontSize: '0.85rem', fontWeight: 600,
          background: toast.type === 'error' ? 'rgba(192,57,43,0.95)' : 'rgba(52,191,58,0.95)',
          color: '#fff', boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          {toast.type === 'error' ? <AlertTriangle size={16} /> : <CheckCircle size={16} />} {toast.msg}
        </div>
      )}

      <div className="flex-between" style={{ marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Expenses</h1>
          <div style={{ display: 'flex', gap: 20, marginTop: 6, fontSize: '0.85rem' }}>
            <span style={{ color: 'var(--text-tertiary)' }}>
              Pending: <strong style={{ color: '#F39C12' }}>SAR {pendingTotal.toFixed(2)}</strong>
            </span>
            <span style={{ color: 'var(--text-tertiary)' }}>
              Reimbursed: <strong style={{ color: '#34BF3A' }}>SAR {reimbursedTotal.toFixed(2)}</strong>
            </span>
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
          <Plus size={16} /> Submit Expense
        </button>
      </div>

      {/* Submission Form */}
      {showForm && (
        <div className="card animate-fade-in-up" style={{ marginBottom: 24 }}>
          <h3 style={{ marginBottom: 20, fontSize: '1.1rem', fontWeight: 700 }}>New Expense</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div className="form-group">
              <label className="form-label">Date *</label>
              <input className="form-input" type="date" value={form.date}
                onChange={e => setForm(p => ({ ...p, date: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Category *</label>
              <select className="form-input" value={form.category}
                onChange={e => setForm(p => ({ ...p, category: e.target.value }))}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Amount (SAR) *</label>
              <input className="form-input" type="number" placeholder="0.00" step="0.01" min="0"
                value={form.amount}
                onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} />
            </div>
          </div>
          <div className="form-group" style={{ marginBottom: 16 }}>
            <label className="form-label">Description *</label>
            <input className="form-input" type="text" value={form.description}
              onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
              placeholder="Brief description (min 10 characters)" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div className="form-group">
              <label className="form-label">Receipt (PDF/JPG/PNG, max 5MB)</label>
              <input className="form-input" type="file" accept=".pdf,.jpg,.jpeg,.png"
                onChange={e => setFile(e.target.files[0] || null)} />
            </div>
            <div className="form-group">
              <label className="form-label">Client Billable?</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <input type="checkbox" checked={form.billable}
                  onChange={e => setForm(p => ({ ...p, billable: e.target.checked }))}
                  style={{ accentColor: 'var(--steel-blue, #1598CC)' }} />
                <span style={{ fontSize: '0.9rem' }}>Bill to client PO</span>
              </div>
            </div>
          </div>
          {/* Live approver hint — updates as user types the amount */}
          {approvalContext && approverInfo.message && (
            <div style={{
              padding: '10px 14px', borderRadius: 8, marginBottom: 16,
              background: approverInfo.level === 'auto'
                ? 'rgba(52,191,58,0.08)'
                : approverInfo.level === 'ceo'
                  ? 'rgba(192,57,43,0.08)'
                  : 'rgba(21,152,204,0.08)',
              border: `1px solid ${
                approverInfo.level === 'auto'
                  ? 'rgba(52,191,58,0.25)'
                  : approverInfo.level === 'ceo'
                    ? 'rgba(192,57,43,0.25)'
                    : 'rgba(21,152,204,0.2)'
              }`,
              fontSize: '0.82rem',
              color: approverInfo.level === 'auto'
                ? '#1f7a2a'
                : approverInfo.level === 'ceo'
                  ? '#C0392B'
                  : '#1598CC',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <Users size={15} />
              <span>{approverInfo.message}</span>
            </div>
          )}
          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
              {submitting ? <Loader size={16} className="spin" /> : <CheckCircle size={16} />}
              {submitting ? ' Submitting...' : ' Submit Expense'}
            </button>
          </div>
        </div>
      )}

      {/* Expense Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-primary)' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>All Expenses ({expenses.length})</h3>
        </div>
        {expenses.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-tertiary)' }}>
            <Receipt size={40} style={{ marginBottom: 12, opacity: 0.3 }} />
            <div>No expenses submitted yet</div>
          </div>
        ) : (
          <table className="data-table">
            <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th><th>Status</th></tr></thead>
            <tbody>
              {expenses.map(exp => {
                const sc = STATUS_CONFIG[exp.status] || STATUS_CONFIG.SUBMITTED
                return (
                  <tr key={exp.id}>
                    <td style={{ fontSize: '0.82rem' }}>{fmtDate(exp.date)}</td>
                    <td><span className="badge badge-info">{exp.category}</span></td>
                    <td>{exp.description}</td>
                    <td style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>SAR {Number(exp.amount).toFixed(2)}</td>
                    <td>
                      <span style={{
                        padding: '2px 10px', borderRadius: 12, fontSize: '0.72rem',
                        fontWeight: 600, background: sc.bg, color: sc.color,
                      }}>
                        {sc.label}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
