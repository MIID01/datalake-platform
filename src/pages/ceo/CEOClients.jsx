import { useEffect, useMemo, useState } from 'react'
import {
  collection, onSnapshot, addDoc, doc, updateDoc, serverTimestamp, query, orderBy,
} from 'firebase/firestore'
import { db, auth } from '../../lib/firebase'
import { softDelete, notDeleted } from '../../lib/soft-delete'
import {
  Users, Plus, Search, X, Edit2, Trash2, Save, AlertTriangle, Loader, CheckCircle2,
  Building2, Mail, Phone, FileText, BarChart3,
} from 'lucide-react'

// Single source of truth for client metadata. Every invoice, timesheet
// "Bill To" line, and CEO-facing client surface reads from this collection.
// Adding a client here makes them available to /ceo/projects (NewProjectModal
// uses a SearchablePicker over the same collection) which in turn cascades
// into engineer_project_assignments and the timesheet/invoice flows.

const FIELD_SPECS = [
  { key: 'client_name',     label: 'Client Name (English)',  type: 'text', required: true, placeholder: 'Acme Corporation Ltd.' },
  { key: 'client_name_ar',  label: 'Client Name (Arabic)',   type: 'text', placeholder: 'شركة أكمي' },
  { key: 'contact_email',   label: 'Primary Contact Email',  type: 'email', placeholder: 'finance@client.com' },
  { key: 'contact_phone',   label: 'Primary Contact Phone',  type: 'tel',   placeholder: '+966 5x xxx xxxx' },
  { key: 'address',         label: 'Address',                type: 'text',  placeholder: 'Riyadh, KSA' },
  { key: 'vat_number',      label: 'VAT Number',             type: 'text',  placeholder: '3xxxxxxxxxxxx03' },
  { key: 'industry',        label: 'Industry',               type: 'text',  placeholder: 'Finance / Energy / Telecom / …' },
]

const STATUS_OPTIONS = [
  { value: 'ACTIVE',    label: 'Active' },
  { value: 'INACTIVE',  label: 'Inactive' },
  { value: 'PROSPECT',  label: 'Prospect' },
]

const SAR = (n) => 'SAR ' + Math.round(Number(n) || 0).toLocaleString()

const s = {
  page:  { padding: '32px 24px', maxWidth: 1200, margin: '0 auto' },
  h1:    { fontSize: '1.5rem', fontWeight: 700, color: '#fff', margin: 0 },
  sub:   { color: 'rgba(255,255,255,0.55)', fontSize: '0.85rem', marginTop: 4 },
  card:  { background: 'rgba(2,40,115,0.4)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 20, backdropFilter: 'blur(12px)' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' },
  th:    { textAlign: 'left', padding: '10px 12px', color: 'rgba(255,255,255,0.55)', fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.08)' },
  td:    { padding: '12px 12px', color: 'rgba(255,255,255,0.85)', borderBottom: '1px solid rgba(255,255,255,0.06)' },
  input: { width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.25)', color: '#fff', fontSize: '0.86rem', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' },
  label: { display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 5 },
  btnPrimary: { padding: '9px 18px', borderRadius: 8, border: 'none', background: '#EF5829', color: '#fff', fontSize: '0.85rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 },
  btnGhost:   { padding: '7px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: 'rgba(255,255,255,0.85)', fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 },
  btnDanger:  { padding: '7px 12px', borderRadius: 8, border: '1px solid rgba(192,57,43,0.3)', background: 'rgba(192,57,43,0.15)', color: '#fca5a5', fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 },
  modal: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 },
  modalCard: { background: '#0f1d36', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 14, maxWidth: 640, width: '100%', maxHeight: 'calc(100vh - 40px)', overflowY: 'auto', color: '#fff' },
  badgeActive:   { padding: '3px 10px', borderRadius: 999, fontSize: '0.72rem', fontWeight: 700, background: 'rgba(52,191,58,0.15)', color: '#4ade80' },
  badgeInactive: { padding: '3px 10px', borderRadius: 999, fontSize: '0.72rem', fontWeight: 700, background: 'rgba(148,163,184,0.18)', color: '#94a3b8' },
  badgeProspect: { padding: '3px 10px', borderRadius: 999, fontSize: '0.72rem', fontWeight: 700, background: 'rgba(243,156,18,0.18)', color: '#fbbf24' },
}

function badgeForStatus(st) {
  return st === 'INACTIVE' ? s.badgeInactive
       : st === 'PROSPECT' ? s.badgeProspect
       : s.badgeActive
}

export default function CEOClients() {
  const [clients, setClients] = useState([])
  const [projects, setProjects] = useState([])
  const [assignments, setAssignments] = useState([])
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [editClient, setEditClient] = useState(null)
  const [toast, setToast] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const unsubs = []
    unsubs.push(onSnapshot(query(collection(db, 'clients'), orderBy('client_name')),
      snap => { setClients(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(notDeleted)); setLoading(false) },
      err => { setError(err.message); setLoading(false) },
    ))
    unsubs.push(onSnapshot(collection(db, 'projects'),
      snap => setProjects(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      () => {},
    ))
    unsubs.push(onSnapshot(collection(db, 'engineer_project_assignments'),
      snap => setAssignments(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      () => {},
    ))
    unsubs.push(onSnapshot(collection(db, 'invoices'),
      snap => setInvoices(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      () => {},
    ))
    return () => unsubs.forEach(u => u())
  }, [])

  // Per-client stats — counted from authoritative collections, not stored on
  // the client doc (which would drift). Match projects by client_id first,
  // fall back to client_name for historical rows that pre-date the
  // client_id stamp.
  const statsFor = useMemo(() => {
    const monthStart = new Date().toISOString().slice(0, 7) // YYYY-MM
    const cache = new Map()
    for (const c of clients) {
      const myProjects = projects.filter(p =>
        (p.client_id && p.client_id === c.id) ||
        (!p.client_id && p.client_name && c.client_name && p.client_name === c.client_name)
      )
      const projectIds = new Set(myProjects.map(p => p.id))
      const projectNames = new Set(myProjects.map(p => p.project_name).filter(Boolean))
      const engineers = new Set(
        assignments
          .filter(a =>
            (a.status || 'ACTIVE') === 'ACTIVE' &&
            (projectIds.has(a.project_id) || projectNames.has(a.project_name))
          )
          .map(a => a.engineer_email || a.engineer_id)
          .filter(Boolean)
      )
      const revenueMtd = invoices
        .filter(inv => inv.client_id === c.id || inv.client_name === c.client_name)
        .filter(inv => {
          if (inv.status !== 'PAID') return false
          const d = inv.created_at?.toDate ? inv.created_at.toDate().toISOString().slice(0, 7)
                  : inv.date ? String(inv.date).slice(0, 7)
                  : null
          return d === monthStart
        })
        .reduce((sum, inv) => sum + (Number(inv.total) || 0), 0)
      cache.set(c.id, { projects: myProjects.length, engineers: engineers.size, revenueMtd })
    }
    return cache
  }, [clients, projects, assignments, invoices])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return clients
    return clients.filter(c =>
      String(c.client_name || '').toLowerCase().includes(q) ||
      String(c.client_name_ar || '').toLowerCase().includes(q) ||
      String(c.contact_email || '').toLowerCase().includes(q) ||
      String(c.industry || '').toLowerCase().includes(q)
    )
  }, [clients, search])

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3500) }

  return (
    <div style={s.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 14, marginBottom: 20 }}>
        <div>
          <h1 style={s.h1}>Clients</h1>
          <p style={s.sub}>
            Single source of truth for client metadata. Used by projects, invoices,
            and the timesheet billing fields. Edit a client's address here and the
            next invoice picks it up automatically.
          </p>
        </div>
        <button style={s.btnPrimary} onClick={() => setShowAdd(true)}>
          <Plus size={14} /> Add Client
        </button>
      </div>

      {/* Search */}
      <div style={{ position: 'relative', marginBottom: 18 }}>
        <Search size={14} style={{ position: 'absolute', left: 12, top: 11, color: 'rgba(255,255,255,0.45)' }} />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, Arabic name, email, or industry…"
          style={{ ...s.input, padding: '9px 12px 9px 34px' }}
        />
        {search && (
          <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 8, top: 7, background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.55)', cursor: 'pointer', padding: 4 }}>
            <X size={14} />
          </button>
        )}
      </div>

      {error && (
        <div style={{ padding: '10px 14px', background: 'rgba(192,57,43,0.12)', border: '1px solid rgba(192,57,43,0.3)', borderRadius: 8, color: '#fca5a5', fontSize: '0.82rem', marginBottom: 16 }}>
          <AlertTriangle size={14} style={{ verticalAlign: -2, marginRight: 6 }} /> {error}
        </div>
      )}

      <div style={s.card}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.55)' }}>
            <Loader size={20} className="spin" /> Loading clients…
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.55)' }}>
            <Building2 size={32} style={{ opacity: 0.4 }} />
            <div style={{ marginTop: 10, fontWeight: 600 }}>
              {clients.length === 0 ? 'No clients yet.' : `No clients match "${search}".`}
            </div>
            {clients.length === 0 && (
              <div style={{ marginTop: 4, fontSize: '0.82rem' }}>Click "Add Client" to create the first one.</div>
            )}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>Client</th>
                  <th style={s.th}>Industry</th>
                  <th style={s.th}>Contact</th>
                  <th style={s.th}>Projects</th>
                  <th style={s.th}>Engineers</th>
                  <th style={s.th}>Revenue (MTD)</th>
                  <th style={s.th}>Status</th>
                  <th style={s.th}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => {
                  const stats = statsFor.get(c.id) || { projects: 0, engineers: 0, revenueMtd: 0 }
                  return (
                    <tr key={c.id}>
                      <td style={s.td}>
                        <div style={{ fontWeight: 700 }}>{c.client_name || '—'}</div>
                        {c.client_name_ar && <div style={{ fontSize: '0.74rem', color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>{c.client_name_ar}</div>}
                      </td>
                      <td style={{ ...s.td, color: 'rgba(255,255,255,0.7)' }}>{c.industry || '—'}</td>
                      <td style={s.td}>
                        <div style={{ fontSize: '0.78rem' }}>{c.contact_email || '—'}</div>
                        {c.contact_phone && <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.55)' }}>{c.contact_phone}</div>}
                      </td>
                      <td style={{ ...s.td, textAlign: 'center', fontWeight: 700 }}>{stats.projects}</td>
                      <td style={{ ...s.td, textAlign: 'center', fontWeight: 700 }}>{stats.engineers}</td>
                      <td style={{ ...s.td, fontFamily: "'JetBrains Mono', monospace" }}>{SAR(stats.revenueMtd)}</td>
                      <td style={s.td}><span style={badgeForStatus(c.status)}>{c.status || 'ACTIVE'}</span></td>
                      <td style={s.td}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <button style={s.btnGhost} onClick={() => setEditClient(c)}>
                            <Edit2 size={12} /> Edit
                          </button>
                          <button
                            style={s.btnDanger}
                            onClick={async () => {
                              if (stats.projects > 0) {
                                alert(`Cannot delete "${c.client_name}" — ${stats.projects} project(s) reference this client. Move or close the projects first.`)
                                return
                              }
                              if (window.confirm(`Delete "${c.client_name}"?\n\nIt moves to the Recycle Bin and can be restored by an admin — not permanently deleted.`)) {
                                try { await softDelete('clients', c.id); showToast(`Client "${c.client_name}" moved to Recycle Bin`) }
                                catch (e) { setError(e.message) }
                              }
                            }}
                          >
                            <Trash2 size={12} /> Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {(showAdd || editClient) && (
        <ClientFormModal
          initial={editClient}
          onClose={() => { setShowAdd(false); setEditClient(null) }}
          onSaved={(name, mode) => {
            showToast(`Client "${name}" ${mode === 'add' ? 'created' : 'updated'}`)
            setShowAdd(false); setEditClient(null)
          }}
          onError={setError}
        />
      )}

      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 1100,
          padding: '12px 18px', borderRadius: 10, background: 'rgba(52,191,58,0.95)', color: '#fff',
          fontSize: '0.85rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8,
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
        }}>
          <CheckCircle2 size={15} /> {toast}
        </div>
      )}

      <style>{`
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────
// ClientFormModal — add or edit, same form
// ───────────────────────────────────────────────────────────────────
function ClientFormModal({ initial, onClose, onSaved, onError }) {
  const mode = initial ? 'edit' : 'add'
  const [form, setForm] = useState(() => {
    const seed = {}
    for (const f of FIELD_SPECS) seed[f.key] = initial?.[f.key] || ''
    seed.status = initial?.status || 'ACTIVE'
    return seed
  })
  const [saving, setSaving] = useState(false)
  const [localError, setLocalError] = useState('')

  const setField = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const handleSave = async () => {
    setLocalError('')
    if (!form.client_name.trim()) { setLocalError('Client name is required.'); return }
    setSaving(true)
    try {
      const me = auth.currentUser
      const by = me?.displayName || me?.email || 'unknown'
      const patch = { ...form, client_name: form.client_name.trim(), updated_at: serverTimestamp(), updated_by: by }
      if (mode === 'edit') {
        await updateDoc(doc(db, 'clients', initial.id), patch)
      } else {
        await addDoc(collection(db, 'clients'), {
          ...patch,
          created_at: serverTimestamp(),
          created_by: by,
        })
      }
      onSaved(patch.client_name, mode)
    } catch (e) {
      setLocalError(e.message)
      onError?.(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={s.modal} onClick={onClose}>
      <div style={s.modalCard} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Building2 size={18} color="#38bdf8" />
            <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>{mode === 'add' ? 'Add Client' : `Edit Client — ${initial.client_name}`}</h2>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.55)', cursor: 'pointer' }}><X size={18} /></button>
        </div>
        <div style={{ padding: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
            {FIELD_SPECS.map(f => (
              <div key={f.key}>
                <label style={s.label}>{f.label}{f.required && <span style={{ color: '#fca5a5', marginLeft: 4 }}>*</span>}</label>
                <input
                  type={f.type}
                  style={s.input}
                  value={form[f.key]}
                  placeholder={f.placeholder}
                  onChange={e => setField(f.key, e.target.value)}
                />
              </div>
            ))}
            <div>
              <label style={s.label}>Status</label>
              <select style={s.input} value={form.status} onChange={e => setField('status', e.target.value)}>
                {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value} style={{ background: '#1a2744' }}>{o.label}</option>)}
              </select>
            </div>
          </div>

          {localError && (
            <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, background: 'rgba(192,57,43,0.12)', border: '1px solid rgba(192,57,43,0.3)', color: '#fca5a5', fontSize: '0.82rem' }}>
              <AlertTriangle size={13} style={{ verticalAlign: -2, marginRight: 6 }} /> {localError}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
            <button style={s.btnGhost} onClick={onClose} disabled={saving}>Cancel</button>
            <button style={s.btnPrimary} onClick={handleSave} disabled={saving}>
              {saving ? <Loader size={13} className="spin" /> : <Save size={13} />}
              {saving ? ' Saving…' : mode === 'add' ? ' Create Client' : ' Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
