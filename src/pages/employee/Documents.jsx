import { useState, useEffect } from 'react'
import { collection, addDoc, query, where, onSnapshot, updateDoc, doc, serverTimestamp } from 'firebase/firestore'
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, auth, LIST_MY_PAYSLIPS_URL, GENERATE_PDF_URL } from '../../lib/firebase'
import { FileText, Upload, CheckCircle, Clock, AlertTriangle, Download, Eye, Loader, Shield, Mail, X, DollarSign } from 'lucide-react'

const DOC_CATEGORIES = ['Contract', 'NDA', 'Policy', 'Certificate', 'ID/Passport', 'Medical', 'Payslip', 'Other']

const statusConfig = {
  PENDING_ACK: { label: 'Action Required', color: '#EF5829', bg: 'rgba(239,88,41,0.12)', icon: AlertTriangle },
  ACKNOWLEDGED: { label: 'Acknowledged', color: '#34BF3A', bg: 'rgba(52,191,58,0.12)', icon: CheckCircle },
  UPLOADED: { label: 'Uploaded', color: '#1598CC', bg: 'rgba(21,152,204,0.12)', icon: Upload },
  SIGNED: { label: 'Signed', color: '#34BF3A', bg: 'rgba(52,191,58,0.12)', icon: Shield },
}

export default function Documents() {
  const [documents, setDocuments] = useState([])
  const [showUpload, setShowUpload] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [toast, setToast] = useState(null)
  const [uploadForm, setUploadForm] = useState({ title: '', category: DOC_CATEGORIES[0], notes: '' })
  const [file, setFile] = useState(null)
  const [ackModal, setAckModal] = useState(null)
  const [showRequest, setShowRequest] = useState(false)
  const [requestForm, setRequestForm] = useState({ type: 'Salary Certificate', addressee: '', reason: '' })

  const [userEmail, setUserEmail] = useState(null)
  const [userName, setUserName] = useState('')
  const [payslips, setPayslips] = useState([])
  const [payslipsLoading, setPayslipsLoading] = useState(true)

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(user => {
      if (user) { setUserEmail(user.email); setUserName(user.displayName || user.email) }
    })
    return () => unsub()
  }, [])

  // Pull this employee's payslips via the listMyPayslips Cloud Function. The
  // backend resolves employee_id from the auth token's email, then returns the
  // line item from every APPROVED payroll_run that contains them.
  useEffect(() => {
    if (!userEmail) return
    let alive = true
    ;(async () => {
      try {
        const me = auth.currentUser
        const idToken = await me.getIdToken()
        const res = await fetch(LIST_MY_PAYSLIPS_URL, { headers: { Authorization: 'Bearer ' + idToken } })
        const data = await res.json().catch(() => ({}))
        if (alive) setPayslips(data.payslips || [])
      } catch (err) {
        console.warn('listMyPayslips failed:', err.message)
      } finally {
        if (alive) setPayslipsLoading(false)
      }
    })()
    return () => { alive = false }
  }, [userEmail])

  const downloadPayslip = async (payrollRunId, period) => {
    try {
      const me = auth.currentUser
      const idToken = await me.getIdToken()
      const empQ = await import('firebase/firestore').then(m => m.getDocs(m.query(m.collection(db, 'employees'), m.where('email', '==', userEmail), m.limit(1))))
      const employeeId = !empQ.empty ? (empQ.docs[0].data().employee_id || empQ.docs[0].id) : null
      if (!employeeId) { showToast('Could not resolve your employee ID.', 'error'); return }
      const url = `${GENERATE_PDF_URL}?template=payslip&docId=${encodeURIComponent(payrollRunId + '__' + employeeId)}`
      const res = await fetch(url, { headers: { Authorization: 'Bearer ' + idToken } })
      if (!res.ok) throw new Error(`PDF ${res.status}`)
      const blob = await res.blob()
      const a = document.createElement('a')
      const dlUrl = URL.createObjectURL(blob)
      a.href = dlUrl; a.download = `payslip-${period}.pdf`; a.click()
      setTimeout(() => URL.revokeObjectURL(dlUrl), 2000)
    } catch (err) {
      showToast('Payslip download failed: ' + err.message, 'error')
    }
  }

  useEffect(() => {
    if (!userEmail) return
    const q = query(collection(db, 'employee_documents'), where('engineer_email', '==', userEmail))
    const unsub = onSnapshot(q, snap => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      data.sort((a, b) => (b.created_at?.seconds || 0) - (a.created_at?.seconds || 0))
      setDocuments(data)
      setLoading(false)
    }, err => {
      console.warn('Documents listener:', err.message)
      setError(err)
      setLoading(false)
    })
    return () => unsub()
  }, [userEmail])

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type }); setTimeout(() => setToast(null), 4000)
  }

  const actionRequired = documents.filter(d => d.status === 'PENDING_ACK')
  const myDocs = documents.filter(d => d.status !== 'PENDING_ACK')

  const handleUpload = async () => {
    if (!uploadForm.title || uploadForm.title.length < 3) { showToast('Title is required', 'error'); return }
    if (!file) { showToast('File is required', 'error'); return }

    setSubmitting(true)
    try {
      const docId = `DOC-${Date.now()}-${Math.floor(Math.random() * 1000)}`
      
      const storage = getStorage()
      const fileRef = ref(storage, `datalake-worm-hr/employee_documents/${docId}-${file.name}`)
      await uploadBytes(fileRef, file)
      const fileUrl = await getDownloadURL(fileRef)

      await addDoc(collection(db, 'employee_documents'), {
        document_id: docId,
        title: uploadForm.title,
        category: uploadForm.category,
        notes: uploadForm.notes || null,
        engineer_email: userEmail,
        engineer_name: userName,
        status: 'UPLOADED',
        uploaded_by: 'employee',
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
        acknowledged_at: null,
        file_url: fileUrl,
      })
      showToast(`Document "${uploadForm.title}" uploaded`)
      setUploadForm({ title: '', category: DOC_CATEGORIES[0], notes: '' })
      setFile(null)
      setShowUpload(false)
    } catch (err) {
      showToast(`Failed: ${err.message}`, 'error')
    }
    setSubmitting(false)
  }

  const handleAcknowledge = async (docItem) => {
    setSubmitting(true)
    try {
      await updateDoc(doc(db, 'employee_documents', docItem.id), {
        status: 'ACKNOWLEDGED',
        acknowledged_at: serverTimestamp(),
        acknowledged_by: userEmail,
        updated_at: serverTimestamp(),
      })
      showToast(`"${docItem.title}" acknowledged`)
      setAckModal(null)
    } catch (err) {
      showToast(`Failed: ${err.message}`, 'error')
    }
    setSubmitting(false)
  }

  const handleRequestLetter = async () => {
    if (!requestForm.addressee || !requestForm.reason) { showToast('Please fill all fields', 'error'); return }
    setSubmitting(true)
    try {
      await addDoc(collection(db, 'document_requests'), {
        type: requestForm.type,
        addressee: requestForm.addressee,
        reason: requestForm.reason,
        engineer_email: userEmail,
        engineer_name: userName,
        status: 'PENDING',
        created_at: serverTimestamp()
      })
      showToast('Letter request submitted successfully')
      setShowRequest(false)
      setRequestForm({ type: 'Salary Certificate', addressee: '', reason: '' })
    } catch(err) {
      showToast(err.message, 'error')
    }
    setSubmitting(false)
  }

  const fmtDate = (ts) => {
    if (!ts) return '—'
    const d = ts.toDate ? ts.toDate() : new Date(ts)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
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
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Documents</h1>
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn btn-outline" style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => setShowRequest(true)}>
            <Mail size={16} /> Request Letter
          </button>
          <button className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => setShowUpload(!showUpload)}>
            <Upload size={16} /> Upload Document
          </button>
        </div>
      </div>

      {/* My Payslips — pulled from payroll_runs the platform owns end-to-end. */}
      <div className="card animate-fade-in-up" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <DollarSign size={18} color="#022873" />
          <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>My Payslips</h3>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginLeft: 6 }}>
            {payslipsLoading ? 'loading…' : `${payslips.length} approved`}
          </span>
        </div>
        {payslipsLoading ? (
          <div style={{ padding: 16, color: 'var(--text-tertiary)', fontSize: '0.86rem' }}>Loading…</div>
        ) : payslips.length === 0 ? (
          <div style={{ padding: '16px 8px', color: 'var(--text-tertiary)', fontSize: '0.86rem' }}>
            No payslips yet. Your first one will show up here once HR/CEO approves the next payroll run.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ width: '100%', fontSize: '0.86rem' }}>
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Basic</th>
                  <th>Housing</th>
                  <th>Transport</th>
                  <th>GOSI</th>
                  <th>Net Pay</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {payslips.map(p => (
                  <tr key={p.payroll_run_id}>
                    <td style={{ fontWeight: 600 }}>{p.period}</td>
                    <td>SAR {Math.round(p.base_salary || 0).toLocaleString()}</td>
                    <td>SAR {Math.round(p.housing || 0).toLocaleString()}</td>
                    <td>SAR {Math.round(p.transport || 0).toLocaleString()}</td>
                    <td style={{ color: 'var(--text-tertiary)' }}>SAR {Math.round(p.gosi_employee || 0).toLocaleString()}</td>
                    <td style={{ fontWeight: 700 }}>SAR {Math.round(p.net_pay || 0).toLocaleString()}</td>
                    <td>
                      <button onClick={() => downloadPayslip(p.payroll_run_id, p.period)} className="btn btn-outline" style={{ padding: '6px 12px', fontSize: '0.76rem', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Download size={12} /> Download
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Action Required Banner */}
      {actionRequired.length > 0 && (
        <div className="card animate-fade-in-up" style={{
          marginBottom: 24, borderLeft: '4px solid #EF5829',
          background: 'rgba(239,88,41,0.06)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <AlertTriangle size={18} color="#EF5829" />
            <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#EF5829' }}>
              Action Required ({actionRequired.length})
            </h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {actionRequired.map(d => (
              <div key={d.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 16px', borderRadius: 8, background: 'var(--bg-card)',
                border: '1px solid var(--border-card)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <FileText size={18} color="#EF5829" />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{d.title}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>{d.category} · Added {fmtDate(d.created_at)}</div>
                  </div>
                </div>
                <button className="btn btn-primary" style={{ padding: '6px 16px', fontSize: '0.82rem' }}
                  onClick={() => setAckModal(d)}>
                  <Eye size={14} /> Review & Acknowledge
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upload Form */}
      {showUpload && (
        <div className="card animate-fade-in-up" style={{ marginBottom: 24 }}>
          <h3 style={{ marginBottom: 20, fontSize: '1.1rem', fontWeight: 700 }}>Upload Document</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div className="form-group">
              <label className="form-label">Document Title *</label>
              <input className="form-input" value={uploadForm.title}
                onChange={e => setUploadForm(p => ({ ...p, title: e.target.value }))}
                placeholder="e.g. Passport Copy, Medical Certificate" />
            </div>
            <div className="form-group">
              <label className="form-label">Category</label>
              <select className="form-input" value={uploadForm.category}
                onChange={e => setUploadForm(p => ({ ...p, category: e.target.value }))}>
                {DOC_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group" style={{ marginBottom: 16 }}>
            <label className="form-label">File *</label>
            <input className="form-input" type="file" accept=".pdf,.jpg,.png,.doc,.docx" 
              onChange={e => setFile(e.target.files[0] || null)} />
          </div>
          <div className="form-group" style={{ marginBottom: 20 }}>
            <label className="form-label">Notes (optional)</label>
            <input className="form-input" value={uploadForm.notes}
              onChange={e => setUploadForm(p => ({ ...p, notes: e.target.value }))}
              placeholder="Any additional notes" />
          </div>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => setShowUpload(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleUpload} disabled={submitting}>
              {submitting ? <Loader size={16} className="spin" /> : <Upload size={16} />}
              {submitting ? ' Uploading...' : ' Upload'}
            </button>
          </div>
        </div>
      )}

      {/* Documents Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-primary)' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>My Documents ({myDocs.length})</h3>
        </div>
        {myDocs.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-tertiary)' }}>
            <FileText size={40} style={{ marginBottom: 12, opacity: 0.3 }} />
            <div>No documents yet</div>
          </div>
        ) : (
          <table className="data-table">
            <thead><tr><th>Document</th><th>Category</th><th>Date</th><th>Status</th></tr></thead>
            <tbody>
              {myDocs.map(d => {
                const sc = statusConfig[d.status] || statusConfig.UPLOADED
                return (
                  <tr key={d.id}>
                    <td style={{ fontWeight: 600 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <FileText size={16} color="var(--text-tertiary)" />
                        {d.title}
                      </div>
                    </td>
                    <td><span className="badge badge-info">{d.category}</span></td>
                    <td style={{ fontSize: '0.82rem' }}>{fmtDate(d.created_at)}</td>
                    <td>
                      <span style={{
                        padding: '2px 10px', borderRadius: 12, fontSize: '0.72rem',
                        fontWeight: 600, background: sc.bg, color: sc.color,
                      }}>
                        {sc.label}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Acknowledgment Modal */}
      {ackModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
            onClick={() => setAckModal(null)} />
          <div className="animate-fade-in-up" style={{
            position: 'relative', background: 'var(--bg-card)', border: '1px solid var(--border-card)',
            borderRadius: 16, padding: 32, width: '90%', maxWidth: 500,
            boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
          }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: 8 }}>
              📄 Review Document
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 16 }}>
              <strong>{ackModal.title}</strong> · {ackModal.category}
            </p>
            {ackModal.description && (
              <div style={{
                padding: '12px 16px', borderRadius: 8, background: 'var(--bg-surface)',
                border: '1px solid var(--border-primary)', fontSize: '0.85rem',
                lineHeight: 1.6, marginBottom: 20, maxHeight: 200, overflowY: 'auto',
              }}>
                {ackModal.description}
              </div>
            )}
            <div style={{
              padding: '10px 16px', borderRadius: 8, marginBottom: 20,
              background: 'rgba(243,156,18,0.08)', border: '1px solid rgba(243,156,18,0.2)',
              fontSize: '0.82rem', color: '#F39C12',
            }}>
              ⚠️ By clicking "I Acknowledge", you confirm that you have read and understood this document.
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setAckModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => handleAcknowledge(ackModal)} disabled={submitting}>
                {submitting ? <Loader size={16} className="spin" /> : <CheckCircle size={16} />}
                {submitting ? ' Processing...' : ' I Acknowledge'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Request Letter Modal */}
      {showRequest && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
            onClick={() => setShowRequest(false)} />
          <div className="animate-fade-in-up" style={{
            position: 'relative', background: 'var(--bg-card)', border: '1px solid var(--border-card)',
            borderRadius: 16, width: '100%', maxWidth: 500, overflow: 'hidden',
            boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
          }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>Request Letter</h3>
              <button className="btn btn-ghost" style={{ padding: 4 }} onClick={() => setShowRequest(false)}><X size={20}/></button>
            </div>
            
            <div style={{ padding: 24 }}>
              <div className="form-group">
                <label className="form-label">Letter Type</label>
                <select className="form-input" value={requestForm.type} onChange={e => setRequestForm({ ...requestForm, type: e.target.value })}>
                  <option value="Salary Certificate">Salary Certificate</option>
                  <option value="Employment Proof">Employment Proof</option>
                  <option value="NOC (No Objection Certificate)">NOC (No Objection Certificate)</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Addressee (To Whom It May Concern / Bank Name, etc.) *</label>
                <input className="form-input" value={requestForm.addressee} onChange={e => setRequestForm({ ...requestForm, addressee: e.target.value })} placeholder="e.g. Al Rajhi Bank" />
              </div>
              <div className="form-group" style={{ marginBottom: 24 }}>
                <label className="form-label">Reason for Request *</label>
                <textarea className="form-input" style={{ minHeight: 80, resize: 'vertical' }} value={requestForm.reason} onChange={e => setRequestForm({ ...requestForm, reason: e.target.value })} placeholder="Briefly explain why you need this letter..." />
              </div>
              
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost" onClick={() => setShowRequest(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={handleRequestLetter} disabled={submitting}>
                  {submitting ? <Loader size={16} className="spin" /> : <Mail size={16} />}
                  {submitting ? ' Submitting...' : ' Submit Request'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
