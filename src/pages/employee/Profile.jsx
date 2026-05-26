import { useState, useEffect, useRef } from 'react'
import { collection, onSnapshot, query, where, getDoc, getDocs, doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, auth, storage } from '../../lib/firebase'
import { Shield, Download, Trash2, Edit2, Loader, Camera, Check, X } from 'lucide-react'

export default function Profile() {
  const [profile, setProfile] = useState({})
  const [empDocId, setEmpDocId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [editing, setEditing] = useState(false)
  const [savingEdit, setSavingEdit] = useState(false)
  const [editForm, setEditForm] = useState({ phone: '', ecName: '', ecRelationship: '', ecPhone: '' })
  const fileInput = useRef(null)

  useEffect(() => {
    let unsubEmp = () => {}
    const unsubAuth = auth.onAuthStateChanged(async (user) => {
      if (!user) { setLoading(false); return }
      try {
        // Resolve the user record (UID-keyed, then email) to get the canonical employee_id.
        let userData = null
        const byUid = await getDoc(doc(db, 'users', user.uid))
        if (byUid.exists()) userData = byUid.data()
        else {
          const uq = await getDocs(query(collection(db, 'users'), where('email', '==', user.email)))
          if (!uq.empty) userData = uq.docs[0].data()
        }
        const empId = userData?.employee_id

        const applyDoc = (empData, docId) => {
          setEmpDocId(docId)
          const merged = { ...(userData || {}), ...(empData || {}) }
          setProfile(merged)
          setEditForm({
            phone: merged.phone || '',
            ecName: merged.emergency_contact?.name || '',
            ecRelationship: merged.emergency_contact?.relationship || '',
            ecPhone: merged.emergency_contact?.phone || '',
          })
          setLoading(false)
        }

        if (empId) {
          // Live-subscribe to the employees doc keyed by employee_id (reliable; avoids email-case mismatches).
          unsubEmp = onSnapshot(doc(db, 'employees', empId), snap => {
            applyDoc(snap.exists() ? snap.data() : {}, empId)
          }, err => {
            console.warn('Profile employees listener:', err.message)
            applyDoc({}, empId) // still show user-record fields
          })
        } else {
          // No employee_id on the user record — fall back to an email match on employees.
          const eq = await getDocs(query(collection(db, 'employees'), where('email', '==', user.email)))
          if (!eq.empty) applyDoc(eq.docs[0].data(), eq.docs[0].id)
          else applyDoc({}, null)
        }
      } catch (e) {
        console.warn('Profile load error:', e.message)
        setError(e)
        setLoading(false)
      }
    })
    return () => { unsubAuth(); unsubEmp() }
  }, [])

  // ── Normalized fields (employees-collection field names) ──
  const name = profile.full_name || profile.name || ''
  const empId = profile.employee_id || profile.employeeId || ''
  const email = profile.email || ''
  const title = profile.title || profile.role || ''
  const nationality = profile.nationality || ''
  const phone = profile.phone || ''
  const photoUrl = profile.photo_url || ''
  const ec = profile.emergency_contact || {}
  const skills = profile.skills || []
  const certifications = profile.certifications || []

  const handlePhotoSelect = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!empDocId) { alert('No employee record linked to your account — contact HR.'); return }
    if (!file.type.startsWith('image/')) { alert('Please choose an image file.'); return }
    if (file.size > 5 * 1024 * 1024) { alert('Image must be under 5MB.'); return }
    setUploadingPhoto(true)
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      const storageRef = ref(storage, `employee-photos/${empDocId}.${ext}`)
      await uploadBytes(storageRef, file)
      const url = await getDownloadURL(storageRef)
      await updateDoc(doc(db, 'employees', empDocId), { photo_url: url, updated_at: serverTimestamp() })
      // onSnapshot will refresh; set locally too for immediate feedback.
      setProfile(prev => ({ ...prev, photo_url: url }))
    } catch (err) {
      console.warn('Photo upload failed:', err.message)
      alert(`Photo upload failed: ${err.message}`)
    } finally {
      setUploadingPhoto(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const saveEdits = async () => {
    if (!empDocId) { alert('No employee record linked to your account — contact HR.'); return }
    setSavingEdit(true)
    try {
      await updateDoc(doc(db, 'employees', empDocId), {
        phone: editForm.phone || null,
        emergency_contact: {
          name: editForm.ecName || null,
          relationship: editForm.ecRelationship || null,
          phone: editForm.ecPhone || null,
        },
        updated_at: serverTimestamp(),
      })
      setEditing(false)
    } catch (err) {
      console.warn('Profile save failed:', err.message)
      alert(`Could not save: ${err.message}`)
    } finally {
      setSavingEdit(false)
    }
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

  const initials = name ? name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() : 'ME'

  return (
    <div style={{ position: 'relative', minHeight: '100%' }}>
      {loading && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary)', zIndex: 10 }}>
          <Loader size={32} className="spin" style={{ color: 'var(--accent-primary)' }} />
        </div>
      )}

      <div className="flex-between" style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>My Profile</h1>
      </div>

      {/* Profile Header with photo upload */}
      <div className="card animate-fade-in-up" style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 20 }}>
        <div style={{ position: 'relative', width: 72, height: 72, flexShrink: 0 }}>
          <div style={{
            width: 72, height: 72, borderRadius: '50%', overflow: 'hidden',
            background: 'linear-gradient(135deg, var(--steel-blue), var(--navy))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'white', fontSize: '1.5rem', fontWeight: 800, fontFamily: 'var(--font-heading)',
          }}>
            {photoUrl
              ? <img src={photoUrl} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : initials}
          </div>
          <button
            onClick={() => fileInput.current?.click()}
            disabled={uploadingPhoto || !empDocId}
            title={empDocId ? 'Change photo' : 'No employee record linked'}
            style={{
              position: 'absolute', bottom: -2, right: -2, width: 26, height: 26, borderRadius: '50%',
              background: 'var(--accent-primary, #1598CC)', border: '2px solid var(--bg-primary, #fff)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
              cursor: uploadingPhoto || !empDocId ? 'not-allowed' : 'pointer', padding: 0,
            }}
          >
            {uploadingPhoto ? <Loader size={13} className="spin" /> : <Camera size={13} />}
          </button>
          <input ref={fileInput} type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePhotoSelect} />
        </div>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: '1.3rem', fontWeight: 700 }}>{name || '—'}</h2>
          <p style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>{title || '—'}</p>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: 4 }}>{empId || '—'} · {email || '—'}</p>
        </div>
      </div>

      {/* Personal Information */}
      <div className="profile-section animate-fade-in-up stagger-1">
        <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: 16 }}>👤 Personal Information</h3>
        <div className="profile-field"><span className="field-label">Full Name</span><span className="field-value">{name || '—'}</span></div>
        <div className="profile-field"><span className="field-label">Employee ID</span><span className="field-value" style={{ fontFamily: 'var(--font-mono)' }}>{empId || '—'}</span></div>
        <div className="profile-field"><span className="field-label">Email</span><span className="field-value">{email || '—'}</span></div>
        <div className="profile-field"><span className="field-label">Title</span><span className="field-value">{title || '—'}</span></div>
        <div className="profile-field"><span className="field-label">Nationality</span><span className="field-value">{nationality || '—'}</span></div>
        <div className="profile-field">
          <span className="field-label">Phone</span>
          {editing
            ? <input className="form-input" style={{ maxWidth: 220 }} value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} placeholder="e.g. +966 5x xxx xxxx" />
            : <span className="field-value">{phone || '—'}</span>}
        </div>
      </div>

      {/* Emergency Contact (editable, own limited fields) */}
      <div className="profile-section animate-fade-in-up stagger-2">
        <div className="flex-between" style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>🆘 Emergency Contact</h3>
          {!editing ? (
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}><Edit2 size={14} /> Edit</button>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost btn-sm" disabled={savingEdit} onClick={() => setEditing(false)}><X size={14} /> Cancel</button>
              <button className="btn btn-primary btn-sm" disabled={savingEdit} onClick={saveEdits}>
                {savingEdit ? <Loader size={14} className="spin" /> : <Check size={14} />} Save
              </button>
            </div>
          )}
        </div>
        <div className="profile-field">
          <span className="field-label">Name</span>
          {editing
            ? <input className="form-input" style={{ maxWidth: 220 }} value={editForm.ecName} onChange={e => setEditForm(f => ({ ...f, ecName: e.target.value }))} />
            : <span className="field-value">{ec.name || '—'}</span>}
        </div>
        <div className="profile-field">
          <span className="field-label">Relationship</span>
          {editing
            ? <input className="form-input" style={{ maxWidth: 220 }} value={editForm.ecRelationship} onChange={e => setEditForm(f => ({ ...f, ecRelationship: e.target.value }))} />
            : <span className="field-value">{ec.relationship || '—'}</span>}
        </div>
        <div className="profile-field">
          <span className="field-label">Phone</span>
          {editing
            ? <input className="form-input" style={{ maxWidth: 220 }} value={editForm.ecPhone} onChange={e => setEditForm(f => ({ ...f, ecPhone: e.target.value }))} />
            : <span className="field-value">{ec.phone || '—'}</span>}
        </div>
      </div>

      {/* Skills & Certifications (only if present) */}
      {(skills.length > 0 || certifications.length > 0) && (
        <div className="profile-section animate-fade-in-up stagger-3">
          <div className="flex-between" style={{ marginBottom: 16 }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>🛠️ Skills & Certifications</h3>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {skills.map(skill => <span key={skill} className="badge badge-info">{skill}</span>)}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {certifications.map(cert => (
              <div key={cert} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="badge badge-success">🏅</span>
                <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>{cert}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* PDPL Actions */}
      <div className="profile-section animate-fade-in-up" style={{ background: 'var(--bg-surface)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <Shield size={20} style={{ color: 'var(--text-tertiary)' }} />
          <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>Data Privacy (PDPL)</h3>
        </div>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-tertiary)', marginBottom: 16, lineHeight: 1.6 }}>
          Under the Saudi Personal Data Protection Law (PDPL), you have the right to access your data and request its deletion.
        </p>
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn btn-ghost btn-sm"><Download size={14} /> Download My Data (PDPL Art. 15)</button>
          <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }}><Trash2 size={14} /> Request Data Deletion (PDPL Art. 18)</button>
        </div>
      </div>
    </div>
  )
}
