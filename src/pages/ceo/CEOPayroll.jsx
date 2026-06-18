import { useState, useEffect, useMemo } from 'react'
import {
  collection, onSnapshot, query, orderBy, where, getDocs, doc, getDoc,
} from 'firebase/firestore'
import { auth, db, CREATE_PAYROLL_RUN_URL, GENERATE_PDF_URL, VERIFY_EMPLOYEE_SALARY_URL, CANCEL_PAYROLL_RUN_URL, SAVE_PAYROLL_SETTINGS_URL } from '../../lib/firebase'
import {
  AlertTriangle, CheckCircle, Clock, ShieldCheck, Plus, Loader, FileText,
  Users, DollarSign, Download, FileSpreadsheet, AlertCircle, X,
} from 'lucide-react'
import ApprovalButton from '../../components/ApprovalButton'
import { SignedBadgeList } from '../../components/SignedBadge'

// Self-contained payroll module — no Zoho dependency. Source of truth lives
// in payroll_runs/{PR-YYYY-MM}. CEO/Finance creates a DRAFT, signs it via
// ApprovalButton, and the platform generates payslips + WPS + GOSI itself.

function fmtMoney(n) {
  return 'SAR ' + Math.round(Number(n) || 0).toLocaleString()
}

function currentYearMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function CEOPayroll() {
  const [runs, setRuns] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [selectedMonth, setSelectedMonth] = useState(currentYearMonth())
  const [activeRunId, setActiveRunId] = useState(null)
  const [userRole, setUserRole] = useState(null)
  const [showSettings, setShowSettings] = useState(false)
  const [gosi, setGosi] = useState(null)
  const [savingSettings, setSavingSettings] = useState(false)

  // Load GOSI rate settings (defaults shown if the doc doesn't exist yet).
  useEffect(() => {
    getDoc(doc(db, 'platform_settings', 'payroll'))
      .then(s => setGosi({
        gosi_saudi_employee_pct: 9.75, gosi_saudi_employer_pct: 11.75,
        gosi_nonsaudi_employee_pct: 0, gosi_nonsaudi_employer_pct: 2,
        ...(s.exists() ? s.data() : {}),
      }))
      .catch(() => {})
  }, [])

  const saveSettings = async () => {
    setSavingSettings(true)
    try {
      const idToken = await auth.currentUser.getIdToken()
      const res = await fetch(SAVE_PAYROLL_SETTINGS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
        body: JSON.stringify(gosi),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`)
      setShowSettings(false)
      window.alert('GOSI rates saved. They apply to the next payroll run you create.')
    } catch (e) { window.alert(e.message) }
    setSavingSettings(false)
  }

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'payroll_runs'), orderBy('period', 'desc')),
      snap => { setRuns(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false) },
      err => { console.warn('payroll_runs error:', err); setLoading(false) },
    )
    return () => unsub()
  }, [])

  // Resolve the caller's role so we show the right approval stage (Finance vs CEO).
  useEffect(() => {
    const me = auth.currentUser
    if (!me?.email) return
    if (me.email === 'm.alqumri@datalake.sa') { setUserRole('ceo'); return }
    getDocs(query(collection(db, 'users'), where('email', '==', me.email)))
      .then(s => { if (!s.empty) setUserRole(s.docs[0].data().role_id || null) })
      .catch(() => {})
  }, [])

  // Verify / set an employee's SAR salary (clears UNVERIFIED, or converts a
  // foreign-currency contract). Updates the employee → recreate the run to apply.
  const verifySalary = async (employee_id, name, withAmount) => {
    let salary_monthly_sar
    if (withAmount) {
      const v = window.prompt(`Enter ${name}'s monthly salary in SAR:`)
      if (v == null) return
      salary_monthly_sar = Number(v)
      if (!(salary_monthly_sar > 0)) { window.alert('Enter a positive number.'); return }
    }
    try {
      const idToken = await auth.currentUser.getIdToken()
      const res = await fetch(VERIFY_EMPLOYEE_SALARY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
        body: JSON.stringify({ employee_id, salary_monthly_sar }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`)
      window.alert("Saved. Re-create this month's run (Create Payroll Run) to apply it.")
    } catch (e) { window.alert(e.message) }
  }

  // CEO-only: void a run and re-credit any deductions it consumed.
  const cancelRun = async (run) => {
    const reason = window.prompt(`Cancel payroll run ${run.period || run.id}? This voids it${run.status === 'APPROVED' ? ' and re-credits any deductions it consumed' : ''}. Enter a reason:`)
    if (reason == null || !reason.trim()) return
    try {
      const idToken = await auth.currentUser.getIdToken()
      const res = await fetch(CANCEL_PAYROLL_RUN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
        body: JSON.stringify({ payroll_run_id: run.id, reason: reason.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`)
      window.alert('Run cancelled.')
    } catch (e) { window.alert(e.message) }
  }

  const activeRun = useMemo(() => runs.find(r => r.id === activeRunId) || null, [runs, activeRunId])
  const pendingFinance = useMemo(() => runs.filter(r => r.status === 'DRAFT'), [runs])
  const pendingCEO = useMemo(() => runs.filter(r => r.status === 'FINANCE_APPROVED'), [runs])

  const createRun = async () => {
    if (!/^\d{4}-\d{2}$/.test(selectedMonth)) { setCreateError('Pick a YYYY-MM month.'); return }
    setCreating(true); setCreateError('')
    try {
      const me = auth.currentUser
      if (!me) throw new Error('Not signed in.')
      const idToken = await me.getIdToken()
      const res = await fetch(CREATE_PAYROLL_RUN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
        body: JSON.stringify({ year_month: selectedMonth }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Create failed (${res.status})`)
      setShowCreate(false)
      setActiveRunId(data.payroll_run_id)
    } catch (e) {
      setCreateError(e.message)
    } finally {
      setCreating(false)
    }
  }

  const downloadFromPdf = async (template, docId, fileName) => {
    try {
      const me = auth.currentUser
      const idToken = await me.getIdToken()
      const url = `${GENERATE_PDF_URL}?template=${template}&docId=${encodeURIComponent(docId)}`
      const res = await fetch(url, { headers: { Authorization: 'Bearer ' + idToken } })
      if (!res.ok) throw new Error(`PDF ${res.status}`)
      const blob = await res.blob()
      const a = document.createElement('a')
      const dlUrl = URL.createObjectURL(blob)
      a.href = dlUrl; a.download = fileName; a.click()
      setTimeout(() => URL.revokeObjectURL(dlUrl), 2000)
    } catch (err) {
      alert('Download failed: ' + err.message)
    }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Loading payroll data…</div>

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <DollarSign size={22} color="#022873" /> Payroll
          </h1>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-tertiary)', marginTop: 4 }}>
            Datalake is the system of record. Create a run, get CEO sign-off, the platform generates payslips + WPS + GOSI.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {(userRole === 'ceo' || userRole === 'finance') && (
            <button
              onClick={() => setShowSettings(true)}
              style={{ background: '#fff', color: '#022873', padding: '10px 14px', borderRadius: 8, border: '1px solid #022873', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit' }}
            >
              <ShieldCheck size={15} /> GOSI Rates
            </button>
          )}
          <button
            onClick={() => setShowCreate(true)}
            className="write-action"
            style={{ background: '#022873', color: '#fff', padding: '10px 18px', borderRadius: 8, border: 'none', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit' }}
          >
            <Plus size={16} /> Create Payroll Run
          </button>
        </div>
      </div>

      {showSettings && gosi && (
        <div onClick={() => setShowSettings(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(2,8,23,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 24, width: 460, maxWidth: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#022873' }}>GOSI Rates (%)</h2>
              <button onClick={() => setShowSettings(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B' }}><X size={20} /></button>
            </div>
            <div style={{ fontSize: '0.78rem', color: '#B45309', background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 8, padding: '8px 12px', margin: '8px 0 14px' }}>
              ⚠ Verify these against current GOSI regulations with your accountant before running real payroll. Applies to the next run created.
            </div>
            {[
              ['gosi_saudi_employee_pct', 'Saudi — employee'],
              ['gosi_saudi_employer_pct', 'Saudi — employer'],
              ['gosi_nonsaudi_employee_pct', 'Non-Saudi — employee'],
              ['gosi_nonsaudi_employer_pct', 'Non-Saudi — employer'],
            ].map(([k, label]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <label style={{ fontSize: '0.85rem', color: '#334155' }}>{label}</label>
                <input type="number" step="0.01" min="0" max="100" value={gosi[k] ?? ''} onChange={e => setGosi({ ...gosi, [k]: e.target.value === '' ? '' : Number(e.target.value) })} style={{ width: 110, padding: '8px 10px', border: '1px solid #E5E7EB', borderRadius: 8, fontSize: '0.88rem', textAlign: 'right' }} />
              </div>
            ))}
            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              <button onClick={() => setShowSettings(false)} style={{ flex: 1, padding: '11px', borderRadius: 8, border: '1px solid #E5E7EB', background: '#fff', color: '#475569', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
              <button onClick={saveSettings} disabled={savingSettings} style={{ flex: 1, padding: '11px', borderRadius: 8, border: 'none', background: '#022873', color: '#fff', fontWeight: 700, cursor: savingSettings ? 'default' : 'pointer' }}>{savingSettings ? 'Saving…' : 'Save Rates'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Approval chain: HR prepares (DRAFT) → Finance approves → CEO approves */}
      {(pendingFinance.length > 0 || pendingCEO.length > 0) && (
        <div className="card" style={{ marginBottom: 20, borderLeft: '3px solid #F39C12' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 18px 4px' }}>
            <ShieldCheck size={16} color="#F39C12" />
            <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>
              Payroll runs awaiting approval ({pendingFinance.length + pendingCEO.length})
            </h3>
          </div>
          <div style={{ padding: '4px 18px 6px', fontSize: '0.74rem', color: 'var(--text-tertiary)' }}>
            HR prepares → <strong>Finance approves</strong> → <strong>CEO final approval</strong>.
          </div>
          <div style={{ padding: '8px 18px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              ...pendingFinance.map(r => ({ run: r, stage: 'finance' })),
              ...pendingCEO.map(r => ({ run: r, stage: 'ceo' })),
            ].map(({ run, stage }) => {
              const canAct = (stage === 'finance' && userRole === 'finance') || (stage === 'ceo' && userRole === 'ceo')
              return (
                <div key={run.id} style={{ padding: 14, border: '1px solid var(--border-primary)', borderRadius: 10, background: 'var(--bg-surface)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
                    <div>
                      <div style={{ fontSize: '0.95rem', fontWeight: 700 }}>{run.period || run.id}</div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: 3 }}>
                        {run.employee_count || run.employees?.length || 0} paid · {fmtMoney(run.total_gross)} gross · {fmtMoney(run.total_net)} net
                        {run.pending_contract_count ? ` · ${run.pending_contract_count} pending contract` : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <button onClick={() => setActiveRunId(run.id)} style={{ background: 'transparent', color: '#022873', border: '1px solid #022873', borderRadius: 6, padding: '6px 12px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                        Preview
                      </button>
                      <span className={stage === 'finance' ? 'badge badge-info' : 'badge badge-warning'}>
                        {stage === 'finance' ? 'DRAFT · awaiting Finance' : 'FINANCE-APPROVED · awaiting CEO'}
                      </span>
                    </div>
                  </div>
                  {canAct ? (
                    <ApprovalButton
                      parentCollection="payroll_runs"
                      parentId={run.id}
                      requiresDocument={stage === 'ceo'}
                      label={stage === 'finance' ? 'Finance Approve' : 'CEO Final Approval'}
                      variant="ceo"
                      extra={{
                        stage,
                        period: run.period || null,
                        employee_count: run.employee_count || run.employees?.length || null,
                        total_gross: run.total_gross || null,
                        total_net: run.total_net || null,
                      }}
                      onApproved={() => { /* status flipped server-side; snapshot refreshes the row */ }}
                    />
                  ) : (
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                      {stage === 'finance' ? 'Awaiting Finance approval.' : 'Awaiting CEO final approval.'}
                    </div>
                  )}
                  <div style={{ marginTop: 8 }}>
                    <SignedBadgeList parentCollection="payroll_runs" parentId={run.id} compact />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* All runs */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-primary)' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>All payroll runs</h3>
        </div>
        {runs.length === 0 ? (
          <div style={{ padding: 36, textAlign: 'center', color: 'var(--text-tertiary)' }}>
            No payroll runs yet. Click "Create Payroll Run" to start.
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Period</th>
                <th>Status</th>
                <th>Employees</th>
                <th>Gross</th>
                <th>GOSI (er.)</th>
                <th>Net</th>
                <th>Pending</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {runs.map(r => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600 }}>{r.period || r.id}</td>
                  <td>
                    <span className={`badge ${r.status === 'APPROVED' ? 'badge-success' : r.status === 'DRAFT' ? 'badge-info' : 'badge-warning'}`}>
                      {r.status || '—'}
                    </span>
                  </td>
                  <td>{r.employee_count || r.employees?.length || 0}</td>
                  <td>{fmtMoney(r.total_gross)}</td>
                  <td style={{ color: 'var(--text-tertiary)' }}>{fmtMoney(r.total_gosi_employee)}</td>
                  <td style={{ fontWeight: 600 }}>{fmtMoney(r.total_net)}</td>
                  <td style={{ color: r.pending_contract_count ? '#C0392B' : 'var(--text-tertiary)' }}>
                    {r.pending_contract_count || 0}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button onClick={() => setActiveRunId(r.id)} style={btn('ghost')}>Open</button>
                      {r.status === 'APPROVED' && (
                        <button onClick={() => downloadFromPdf('payslip', r.id, `${r.id}-summary.pdf`)} style={btn('ghost')}>
                          <FileText size={11} /> Summary PDF
                        </button>
                      )}
                      {userRole === 'ceo' && (r.status === 'APPROVED' || r.status === 'FINANCE_APPROVED') && (
                        <button onClick={() => cancelRun(r)} style={{ background: '#fff', color: '#B91C1C', border: '1px solid #FECACA', borderRadius: 6, padding: '5px 10px', fontSize: '0.76rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                          Cancel
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

      {activeRun && (
        <PayrollRunDetail
          run={activeRun}
          onClose={() => setActiveRunId(null)}
          downloadFromPdf={downloadFromPdf}
        />
      )}

      {showCreate && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }} onClick={() => !creating && setShowCreate(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-surface, #fff)', borderRadius: 12, padding: 24, width: 420, maxWidth: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>Create Payroll Run</h3>
              <button onClick={() => !creating && setShowCreate(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}><X size={18} /></button>
            </div>
            <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', marginBottom: 14, lineHeight: 1.5 }}>
              Pulls active employees with salary data, computes GOSI by nationality (Saudi 9.75% / non-Saudi 0%), and writes a DRAFT run. Employees without salary data are listed as <strong>Pending Contract</strong> — not zeroed.
            </p>
            <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>Period (YYYY-MM)</label>
            <input
              type="month"
              value={selectedMonth}
              onChange={e => setSelectedMonth(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border-primary, #E5E7EB)', fontSize: '0.9rem', fontFamily: 'inherit', boxSizing: 'border-box' }}
            />
            {createError && (
              <div style={{ marginTop: 12, padding: 10, background: 'rgba(192,57,43,0.1)', border: '1px solid rgba(192,57,43,0.3)', borderRadius: 6, color: '#C0392B', fontSize: '0.84rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertCircle size={14} /> {createError}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button onClick={() => !creating && setShowCreate(false)} style={btn('ghost')}>Cancel</button>
              <button onClick={createRun} disabled={creating} style={{ ...btn('primary'), opacity: creating ? 0.6 : 1 }}>
                {creating ? <><Loader size={13} className="spin" /> Creating…</> : <><Plus size={13} /> Create DRAFT</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PayrollRunDetail({ run, onClose, downloadFromPdf }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-surface, #fff)', borderRadius: 12, padding: 24, width: 880, maxWidth: '100%', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>{run.period || run.id}</h3>
            <div style={{ fontSize: '0.76rem', color: 'var(--text-tertiary)', marginTop: 4 }}>
              {run.id} · status: <strong>{run.status}</strong>
              {run.approved_by && ` · approved by ${run.approved_by}`}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}><X size={18} /></button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 16 }}>
          <StatBox label="Employees paid" value={run.employee_count || run.employees?.length || 0} />
          <StatBox label="Total Gross" value={fmtMoney(run.total_gross)} />
          <StatBox label="GOSI (er.)" value={fmtMoney(run.total_gosi_employee)} />
          <StatBox label="Net to WPS" value={fmtMoney(run.total_net)} accent />
        </div>

        {run.pending_contract_count > 0 && (
          <div style={{ marginBottom: 16, padding: 12, background: 'rgba(192,57,43,0.08)', border: '1px solid rgba(192,57,43,0.25)', borderRadius: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.86rem', fontWeight: 700, color: '#C0392B', marginBottom: 6 }}>
              <AlertTriangle size={14} /> Pending Contract — {run.pending_contract_count} employee(s) excluded
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: 8 }}>
              These employees have no salary on file (no contract loaded yet). They are NOT in this run — load their contracts to include them next month.
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.82rem' }}>
              {(run.pending_contract || []).map(p => (
                <li key={p.employee_id}>
                  {p.name} ({p.employee_id}) — {p.reason === 'needs_currency_conversion'
                    ? `salary in ${p.currency || 'foreign currency'}${p.foreign_amount ? ` (${p.foreign_amount})` : ''} — needs SAR conversion by Finance`
                    : 'no salary on file'}
                  {p.reason === 'needs_currency_conversion' && (
                    <button onClick={() => verifySalary(p.employee_id, p.name, true)} style={{ marginLeft: 8, fontSize: '0.7rem', fontWeight: 700, color: '#022873', background: '#fff', border: '1px solid #022873', borderRadius: 6, padding: '1px 8px', cursor: 'pointer' }}>Set SAR</button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <h4 style={{ fontSize: '0.9rem', fontWeight: 700, marginTop: 10, marginBottom: 8 }}>Line items ({run.employees?.length || 0})</h4>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table" style={{ width: '100%', fontSize: '0.82rem' }}>
            <thead>
              <tr>
                <th>Employee</th>
                <th>GOSI</th>
                <th>Basic</th>
                <th>Housing</th>
                <th>Transport</th>
                <th>GOSI (em.)</th>
                <th>Net</th>
                <th>Payslip</th>
              </tr>
            </thead>
            <tbody>
              {(run.employees || []).map(emp => (
                <tr key={emp.employee_id}>
                  <td style={{ fontWeight: 600 }}>{emp.name}<br/><span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>{emp.employee_id}</span></td>
                  <td>{emp.gosi_type}</td>
                  <td>
                    {fmtMoney(emp.base_salary)}
                    {emp.salary_verified === false && (
                      <>
                        <span title="Salary auto-mapped from the contract but not yet verified by HR" style={{ marginLeft: 6, fontSize: '0.62rem', fontWeight: 700, color: '#B45309', background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 6, padding: '1px 5px', whiteSpace: 'nowrap' }}>
                          ⚠ UNVERIFIED
                        </span>
                        <button onClick={() => verifySalary(emp.employee_id, emp.name, false)} style={{ marginLeft: 6, fontSize: '0.62rem', fontWeight: 700, color: '#15803D', background: '#fff', border: '1px solid #86EFAC', borderRadius: 6, padding: '1px 6px', cursor: 'pointer' }}>Verify</button>
                      </>
                    )}
                  </td>
                  <td>{fmtMoney(emp.housing)}</td>
                  <td>{fmtMoney(emp.transport)}</td>
                  <td style={{ color: 'var(--text-tertiary)' }}>{fmtMoney(emp.gosi_employee)}</td>
                  <td style={{ fontWeight: 700 }}>{fmtMoney(emp.net_pay)}</td>
                  <td>
                    {run.status === 'APPROVED' ? (
                      <button onClick={() => downloadFromPdf('payslip', `${run.id}__${emp.employee_id}`, `payslip-${run.period}-${emp.employee_id}.pdf`)} style={btn('ghost')}>
                        <Download size={11} /> PDF
                      </button>
                    ) : (
                      <span style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)' }}>after approval</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {run.status === 'APPROVED' && (
          <div style={{ marginTop: 16, padding: 12, background: 'rgba(52,191,58,0.06)', border: '1px solid rgba(52,191,58,0.25)', borderRadius: 8 }}>
            <div style={{ fontSize: '0.86rem', fontWeight: 700, color: '#34BF3A', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <CheckCircle size={14} /> Outputs (system of record — no Zoho dependency)
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: '0.8rem' }}>
              {run.wps_file_url ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#022873' }}>
                  <FileSpreadsheet size={13} /> WPS SIF: <code style={{ fontSize: '0.72rem', background: '#f4f6f9', padding: '2px 6px', borderRadius: 4 }}>{run.wps_file_url}</code>
                </span>
              ) : run.wps_status === 'BLOCKED_NO_MOL' ? (
                <span style={{ color: '#B45309', display: 'inline-flex', alignItems: 'center', gap: 4 }} title={run.wps_error || ''}>
                  <AlertTriangle size={13} /> WPS blocked — MOL number not configured
                </span>
              ) : run.wps_status === 'FAILED' ? (
                <span style={{ color: '#B91C1C', display: 'inline-flex', alignItems: 'center', gap: 4 }} title={run.wps_error || ''}>
                  <AlertCircle size={13} /> WPS failed — {run.wps_error || 'unknown error'}
                </span>
              ) : (
                <span style={{ color: 'var(--text-tertiary)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Clock size={13} /> WPS generating…
                </span>
              )}
              {run.gosi_report_url ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#022873' }}>
                  <ShieldCheck size={13} /> GOSI: <code style={{ fontSize: '0.72rem', background: '#f4f6f9', padding: '2px 6px', borderRadius: 4 }}>{run.gosi_report_url}</code>
                </span>
              ) : run.gosi_status === 'FAILED' ? (
                <span style={{ color: '#B91C1C', display: 'inline-flex', alignItems: 'center', gap: 4 }} title={run.gosi_error || ''}>
                  <AlertCircle size={13} /> GOSI failed — {run.gosi_error || 'unknown error'}
                </span>
              ) : (
                <span style={{ color: 'var(--text-tertiary)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Clock size={13} /> GOSI report generating…
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function StatBox({ label, value, accent }) {
  return (
    <div style={{ padding: '10px 14px', borderRadius: 8, background: accent ? 'rgba(52,191,58,0.08)' : 'var(--bg-surface, #fff)', border: '1px solid var(--border-primary, #E5E7EB)' }}>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: '1rem', fontWeight: 700, color: accent ? '#34BF3A' : 'var(--text-primary)', marginTop: 4 }}>{value}</div>
    </div>
  )
}

function btn(kind) {
  const base = { padding: '6px 12px', borderRadius: 6, fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 4 }
  if (kind === 'primary') return { ...base, background: '#022873', color: '#fff', border: '1px solid #022873' }
  return { ...base, background: 'transparent', color: '#022873', border: '1px solid var(--border-primary, #E5E7EB)' }
}
