import { useState, useEffect } from 'react'
import { collection, onSnapshot, addDoc, updateDoc, doc, serverTimestamp, query, orderBy } from 'firebase/firestore'
import { db, auth } from '../../lib/firebase'
import { softDelete, notDeleted } from '../../lib/soft-delete'
import { Briefcase, MapPin, Plus, Edit2, X, CheckCircle, Clock, Users, DollarSign, FileText, Save, AlertTriangle } from 'lucide-react'

const STATUS_COLORS = {
  open:   { bg: '#e8fbe5', color: '#27ae60', border: '#b7e8bc', label: 'Open' },
  closed: { bg: '#f0f0f0', color: '#888',    border: '#ddd',    label: 'Closed' },
  draft:  { bg: '#fff7ed', color: '#E8913A', border: '#fde0b8', label: 'Draft' },
}

const EMPTY_FORM = { title: '', description: '', requirements: '', client: '', location: '', salary_range: '', status: 'open' }

export default function HRJobListings() {
  const [listings, setListings] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    const q = query(collection(db, 'job_listings'), orderBy('created_at', 'desc'))
    const unsub = onSnapshot(q, snap => {
      setListings(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(notDeleted))
      setLoading(false)
    }, err => { console.warn('job_listings error:', err.message); setLoading(false) })
    return () => unsub()
  }, [])

  const update = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const handleSave = async () => {
    if (!form.title.trim() || !form.client.trim() || !form.location.trim()) {
      setError('Title, client, and location are required'); return
    }
    setSaving(true); setError(''); setSuccess('')
    try {
      const user = auth.currentUser
      if (editingId) {
        await updateDoc(doc(db, 'job_listings', editingId), {
          ...form, updated_at: serverTimestamp(), updated_by: user?.email
        })
        setSuccess('Listing updated')
      } else {
        await addDoc(collection(db, 'job_listings'), {
          ...form, created_at: serverTimestamp(), created_by: user?.email, applications_count: 0
        })
        setSuccess('Listing created')
      }
      setShowForm(false); setEditingId(null); setForm(EMPTY_FORM)
    } catch (err) { setError(err.message) }
    setSaving(false)
  }

  const handleEdit = (listing) => {
    setForm({ title: listing.title || '', description: listing.description || '', requirements: listing.requirements || '', client: listing.client || '', location: listing.location || '', salary_range: listing.salary_range || '', status: listing.status || 'open' })
    setEditingId(listing.id); setShowForm(true); setError(''); setSuccess('')
  }

  const handleClose = async (id) => {
    try {
      await updateDoc(doc(db, 'job_listings', id), { status: 'closed', closed_at: serverTimestamp(), closed_by: auth.currentUser?.email })
      setSuccess('Listing closed')
    } catch (err) { setError(err.message) }
  }

  const handleNew = () => { setForm(EMPTY_FORM); setEditingId(null); setShowForm(true); setError(''); setSuccess('') }
  const handleCancel = () => { setShowForm(false); setEditingId(null); setForm(EMPTY_FORM); setError('') }

  const inp = { width: '100%', padding: '10px 14px', border: '1px solid #1e3050', borderRadius: 8, fontSize: '0.88rem', fontFamily: 'inherit', outline: 'none', color: '#e2e8f0', background: '#0d1829', boxSizing: 'border-box' }
  const lbl = { fontSize: '0.72rem', fontWeight: 700, color: '#94a3b8', marginBottom: 6, display: 'block', textTransform: 'uppercase', letterSpacing: '0.05em' }

  return (
    <div style={{ padding: '32px 24px', maxWidth: 1100, margin: '0 auto', fontFamily: "'DM Sans', 'Inter', sans-serif" }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#e2e8f0', margin: 0 }}>Job Listings</h1>
          <div style={{ fontSize: '0.82rem', color: '#64748b', marginTop: 4 }}>Manage open positions — published live on /careers</div>
        </div>
        <button onClick={handleNew} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 20px', background: 'linear-gradient(135deg, #1598CC, #022873)', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: '0.88rem', cursor: 'pointer', fontFamily: 'inherit' }}>
          <Plus size={16} /> New Listing
        </button>
      </div>

      {error && <div style={{ padding: '10px 16px', background: 'rgba(239,88,41,0.15)', border: '1px solid rgba(239,88,41,0.3)', borderRadius: 8, color: '#fb923c', fontSize: '0.82rem', marginBottom: 16, display: 'flex', gap: 8 }}><AlertTriangle size={14} />{error}</div>}
      {success && <div style={{ padding: '10px 16px', background: 'rgba(52,191,58,0.12)', border: '1px solid rgba(52,191,58,0.3)', borderRadius: 8, color: '#4ade80', fontSize: '0.82rem', marginBottom: 16, display: 'flex', gap: 8 }}><CheckCircle size={14} />{success}</div>}

      {/* Create / Edit Form */}
      {showForm && (
        <div style={{ background: '#111e33', border: '1px solid #1598CC', borderRadius: 14, padding: 28, marginBottom: 28 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#e2e8f0', margin: 0 }}>{editingId ? 'Edit Listing' : 'New Job Listing'}</h2>
            <button onClick={handleCancel} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}><X size={18} /></button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div>
              <label style={lbl}>Job Title *</label>
              <input style={inp} placeholder="e.g. Senior Data Engineer" value={form.title} onChange={e => update('title', e.target.value)} />
            </div>
            <div>
              <label style={lbl}>Client *</label>
              <input style={inp} placeholder="e.g. Al Rajhi Bank" value={form.client} onChange={e => update('client', e.target.value)} />
            </div>
            <div>
              <label style={lbl}>Location *</label>
              <input style={inp} placeholder="e.g. Riyadh, KSA" value={form.location} onChange={e => update('location', e.target.value)} />
            </div>
            <div>
              <label style={lbl}>Salary Range</label>
              <input style={inp} placeholder="e.g. SAR 25,000 – 35,000/mo" value={form.salary_range} onChange={e => update('salary_range', e.target.value)} />
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={lbl}>Job Description</label>
            <textarea style={{ ...inp, minHeight: 90, resize: 'vertical' }} placeholder="Role overview, responsibilities..." value={form.description} onChange={e => update('description', e.target.value)} />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={lbl}>Requirements</label>
            <textarea style={{ ...inp, minHeight: 80, resize: 'vertical' }} placeholder="Skills, experience, qualifications..." value={form.requirements} onChange={e => update('requirements', e.target.value)} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <label style={lbl}>Status</label>
              <select style={{ ...inp, width: 160 }} value={form.status} onChange={e => update('status', e.target.value)}>
                <option value="open">Open</option>
                <option value="draft">Draft</option>
                <option value="closed">Closed</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={handleCancel} style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid #1e3050', background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
              <button onClick={handleSave} disabled={saving} style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: saving ? '#1e293b' : 'linear-gradient(135deg, #27ae60, #1e8449)', color: '#fff', fontWeight: 700, cursor: saving ? 'default' : 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Save size={14} /> {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Create Listing'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Listings */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 48, color: '#64748b' }}>Loading listings…</div>
      ) : listings.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48, color: '#64748b', background: '#111e33', borderRadius: 14, border: '1px dashed #1e3050' }}>
          <Briefcase size={40} style={{ marginBottom: 12, opacity: 0.3 }} />
          <div style={{ fontWeight: 600, marginBottom: 6 }}>No job listings yet</div>
          <div style={{ fontSize: '0.82rem' }}>Create your first listing — it will appear on /careers immediately</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {listings.map(l => {
            const st = STATUS_COLORS[l.status] || STATUS_COLORS.open
            return (
              <div key={l.id} style={{ background: '#111e33', border: '1px solid #1e3050', borderRadius: 12, padding: '18px 22px', display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                <div style={{ width: 44, height: 44, borderRadius: 10, background: 'linear-gradient(135deg, #022873, #1598CC)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Briefcase size={20} color="#fff" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
                    <span style={{ fontWeight: 700, fontSize: '0.95rem', color: '#e2e8f0' }}>{l.title}</span>
                    <span style={{ padding: '2px 10px', borderRadius: 20, fontSize: '0.68rem', fontWeight: 700, background: st.bg, color: st.color, border: `1px solid ${st.border}` }}>{st.label}</span>
                    {l.applications_count > 0 && <span style={{ fontSize: '0.72rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}><Users size={12} /> {l.applications_count} applicant{l.applications_count !== 1 ? 's' : ''}</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 16, fontSize: '0.78rem', color: '#64748b', flexWrap: 'wrap' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Users size={12} /> {l.client}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><MapPin size={12} /> {l.location}</span>
                    {l.salary_range && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><DollarSign size={12} /> {l.salary_range}</span>}
                  </div>
                  {l.description && <div style={{ fontSize: '0.78rem', color: '#475569', marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 600 }}>{l.description}</div>}
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <button onClick={() => handleEdit(l)} style={{ padding: '6px 12px', borderRadius: 7, border: '1px solid #1e3050', background: 'transparent', color: '#94a3b8', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.78rem', fontFamily: 'inherit' }}>
                    <Edit2 size={12} /> Edit
                  </button>
                  {l.status === 'open' && (
                    <button onClick={() => handleClose(l.id)} style={{ padding: '6px 12px', borderRadius: 7, border: '1px solid rgba(192,57,43,0.4)', background: 'rgba(192,57,43,0.08)', color: '#ef4444', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.78rem', fontFamily: 'inherit' }}>
                      <X size={12} /> Close
                    </button>
                  )}
                  <button onClick={async () => {
                    if (window.confirm('Delete this job listing?\n\nIt moves to the Recycle Bin and can be restored by an admin — not permanently deleted.')) {
                      try {
                        await softDelete('job_listings', l.id)
                        setSuccess('Listing moved to Recycle Bin')
                      } catch(err) { setError(err.message) }
                    }
                  }} style={{ padding: '6px 12px', borderRadius: 7, border: '1px solid rgba(192,57,43,0.4)', background: 'transparent', color: '#ef4444', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.78rem', fontFamily: 'inherit' }}>
                    Delete
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
