import { useState, useEffect, useMemo } from 'react'
import { collection, getDocs, onSnapshot, query, orderBy } from 'firebase/firestore'
import { db, auth, CREATE_DEDUCTION_URL, CANCEL_DEDUCTION_URL } from '../../lib/firebase'
import { MinusCircle, Plus, Loader, AlertTriangle, X, Ban } from 'lucide-react'

const SAR = (n) => `SAR ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const thisMonth = () => new Date().toISOString().slice(0, 7)

const STATUS_COLOR = {
  ACTIVE: { bg: '#E0F2FE', color: '#0369A1' },
  COMPLETED: { bg: '#DCFCE7', color: '#15803D' },
  CANCELLED: { bg: '#F1F5F9', color: '#64748B' },
}

// HR deduction categories — keep in sync with functions/deductions.js CATEGORIES.
const CATEGORIES = [
  { value: 'loan', label: 'Loan' },
  { value: 'advance', label: 'Salary Advance' },
  { value: 'bounce', label: 'Bounced / Returned Payment' },
  { value: 'fine', label: 'Fine / Penalty' },
  { value: 'absence', label: 'Absence / Unpaid Leave' },
  { value: 'damage', label: 'Damage / Equipment Loss' },
  { value: 'gosi_adjustment', label: 'GOSI / Insurance Adjustment' },
  { value: 'other', label: 'Other' },
]
const CAT_LABEL = Object.fromEntries(CATEGORIES.map(c => [c.value, c.label]))

export default function HRDeductions() {
  const [deductions, setDeductions] = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [busyId, setBusyId] = useState(null)

  // Live deductions
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'deductions'), orderBy('created_at', 'desc')),
      snap => { setDeductions(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false) },
      err => { setError(err.message); setLoading(false) }
    )
    return () => unsub()
  }, [])

  // Employees for the picker
  useEffect(() => {
    getDocs(collection(db, 'employees'))
      .then(s => setEmployees(s.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(e => (e.employment_status || e.status || '').toLowerCase() !== 'terminated')
        .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))))
      .catch(() => {})
  }, [])

  const post = async (url, body) => {
    const idToken = await auth.currentUser.getIdToken()
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
    return data
  }

  const handleCancel = async (d) => {
    if (busyId || d.status !== 'ACTIVE') return
    if (!window.confirm(`Cancel the deduction "${d.description}" for ${d.employee_name}? Remaining balance ${SAR(d.remaining_balance)} will not be deducted.`)) return
    setBusyId(d.id); setError('')
    try { await post(CANCEL_DEDUCTION_URL, { deduction_id: d.id }) }
    catch (e) { setError(e.message) }
    setBusyId(null)
  }

  const active = useMemo(() => deductions.filter(d => d.status === 'ACTIVE'), [deductions])

  if (loading) return (
    <div style={{ padding: 40, textAlign: 'center', color: '#64748B' }}>
      <Loader size={26} style={{ animation: 'spin 1s linear infinite', marginBottom: 10 }} />
      <div>Loading deductions…</div>
    </div>
  )

  return (
    <div style={{ padding: '28px 24px', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#022873', display: 'flex', alignItems: 'center', gap: 10 }}>
          <MinusCircle size={22} color="#EF5829" /> Payroll Deductions
        </h1>
        <button onClick={() => setShowAdd(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 18px', background: '#022873', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}>
          <Plus size={16} /> Add Deduction
        </button>
      </div>
      <p style={{ color: '#64748B', fontSize: '0.85rem', marginBottom: 22 }}>
        One-off or multi-month installments per employee. Each payroll run applies the right installment and the balance reduces automatically on approval. {active.length} active.
      </p>

      {error && <div style={{ padding: '10px 14px', background: '#FEF2F2', color: '#B91C1C', border: '1px solid #FECACA', borderRadius: 8, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem' }}><AlertTriangle size={16} />{error}</div>}

      {deductions.length === 0 ? (
        <div style={{ padding: 48, textAlign: 'center', color: '#94A3B8', background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12 }}>
          No deductions yet. Add one to have it applied on the next payroll run.
        </div>
      ) : (
        <div style={{ overflowX: 'auto', background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#64748B', borderBottom: '1px solid #E5E7EB' }}>
                <th style={{ padding: '12px 14px' }}>Employee</th>
                <th style={{ padding: '12px 14px' }}>Category</th>
                <th style={{ padding: '12px 14px' }}>Description</th>
                <th style={{ padding: '12px 14px' }}>Type</th>
                <th style={{ padding: '12px 14px' }}>Total</th>
                <th style={{ padding: '12px 14px' }}>Monthly</th>
                <th style={{ padding: '12px 14px' }}>Progress</th>
                <th style={{ padding: '12px 14px' }}>Remaining</th>
                <th style={{ padding: '12px 14px' }}>Status</th>
                <th style={{ padding: '12px 14px' }}></th>
              </tr>
            </thead>
            <tbody>
              {deductions.map(d => {
                const sc = STATUS_COLOR[d.status] || STATUS_COLOR.CANCELLED
                return (
                  <tr key={d.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                    <td style={{ padding: '11px 14px', fontWeight: 600, color: '#0F172A' }}>{d.employee_name || d.employee_id}</td>
                    <td style={{ padding: '11px 14px' }}>{CAT_LABEL[d.category] || '—'}</td>
                    <td style={{ padding: '11px 14px' }}>{d.description}</td>
                    <td style={{ padding: '11px 14px' }}>{d.type === 'installment' ? `Installment ×${d.installments}` : 'One-off'}</td>
                    <td style={{ padding: '11px 14px' }}>{SAR(d.total_amount)}</td>
                    <td style={{ padding: '11px 14px' }}>{SAR(d.monthly_amount)}</td>
                    <td style={{ padding: '11px 14px' }}>{Number(d.installments_paid || 0)} / {d.installments || 1}</td>
                    <td style={{ padding: '11px 14px', fontWeight: 600 }}>{SAR(d.remaining_balance)}</td>
                    <td style={{ padding: '11px 14px' }}>
                      <span style={{ padding: '2px 9px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 700, background: sc.bg, color: sc.color }}>{d.status}</span>
                    </td>
                    <td style={{ padding: '11px 14px' }}>
                      {d.status === 'ACTIVE' && (
                        <button onClick={() => handleCancel(d)} disabled={busyId === d.id} title="Cancel deduction" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', background: '#fff', color: '#B91C1C', border: '1px solid #FECACA', borderRadius: 7, fontSize: '0.76rem', cursor: 'pointer' }}>
                          {busyId === d.id ? <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Ban size={12} />} Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <AddDeductionModal
          employees={employees}
          submitting={submitting}
          onClose={() => setShowAdd(false)}
          onSubmit={async (form) => {
            setSubmitting(true); setError('')
            try { await post(CREATE_DEDUCTION_URL, form); setShowAdd(false) }
            catch (e) { setError(e.message) }
            setSubmitting(false)
          }}
        />
      )}
    </div>
  )
}

function AddDeductionModal({ employees, onClose, onSubmit, submitting }) {
  const [employee_id, setEmployeeId] = useState('')
  const [category, setCategory] = useState('loan')
  const [description, setDescription] = useState('')
  const [total_amount, setTotal] = useState('')
  const [type, setType] = useState('one_off')
  const [installments, setInstallments] = useState('3')
  const [start_period, setStart] = useState(thisMonth())

  const monthly = type === 'installment' && Number(total_amount) > 0 && Number(installments) >= 2
    ? (Number(total_amount) / Number(installments)) : Number(total_amount || 0)

  const valid = employee_id && Number(total_amount) > 0 && (type === 'one_off' || Number(installments) >= 2)
  const inp = { width: '100%', padding: '9px 12px', border: '1px solid #E5E7EB', borderRadius: 8, fontSize: '0.88rem', boxSizing: 'border-box', marginTop: 4 }
  const lbl = { fontSize: '0.78rem', fontWeight: 600, color: '#475569', marginTop: 14, display: 'block' }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(2,8,23,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 24, width: 460, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#022873' }}>Add Deduction</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B' }}><X size={20} /></button>
        </div>

        <label style={lbl}>Employee</label>
        <select style={inp} value={employee_id} onChange={e => setEmployeeId(e.target.value)}>
          <option value="">Choose an employee…</option>
          {employees.map(e => <option key={e.id} value={e.employee_id || e.id}>{e.full_name || e.name || e.id}</option>)}
        </select>

        <label style={lbl}>Category</label>
        <select style={inp} value={category} onChange={e => setCategory(e.target.value)}>
          {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>

        <label style={lbl}>Description / reason</label>
        <input style={inp} placeholder="e.g. Car loan, Jan advance, late penalty" value={description} onChange={e => setDescription(e.target.value)} />

        <label style={lbl}>Total amount (SAR)</label>
        <input style={inp} type="number" min="0" step="0.01" value={total_amount} onChange={e => setTotal(e.target.value)} />

        <label style={lbl}>Type</label>
        <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
          <button onClick={() => setType('one_off')} style={{ flex: 1, padding: '9px', borderRadius: 8, border: `1px solid ${type === 'one_off' ? '#022873' : '#E5E7EB'}`, background: type === 'one_off' ? '#022873' : '#fff', color: type === 'one_off' ? '#fff' : '#475569', fontWeight: 600, cursor: 'pointer', fontSize: '0.84rem' }}>One-off (one month)</button>
          <button onClick={() => setType('installment')} style={{ flex: 1, padding: '9px', borderRadius: 8, border: `1px solid ${type === 'installment' ? '#022873' : '#E5E7EB'}`, background: type === 'installment' ? '#022873' : '#fff', color: type === 'installment' ? '#fff' : '#475569', fontWeight: 600, cursor: 'pointer', fontSize: '0.84rem' }}>Installments</button>
        </div>

        {type === 'installment' && (
          <>
            <label style={lbl}>Number of months</label>
            <input style={inp} type="number" min="2" step="1" value={installments} onChange={e => setInstallments(e.target.value)} />
          </>
        )}

        <label style={lbl}>Starts from (month)</label>
        <input style={inp} type="month" value={start_period} onChange={e => setStart(e.target.value)} />

        {Number(total_amount) > 0 && (
          <div style={{ marginTop: 14, padding: '10px 12px', background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 8, fontSize: '0.82rem', color: '#475569' }}>
            {type === 'installment'
              ? `${SAR(monthly)} / month for ${installments} months, starting ${start_period}.`
              : `${SAR(total_amount)} deducted once, in ${start_period}.`}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '11px', borderRadius: 8, border: '1px solid #E5E7EB', background: '#fff', color: '#475569', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          <button
            disabled={!valid || submitting}
            onClick={() => onSubmit({ employee_id, category, description, total_amount: Number(total_amount), type, installments: Number(installments), start_period })}
            style={{ flex: 1, padding: '11px', borderRadius: 8, border: 'none', background: valid && !submitting ? '#EF5829' : '#FCA5A5', color: '#fff', fontWeight: 700, cursor: valid && !submitting ? 'pointer' : 'default', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            {submitting ? <><Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</> : 'Add Deduction'}
          </button>
        </div>
      </div>
    </div>
  )
}
