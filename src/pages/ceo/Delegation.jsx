import { useState, useEffect } from 'react'
import { auth, db } from '../../lib/firebase'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { DEFAULT_ROUTING } from '../../lib/approval-routing'
import {
  Save, RotateCcw, ShieldAlert, Loader, CheckCircle2, AlertCircle,
  DollarSign, Calendar, LifeBuoy, ScrollText,
} from 'lucide-react'

// All leave types the engineers form supports — must stay in sync with employee/Leave.jsx
const ALL_LEAVE_TYPES = [
  { id: 'annual', label: 'Annual Leave' },
  { id: 'sick', label: 'Sick Leave' },
  { id: 'marriage', label: 'Marriage Leave' },
  { id: 'bereavement', label: 'Bereavement Leave' },
  { id: 'paternity', label: 'Paternity Leave' },
  { id: 'maternity', label: 'Maternity Leave' },
  { id: 'unpaid', label: 'Unpaid Leave' },
  { id: 'hajj', label: 'Hajj Leave' },
  { id: 'emergency', label: 'Emergency Leave' },
]

// Ticket categories must mirror src/pages/employee/Support.jsx CATEGORIES
const TICKET_CATEGORIES = [
  'Payroll / Salary',
  'IT / Access Issues',
  'Leave / HR',
  'Contract / Legal',
  'Client Conflict',
  'Housing / Travel',
  'Health & Safety',
  'Other',
]

const ASSIGNEE_OPTIONS = [
  { value: 'it_admin', label: 'IT Administration' },
  { value: 'finance',  label: 'Finance' },
  { value: 'hr',       label: 'HR' },
  { value: 'pm',       label: 'PM (CEO if unassigned)' },
  { value: 'hr_and_ceo', label: 'HR + CEO (urgent)' },
  { value: 'ceo',      label: 'CEO' },
]

const styles = {
  page: { padding: '28px 24px', maxWidth: 1000, margin: '0 auto' },
  card: { background: '#fff', border: '1px solid var(--border-primary, #E5E7EB)', borderRadius: 12, padding: 22, marginBottom: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' },
  cardHeader: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 },
  cardIcon: { width: 36, height: 36, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  cardTitle: { fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' },
  cardSub: { fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: 2 },
  fieldRow: { display: 'grid', gridTemplateColumns: '1fr 180px', gap: 14, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border-primary, #F0F2F5)' },
  fieldRowLast: { display: 'grid', gridTemplateColumns: '1fr 180px', gap: 14, alignItems: 'center', padding: '10px 0' },
  fieldLabel: { fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)' },
  fieldHint: { fontSize: '0.74rem', color: 'var(--text-tertiary)', marginTop: 3 },
  input: { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-primary, #E5E7EB)', background: '#fff', fontSize: '0.88rem', width: '100%', boxSizing: 'border-box' },
  checkboxList: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 },
  checkboxLabel: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: '1px solid var(--border-primary, #E5E7EB)', borderRadius: 8, cursor: 'pointer', fontSize: '0.84rem' },
  saveBar: { position: 'sticky', bottom: 0, background: '#fff', borderTop: '1px solid var(--border-primary, #E5E7EB)', padding: '14px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 8 },
  msgSuccess: { color: '#34BF3A', fontSize: '0.82rem', display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 },
  msgError: { color: '#C0392B', fontSize: '0.82rem', display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 },
}

function emptyToZero(v) { return v === '' || v == null ? 0 : Number(v) }

export default function Delegation() {
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(null)
  const [feedback, setFeedback] = useState({ kind: '', text: '' })

  // CEO-only — defense in depth (AuthGate is the real boundary)
  const isCeo = auth.currentUser?.email === 'm.alqumri@datalake.sa'

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const snap = await getDoc(doc(db, 'approval_routing', 'config'))
        if (cancelled) return
        const stored = snap.exists() ? snap.data() : {}
        const merged = {
          expense_thresholds: { ...DEFAULT_ROUTING.expense_thresholds, ...(stored.expense_thresholds || {}) },
          leave_ceo_required_types: stored.leave_ceo_required_types || DEFAULT_ROUTING.leave_ceo_required_types,
          leave_hr_threshold_days: stored.leave_hr_threshold_days ?? DEFAULT_ROUTING.leave_hr_threshold_days,
          sick_auto_approve_max_days: stored.sick_auto_approve_max_days ?? DEFAULT_ROUTING.sick_auto_approve_max_days,
          ticket_routing: { ...DEFAULT_ROUTING.ticket_routing, ...(stored.ticket_routing || {}) },
          updated_at: stored.updated_at || null,
          updated_by: stored.updated_by || null,
        }
        setConfig(merged)
        setSavedAt(stored.updated_at || null)
        setLoading(false)
      } catch (e) {
        if (!cancelled) { setError(e.message); setLoading(false) }
      }
    }
    run()
    return () => { cancelled = true }
  }, [])

  const updateExpense = (key, val) => setConfig(c => ({
    ...c, expense_thresholds: { ...c.expense_thresholds, [key]: emptyToZero(val) },
  }))

  const toggleLeaveCeo = (typeId) => setConfig(c => {
    const set = new Set(c.leave_ceo_required_types || [])
    if (set.has(typeId)) set.delete(typeId); else set.add(typeId)
    return { ...c, leave_ceo_required_types: Array.from(set) }
  })

  const updateTicket = (cat, role) => setConfig(c => ({
    ...c, ticket_routing: { ...c.ticket_routing, [cat]: role },
  }))

  const resetDefaults = () => {
    setConfig(c => ({
      ...c,
      expense_thresholds: { ...DEFAULT_ROUTING.expense_thresholds },
      leave_ceo_required_types: [...DEFAULT_ROUTING.leave_ceo_required_types],
      leave_hr_threshold_days: DEFAULT_ROUTING.leave_hr_threshold_days,
      sick_auto_approve_max_days: DEFAULT_ROUTING.sick_auto_approve_max_days,
      ticket_routing: { ...DEFAULT_ROUTING.ticket_routing },
    }))
    setFeedback({ kind: '', text: '' })
  }

  const handleSave = async () => {
    if (!config) return
    setSaving(true); setFeedback({ kind: '', text: '' })
    try {
      const payload = {
        expense_thresholds: config.expense_thresholds,
        leave_ceo_required_types: config.leave_ceo_required_types,
        leave_hr_threshold_days: Number(config.leave_hr_threshold_days),
        sick_auto_approve_max_days: Number(config.sick_auto_approve_max_days),
        ticket_routing: config.ticket_routing,
        updated_at: serverTimestamp(),
        updated_by: auth.currentUser?.email || null,
      }
      await setDoc(doc(db, 'approval_routing', 'config'), payload, { merge: true })
      setFeedback({ kind: 'success', text: 'Delegation matrix saved. New requests will use these rules.' })
      setSavedAt(new Date())
    } catch (e) {
      setFeedback({ kind: 'error', text: e.message })
    } finally {
      setSaving(false)
    }
  }

  if (!isCeo) {
    return (
      <div style={styles.page}>
        <div style={{ ...styles.card, display: 'flex', alignItems: 'center', gap: 12, color: '#C0392B' }}>
          <ShieldAlert size={20} /> Only the CEO can edit the Delegation of Authority matrix.
        </div>
      </div>
    )
  }

  if (loading) return <div style={styles.page}><Loader size={20} className="spin" /> Loading delegation matrix…</div>
  if (error)   return <div style={styles.page}><div style={{ color: '#C0392B' }}>Could not load: {error}</div></div>

  return (
    <div style={styles.page}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Delegation of Authority</h1>
        <p style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem', marginTop: 4 }}>
          Define the thresholds and routing rules that keep the CEO out of routine approvals.
          Changes here take effect on every new request submitted from the employee portal.
        </p>
        {savedAt && (
          <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: 6 }}>
            Last saved: {savedAt?.toDate ? savedAt.toDate().toLocaleString() : new Date(savedAt).toLocaleString()}
            {config?.updated_by && ` · by ${config.updated_by}`}
          </div>
        )}
      </div>

      {/* Expense thresholds */}
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <div style={{ ...styles.cardIcon, background: 'rgba(52,191,58,0.12)', color: '#34BF3A' }}><DollarSign size={18} /></div>
          <div>
            <div style={styles.cardTitle}>Expense Thresholds (SAR)</div>
            <div style={styles.cardSub}>Set the amounts that route an expense to auto / PM / Finance / CEO.</div>
          </div>
        </div>
        <div style={styles.fieldRow}>
          <div>
            <div style={styles.fieldLabel}>Auto-approve below</div>
            <div style={styles.fieldHint}>Communication-category expenses under this amount are approved automatically.</div>
          </div>
          <input type="number" min="0" style={styles.input}
            value={config.expense_thresholds.auto_approve_under_sar}
            onChange={e => updateExpense('auto_approve_under_sar', e.target.value)} />
        </div>
        <div style={styles.fieldRow}>
          <div>
            <div style={styles.fieldLabel}>PM approves up to</div>
            <div style={styles.fieldHint}>Expenses below this amount go to the project's PM (CEO if no PM assigned).</div>
          </div>
          <input type="number" min="0" style={styles.input}
            value={config.expense_thresholds.pm_max_sar}
            onChange={e => updateExpense('pm_max_sar', e.target.value)} />
        </div>
        <div style={styles.fieldRowLast}>
          <div>
            <div style={styles.fieldLabel}>Finance approves up to</div>
            <div style={styles.fieldHint}>Above this amount, the request escalates to the CEO.</div>
          </div>
          <input type="number" min="0" style={styles.input}
            value={config.expense_thresholds.finance_max_sar}
            onChange={e => updateExpense('finance_max_sar', e.target.value)} />
        </div>
      </div>

      {/* Leave approval rules */}
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <div style={{ ...styles.cardIcon, background: 'rgba(243,156,18,0.12)', color: '#F39C12' }}><Calendar size={18} /></div>
          <div>
            <div style={styles.cardTitle}>Leave Rules</div>
            <div style={styles.cardSub}>Which leave types must reach the CEO, and when HR also reviews.</div>
          </div>
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={styles.fieldLabel}>Leave types that require CEO approval</div>
          <div style={{ ...styles.fieldHint, marginBottom: 10 }}>
            All other types route to Client PM → Datalake PM (deployed engineers) or HR (internal staff).
          </div>
          <div style={styles.checkboxList}>
            {ALL_LEAVE_TYPES.map(lt => {
              const checked = (config.leave_ceo_required_types || []).map(s => s.toLowerCase()).includes(lt.id)
              return (
                <label key={lt.id} style={{ ...styles.checkboxLabel, background: checked ? 'rgba(21,152,204,0.06)' : '#fff', borderColor: checked ? '#1598CC' : 'var(--border-primary, #E5E7EB)' }}>
                  <input type="checkbox" checked={checked} onChange={() => toggleLeaveCeo(lt.id)} />
                  {lt.label}
                </label>
              )
            })}
          </div>
        </div>
        <div style={styles.fieldRow}>
          <div>
            <div style={styles.fieldLabel}>HR escalation threshold (days)</div>
            <div style={styles.fieldHint}>Leave longer than this also routes through HR after the PM approves.</div>
          </div>
          <input type="number" min="0" style={styles.input}
            value={config.leave_hr_threshold_days}
            onChange={e => setConfig(c => ({ ...c, leave_hr_threshold_days: emptyToZero(e.target.value) }))} />
        </div>
        <div style={styles.fieldRowLast}>
          <div>
            <div style={styles.fieldLabel}>Sick auto-approve up to (days)</div>
            <div style={styles.fieldHint}>Sick leave at or below this length is approved automatically; PM + HR are notified.</div>
          </div>
          <input type="number" min="0" style={styles.input}
            value={config.sick_auto_approve_max_days}
            onChange={e => setConfig(c => ({ ...c, sick_auto_approve_max_days: emptyToZero(e.target.value) }))} />
        </div>
      </div>

      {/* Ticket routing */}
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <div style={{ ...styles.cardIcon, background: 'rgba(21,152,204,0.12)', color: '#1598CC' }}><LifeBuoy size={18} /></div>
          <div>
            <div style={styles.cardTitle}>Ticket Routing</div>
            <div style={styles.cardSub}>Which team owns each support category by default.</div>
          </div>
        </div>
        {TICKET_CATEGORIES.map((cat, i) => {
          const last = i === TICKET_CATEGORIES.length - 1
          return (
            <div key={cat} style={last ? styles.fieldRowLast : styles.fieldRow}>
              <div style={styles.fieldLabel}>{cat}</div>
              <select
                style={styles.input}
                value={config.ticket_routing[cat] || 'hr'}
                onChange={e => updateTicket(cat, e.target.value)}
              >
                {ASSIGNEE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          )
        })}
      </div>

      {/* Save bar */}
      <div style={styles.saveBar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <ScrollText size={15} color="var(--text-tertiary)" />
          <span style={{ fontSize: '0.82rem', color: 'var(--text-tertiary)' }}>
            Saved to <code>approval_routing/config</code>. Forms read this on every submit.
          </span>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {feedback.kind === 'success' && <span style={styles.msgSuccess}><CheckCircle2 size={14} /> {feedback.text}</span>}
          {feedback.kind === 'error'   && <span style={styles.msgError}><AlertCircle size={14} /> {feedback.text}</span>}
          <button className="btn btn-ghost" onClick={resetDefaults} disabled={saving}>
            <RotateCcw size={14} /> Reset to defaults
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? <Loader size={14} className="spin" /> : <Save size={14} />}
            {saving ? ' Saving…' : ' Save'}
          </button>
        </div>
      </div>

      <style>{`
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
