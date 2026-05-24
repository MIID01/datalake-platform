import { useState, useEffect } from 'react'
import { collection, addDoc, query, where, onSnapshot, serverTimestamp } from 'firebase/firestore'
import { db, auth } from '../../lib/firebase'
import { Plane, Plus, CheckCircle, AlertTriangle, Loader, MapPin, Calendar, Clock } from 'lucide-react'

const REQUEST_TYPES = ['Business Travel', 'Client Site Relocation', 'Conference / Training', 'Visa / Iqama Renewal']
const STATUS_CONFIG = {
  PENDING: { label: 'Pending', color: '#F39C12', bg: 'rgba(243,156,18,0.12)' },
  APPROVED: { label: 'Approved', color: '#34BF3A', bg: 'rgba(52,191,58,0.12)' },
  REJECTED: { label: 'Rejected', color: '#C0392B', bg: 'rgba(192,57,43,0.12)' },
  COMPLETED: { label: 'Completed', color: '#78909C', bg: 'rgba(120,144,156,0.12)' },
}

export default function Travel() {
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState(null)
  const [form, setForm] = useState({
    type: REQUEST_TYPES[0], destination: '', start_date: '', end_date: '',
    purpose: '', estimated_cost: '', accommodation_needed: false,
  })

  const [userEmail, setUserEmail] = useState(null)
  const [userName, setUserName] = useState('')

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(user => {
      if (user) { setUserEmail(user.email); setUserName(user.displayName || user.email) }
    })
    return () => unsub()
  }, [])

  useEffect(() => {
    if (!userEmail) return
    const q = query(collection(db, 'travel_requests'), where('engineer_email', '==', userEmail))
    const unsub = onSnapshot(q, snap => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      data.sort((a, b) => (b.created_at?.seconds || 0) - (a.created_at?.seconds || 0))
      setRequests(data)
      setLoading(false)
    }, err => {
      console.warn('Travel listener:', err.message)
      setError(err)
      setLoading(false)
    })
    return () => unsub()
  }, [userEmail])

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type }); setTimeout(() => setToast(null), 4000)
  }

  const handleSubmit = async () => {
    if (!form.destination || !form.start_date || !form.purpose) {
      showToast('Please fill in all required fields', 'error'); return
    }
    setSubmitting(true)
    try {
      const reqId = `TRV-${Date.now()}-${Math.floor(Math.random() * 1000)}`
      await addDoc(collection(db, 'travel_requests'), {
        request_id: reqId,
        type: form.type,
        destination: form.destination,
        start_date: form.start_date,
        end_date: form.end_date || form.start_date,
        purpose: form.purpose,
        estimated_cost: Number(form.estimated_cost) || 0,
        accommodation_needed: form.accommodation_needed,
        status: 'PENDING',
        engineer_email: userEmail,
        engineer_name: userName,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
        approved_by: null,
        approved_at: null,
      })
      showToast(`Travel request ${reqId} submitted`)
      setForm({ type: REQUEST_TYPES[0], destination: '', start_date: '', end_date: '', purpose: '', estimated_cost: '', accommodation_needed: false })
      setShowForm(false)
    } catch (err) {
      showToast(`Failed: ${err.message}`, 'error')
    }
    setSubmitting(false)
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
    <div style={{ position: 'relative', minHeight: '100%' }}>
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
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Travel & Logistics</h1>
          <p style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem', marginTop: 4 }}>
            Submit travel requests for client site visits, relocations, and visa renewals
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
          <Plus size={16} /> New Request
        </button>
      </div>

      {/* Request Form */}
      {showForm && (
        <div className="card animate-fade-in-up" style={{ marginBottom: 24 }}>
          <h3 style={{ marginBottom: 20, fontSize: '1.1rem', fontWeight: 700 }}>New Travel Request</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div className="form-group">
              <label className="form-label">Request Type *</label>
              <select className="form-input" value={form.type}
                onChange={e => setForm(p => ({ ...p, type: e.target.value }))}>
                {REQUEST_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Destination *</label>
              <input className="form-input" value={form.destination}
                onChange={e => setForm(p => ({ ...p, destination: e.target.value }))}
                placeholder="e.g. Jeddah, Dubai, client site" />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div className="form-group">
              <label className="form-label">Start Date *</label>
              <input className="form-input" type="date" value={form.start_date}
                onChange={e => setForm(p => ({ ...p, start_date: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">End Date</label>
              <input className="form-input" type="date" value={form.end_date} min={form.start_date}
                onChange={e => setForm(p => ({ ...p, end_date: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Estimated Cost (SAR)</label>
              <input className="form-input" type="number" placeholder="0" min="0"
                value={form.estimated_cost}
                onChange={e => setForm(p => ({ ...p, estimated_cost: e.target.value }))} />
            </div>
          </div>
          <div className="form-group" style={{ marginBottom: 16 }}>
            <label className="form-label">Purpose / Justification *</label>
            <textarea className="form-input" rows={3} value={form.purpose}
              onChange={e => setForm(p => ({ ...p, purpose: e.target.value }))}
              placeholder="Why is this travel necessary?" />
          </div>
          <div className="form-group" style={{ marginBottom: 20 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.9rem' }}>
              <input type="checkbox" checked={form.accommodation_needed}
                onChange={e => setForm(p => ({ ...p, accommodation_needed: e.target.checked }))}
                style={{ accentColor: 'var(--steel-blue, #1598CC)' }} />
              Accommodation required
            </label>
          </div>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
              {submitting ? <Loader size={16} className="spin" /> : <Plane size={16} />}
              {submitting ? ' Submitting...' : ' Submit Request'}
            </button>
          </div>
        </div>
      )}

      {/* Requests List */}
      {requests.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 48 }}>
          <Plane size={48} style={{ color: 'var(--text-tertiary)', opacity: 0.3, marginBottom: 12 }} />
          <div style={{ fontWeight: 600, fontSize: '1rem', marginBottom: 4 }}>No travel requests</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)' }}>
            Submit a request when you need to travel for work
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {requests.map((req, i) => {
            const sc = STATUS_CONFIG[req.status] || STATUS_CONFIG.PENDING
            return (
              <div key={req.id} className={`card animate-fade-in-up stagger-${i + 1}`}
                style={{ borderLeft: `4px solid ${sc.color}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                    background: sc.bg,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <MapPin size={18} color={sc.color} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>
                      {req.type} — {req.destination}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: 2, display: 'flex', gap: 12 }}>
                      <span><Calendar size={11} style={{ verticalAlign: -1 }} /> {req.start_date}{req.end_date && req.end_date !== req.start_date ? ` — ${req.end_date}` : ''}</span>
                      {req.estimated_cost > 0 && <span>SAR {Number(req.estimated_cost).toLocaleString()}</span>}
                      {req.accommodation_needed && <span>🏨 Accommodation</span>}
                    </div>
                  </div>
                  <span style={{
                    padding: '4px 12px', borderRadius: 12, fontSize: '0.72rem',
                    fontWeight: 600, background: sc.bg, color: sc.color,
                  }}>
                    {sc.label}
                  </span>
                </div>
                {req.purpose && (
                  <div style={{ marginTop: 10, fontSize: '0.82rem', color: 'var(--text-secondary)', paddingLeft: 54 }}>
                    {req.purpose}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
