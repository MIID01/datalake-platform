import { useState, useEffect, useRef } from 'react'
import { collection, onSnapshot, query, where, getDoc, getDocs, doc, updateDoc, addDoc, serverTimestamp, collectionGroup } from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth'
import { db, auth, storage } from '../../lib/firebase'
import { Shield, Download, Trash2, Edit2, Loader, Camera, Check, X, AlertCircle, KeyRound, Eye, EyeOff } from 'lucide-react'
import PasswordChecklist from '../../components/PasswordChecklist'
import MfaEnrollment from '../../components/MfaEnrollment'
import { evaluatePassword } from '../../lib/password-policy'

export default function Profile() {
  const [profile, setProfile] = useState({})
  const [empDocId, setEmpDocId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [editing, setEditing] = useState(false)
  const [savingEdit, setSavingEdit] = useState(false)
  const [editForm, setEditForm] = useState({ phone: '', ecName: '', ecRelationship: '', ecPhone: '' })
  // PDPL Art. 15 / Art. 18 buttons
  const [dsrWorking, setDsrWorking] = useState(null)  // 'export' | 'delete' | null
  const [dsrMsg, setDsrMsg] = useState({ kind: '', text: '' })
  const fileInput = useRef(null)
  // Change-password form (re-auth + updatePassword)
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' })
  const [pwShow, setPwShow] = useState(false)
  const [pwSaving, setPwSaving] = useState(false)
  const [pwMsg, setPwMsg] = useState({ kind: '', text: '' })

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

  // ── PDPL Art. 15 — Download My Data ──────────────────────────────
  // Collects every doc this employee is referenced in across the platform,
  // bundles into a single JSON file, and writes a dsr_requests audit row.
  async function handleDownloadMyData() {
    setDsrWorking('export'); setDsrMsg({ kind: '', text: '' })
    try {
      const me = auth.currentUser
      if (!me) throw new Error('Not signed in.')
      const email = String(me.email || '').toLowerCase()
      const empId = empDocId || profile.employee_id || null

      // Best-effort IP for the audit row (same pattern as onboarding submit).
      let ip = null
      try {
        const ctrl = new AbortController()
        const t = setTimeout(() => ctrl.abort(), 2000)
        const r = await fetch('https://api.ipify.org?format=json', { signal: ctrl.signal })
        clearTimeout(t)
        if (r.ok) { const j = await r.json(); ip = j.ip || null }
      } catch { ip = null }

      // Helper: run a query and return docs as plain JS objects.
      const grab = async (q) => {
        try {
          const snap = await getDocs(q)
          return snap.docs.map(d => ({ _id: d.id, _path: d.ref.path, ...d.data() }))
        } catch (e) {
          return { _error: e.message }
        }
      }

      // 1. users/{uid}
      let usersRow = null
      try {
        const u = await getDoc(doc(db, 'users', me.uid))
        usersRow = u.exists() ? { _id: u.id, _path: u.ref.path, ...u.data() } : null
      } catch { /* permission-denied */ }

      // 2. employees/{empId}
      let employeesRow = null
      if (empId) {
        try {
          const e = await getDoc(doc(db, 'employees', empId))
          employeesRow = e.exists() ? { _id: e.id, _path: e.ref.path, ...e.data() } : null
        } catch { /* permission-denied */ }
      }

      // 3. The collections that key by engineer_email.
      const [timesheets, leaveReqs, expenses, tickets] = await Promise.all([
        grab(query(collection(db, 'timesheets'),       where('engineer_email', '==', email))),
        grab(query(collection(db, 'leave_requests'),    where('engineer_email', '==', email))),
        grab(query(collection(db, 'expenses'),          where('engineer_email', '==', email))),
        grab(query(collection(db, 'support_tickets'),   where('engineer_email', '==', email))),
      ])

      // 4. Onboarding evidence + assignments (anchored on employees/{empId}).
      let onboardingEvidence = []
      let assignments = []
      if (empId) {
        onboardingEvidence = await grab(query(collection(db, 'employees', empId, 'onboarding_evidence')))
        assignments = await grab(query(collection(db, 'engineer_project_assignments'), where('engineer_email', '==', email)))
      }

      // 5. Approval evidence touching this person — try a collection-group
      // scan filtered by approver_email. May permission-deny depending on rules.
      let approvalEvidence = []
      try {
        approvalEvidence = await grab(query(collectionGroup(db, 'approval_evidence'), where('approver_email', '==', email)))
      } catch (e) {
        approvalEvidence = { _error: e.message }
      }

      const bundle = {
        export_id: `DSR-EXPORT-${Date.now()}`,
        generated_at: new Date().toISOString(),
        requested_by: { email, uid: me.uid, employee_id: empId, ip, user_agent: navigator.userAgent },
        pdpl_article: 'Art. 15 — Right to Access',
        company: 'Datalake Saudi Arabia LLC · CR:1009194773 · NUN:7048904952',
        records: {
          user_account: usersRow,
          employee_record: employeesRow,
          onboarding_evidence: onboardingEvidence,
          project_assignments: assignments,
          timesheets,
          leave_requests: leaveReqs,
          expenses,
          support_tickets: tickets,
          approval_evidence: approvalEvidence,
        },
      }

      // Write the audit row. Failure here is non-fatal — the user still gets
      // their data; we just log a console warning.
      try {
        await addDoc(collection(db, 'dsr_requests'), {
          request_type: 'EXPORT',
          status: 'COMPLETED',
          employee_id: empId,
          employee_email: email,
          requested_at: serverTimestamp(),
          completed_at: serverTimestamp(),
          ip_address: ip,
          user_agent: navigator.userAgent,
          export_id: bundle.export_id,
          export_row_count: Object.fromEntries(
            Object.entries(bundle.records).map(([k, v]) => [
              k, Array.isArray(v) ? v.length : (v ? 1 : 0),
            ]),
          ),
        })
      } catch (e) {
        console.warn('[PDPL] dsr_requests audit row failed:', e.message)
      }

      // Generate a readable HTML document instead of raw JSON
      const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Personal Data Export - ${profile.full_name || profile.name || email}</title>
  <style>
    body { font-family: 'Segoe UI', system-ui, sans-serif; background: #f4f6f9; color: #1f2937; margin: 0; padding: 40px; }
    .container { max-width: 900px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 40px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
    h1 { color: #022873; margin-top: 0; font-size: 1.8rem; }
    h2 { color: #1598cc; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; margin-top: 36px; font-size: 1.3rem; }
    h3 { color: #334155; margin-top: 24px; font-size: 1.1rem; }
    .meta { background: #f8fafc; padding: 20px; border-radius: 8px; margin-bottom: 32px; font-size: 0.95rem; border: 1px solid #e2e8f0; }
    .meta div { margin-bottom: 10px; }
    .meta strong { color: #475569; display: inline-block; width: 140px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { text-align: left; padding: 12px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
    th { background: #f1f5f9; color: #475569; font-weight: 600; font-size: 0.9rem; }
    pre { background: #f8fafc; padding: 16px; border-radius: 6px; overflow-x: auto; font-size: 0.85rem; border: 1px solid #e2e8f0; margin: 0; white-space: pre-wrap; word-break: break-all; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Personal Data Export</h1>
    <div class="meta">
      <div><strong>Export ID:</strong> ${bundle.export_id}</div>
      <div><strong>Generated:</strong> ${new Date(bundle.generated_at).toLocaleString()}</div>
      <div><strong>Employee:</strong> ${profile.full_name || profile.name || email} (${email})</div>
      <div><strong>Legal Basis:</strong> ${bundle.pdpl_article}</div>
      <div><strong>Data Controller:</strong> ${bundle.company}</div>
    </div>
    
    <h2>Core Account & Profile</h2>
    <h3>User Account Record</h3>
    <pre>${JSON.stringify(bundle.records.user_account, null, 2)}</pre>
    
    <h3>Employment Record</h3>
    <pre>${JSON.stringify(bundle.records.employee_record, null, 2)}</pre>
    
    <h2>System Records & Activity</h2>
    ${Object.entries(bundle.records).filter(([k]) => k !== 'user_account' && k !== 'employee_record').map(([k, v]) => `
      <h3>${k.replace(/_/g, ' ').toUpperCase()} (${Array.isArray(v) ? v.length : (v ? 1 : 0)} records)</h3>
      ${Array.isArray(v) && v.length > 0 ? `
        <table>
          <thead>
            <tr><th style="width: 25%">Record ID / Path</th><th>Data Attributes</th></tr>
          </thead>
          <tbody>
            ${v.map(r => `<tr><td><code style="font-size:0.8rem;color:#022873">${r._path || r._id || '-'}</code></td><td><pre>${JSON.stringify(r, null, 2)}</pre></td></tr>`).join('')}
          </tbody>
        </table>
      ` : `<p style="color:#64748b; font-style: italic;">No records found in this category.</p>`}
    `).join('')}
  </div>
</body>
</html>
      `

      // Trigger browser download.
      const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const safeName = (profile.full_name || profile.name || email).replace(/[^A-Za-z0-9_-]+/g, '_')
      a.href = url
      a.download = `PDPL_Data_Export_${safeName}_${new Date().toISOString().slice(0,10)}.html`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 4000)

      setDsrMsg({ kind: 'success', text: 'Your data was exported. The download has started.' })
    } catch (e) {
      setDsrMsg({ kind: 'error', text: e.message || 'Could not export your data.' })
    } finally {
      setDsrWorking(null)
    }
  }

  // ── PDPL Art. 18 — Request Data Deletion ─────────────────────────
  async function handleRequestDeletion() {
    if (!window.confirm(
      'This will request deletion of your personal data. This action is irreversible.\n\n' +
      'HR will review your request within 30 days per PDPL Article 18. Financial records ' +
      'we are legally required to retain (e.g. ZATCA) cannot be deleted.\n\nProceed?'
    )) return

    setDsrWorking('delete'); setDsrMsg({ kind: '', text: '' })
    try {
      const me = auth.currentUser
      if (!me) throw new Error('Not signed in.')
      const email = String(me.email || '').toLowerCase()
      const empId = empDocId || profile.employee_id || null

      let ip = null
      try {
        const ctrl = new AbortController()
        const t = setTimeout(() => ctrl.abort(), 2000)
        const r = await fetch('https://api.ipify.org?format=json', { signal: ctrl.signal })
        clearTimeout(t)
        if (r.ok) { const j = await r.json(); ip = j.ip || null }
      } catch { ip = null }

      await addDoc(collection(db, 'dsr_requests'), {
        request_type: 'DELETION',
        status: 'PENDING',
        employee_id: empId,
        employee_email: email,
        requested_by_uid: me.uid,
        requested_at: serverTimestamp(),
        ip_address: ip,
        user_agent: navigator.userAgent,
        pdpl_article: 'Art. 18 — Right to Erasure',
        notes: 'Submitted by the data subject from the employee profile page. ' +
               'HR must review before any deletion takes place — active employees cannot be deleted.',
      })

      setDsrMsg({
        kind: 'success',
        text: 'Your deletion request has been submitted. HR will process it within 30 days per PDPL Article 18.',
      })
    } catch (e) {
      setDsrMsg({ kind: 'error', text: e.message || 'Could not submit the deletion request.' })
    } finally {
      setDsrWorking(null)
    }
  }

  // ── Change Password — re-authenticate then updatePassword ────────
  // Firebase requires a recent login to change a password, so we re-auth with
  // the current password first. The new password is enforced both client-side
  // (live checklist below) and server-side (updatePassword rejects a password
  // that fails the project policy with auth/password-does-not-meet-requirements).
  async function handleChangePassword(e) {
    e.preventDefault()
    setPwMsg({ kind: '', text: '' })
    const { current, next, confirm } = pwForm
    if (!evaluatePassword(next).allMet) {
      setPwMsg({ kind: 'error', text: 'Your new password does not meet every requirement below.' }); return
    }
    if (next !== confirm) {
      setPwMsg({ kind: 'error', text: 'The new password and confirmation do not match.' }); return
    }
    const user = auth.currentUser
    if (!user?.email) { setPwMsg({ kind: 'error', text: 'You are not signed in. Please sign in again.' }); return }
    setPwSaving(true)
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, current))
      await updatePassword(user, next)
      setPwForm({ current: '', next: '', confirm: '' })
      setPwMsg({ kind: 'success', text: 'Your password has been updated.' })
    } catch (err) {
      const c = String(err?.code || '').toLowerCase()
      let text = 'Could not change your password. Please try again.'
      if (c.includes('wrong-password') || c.includes('invalid-credential')) text = 'Your current password is incorrect.'
      else if (c.includes('weak-password') || c.includes('password-does-not-meet-requirements')) text = 'That password does not meet the security requirements.'
      else if (c.includes('too-many-requests')) text = 'Too many attempts — please try again in a minute.'
      else if (c.includes('requires-recent-login')) text = 'For security, please sign out and sign back in, then change your password.'
      setPwMsg({ kind: 'error', text })
    } finally {
      setPwSaving(false)
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

      {/* Change Password */}
      <div className="profile-section animate-fade-in-up">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <KeyRound size={20} style={{ color: 'var(--text-tertiary)' }} />
          <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>Change Password</h3>
        </div>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-tertiary)', marginBottom: 16, lineHeight: 1.6 }}>
          Choose a strong password that meets every requirement below. You'll need your current password to confirm it's you.
        </p>
        <form onSubmit={handleChangePassword} style={{ maxWidth: 380 }}>
          <div style={{ position: 'relative', marginBottom: 10 }}>
            <input
              className="form-input" type={pwShow ? 'text' : 'password'} autoComplete="current-password"
              placeholder="Current password" value={pwForm.current}
              onChange={e => setPwForm(f => ({ ...f, current: e.target.value }))}
              style={{ width: '100%', boxSizing: 'border-box', paddingRight: 40 }}
            />
            <button type="button" onClick={() => setPwShow(s => !s)} aria-label={pwShow ? 'Hide passwords' : 'Show passwords'}
              style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: 4, display: 'flex' }}>
              {pwShow ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <input
            className="form-input" type={pwShow ? 'text' : 'password'} autoComplete="new-password"
            placeholder="New password" value={pwForm.next}
            onChange={e => setPwForm(f => ({ ...f, next: e.target.value }))}
            style={{ width: '100%', boxSizing: 'border-box', marginBottom: 10 }}
          />
          <input
            className="form-input" type={pwShow ? 'text' : 'password'} autoComplete="new-password"
            placeholder="Confirm new password" value={pwForm.confirm}
            onChange={e => setPwForm(f => ({ ...f, confirm: e.target.value }))}
            style={{ width: '100%', boxSizing: 'border-box' }}
          />
          {pwForm.next !== '' && <PasswordChecklist password={pwForm.next} confirm={pwForm.confirm} />}
          {pwMsg.text && (
            <div style={{
              marginTop: 12, padding: '10px 14px', borderRadius: 8,
              background: pwMsg.kind === 'error' ? 'rgba(192,57,43,0.10)' : 'rgba(52,191,58,0.10)',
              border: '1px solid ' + (pwMsg.kind === 'error' ? 'rgba(192,57,43,0.30)' : 'rgba(52,191,58,0.30)'),
              color: pwMsg.kind === 'error' ? '#C0392B' : '#1f7a2a',
              fontSize: '0.82rem', display: 'flex', alignItems: 'flex-start', gap: 8,
            }}>
              {pwMsg.kind === 'error' ? <AlertCircle size={13} /> : <Check size={13} />}
              <span>{pwMsg.text}</span>
            </div>
          )}
          <button type="submit" className="btn btn-primary btn-sm" disabled={pwSaving} style={{ marginTop: 14 }}>
            {pwSaving ? <Loader size={14} className="spin" /> : <KeyRound size={14} />}
            {pwSaving ? ' Updating…' : ' Update Password'}
          </button>
        </form>
      </div>

      {/* Two-Factor Authentication (dormant until VITE_MFA_ENABLED + Identity Platform) */}
      <MfaEnrollment />

      {/* PDPL Actions */}
      <div className="profile-section animate-fade-in-up" style={{ background: 'var(--bg-surface)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <Shield size={20} style={{ color: 'var(--text-tertiary)' }} />
          <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>Data Privacy (PDPL)</h3>
        </div>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-tertiary)', marginBottom: 16, lineHeight: 1.6 }}>
          Under the Saudi Personal Data Protection Law (PDPL), you have the right to access your data and request its deletion.
        </p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={handleDownloadMyData}
            disabled={dsrWorking !== null}
            title="Generates a JSON file of every record about you across the platform."
          >
            {dsrWorking === 'export' ? <Loader size={14} className="spin" /> : <Download size={14} />}
            {dsrWorking === 'export' ? ' Collecting…' : ' Download My Data (PDPL Art. 15)'}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            style={{ color: 'var(--red)' }}
            onClick={handleRequestDeletion}
            disabled={dsrWorking !== null}
            title="Creates a deletion request that HR reviews within 30 days."
          >
            {dsrWorking === 'delete' ? <Loader size={14} className="spin" /> : <Trash2 size={14} />}
            {dsrWorking === 'delete' ? ' Submitting…' : ' Request Data Deletion (PDPL Art. 18)'}
          </button>
        </div>
        {dsrMsg.text && (
          <div style={{
            marginTop: 12, padding: '10px 14px', borderRadius: 8,
            background: dsrMsg.kind === 'error' ? 'rgba(192,57,43,0.10)' : 'rgba(52,191,58,0.10)',
            border: '1px solid ' + (dsrMsg.kind === 'error' ? 'rgba(192,57,43,0.30)' : 'rgba(52,191,58,0.30)'),
            color: dsrMsg.kind === 'error' ? '#C0392B' : '#1f7a2a',
            fontSize: '0.82rem', display: 'flex', alignItems: 'flex-start', gap: 8,
          }}>
            {dsrMsg.kind === 'error' ? <AlertCircle size={13} /> : <Check size={13} />}
            <span>{dsrMsg.text}</span>
          </div>
        )}
      </div>
    </div>
  )
}
