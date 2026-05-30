import { useState, useEffect, useMemo } from 'react'
import {
  collection, collectionGroup, onSnapshot, addDoc, deleteDoc, doc, serverTimestamp, query, orderBy,
} from 'firebase/firestore'
import { db, auth } from '../../lib/firebase'
import { CheckCircle, XCircle, Plus, X, Trash2, AlertTriangle, Loader, GraduationCap } from 'lucide-react'

// Reads training_modules dynamically (no hardcoded list). For each module +
// employee combo, we mark COMPLETE when:
//   - training_completions has a row with status COMPLETED, OR
//   - the employee has an onboarding_evidence row whose policy_id matches the
//     module's onboarding_policy_id (the 4 onboarding policies double as
//     "compliance-acknowledged" training modules, so we don't show fake gaps).

const MODULE_CATEGORIES = ['compliance', 'security', 'hr', 'product', 'role-specific']

export default function CEOTraining() {
  const [modules, setModules] = useState([])
  const [completions, setCompletions] = useState([])
  const [onboardingAcks, setOnboardingAcks] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState(null)
  const [toast, setToast] = useState(null)

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, 'training_modules'), orderBy('created_at', 'desc')),
      snap => setModules(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      err => setError('Modules: ' + err.message))
    return () => unsub()
  }, [])

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'training_completions'),
      snap => setCompletions(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      err => setError('Completions: ' + err.message))
    return () => unsub()
  }, [])

  useEffect(() => {
    const unsub = onSnapshot(collectionGroup(db, 'onboarding_evidence'),
      snap => setOnboardingAcks(snap.docs.map(d => ({
        id: d.id,
        employee_id: d.ref.parent.parent?.id || '',
        ...d.data(),
      }))),
      err => console.warn('onboarding_evidence:', err.message))
    return () => unsub()
  }, [])

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3500) }

  // Build per-employee completion map keyed by module_id
  const byEmployee = useMemo(() => {
    const acc = {}
    completions.forEach(c => {
      if (c.status !== 'COMPLETED') return
      const key = c.engineer_email || c.employee_id || 'unknown'
      acc[key] = acc[key] || { name: c.engineer_name || c.employee_name || key, email: c.engineer_email, modules: new Set() }
      acc[key].modules.add(c.module_id)
    })
    onboardingAcks.forEach(a => {
      if (!a.policy_id || !a.employee_email) return
      const matched = modules.find(m => m.onboarding_policy_id === a.policy_id)
      if (!matched) return
      const key = a.employee_email
      acc[key] = acc[key] || { name: a.employee_name || key, email: key, modules: new Set() }
      acc[key].modules.add(matched.module_id || matched.id)
    })
    return acc
  }, [completions, onboardingAcks, modules])

  const createModule = async (form) => {
    setCreating(true); setError(null)
    try {
      const moduleId = (form.module_id || form.title).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
      await addDoc(collection(db, 'training_modules'), {
        module_id: moduleId,
        title: form.title,
        category: form.category,
        description: form.description || '',
        assignment_scope: form.assignment_scope || 'all',
        assignment_role: form.assignment_role || null,
        onboarding_policy_id: form.onboarding_policy_id || null,
        content_url: form.content_url || '',
        content_html: form.content_html || '',
        is_mandatory: form.is_mandatory !== false,
        created_at: serverTimestamp(),
        created_by: auth.currentUser?.email || 'unknown',
      })
      showToast(`Module "${form.title}" created`)
      setShowCreate(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setCreating(false)
    }
  }

  const deleteModule = async (m) => {
    if (!window.confirm(`Delete module "${m.title}"? Completions stay in audit log.`)) return
    try {
      await deleteDoc(doc(db, 'training_modules', m.id))
      showToast('Module deleted')
    } catch (err) {
      setError(err.message)
    }
  }

  const totalEmployees = Object.keys(byEmployee).length
  const completionRate = (modId) => {
    if (totalEmployees === 0) return 0
    const done = Object.values(byEmployee).filter(e => e.modules.has(modId)).length
    return Math.round((done / totalEmployees) * 100)
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <GraduationCap size={22} color="#022873" />
            Training & Compliance Matrix
          </h1>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-tertiary)', marginTop: 4 }}>
            Modules from <code>training_modules</code>. Onboarding policies auto-count when an employee has acknowledged them.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="write-action"
          style={{ background: '#022873', color: '#fff', padding: '10px 18px', borderRadius: 8, border: 'none', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit' }}
        >
          <Plus size={16} /> Create Module
        </button>
      </div>

      {error && (
        <div style={{ background: 'rgba(192,57,43,0.1)', border: '1px solid rgba(192,57,43,0.3)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, color: '#C0392B', fontSize: '0.84rem', display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        {modules.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-tertiary)' }}>
            No training modules yet. Click "Create Module" to add one.
          </div>
        ) : (
          <table className="data-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Employee</th>
                {modules.map(m => (
                  <th key={m.id} style={{ fontSize: '0.72rem', textAlign: 'center', maxWidth: 110 }} title={m.description}>
                    {m.title}<br/>
                    <span style={{ fontSize: '0.62rem', color: 'var(--text-tertiary)', fontWeight: 400 }}>{completionRate(m.module_id || m.id)}%</span>
                  </th>
                ))}
                <th style={{ textAlign: 'center' }}>Compliance</th>
              </tr>
            </thead>
            <tbody>
              {Object.values(byEmployee).map(emp => {
                const done = modules.filter(m => emp.modules.has(m.module_id || m.id)).length
                const pct = modules.length === 0 ? 0 : Math.round((done / modules.length) * 100)
                return (
                  <tr key={emp.email}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{emp.name}</div>
                      <div style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)' }}>{emp.email}</div>
                    </td>
                    {modules.map(m => (
                      <td key={m.id} style={{ textAlign: 'center' }}>
                        {emp.modules.has(m.module_id || m.id)
                          ? <CheckCircle size={18} color="#34BF3A" />
                          : <XCircle size={18} color="#C0392B" />}
                      </td>
                    ))}
                    <td style={{ fontWeight: 700, textAlign: 'center', color: pct === 100 ? '#34BF3A' : pct > 50 ? '#F39C12' : '#C0392B' }}>
                      {pct}%
                    </td>
                  </tr>
                )
              })}
              {Object.keys(byEmployee).length === 0 && (
                <tr><td colSpan={modules.length + 2} style={{ textAlign: 'center', padding: 48, color: 'var(--text-tertiary)' }}>No completions yet — employees see modules at /employee/training.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {modules.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: 12 }}>Module library</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {modules.map(m => (
              <div key={m.id} className="card" style={{ padding: 16, border: '1px solid var(--border-primary, #E5E7EB)', borderRadius: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                  <div>
                    <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>{m.title}</div>
                    <div style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)', marginTop: 2 }}>
                      {m.category || 'general'} · {m.assignment_scope || 'all'} · {m.is_mandatory ? 'Mandatory' : 'Optional'}
                    </div>
                  </div>
                  <button onClick={() => deleteModule(m)} className="write-action" title="Delete" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#C0392B', padding: 4 }}>
                    <Trash2 size={14} />
                  </button>
                </div>
                {m.description && <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: 8, lineHeight: 1.4 }}>{m.description}</p>}
                {m.onboarding_policy_id && (
                  <div style={{ marginTop: 8, fontSize: '0.72rem', color: '#022873', background: 'rgba(2,40,115,0.06)', padding: '4px 8px', borderRadius: 4, display: 'inline-block' }}>
                    Linked to onboarding policy: {m.onboarding_policy_id}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {showCreate && (
        <CreateModuleModal onClose={() => setShowCreate(false)} onCreate={createModule} creating={creating} />
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, padding: '12px 18px', borderRadius: 8, background: '#34BF3A', color: '#fff', fontWeight: 600, fontSize: '0.86rem', boxShadow: '0 8px 24px rgba(52,191,58,0.4)' }}>
          {toast}
        </div>
      )}
    </div>
  )
}

function CreateModuleModal({ onClose, onCreate, creating }) {
  const [form, setForm] = useState({
    title: '', module_id: '', category: 'compliance', description: '',
    assignment_scope: 'all', assignment_role: '', onboarding_policy_id: '',
    content_url: '', is_mandatory: true,
  })
  const u = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const valid = form.title.trim() && form.category

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-surface, #fff)', borderRadius: 12, padding: 24, width: 500, maxWidth: '100%', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>Create training module</h3>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}><X size={18} /></button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Title *">
            <input value={form.title} onChange={e => u('title', e.target.value)} placeholder="PDPL Awareness 2026" style={inp()} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Module ID (optional)">
              <input value={form.module_id} onChange={e => u('module_id', e.target.value)} placeholder="auto-derived from title" style={inp()} />
            </Field>
            <Field label="Category">
              <select value={form.category} onChange={e => u('category', e.target.value)} style={inp()}>
                {MODULE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Description">
            <textarea value={form.description} onChange={e => u('description', e.target.value)} rows={3} placeholder="What this module covers and who must take it." style={{ ...inp(), resize: 'vertical' }} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Assign to">
              <select value={form.assignment_scope} onChange={e => u('assignment_scope', e.target.value)} style={inp()}>
                <option value="all">All employees</option>
                <option value="role">Specific role</option>
              </select>
            </Field>
            {form.assignment_scope === 'role' && (
              <Field label="Role">
                <select value={form.assignment_role} onChange={e => u('assignment_role', e.target.value)} style={inp()}>
                  <option value="">— pick —</option>
                  <option value="employee">Employee</option>
                  <option value="hr">HR</option>
                  <option value="finance">Finance</option>
                  <option value="it_admin">IT Admin</option>
                </select>
              </Field>
            )}
          </div>
          <Field label="Linked onboarding policy ID (optional)">
            <input value={form.onboarding_policy_id} onChange={e => u('onboarding_policy_id', e.target.value)} placeholder="pdpl_consent / code_of_conduct / it_acceptable_use / contract" style={inp()} />
          </Field>
          <Field label="Content URL (optional)">
            <input value={form.content_url} onChange={e => u('content_url', e.target.value)} placeholder="https://… link to slides / video / PDF" style={inp()} />
          </Field>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.86rem' }}>
            <input type="checkbox" checked={form.is_mandatory} onChange={e => u('is_mandatory', e.target.checked)} />
            Mandatory (must be completed before access is granted)
          </label>
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 22 }}>
          <button onClick={onClose} style={{ padding: '9px 16px', borderRadius: 6, border: '1px solid var(--border-primary, #E5E7EB)', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
          <button onClick={() => onCreate(form)} disabled={!valid || creating} style={{ padding: '9px 18px', borderRadius: 6, border: 'none', background: !valid || creating ? '#94a3b8' : '#022873', color: '#fff', cursor: !valid || creating ? 'not-allowed' : 'pointer', fontWeight: 700, fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {creating && <Loader size={14} className="spin" />} Create
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label style={{ fontSize: '0.74rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  )
}
function inp() {
  return { width: '100%', padding: '9px 12px', borderRadius: 6, border: '1px solid var(--border-primary, #E5E7EB)', background: 'var(--bg-surface, #fff)', color: 'var(--text-primary)', fontSize: '0.88rem', fontFamily: 'inherit', boxSizing: 'border-box' }
}
