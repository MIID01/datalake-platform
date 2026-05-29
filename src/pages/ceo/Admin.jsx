import { useState, useEffect } from 'react'
import { auth, db } from '../../lib/firebase'
import { collection, getDocs, doc, setDoc, updateDoc, deleteDoc, addDoc, query, where, serverTimestamp } from 'firebase/firestore'
import { Link } from 'react-router-dom'
import { Users, Shield, Grid3X3, Plus, X, CheckCircle, Loader, AlertTriangle, ScrollText, Search } from 'lucide-react'

const TABS = [
  { id: 'users', label: 'Users', icon: Users },
  { id: 'roles', label: 'Roles', icon: Shield },
  { id: 'matrix', label: 'Access Matrix', icon: Grid3X3 },
]

const DATA_CLASSES = [
  'admin_config','user_management','role_management','candidate_pii','candidate_anonymous',
  'hr_scoring','project_full','project_filtered','own_timesheet','other_timesheets',
  'client_timesheets','client_billing','engineer_rates','finance_full','audit_log','compliance_documents'
]

// Canonical assignable roles (incl. it_admin). Merged with any custom roles from Firestore.
const CANONICAL_ROLES = [
  { id: 'employee', role_name: 'Employee' },
  { id: 'hr', role_name: 'HR Admin' },
  { id: 'finance', role_name: 'Finance' },
  { id: 'it_admin', role_name: 'IT Admin' },
  { id: 'cto', role_name: 'CTO' },
  { id: 'ceo', role_name: 'CEO' },
  { id: 'client', role_name: 'Client' },
  { id: 'pm', role_name: 'Project Manager' },
]
const CEO_EMAIL = 'm.alqumri@datalake.sa'

const s = {
  page: { padding: '32px 24px', maxWidth: 1200, margin: '0 auto' },
  h1: { fontSize: '1.5rem', fontWeight: 700, color: '#fff', marginBottom: 24 },
  tabs: { display: 'flex', gap: 8, marginBottom: 24 },
  tab: (a) => ({ padding: '10px 20px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 8, background: a ? 'rgba(21,152,204,0.2)' : 'rgba(255,255,255,0.05)', color: a ? '#38bdf8' : 'rgba(255,255,255,0.6)', border: a ? '1px solid rgba(21,152,204,0.3)' : '1px solid transparent', minHeight: 44, transition: 'all 0.2s' }),
  card: { background: 'rgba(2,40,115,0.4)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 24, backdropFilter: 'blur(12px)' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' },
  th: { textAlign: 'left', padding: '10px 12px', color: 'rgba(255,255,255,0.5)', fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.08)' },
  td: { padding: '10px 12px', color: 'rgba(255,255,255,0.85)', borderBottom: '1px solid rgba(255,255,255,0.05)' },
  badge: (c) => ({ padding: '2px 10px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600, background: c === 'active' ? 'rgba(52,191,58,0.15)' : c === 'system' ? 'rgba(21,152,204,0.15)' : 'rgba(148,163,184,0.15)', color: c === 'active' ? '#4ade80' : c === 'system' ? '#38bdf8' : '#94a3b8' }),
  btn: (v) => ({ padding: v === 'sm' ? '6px 14px' : '10px 20px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: v === 'sm' ? '0.75rem' : '0.85rem', background: '#EF5829', color: '#fff', display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 44, transition: 'all 0.2s' }),
  modal: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 },
  modalCard: { background: '#0f1d36', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: '32px 28px', maxWidth: 480, width: '100%' },
  input: { width: '100%', padding: '10px 14px', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, fontSize: '0.9rem', fontFamily: 'inherit', outline: 'none', color: '#fff', background: 'rgba(255,255,255,0.05)', boxSizing: 'border-box', minHeight: 44 },
  select: { width: '100%', padding: '10px 14px', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, fontSize: '0.9rem', fontFamily: 'inherit', outline: 'none', color: '#fff', background: '#1a2744', boxSizing: 'border-box', minHeight: 44 },
  label: { fontSize: '0.78rem', fontWeight: 600, color: 'rgba(255,255,255,0.7)', marginBottom: 6, display: 'block' },
  toast: (show) => ({ position: 'fixed', bottom: 24, right: 24, background: '#059669', color: '#fff', padding: '12px 20px', borderRadius: 10, fontSize: '0.85rem', fontWeight: 600, zIndex: 2000, opacity: show ? 1 : 0, transform: show ? 'translateY(0)' : 'translateY(10px)', transition: 'all 0.3s', display: 'flex', alignItems: 'center', gap: 8 }),
}

async function auditLog(event, details) {
  try {
    await addDoc(collection(db, 'task_audit_log'), {
      event, action_by: auth.currentUser?.email || 'unknown',
      action_at: serverTimestamp(), details,
    })
  } catch (e) { console.warn('Audit log write failed:', e.message) }
}

export default function Admin() {
  const [tab, setTab] = useState('users')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [state, setState] = useState({ users: [], roles: [], access_matrix: {}, clients: [] })
  const [toast, setToast] = useState('')
  const [modal, setModal] = useState(null)
  const [modalData, setModalData] = useState({})
  const [saving, setSaving] = useState(false)
  const [matrixDiffs, setMatrixDiffs] = useState({})
  // Users tab: inline editing + search ─────────────────────────────
  const [userSearch, setUserSearch] = useState('')
  const [roleEdits, setRoleEdits] = useState({})       // { uid: new_role_id }
  const [savingRowId, setSavingRowId] = useState(null) // single-row save spinner

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  const loadState = async () => {
    setLoading(true); setError('')
    try {
      const [usersSnap, rolesSnap, matrixSnap, clientsSnap] = await Promise.all([
        getDocs(collection(db, 'users')),
        getDocs(collection(db, 'roles')),
        getDocs(collection(db, 'access_matrix')),
        getDocs(collection(db, 'clients')),
      ])
      setState({
        users: usersSnap.docs.map(d => ({ id: d.id, ...d.data() })),
        roles: rolesSnap.docs.map(d => ({ id: d.id, ...d.data() })),
        access_matrix: matrixSnap.docs.reduce((acc, d) => { acc[d.id] = d.data(); return acc }, {}),
        clients: clientsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
      })
    } catch (err) { setError(err.message) }
    setLoading(false)
  }

  useEffect(() => { loadState() }, [])

  const handleAddUser = async () => {
    const { email, display_name, role_id, client_id, employee_id } = modalData
    if (!email || !display_name || !role_id) return
    setSaving(true)
    try {
      const uid = email.replace(/[^a-zA-Z0-9]/g, '_')
      await setDoc(doc(db, 'users', uid), {
        uid, email, display_name, role_id, status: 'active',
        employee_id: employee_id || null,
        client_id: client_id || null, assigned_projects: [],
        pdpl_consent_state: 'GRANTED', // Auto-grant for CEO-created users
        created_at: serverTimestamp(), created_by: auth.currentUser?.email,
      })
      await auditLog('USER_CREATED', { target_email: email, role_id })
      showToast(`User ${email} created`)
      setModal(null); setModalData({}); await loadState()
    } catch (err) { setError(err.message) }
    setSaving(false)
  }

  const handleChangeRole = async () => {
    const { uid, new_role_id, client_id } = modalData
    if (!uid || !new_role_id) return
    setSaving(true)
    try {
      const updateData = { role_id: new_role_id }
      if (new_role_id === 'client' && client_id) updateData.client_id = client_id
      if (new_role_id !== 'client') updateData.client_id = null
      await updateDoc(doc(db, 'users', uid), updateData)
      await auditLog('USER_ROLE_CHANGED', { target_uid: uid, new_role: new_role_id })
      showToast('Role updated')
      setModal(null); setModalData({}); await loadState()
    } catch (err) { setError(err.message) }
    setSaving(false)
  }

  const handleToggleDisable = async (uid, currentStatus) => {
    try {
      const newStatus = currentStatus === 'active' ? 'disabled' : 'active'
      await updateDoc(doc(db, 'users', uid), { status: newStatus })
      await auditLog(newStatus === 'disabled' ? 'USER_DISABLED' : 'USER_ENABLED', { target_uid: uid })
      showToast(`User ${newStatus}`)
      await loadState()
    } catch (err) { setError(err.message) }
  }

  const handleCreateRole = async () => {
    const { role_name, description, base_role_id } = modalData
    if (!role_name || !description || !base_role_id) return
    setSaving(true)
    try {
      const slug = role_name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
      const baseMatrix = state.access_matrix[base_role_id]
      await setDoc(doc(db, 'roles', slug), {
        role_id: slug, role_name, role_type: 'custom', description, is_deletable: true,
        created_at: serverTimestamp(), created_by: auth.currentUser?.email,
      })
      await setDoc(doc(db, 'access_matrix', slug), {
        role_id: slug, data_classes: baseMatrix?.data_classes || {},
        last_updated_by: auth.currentUser?.email, last_updated_at: serverTimestamp(),
      })
      await auditLog('ROLE_CREATED', { role_id: slug, role_name, base_role_id })
      showToast(`Role "${role_name}" created`)
      setModal(null); setModalData({}); await loadState()
    } catch (err) { setError(err.message) }
    setSaving(false)
  }

  const handleDeleteRole = async (role_id) => {
    if (!confirm(`Delete role "${role_id}"?`)) return
    const usersWithRole = state.users.filter(u => u.role_id === role_id)
    if (usersWithRole.length > 0) { setError(`Cannot delete: ${usersWithRole.length} user(s) assigned`); return }
    try {
      await deleteDoc(doc(db, 'roles', role_id))
      await deleteDoc(doc(db, 'access_matrix', role_id))
      await auditLog('ROLE_DELETED', { role_id })
      showToast(`Role "${role_id}" deleted`)
      await loadState()
    } catch (err) { setError(err.message) }
  }

  const handleSaveMatrix = async (roleId) => {
    const diff = matrixDiffs[roleId]
    if (!diff || Object.keys(diff).length === 0) return
    setSaving(true)
    try {
      const current = state.access_matrix[roleId]?.data_classes || {}
      const newClasses = { ...current, ...diff }
      await updateDoc(doc(db, 'access_matrix', roleId), {
        data_classes: newClasses,
        last_updated_by: auth.currentUser?.email, last_updated_at: serverTimestamp(),
      })
      await auditLog('ACCESS_MATRIX_UPDATED', { role_id: roleId, changes: diff })
      showToast(`Matrix updated for ${roleId}`)
      setMatrixDiffs(p => { const n = {...p}; delete n[roleId]; return n })
      await loadState()
    } catch (err) { setError(err.message) }
    setSaving(false)
  }

  const getMatrixValue = (roleId, dc) => matrixDiffs[roleId]?.[dc] || state.access_matrix[roleId]?.data_classes?.[dc] || 'hidden'
  const userCountForRole = (roleId) => state.users.filter(u => u.role_id === roleId).length
  // Canonical roles + any custom roles from Firestore (deduped) — guarantees it_admin is assignable.
  const assignableRoles = [
    ...CANONICAL_ROLES,
    ...state.roles.filter(r => !CANONICAL_ROLES.some(c => c.id === r.id)).map(r => ({ id: r.id, role_name: r.role_name })),
  ]

  if (loading) return <div style={{ ...s.page, color: 'rgba(255,255,255,0.6)', textAlign: 'center', paddingTop: 80 }}><Loader size={24} style={{ margin: '0 auto 12px', animation: 'spin 1s linear infinite' }} /><div>Loading RBAC state...</div></div>

  return (
    <div style={s.page}>
      <h1 style={s.h1}>Role Administration</h1>
      <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.82rem', margin: '-12px 0 20px' }}>Assign roles &amp; manage RBAC. Password and credential management lives in the IT Administration portal (segregation of duties).</p>
      <Link to="/ceo/admin/delegation" style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', marginBottom: 20,
        background: 'rgba(21,152,204,0.15)', border: '1px solid rgba(21,152,204,0.35)',
        borderRadius: 8, fontSize: '0.82rem', color: '#7dd3fc', fontWeight: 600, textDecoration: 'none',
      }}>
        <ScrollText size={14} /> Delegation of Authority — expense / leave / ticket routing
      </Link>
      {error && <div style={{ padding: '10px 16px', background: 'rgba(239,88,41,0.15)', border: '1px solid rgba(239,88,41,0.3)', borderRadius: 8, color: '#fb923c', fontSize: '0.82rem', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}><AlertTriangle size={16} />{error}<button onClick={() => setError('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#fb923c', cursor: 'pointer' }}><X size={14} /></button></div>}
      <div style={s.tabs}>{TABS.map(t => <button key={t.id} onClick={() => setTab(t.id)} style={s.tab(tab === t.id)}><t.icon size={16} />{t.label}</button>)}</div>

      {tab === 'users' && <div style={s.card}>
        {(() => {
          const q = userSearch.trim().toLowerCase()
          const filteredUsers = q
            ? state.users.filter(u =>
                String(u.email || '').toLowerCase().includes(q) ||
                String(u.display_name || '').toLowerCase().includes(q) ||
                String(u.role_id || '').toLowerCase().includes(q)
              )
            : state.users
          // Single-row save: writes users/{uid}.role_id directly (handleChangeRole
          // is kept for the legacy modal but we now save inline so the CEO never
          // has to click through a popup just to change a role).
          const saveRoleInline = async (u) => {
            const newRole = roleEdits[u.id]
            if (!newRole || newRole === u.role_id) return
            setSavingRowId(u.id)
            try {
              const patch = { role_id: newRole }
              if (newRole === 'client') {
                // Keep client_id if it was already set; clear otherwise.
                patch.client_id = u.client_id || null
              } else {
                patch.client_id = null
              }
              await updateDoc(doc(db, 'users', u.id), patch)
              await auditLog('USER_ROLE_CHANGED', { target_uid: u.id, new_role: newRole, previous_role: u.role_id })
              showToast(`Role updated → ${newRole}`)
              setRoleEdits(prev => { const next = { ...prev }; delete next[u.id]; return next })
              await loadState()
            } catch (err) {
              setError(err.message)
            } finally {
              setSavingRowId(null)
            }
          }
          return (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 12 }}>
                <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#fff' }}>
                  Users <span style={{ color: 'rgba(255,255,255,0.45)', fontWeight: 500, marginLeft: 6 }}>
                    {q ? `(${filteredUsers.length} of ${state.users.length})` : `(${state.users.length})`}
                  </span>
                </div>
                <button style={s.btn()} onClick={() => { setModal('addUser'); setModalData({ role_id: state.roles[0]?.id || 'engineer' }) }}><Plus size={16} />Add User</button>
              </div>

              {/* Search box — name, email, or role */}
              <div style={{ position: 'relative', marginBottom: 16 }}>
                <Search size={14} style={{ position: 'absolute', left: 12, top: 11, color: 'rgba(255,255,255,0.45)' }} />
                <input
                  value={userSearch}
                  onChange={e => setUserSearch(e.target.value)}
                  placeholder="Search by name, email, or role…"
                  style={{
                    width: '100%', padding: '9px 12px 9px 34px',
                    borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)',
                    background: 'rgba(0,0,0,0.25)', color: '#fff',
                    fontSize: '0.85rem', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
                  }}
                />
                {userSearch && (
                  <button
                    onClick={() => setUserSearch('')}
                    style={{ position: 'absolute', right: 8, top: 7, background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.55)', cursor: 'pointer', padding: 4 }}
                    title="Clear"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.th}>Email</th>
                      <th style={s.th}>Name</th>
                      <th style={s.th}>Role</th>
                      <th style={s.th}>Status</th>
                      <th style={s.th}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.length === 0 && (
                      <tr>
                        <td colSpan={5} style={{ ...s.td, padding: 30, textAlign: 'center', color: 'rgba(255,255,255,0.45)' }}>
                          {q ? `No users match "${userSearch}".` : 'No users yet.'}
                        </td>
                      </tr>
                    )}
                    {filteredUsers.map(u => {
                      const isCeo = u.email === CEO_EMAIL
                      const pendingRole = roleEdits[u.id]
                      const dirtyRole = !!pendingRole && pendingRole !== u.role_id
                      const rowSaving = savingRowId === u.id
                      return (
                        <tr key={u.id}>
                          <td style={{ ...s.td, fontFamily: "'JetBrains Mono', monospace", fontSize: '0.78rem' }}>{u.email}</td>
                          <td style={s.td}>{u.display_name}</td>
                          <td style={s.td}>
                            {/* Inline role dropdown — single click to change, single click to save. */}
                            <select
                              disabled={isCeo || rowSaving}
                              value={pendingRole ?? u.role_id ?? ''}
                              onChange={e => setRoleEdits(prev => ({ ...prev, [u.id]: e.target.value }))}
                              title={isCeo ? 'Segregation of duties — CEO role is locked.' : 'Change role'}
                              style={{
                                padding: '5px 8px', borderRadius: 6,
                                border: dirtyRole ? '1px solid #fbbf24' : '1px solid rgba(255,255,255,0.15)',
                                background: dirtyRole ? 'rgba(251,191,36,0.10)' : 'rgba(255,255,255,0.05)',
                                color: '#fff', fontSize: '0.78rem', fontFamily: 'inherit',
                                cursor: isCeo ? 'not-allowed' : 'pointer',
                              }}
                            >
                              {assignableRoles.map(r => (
                                <option key={r.id} value={r.id} style={{ background: '#1a2744', color: '#fff' }}>{r.role_name} ({r.id})</option>
                              ))}
                            </select>
                          </td>
                          <td style={s.td}><span style={s.badge(u.status)}>{u.status}</span></td>
                          <td style={s.td}>
                            <div style={{ display: 'flex', gap: 6 }}>
                              {dirtyRole && (
                                <button
                                  style={{ ...s.btn('sm'), background: 'rgba(52,191,58,0.18)', color: '#4ade80' }}
                                  disabled={rowSaving}
                                  onClick={() => saveRoleInline(u)}
                                >
                                  {rowSaving ? '…' : 'Save'}
                                </button>
                              )}
                              {dirtyRole && !rowSaving && (
                                <button
                                  style={{ ...s.btn('sm'), background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)' }}
                                  onClick={() => setRoleEdits(prev => { const next = { ...prev }; delete next[u.id]; return next })}
                                >
                                  Cancel
                                </button>
                              )}
                              <button
                                style={{ ...s.btn('sm'), background: u.status === 'active' ? 'rgba(239,88,41,0.15)' : 'rgba(52,191,58,0.15)', color: u.status === 'active' ? '#fb923c' : '#4ade80' }}
                                onClick={() => handleToggleDisable(u.id, u.status)}
                              >
                                {u.status === 'active' ? 'Disable' : 'Enable'}
                              </button>
                              <button
                                style={{ ...s.btn('sm'), background: 'rgba(239,88,41,0.15)', color: '#fb923c' }}
                                onClick={async () => {
                                  if (window.confirm('Delete user from database? This cannot be undone.')) {
                                    try {
                                      await deleteDoc(doc(db, 'users', u.id))
                                      showToast('User deleted')
                                      await loadState()
                                    } catch (e) { setError(e.message) }
                                  }
                                }}
                              >Delete</button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )
        })()}
      </div>}

      {tab === 'roles' && <div style={s.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#fff' }}>Roles ({state.roles.length})</div>
          <button style={s.btn()} onClick={() => { setModal('addRole'); setModalData({ base_role_id: state.roles[0]?.id || 'engineer' }) }}><Plus size={16} />Create Custom Role</button>
        </div>
        <div style={{ overflowX: 'auto' }}><table style={s.table}><thead><tr>
          <th style={s.th}>Role</th><th style={s.th}>Type</th><th style={s.th}>Description</th><th style={s.th}>Users</th><th style={s.th}>Actions</th>
        </tr></thead><tbody>
          {state.roles.map(r => <tr key={r.id}>
            <td style={{...s.td, fontWeight: 600}}>{r.role_name}</td>
            <td style={s.td}><span style={s.badge(r.role_type)}>{r.role_type}</span></td>
            <td style={{...s.td, fontSize: '0.78rem', color: 'rgba(255,255,255,0.5)', maxWidth: 300}}>{r.description}</td>
            <td style={s.td}>{userCountForRole(r.id)}</td>
            <td style={s.td}>{r.is_deletable && <button style={{...s.btn('sm'), background: 'rgba(239,88,41,0.15)', color: '#fb923c'}} onClick={() => handleDeleteRole(r.id)}>Delete</button>}</td>
          </tr>)}
        </tbody></table></div>
      </div>}

      {tab === 'matrix' && <div style={s.card}>
        <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#fff', marginBottom: 16 }}>Access Matrix</div>
        <div style={{ overflowX: 'auto' }}><table style={{...s.table, minWidth: 900}}><thead><tr>
          <th style={{...s.th, position: 'sticky', left: 0, background: 'rgba(2,40,115,0.95)', zIndex: 1}}>Role</th>
          {DATA_CLASSES.map(dc => <th key={dc} style={{...s.th, fontSize: '0.65rem', writingMode: 'vertical-rl', height: 120, padding: '8px 4px'}}>{dc.replace(/_/g,' ')}</th>)}
          <th style={s.th}>Save</th>
        </tr></thead><tbody>
          {state.roles.map(r => <tr key={r.id}>
            <td style={{...s.td, fontWeight: 600, position: 'sticky', left: 0, background: 'rgba(2,40,115,0.95)', zIndex: 1}}>{r.role_name}</td>
            {DATA_CLASSES.map(dc => {
              const val = getMatrixValue(r.id, dc)
              const changed = matrixDiffs[r.id]?.[dc]
              return <td key={dc} style={{...s.td, padding: '4px 2px', textAlign: 'center'}}>
                <select value={val} onChange={e => setMatrixDiffs(p => ({...p, [r.id]: {...(p[r.id]||{}), [dc]: e.target.value}}))}
                  style={{ padding: '4px', borderRadius: 4, border: changed ? '2px solid #fbbf24' : '1px solid rgba(255,255,255,0.1)', background: val === 'read' ? 'rgba(52,191,58,0.15)' : 'rgba(148,163,184,0.1)', color: val === 'read' ? '#4ade80' : '#94a3b8', fontSize: '0.68rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                  <option value="read" style={{background:'#1a2744',color:'#4ade80'}}>Read</option>
                  <option value="hidden" style={{background:'#1a2744',color:'#94a3b8'}}>Hidden</option>
                </select>
              </td>
            })}
            <td style={s.td}>{matrixDiffs[r.id] && Object.keys(matrixDiffs[r.id]).length > 0 && <button style={{...s.btn('sm'), background: '#059669'}} onClick={() => handleSaveMatrix(r.id)} disabled={saving}>{saving ? '...' : 'Save'}</button>}</td>
          </tr>)}
        </tbody></table></div>
      </div>}

      {/* Modals */}
      {modal === 'addUser' && <div style={s.modal} onClick={() => setModal(null)}><div style={s.modalCard} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}><h3 style={{ color: '#fff', fontSize: '1.1rem', fontWeight: 700 }}>Add User</h3><button onClick={() => setModal(null)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer' }}><X size={20} /></button></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div><label style={s.label}>Email *</label><input style={s.input} placeholder="user@datalake.sa" value={modalData.email || ''} onChange={e => setModalData(p => ({...p, email: e.target.value}))} /></div>
          <div><label style={s.label}>Display Name *</label><input style={s.input} placeholder="Full name" value={modalData.display_name || ''} onChange={e => setModalData(p => ({...p, display_name: e.target.value}))} /></div>
          <div><label style={s.label}>Role *</label><select style={s.select} value={modalData.role_id || ''} onChange={e => setModalData(p => ({...p, role_id: e.target.value}))}>{assignableRoles.map(r => <option key={r.id} value={r.id} style={{background:'#1a2744',color:'#fff'}}>{r.role_name}</option>)}</select></div>
          {(modalData.role_id === 'engineer' || modalData.role_id === 'pm') && <div><label style={s.label}>Employee ID</label><input style={s.input} placeholder="e.g. DLSA1001" value={modalData.employee_id || ''} onChange={e => setModalData(p => ({...p, employee_id: e.target.value}))} /></div>}
          {modalData.role_id === 'client' && <div><label style={s.label}>Client *</label><select style={s.select} value={modalData.client_id || ''} onChange={e => setModalData(p => ({...p, client_id: e.target.value}))}><option value="">Select...</option>{state.clients.map(c => <option key={c.id} value={c.id} style={{background:'#1a2744',color:'#fff'}}>{c.client_name}</option>)}</select></div>}
          <button style={{...s.btn(), width: '100%', justifyContent: 'center', marginTop: 8}} onClick={handleAddUser} disabled={saving}>{saving ? 'Creating...' : 'Create User'}</button>
        </div>
      </div></div>}

      {modal === 'changeRole' && <div style={s.modal} onClick={() => setModal(null)}><div style={s.modalCard} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}><h3 style={{ color: '#fff', fontSize: '1.1rem', fontWeight: 700 }}>Change Role — {modalData.email}</h3><button onClick={() => setModal(null)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer' }}><X size={20} /></button></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div><label style={s.label}>New Role</label><select style={s.select} value={modalData.new_role_id || ''} onChange={e => setModalData(p => ({...p, new_role_id: e.target.value}))}>{assignableRoles.filter(r => r.id !== modalData.current_role).map(r => <option key={r.id} value={r.id} style={{background:'#1a2744',color:'#fff'}}>{r.role_name}</option>)}</select></div>
          <button style={{...s.btn(), width: '100%', justifyContent: 'center', marginTop: 8}} onClick={handleChangeRole} disabled={saving}>{saving ? 'Updating...' : 'Update Role'}</button>
        </div>
      </div></div>}

      {modal === 'addRole' && <div style={s.modal} onClick={() => setModal(null)}><div style={s.modalCard} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}><h3 style={{ color: '#fff', fontSize: '1.1rem', fontWeight: 700 }}>Create Custom Role</h3><button onClick={() => setModal(null)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer' }}><X size={20} /></button></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div><label style={s.label}>Role Name *</label><input style={s.input} placeholder="e.g. HR Director" value={modalData.role_name || ''} onChange={e => setModalData(p => ({...p, role_name: e.target.value}))} /></div>
          <div><label style={s.label}>Description *</label><input style={s.input} placeholder="What this role can do" value={modalData.description || ''} onChange={e => setModalData(p => ({...p, description: e.target.value}))} /></div>
          <div><label style={s.label}>Base On (inherit matrix from)</label><select style={s.select} value={modalData.base_role_id || ''} onChange={e => setModalData(p => ({...p, base_role_id: e.target.value}))}>{state.roles.map(r => <option key={r.id} value={r.id} style={{background:'#1a2744',color:'#fff'}}>{r.role_name}</option>)}</select></div>
          <button style={{...s.btn(), width: '100%', justifyContent: 'center', marginTop: 8}} onClick={handleCreateRole} disabled={saving}>{saving ? 'Creating...' : 'Create Role'}</button>
        </div>
      </div></div>}

      <div style={s.toast(!!toast)}><CheckCircle size={16} />{toast}</div>
    </div>
  )
}
