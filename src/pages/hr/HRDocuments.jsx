import { useState, useEffect, useMemo } from 'react'
import {
  collection, query, where, onSnapshot, addDoc, orderBy, getDocs, serverTimestamp,
} from 'firebase/firestore'
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, auth } from '../../lib/firebase'
import {
  FileText, Upload, Download, Search, User, Loader, AlertTriangle, CheckCircle,
  Plane, FolderOpen, X,
} from 'lucide-react'

// Categories mirror the employee Documents page (single source) + travel-relevant types.
const DOC_CATEGORIES = ['Contract', 'ID/Passport', 'Visa', 'NDA', 'Policy', 'Certificate', 'Medical', 'Other']

export default function HRDocuments() {
  const [employees, setEmployees] = useState([])
  const [loadingEmps, setLoadingEmps] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)        // selected engineer
  const [docs, setDocs] = useState([])
  const [loadingDocs, setLoadingDocs] = useState(false)
  const [error, setError] = useState(null)
  const [toast, setToast] = useState(null)
  const [showUpload, setShowUpload] = useState(false)
  const [uploadForm, setUploadForm] = useState({ title: '', category: DOC_CATEGORIES[0], notes: '' })
  const [file, setFile] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 4000) }

  // ── Load engineers (canonical: employees, ACTIVE) ──
  useEffect(() => {
    const q = query(collection(db, 'employees'))
    const unsub = onSnapshot(q, snap => {
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(e => (e.employment_status || e.status || '').toUpperCase() !== 'TERMINATED')
        .map(e => ({
          id: e.id,
          employee_id: e.employee_id || e.id,
          name: e.full_name || e.name || e.email || e.employee_id,
          email: (e.email || '').toLowerCase(),
        }))
        .filter(e => e.email)
        .sort((a, b) => a.name.localeCompare(b.name))
      setEmployees(rows)
      setLoadingEmps(false)
    }, err => { setError(err); setLoadingEmps(false) })
    return () => unsub()
  }, [])

  // ── Load the selected engineer's documents: employee_documents + the
  //    canonical contracts collection (mapped by employee_id), merged. ──
  useEffect(() => {
    if (!selected) { setDocs([]); return }
    setLoadingDocs(true)
    let empDocs = []
    let contractDocs = []
    const merge = () => setDocs([...empDocs, ...contractDocs].sort((a, b) => (b._ts || 0) - (a._ts || 0)))

    const unsubD = onSnapshot(
      query(collection(db, 'employee_documents'), where('engineer_email', '==', selected.email)),
      snap => {
        empDocs = snap.docs.map(d => { const x = { id: d.id, ...d.data() }; return { ...x, _ts: x.created_at?.seconds || 0 } })
        merge(); setLoadingDocs(false)
      }, err => { setError(err); setLoadingDocs(false) })

    // Contracts mapped to this engineer (by linked_employee_id / employee_id).
    const unsubC = onSnapshot(collection(db, 'contracts'), snap => {
      contractDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(c => (c.linked_employee_id || c.employee_id) === selected.employee_id)
        .map(c => ({
          id: 'contract-' + c.id,
          title: c.contract_pdf_filename || c.original_filename || 'Employment Contract',
          category: 'Contract',
          created_at: c.created_at || c.uploaded_at,
          _ts: (c.created_at || c.uploaded_at)?.seconds || 0,
          uploaded_by: 'system',
          _isContract: true,
          _status: c.status || c.contract_extraction_status || '—',
        }))
      merge(); setLoadingDocs(false)
    }, () => {})

    return () => { unsubD(); unsubC() }
  }, [selected])

  const filteredEmployees = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return employees
    return employees.filter(e => e.name.toLowerCase().includes(s) || e.employee_id.toLowerCase().includes(s) || e.email.includes(s))
  }, [employees, search])

  const handleUpload = async () => {
    if (!selected) { showToast('Pick an engineer first', 'error'); return }
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
        engineer_email: selected.email,
        engineer_name: selected.name,
        employee_id: selected.employee_id,
        status: 'UPLOADED',
        uploaded_by: 'hr',
        uploaded_by_email: (auth.currentUser?.email || '').toLowerCase(),
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
        file_url: fileUrl,
        file_name: file.name,
      })
      showToast(`Uploaded "${uploadForm.title}" for ${selected.name}`)
      setUploadForm({ title: '', category: DOC_CATEGORIES[0], notes: '' })
      setFile(null)
      setShowUpload(false)
    } catch (err) {
      showToast('Upload failed: ' + err.message, 'error')
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
        <AlertTriangle size={32} style={{ color: 'var(--red, #EF5829)', marginBottom: 8 }} />
        <h3 style={{ marginBottom: 8 }}>Unable to load documents</h3>
        <p style={{ color: 'var(--text-secondary)' }}>{error.message || 'A network error occurred.'}</p>
        <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => window.location.reload()}>Retry</button>
      </div>
    )
  }

  return (
    <div style={{ position: 'relative', minHeight: '100%' }}>
      {toast && (
        <div className="animate-fade-in-up" style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999, padding: '12px 20px', borderRadius: 10,
          fontSize: '0.85rem', fontWeight: 600, color: '#fff',
          background: toast.type === 'error' ? 'rgba(192,57,43,0.95)' : 'rgba(52,191,58,0.95)',
          display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
        }}>
          {toast.type === 'error' ? <AlertTriangle size={16} /> : <CheckCircle size={16} />} {toast.msg}
        </div>
      )}

      <div className="flex-between" style={{ marginBottom: 8 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Employee Documents</h1>
      </div>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.86rem', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Plane size={15} /> Retrieve any engineer's contracts, passports & IDs — e.g. for travel arrangements.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 20, alignItems: 'start' }}>
        {/* ── Engineer list ── */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: 14, borderBottom: '1px solid var(--border-primary)' }}>
            <div style={{ position: 'relative' }}>
              <Search size={15} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-tertiary)' }} />
              <input className="form-input" style={{ paddingLeft: 32 }} placeholder="Search engineer / DLSA#"
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>
          <div style={{ maxHeight: '70vh', overflowY: 'auto' }}>
            {loadingEmps ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)' }}>
                <Loader size={20} className="spin" />
              </div>
            ) : filteredEmployees.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.84rem' }}>No engineers found</div>
            ) : filteredEmployees.map(e => (
              <button key={e.id} onClick={() => setSelected(e)}
                style={{
                  width: '100%', textAlign: 'left', padding: '11px 14px', border: 'none', cursor: 'pointer',
                  borderBottom: '1px solid var(--border-primary)', display: 'flex', alignItems: 'center', gap: 10,
                  background: selected?.id === e.id ? 'rgba(21,152,204,0.12)' : 'transparent',
                  color: 'inherit', fontFamily: 'inherit',
                }}>
                <User size={16} color="var(--text-tertiary)" />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.88rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.name}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>{e.employee_id}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* ── Selected engineer's documents ── */}
        <div>
          {!selected ? (
            <div className="card" style={{ padding: 56, textAlign: 'center', color: 'var(--text-tertiary)' }}>
              <FolderOpen size={40} style={{ opacity: 0.3, marginBottom: 12 }} />
              <div>Select an engineer to view their documents</div>
            </div>
          ) : (
            <>
              <div className="flex-between" style={{ marginBottom: 16 }}>
                <div>
                  <h2 style={{ fontSize: '1.15rem', fontWeight: 700 }}>{selected.name}</h2>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>{selected.employee_id} · {selected.email}</div>
                </div>
                <button className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => setShowUpload(true)}>
                  <Upload size={16} /> Upload for {selected.name.split(' ')[0]}
                </button>
              </div>

              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {loadingDocs ? (
                  <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-tertiary)' }}><Loader size={22} className="spin" /></div>
                ) : docs.length === 0 ? (
                  <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-tertiary)' }}>
                    <FileText size={36} style={{ opacity: 0.3, marginBottom: 10 }} />
                    <div>No documents for {selected.name} yet</div>
                  </div>
                ) : (
                  <table className="data-table">
                    <thead><tr><th>Document</th><th>Category</th><th>Added</th><th>Source</th><th></th></tr></thead>
                    <tbody>
                      {docs.map(d => (
                        <tr key={d.id}>
                          <td style={{ fontWeight: 600 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <FileText size={16} color="var(--text-tertiary)" /> {d.title}
                            </div>
                          </td>
                          <td><span className="badge badge-info">{d.category}</span></td>
                          <td style={{ fontSize: '0.82rem' }}>{fmtDate(d.created_at)}</td>
                          <td style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>{d._isContract ? 'Contract record' : d.uploaded_by === 'hr' ? 'HR' : 'Employee'}</td>
                          <td>
                            {d._isContract ? (
                              <a href="/hr/contracts" className="btn btn-outline"
                                style={{ padding: '6px 12px', fontSize: '0.76rem', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                <FileText size={12} /> Open in Contracts
                              </a>
                            ) : d.file_url ? (
                              <a href={d.file_url} target="_blank" rel="noopener noreferrer" className="btn btn-outline"
                                style={{ padding: '6px 12px', fontSize: '0.76rem', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                <Download size={12} /> Download
                              </a>
                            ) : <span style={{ fontSize: '0.76rem', color: 'var(--text-tertiary)' }}>No file</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Upload modal ── */}
      {showUpload && selected && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }} onClick={() => setShowUpload(false)} />
          <div className="animate-fade-in-up card" style={{ position: 'relative', width: '90%', maxWidth: 520 }}>
            <div className="flex-between" style={{ marginBottom: 18 }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Upload for {selected.name}</h3>
              <button className="btn btn-ghost" style={{ padding: 4 }} onClick={() => setShowUpload(false)}><X size={20} /></button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
              <div className="form-group">
                <label className="form-label">Title *</label>
                <input className="form-input" value={uploadForm.title}
                  onChange={e => setUploadForm(p => ({ ...p, title: e.target.value }))} placeholder="e.g. Passport Copy" />
              </div>
              <div className="form-group">
                <label className="form-label">Category</label>
                <select className="form-input" value={uploadForm.category} onChange={e => setUploadForm(p => ({ ...p, category: e.target.value }))}>
                  {DOC_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group" style={{ marginBottom: 14 }}>
              <label className="form-label">File *</label>
              <input className="form-input" type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" onChange={e => setFile(e.target.files[0] || null)} />
            </div>
            <div className="form-group" style={{ marginBottom: 20 }}>
              <label className="form-label">Notes (optional)</label>
              <input className="form-input" value={uploadForm.notes} onChange={e => setUploadForm(p => ({ ...p, notes: e.target.value }))} placeholder="Any notes" />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setShowUpload(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleUpload} disabled={submitting}>
                {submitting ? <Loader size={16} className="spin" /> : <Upload size={16} />}
                {submitting ? ' Uploading…' : ' Upload'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
