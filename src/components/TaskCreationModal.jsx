import { useState } from 'react'
import { X, ChevronDown, ChevronUp, Loader, Plus } from 'lucide-react'
import { auth, CREATE_TASK_URL } from '../lib/firebase'

const TASK_TYPES = [
  { value: 'ACKNOWLEDGE', label: 'Acknowledge' },
  { value: 'SUBMIT_EVIDENCE', label: 'Submit Evidence' },
  { value: 'APPROVE_REJECT', label: 'Approve / Reject' },
  { value: 'SIGN', label: 'Sign' },
  { value: 'COMPLETE_FORM', label: 'Complete Form' },
  { value: 'ESCALATION', label: 'Escalation' },
  { value: 'INFORMATION', label: 'Information' },
]

const ROLES = ['CEO', 'CTO', 'ENGINEER', 'HR_AGENT', 'FINANCE_AGENT', 'SALES', 'PM', 'AI_AGENT', 'ANY_ACTIVE_USER']

const USERS = [
  { id: 'ceo', label: 'CEO — Mohammed Al-Qumri' },
  { id: 'cto', label: 'CTO (Deferred)' },
]

const PRIORITIES = [
  { value: 'CRITICAL', label: 'Critical', color: '#C0392B' },
  { value: 'HIGH', label: 'High', color: '#EF5829' },
  { value: 'NORMAL', label: 'Normal', color: '#1598CC' },
  { value: 'LOW', label: 'Low', color: '#8898aa' },
  { value: 'INFO', label: 'Info', color: '#bbb' },
]

const ESCALATION_TYPES = [
  { value: 'HARD_DEADLINE', label: 'Hard Deadline', desc: 'Task goes overdue, CEO alerted' },
  { value: 'AUTO_ESCALATION', label: 'Auto-Escalation', desc: 'Overdue spawns new task for supervisor' },
  { value: 'COMPLIANCE_GATE', label: 'Compliance Gate', desc: 'Non-completion triggers enforcement — blocks access/payroll' },
]

const LOCATIONS = [
  'Datalake Office (Riyadh HQ)', 'Client Main Office', 'Client HQ', 'Hybrid',
  'Remote — KSA', 'Remote — International', 'Specific Address', 'Virtual / Online',
]

const COMPLIANCE_TAGS = ['NONE', 'PDPL', 'SAMA', 'NCA', 'MHRSD', 'ZATCA']
const RECURRENCE = ['ONE_TIME', 'DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL']

const s = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 },
  modal: { background: 'var(--bg-card, #fff)', border: '1px solid var(--border-card, #e0e0e0)', borderRadius: 16, width: '100%', maxWidth: 720, maxHeight: '90vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' },
  header: { padding: '20px 28px', borderBottom: '1px solid var(--border-primary, #e5e7eb)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, background: 'var(--bg-card, #fff)', zIndex: 2, borderRadius: '16px 16px 0 0' },
  body: { padding: '24px 28px' },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary, #8898aa)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 },
  label: { fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary, #1A1A2E)', marginBottom: 6, display: 'block' },
  input: { width: '100%', padding: '10px 14px', border: '1px solid var(--border-primary, #E5E7EB)', borderRadius: 8, fontSize: '0.88rem', fontFamily: 'inherit', outline: 'none', color: 'var(--text-primary, #1A1A2E)', background: 'var(--bg-surface, #f4f6f9)', transition: 'border-color 0.2s', boxSizing: 'border-box' },
  select: { width: '100%', padding: '10px 14px', border: '1px solid var(--border-primary, #E5E7EB)', borderRadius: 8, fontSize: '0.88rem', fontFamily: 'inherit', outline: 'none', color: 'var(--text-primary, #1A1A2E)', background: 'var(--bg-surface, #f4f6f9)', appearance: 'none', cursor: 'pointer', boxSizing: 'border-box' },
  textarea: { width: '100%', padding: '10px 14px', border: '1px solid var(--border-primary, #E5E7EB)', borderRadius: 8, fontSize: '0.88rem', fontFamily: 'inherit', outline: 'none', color: 'var(--text-primary, #1A1A2E)', background: 'var(--bg-surface, #f4f6f9)', minHeight: 80, resize: 'vertical', boxSizing: 'border-box' },
  row2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 },
  radioGroup: { display: 'flex', gap: 8, flexWrap: 'wrap' },
}

export default function TaskCreationModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    title: '', description: '', assigned_to_type: 'ROLE', assigned_to_id: '', assigned_to_role: '',
    task_type: 'APPROVE_REJECT', priority: 'NORMAL', due_at: '', escalation_type: 'HARD_DEADLINE',
    location: '', location_details: '', compliance_tag: 'NONE', recurrence: 'ONE_TIME', notes: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)

  const update = (key, val) => setForm(prev => ({ ...prev, [key]: val }))

  const canSubmit = form.title.trim() && form.description.trim() && form.due_at && form.task_type && form.priority && form.escalation_type &&
    (form.assigned_to_type === 'ALL_ENGINEERS' || form.assigned_to_type === 'ALL_USERS' ||
     (form.assigned_to_type === 'SPECIFIC_USER' && form.assigned_to_id) ||
     (form.assigned_to_type === 'ROLE' && form.assigned_to_role))

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return
    setSubmitting(true)
    setError('')

    try {
      const user = auth.currentUser
      if (!user) { setError('Please sign in again'); setSubmitting(false); return }
      const idToken = await user.getIdToken()

      const payload = {
        title: form.title.trim(),
        description: form.description.trim(),
        assigned_to_type: form.assigned_to_type,
        assigned_to_id: form.assigned_to_type === 'SPECIFIC_USER' ? form.assigned_to_id : null,
        assigned_to_role: form.assigned_to_type === 'ROLE' ? form.assigned_to_role : form.assigned_to_type === 'ALL_ENGINEERS' ? 'ALL_ENGINEERS' : form.assigned_to_type === 'ALL_USERS' ? 'ALL_USERS' : null,
        task_type: form.task_type,
        priority: form.priority,
        due_at: new Date(form.due_at).toISOString(),
        escalation_type: form.escalation_type,
        location: form.location || null,
        location_details: form.location_details || null,
        compliance_tag: form.compliance_tag,
        recurrence: form.recurrence,
        notes: form.notes || null,
      }

      const response = await fetch(CREATE_TASK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify(payload),
      })

      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to create task')

      onCreated?.(data)
      onClose()
    } catch (err) {
      setError(err.message || 'Failed to create task')
    } finally {
      setSubmitting(false)
    }
  }

  const RadioBtn = ({ selected, onClick, color, label }) => (
    <button type="button" onClick={onClick} style={{
      padding: '6px 14px', borderRadius: 8, fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
      border: selected ? `2px solid ${color}` : '1px solid var(--border-primary, #E5E7EB)',
      background: selected ? `${color}18` : 'transparent',
      color: selected ? color : 'var(--text-secondary, #5a6a84)',
      transition: 'all 0.15s', fontFamily: 'inherit',
    }}>{label}</button>
  )

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={s.header}>
          <div>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0, color: 'var(--text-primary, #1A1A2E)' }}>Create New Task</h2>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-tertiary, #8898aa)', marginTop: 2 }}>DTLK-OPS-TSK-001 · Manual Task Creation</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary, #8898aa)', display: 'flex' }}>
            <X size={20} />
          </button>
        </div>

        <div style={s.body}>
          {/* ── Identity ── */}
          <div style={s.section}>
            <div style={s.sectionTitle}><Plus size={14} /> Task Identity</div>
            <div style={{ marginBottom: 14 }}>
              <label style={s.label}>Title *</label>
              <input style={s.input} maxLength={100} placeholder="e.g. Review Q2 Emkan contract renewal" value={form.title} onChange={e => update('title', e.target.value)} />
              <div style={{ fontSize: '0.65rem', color: 'var(--text-tertiary, #8898aa)', textAlign: 'right', marginTop: 2 }}>{form.title.length}/100</div>
            </div>
            <div>
              <label style={s.label}>Description *</label>
              <textarea style={s.textarea} placeholder="Describe what needs to be done..." value={form.description} onChange={e => update('description', e.target.value)} />
            </div>
          </div>

          {/* ── Assignment ── */}
          <div style={s.section}>
            <div style={s.sectionTitle}>👤 Assignment</div>
            <div style={{ marginBottom: 14 }}>
              <label style={s.label}>Assignee Type *</label>
              <div style={s.radioGroup}>
                {[
                  { value: 'SPECIFIC_USER', label: 'Specific User' },
                  { value: 'ROLE', label: 'Role' },
                  { value: 'ALL_ENGINEERS', label: 'All Engineers' },
                  { value: 'ALL_USERS', label: 'All Users' },
                ].map(opt => (
                  <RadioBtn key={opt.value} selected={form.assigned_to_type === opt.value} onClick={() => update('assigned_to_type', opt.value)} color="#022873" label={opt.label} />
                ))}
              </div>
            </div>

            {form.assigned_to_type === 'SPECIFIC_USER' && (
              <div>
                <label style={s.label}>Select User *</label>
                <div style={{ position: 'relative' }}>
                  <select style={s.select} value={form.assigned_to_id} onChange={e => update('assigned_to_id', e.target.value)}>
                    <option value="">Select...</option>
                    {USERS.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}
                  </select>
                  <ChevronDown size={16} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: '#8898aa', pointerEvents: 'none' }} />
                </div>
              </div>
            )}

            {form.assigned_to_type === 'ROLE' && (
              <div>
                <label style={s.label}>Select Role *</label>
                <div style={{ position: 'relative' }}>
                  <select style={s.select} value={form.assigned_to_role} onChange={e => update('assigned_to_role', e.target.value)}>
                    <option value="">Select...</option>
                    {ROLES.map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
                  </select>
                  <ChevronDown size={16} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: '#8898aa', pointerEvents: 'none' }} />
                </div>
              </div>
            )}
          </div>

          {/* ── Task Config ── */}
          <div style={s.section}>
            <div style={s.sectionTitle}>⚡ Task Configuration</div>
            <div style={{ ...s.row2, marginBottom: 14 }}>
              <div>
                <label style={s.label}>Task Type *</label>
                <div style={{ position: 'relative' }}>
                  <select style={s.select} value={form.task_type} onChange={e => update('task_type', e.target.value)}>
                    {TASK_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                  <ChevronDown size={16} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: '#8898aa', pointerEvents: 'none' }} />
                </div>
              </div>
              <div>
                <label style={s.label}>Due Date & Time *</label>
                <input type="datetime-local" style={s.input} value={form.due_at} onChange={e => update('due_at', e.target.value)} />
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={s.label}>Priority *</label>
              <div style={s.radioGroup}>
                {PRIORITIES.map(p => (
                  <RadioBtn key={p.value} selected={form.priority === p.value} onClick={() => update('priority', p.value)} color={p.color} label={p.label} />
                ))}
              </div>
            </div>

            <div>
              <label style={s.label}>Escalation Type *</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {ESCALATION_TYPES.map(e => (
                  <label key={e.value} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px', borderRadius: 8, cursor: 'pointer',
                    border: form.escalation_type === e.value ? '2px solid #022873' : '1px solid var(--border-primary, #E5E7EB)',
                    background: form.escalation_type === e.value ? 'rgba(2,40,115,0.06)' : 'transparent',
                    transition: 'all 0.15s',
                  }} onClick={() => update('escalation_type', e.value)}>
                    <div style={{
                      width: 18, height: 18, borderRadius: '50%', border: form.escalation_type === e.value ? '5px solid #022873' : '2px solid #ccc',
                      flexShrink: 0, marginTop: 1, transition: 'all 0.15s',
                    }} />
                    <div>
                      <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary, #1A1A2E)' }}>{e.label}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary, #8898aa)' }}>{e.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* ── Advanced (collapsible) ── */}
          <div style={s.section}>
            <button type="button" onClick={() => setShowAdvanced(!showAdvanced)} style={{
              display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer',
              fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em',
              color: 'var(--text-tertiary, #8898aa)', fontFamily: 'inherit', padding: 0,
            }}>
              {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              Advanced Options
            </button>

            {showAdvanced && (
              <div style={{ marginTop: 14 }}>
                <div style={{ ...s.row2, marginBottom: 14 }}>
                  <div>
                    <label style={s.label}>Location</label>
                    <div style={{ position: 'relative' }}>
                      <select style={s.select} value={form.location} onChange={e => update('location', e.target.value)}>
                        <option value="">None</option>
                        {LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
                      </select>
                      <ChevronDown size={16} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: '#8898aa', pointerEvents: 'none' }} />
                    </div>
                  </div>
                  <div>
                    <label style={s.label}>Location Details</label>
                    <input style={s.input} placeholder="Specific address or notes" value={form.location_details} onChange={e => update('location_details', e.target.value)} />
                  </div>
                </div>
                <div style={{ ...s.row2, marginBottom: 14 }}>
                  <div>
                    <label style={s.label}>Compliance Tag</label>
                    <div style={{ position: 'relative' }}>
                      <select style={s.select} value={form.compliance_tag} onChange={e => update('compliance_tag', e.target.value)}>
                        {COMPLIANCE_TAGS.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <ChevronDown size={16} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: '#8898aa', pointerEvents: 'none' }} />
                    </div>
                  </div>
                  <div>
                    <label style={s.label}>Recurrence</label>
                    <div style={{ position: 'relative' }}>
                      <select style={s.select} value={form.recurrence} onChange={e => update('recurrence', e.target.value)}>
                        {RECURRENCE.map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
                      </select>
                      <ChevronDown size={16} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: '#8898aa', pointerEvents: 'none' }} />
                    </div>
                  </div>
                </div>
                <div>
                  <label style={s.label}>Notes</label>
                  <textarea style={s.textarea} placeholder="Additional context..." value={form.notes} onChange={e => update('notes', e.target.value)} />
                </div>
              </div>
            )}
          </div>

          {/* ── Error ── */}
          {error && (
            <div style={{ padding: '10px 16px', background: 'rgba(192,57,43,0.1)', border: '1px solid rgba(192,57,43,0.3)', borderRadius: 8, color: '#C0392B', fontSize: '0.82rem', marginBottom: 16 }}>
              {error}
            </div>
          )}

          {/* ── Footer ── */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 8, borderTop: '1px solid var(--border-primary, #e5e7eb)' }}>
            <button onClick={onClose} style={{ padding: '10px 20px', border: '1px solid var(--border-primary, #E5E7EB)', borderRadius: 8, background: 'transparent', color: 'var(--text-secondary, #5a6a84)', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', fontFamily: 'inherit' }}>
              Cancel
            </button>
            <button onClick={handleSubmit} disabled={!canSubmit || submitting} style={{
              padding: '10px 24px', border: 'none', borderRadius: 8,
              background: canSubmit && !submitting ? '#EF5829' : '#ccc',
              color: '#fff', fontWeight: 700, fontSize: '0.85rem', fontFamily: 'inherit',
              cursor: canSubmit && !submitting ? 'pointer' : 'default',
              display: 'flex', alignItems: 'center', gap: 8,
              boxShadow: canSubmit && !submitting ? '0 2px 8px rgba(239,88,41,0.3)' : 'none',
              transition: 'all 0.2s',
            }}>
              {submitting ? <><Loader size={16} className="spin" /> Creating...</> : <><Plus size={16} /> Create Task</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
