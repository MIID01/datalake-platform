import { useState, useEffect, useMemo } from 'react'
import { auth, db } from '../../lib/firebase'
import {
  collection, onSnapshot, addDoc, doc, updateDoc, serverTimestamp, query, orderBy,
} from 'firebase/firestore'
import {
  Plus, Loader, CheckCircle2, AlertTriangle, AlertCircle, Send, Briefcase,
  DollarSign, TrendingUp, ShieldCheck, ChevronRight, FileText,
} from 'lucide-react'
import {
  evaluateHireBudget, distinctClientsFromProjects, STATUS_META, DEFAULTS,
} from '../../lib/hire-budget'

const fmtSar = (n) => n == null || Number.isNaN(n)
  ? '—'
  : 'SAR ' + Math.round(Number(n)).toLocaleString()

const fmtPct = (n) => n == null || Number.isNaN(n) ? '—' : n.toFixed(1) + '%'

const LIGHT_STYLES = {
  green:   { bg: 'rgba(52,191,58,0.12)', color: '#34BF3A', border: 'rgba(52,191,58,0.35)' },
  amber:   { bg: 'rgba(243,156,18,0.12)', color: '#F39C12', border: 'rgba(243,156,18,0.35)' },
  red:     { bg: 'rgba(192,57,43,0.12)', color: '#C0392B', border: 'rgba(192,57,43,0.35)' },
  unknown: { bg: 'rgba(120,144,156,0.10)', color: '#94a3b8', border: 'rgba(120,144,156,0.25)' },
}

const cardBase = {
  background: 'var(--bg-card, #fff)',
  border: '1px solid var(--border-card, #E5E7EB)',
  borderRadius: 12,
  padding: 20,
}

export function HireBudgetBreakdown({ budget, compact = false }) {
  if (!budget) return null
  const light = LIGHT_STYLES[budget.light] || LIGHT_STYLES.unknown
  const stat = (label, val) => (
    <div>
      <div style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: compact ? '0.85rem' : '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>{val}</div>
    </div>
  )
  return (
    <div style={{
      padding: compact ? 12 : 16, borderRadius: 10,
      background: light.bg, border: '1px solid ' + light.border,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: compact ? 8 : 12 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: light.color }} />
        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: light.color }}>{budget.headline}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr 1fr' : 'repeat(auto-fit,minmax(120px,1fr))', gap: 10 }}>
        {stat('Monthly Cost',  fmtSar(budget.monthly_cost))}
        {stat('Monthly Revenue', fmtSar(budget.monthly_revenue))}
        {stat('Margin / mo', fmtSar(budget.monthly_margin))}
        {stat('Margin %', fmtPct(budget.margin_pct))}
        {stat('Annual Cost', fmtSar(budget.annual_cost))}
        {stat('PO Remaining', budget.po_remaining == null ? '—' : fmtSar(budget.po_remaining))}
      </div>
    </div>
  )
}

export default function HireRequest() {
  const [projects, setProjects] = useState([])
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [actionId, setActionId] = useState(null)
  const [toast, setToast] = useState(null)
  const [form, setForm] = useState({
    client_name: '', project_id: '', role_title: '',
    salary: '', housing: '', transport: '',
    gosi_employer_pct: DEFAULTS.gosi_employer_pct,
    notes: '',
  })

  useEffect(() => {
    const unsubP = onSnapshot(collection(db, 'projects'),
      snap => { setProjects(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false) },
      () => setLoading(false),
    )
    const unsubR = onSnapshot(query(collection(db, 'hire_requests'), orderBy('created_at', 'desc')),
      snap => setRequests(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      () => {},
    )
    return () => { unsubP(); unsubR() }
  }, [])

  const clients = useMemo(() => distinctClientsFromProjects(projects), [projects])
  const clientProjects = useMemo(
    () => projects.filter(p => p.client_name === form.client_name),
    [projects, form.client_name],
  )
  const selectedProject = useMemo(
    () => projects.find(p => p.id === form.project_id) || null,
    [projects, form.project_id],
  )

  // po_used = sum of annual_cost from CEO_APPROVED+ hire_requests on the same project
  // (the lifecycle past CEO_APPROVED is what's "committed" against the PO).
  const poUsedForSelected = useMemo(() => {
    if (!selectedProject) return 0
    const committed = ['CEO_APPROVED', 'RECRUITING', 'CANDIDATE_SELECTED', 'OFFER_SENT', 'CONTRACT_PENDING', 'LEGAL_REVIEW', 'SIGNED', 'PROVISIONING', 'ONBOARDED', 'DEPLOYED']
    return requests
      .filter(r => r.project_id === selectedProject.id && committed.includes(r.status))
      .reduce((sum, r) => sum + (Number(r.budget?.annual_cost) || 0), 0)
  }, [requests, selectedProject])

  const budget = useMemo(() => evaluateHireBudget({
    project: selectedProject,
    costs: {
      salary: form.salary, housing: form.housing, transport: form.transport,
      gosi_employer_pct: form.gosi_employer_pct,
    },
    currentPoUsed: poUsedForSelected,
  }), [selectedProject, form.salary, form.housing, form.transport, form.gosi_employer_pct, poUsedForSelected])

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const showToast = (msg, kind = 'success') => {
    setToast({ msg, kind })
    setTimeout(() => setToast(null), 4000)
  }

  const canSubmit = form.client_name && form.project_id && form.role_title.trim() &&
    Number(form.salary) > 0 && !submitting

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const me = auth.currentUser
      const requestId = 'HR-' + new Date().getFullYear() + '-' + Math.floor(1000 + Math.random() * 9000)
      // Initial status reflects the budget gate: if the calculator is happy AND the PO has room,
      // we record BUDGET_CHECKED so Finance only needs to ratify. Otherwise it stays DRAFT.
      const initialStatus = budget.light === 'green' || budget.light === 'amber'
        ? 'BUDGET_CHECKED' : 'DRAFT'
      const submitter = me?.displayName || me?.email || 'unknown'
      await addDoc(collection(db, 'hire_requests'), {
        request_id: requestId,
        client_name: form.client_name,
        project_id: selectedProject.id,
        po_number: selectedProject.po_number || null,
        project_name: selectedProject.project_name || null,
        role_title: form.role_title.trim(),
        costs: {
          salary: Number(form.salary) || 0,
          housing: Number(form.housing) || 0,
          transport: Number(form.transport) || 0,
          gosi_employer_pct: Number(form.gosi_employer_pct) || 0,
        },
        budget: {
          monthly_cost: budget.monthly_cost,
          annual_cost: budget.annual_cost,
          monthly_revenue: budget.monthly_revenue,
          monthly_margin: budget.monthly_margin,
          margin_pct: budget.margin_pct,
          po_value: budget.po_value,
          po_used_at_submit: budget.po_used,
          po_remaining: budget.po_remaining,
          po_fits_annual_cost: budget.po_fits_annual_cost,
          light: budget.light,
          headline: budget.headline,
        },
        notes: form.notes || null,
        status: initialStatus,
        status_history: [
          { status: 'DRAFT',          at: new Date().toISOString(), by: submitter, notes: 'Request created' },
          ...(initialStatus !== 'DRAFT' ? [{ status: 'BUDGET_CHECKED', at: new Date().toISOString(), by: 'system:budget-calc', notes: 'Budget passed automated check' }] : []),
        ],
        created_at: serverTimestamp(),
        created_by: submitter,
        updated_at: serverTimestamp(),
      })
      showToast('Hire request ' + requestId + ' submitted.')
      setForm({ client_name: '', project_id: '', role_title: '', salary: '', housing: '', transport: '', gosi_employer_pct: DEFAULTS.gosi_employer_pct, notes: '' })
    } catch (err) {
      showToast('Failed: ' + err.message, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const advance = async (req, nextStatus, note) => {
    setActionId(req.id)
    try {
      const me = auth.currentUser
      const by = me?.displayName || me?.email || 'unknown'
      await updateDoc(doc(db, 'hire_requests', req.id), {
        status: nextStatus,
        status_history: [...(req.status_history || []), { status: nextStatus, at: new Date().toISOString(), by, notes: note || '' }],
        updated_at: serverTimestamp(),
      })
    } catch (err) {
      showToast('Failed: ' + err.message, 'error')
    } finally {
      setActionId(null)
    }
  }

  return (
    <div className="animate-fade-in-up">
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          padding: '12px 20px', borderRadius: 10, fontSize: '0.85rem', fontWeight: 600,
          background: toast.kind === 'error' ? 'rgba(192,57,43,0.95)' : 'rgba(52,191,58,0.95)',
          color: '#fff', boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          {toast.kind === 'error' ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />} {toast.msg}
        </div>
      )}

      {/* ── New Request Form ─────────────────────────────────────── */}
      <div style={{ ...cardBase, marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(239,88,41,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Briefcase size={18} color="#EF5829" />
          </div>
          <div>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>New Hire Request</h3>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: 2 }}>
              Budget is checked live as you type. Submitting persists the snapshot so Finance + CEO see the same numbers.
            </p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
          <div>
            <label className="form-label">Client *</label>
            <select className="form-input" value={form.client_name} onChange={e => set('client_name', e.target.value)}>
              <option value="">— Select client —</option>
              {clients.map(c => <option key={c.client_name} value={c.client_name}>{c.client_name}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">Project / PO *</label>
            <select className="form-input" value={form.project_id} onChange={e => set('project_id', e.target.value)} disabled={!form.client_name}>
              <option value="">— Select project —</option>
              {clientProjects.map(p => (
                <option key={p.id} value={p.id}>
                  {(p.project_name || p.id) + (p.po_number ? ' · ' + p.po_number : '')}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label className="form-label">Role Title *</label>
          <input className="form-input" value={form.role_title} onChange={e => set('role_title', e.target.value)} placeholder="e.g. Senior Data Engineer" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 14 }}>
          <div>
            <label className="form-label">Monthly Salary (SAR) *</label>
            <input type="number" min="0" className="form-input" value={form.salary} onChange={e => set('salary', e.target.value)} placeholder="0" />
          </div>
          <div>
            <label className="form-label">Housing</label>
            <input type="number" min="0" className="form-input" value={form.housing} onChange={e => set('housing', e.target.value)} placeholder="0" />
          </div>
          <div>
            <label className="form-label">Transport</label>
            <input type="number" min="0" className="form-input" value={form.transport} onChange={e => set('transport', e.target.value)} placeholder="0" />
          </div>
          <div>
            <label className="form-label">GOSI Employer %</label>
            <input type="number" min="0" step="0.25" className="form-input" value={form.gosi_employer_pct} onChange={e => set('gosi_employer_pct', e.target.value)} placeholder="11.75" />
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label className="form-label">Notes (optional)</label>
          <textarea className="form-input" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Justification, timing, anything Finance/CEO should see..." />
        </div>

        {/* Live budget check */}
        {selectedProject && Number(form.salary) > 0 && <HireBudgetBreakdown budget={budget} />}
        {(!selectedProject || Number(form.salary) <= 0) && (
          <div style={{ padding: 12, borderRadius: 10, background: 'rgba(120,144,156,0.10)', color: 'var(--text-tertiary)', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertCircle size={14} /> Pick a project and enter the salary to see the margin check.
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? <Loader size={14} className="spin" /> : <Send size={14} />}
            {submitting ? ' Submitting…' : ' Submit Hire Request'}
          </button>
        </div>
      </div>

      {/* ── Requests list ───────────────────────────────────────── */}
      <div style={{ ...cardBase, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border-primary)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <FileText size={16} color="var(--text-secondary)" />
          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>Hire Requests <span style={{ color: 'var(--text-tertiary)', fontWeight: 500, fontSize: '0.82rem' }}>({requests.length})</span></h3>
        </div>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}><Loader size={20} className="spin" /> Loading…</div>
        ) : requests.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>
            No hire requests yet. Submit one above to get started.
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>Request</th><th>Client / Project</th><th>Role</th><th>Salary</th><th>Margin</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {requests.map(r => {
                const status = STATUS_META[r.status] || STATUS_META.DRAFT
                const lightStyle = LIGHT_STYLES[r.budget?.light] || LIGHT_STYLES.unknown
                return (
                  <tr key={r.id}>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>{r.request_id || r.id}</td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{r.client_name || '—'}</div>
                      <div style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)' }}>{r.project_name || r.project_id}</div>
                    </td>
                    <td>{r.role_title}</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{fmtSar(r.costs?.salary)}</td>
                    <td>
                      <span style={{
                        padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem',
                        fontWeight: 700, background: lightStyle.bg, color: lightStyle.color,
                      }}>{fmtPct(r.budget?.margin_pct)}</span>
                    </td>
                    <td>
                      <span style={{ padding: '2px 10px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600, background: status.bg, color: status.color }}>
                        {status.label}
                      </span>
                    </td>
                    <td>
                      <HireActions req={r} disabled={actionId === r.id} onAdvance={advance} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <style>{`
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}

function HireActions({ req, disabled, onAdvance }) {
  const s = req.status
  // Limited row-action surface — full advance flow lives on the CEO dashboard + Recruiter pages.
  // These are the immediate transitions that make sense from a list view.
  const next = (() => {
    if (s === 'DRAFT' || s === 'BUDGET_CHECKED') return { to: 'CEO_APPROVED', label: 'CEO Approve' }
    if (s === 'CEO_APPROVED') return { to: 'RECRUITING', label: 'Start Recruiting' }
    if (s === 'OFFER_SENT')   return { to: 'CONTRACT_PENDING', label: 'Mark Offer Accepted' }
    if (s === 'CONTRACT_PENDING') return { to: 'LEGAL_REVIEW', label: 'Send to Legal' }
    if (s === 'SIGNED')       return { to: 'PROVISIONING', label: 'Start Provisioning' }
    if (s === 'PROVISIONING') return { to: 'ONBOARDED', label: 'Mark Onboarded' }
    if (s === 'ONBOARDED')    return { to: 'DEPLOYED', label: 'Mark Deployed' }
    return null
  })()
  if (!next) return <span style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)' }}>{s === 'DEPLOYED' ? 'Complete' : '—'}</span>
  return (
    <button
      className="btn btn-ghost btn-sm"
      disabled={disabled}
      onClick={() => onAdvance(req, next.to)}
    >
      {next.label} <ChevronRight size={13} />
    </button>
  )
}
