import { useState, useEffect, useRef } from 'react'
import { FileText, Download, Upload, Shield, Filter, History, Search, CheckCircle, X } from 'lucide-react'
import { auth, UPLOAD_GRC_DOC_URL } from '../../lib/firebase'

export default function GrcLibrary() {
  const [activeTab, setActiveTab] = useState('library') // 'library', 'upload', 'changelog'
  const [userRole, setUserRole] = useState(null)
  
  useEffect(() => {
    async function loadRole() {
      if (auth.currentUser) {
        if (auth.currentUser.email === 'm.alqumri@datalake.sa') {
          setUserRole('ceo')
        } else {
          setUserRole('engineer')
        }
      }
    }
    loadRole()
  }, [])

  return (
    <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 4 }}>GRC Document Center</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Immutable, auditable repository for all corporate policies, procedures, and evidence.</p>
        </div>
        <div style={{ display: 'flex', background: 'rgba(0,0,0,0.2)', padding: 4, borderRadius: 8, border: '1px solid var(--border-primary)' }}>
          <button 
            onClick={() => setActiveTab('library')}
            style={{ padding: '8px 16px', background: activeTab === 'library' ? 'var(--sky)' : 'transparent', color: activeTab === 'library' ? '#fff' : 'var(--text-secondary)', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem', transition: 'all 0.2s' }}
          >
            Library
          </button>
          {(userRole === 'ceo' || userRole === 'compliance_lead') && (
            <>
              <button 
                onClick={() => setActiveTab('upload')}
                style={{ padding: '8px 16px', background: activeTab === 'upload' ? 'var(--sky)' : 'transparent', color: activeTab === 'upload' ? '#fff' : 'var(--text-secondary)', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem', transition: 'all 0.2s' }}
              >
                Upload
              </button>
              <button 
                onClick={() => setActiveTab('changelog')}
                style={{ padding: '8px 16px', background: activeTab === 'changelog' ? 'var(--sky)' : 'transparent', color: activeTab === 'changelog' ? '#fff' : 'var(--text-secondary)', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem', transition: 'all 0.2s' }}
              >
                Change Log
              </button>
            </>
          )}
        </div>
      </div>

      {activeTab === 'library' && <LibraryTab />}
      {activeTab === 'upload' && <UploadTab />}
      {activeTab === 'changelog' && <ChangeLogTab />}
    </div>
  )
}

function LibraryTab() {
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Simulated fetch from new backend
    setTimeout(() => {
      setDocs([]) // Starts empty per instructions
      setLoading(false)
    }, 500)
  }, [])

  return (
    <div>
      <div className="card" style={{ marginBottom: 24, padding: '16px 20px', display: 'flex', gap: 16, alignItems: 'center', background: 'rgba(21, 152, 204, 0.05)' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <Search size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
          <input 
            type="text" placeholder="Search by Document ID or Title..." 
            style={{ width: '100%', padding: '10px 14px 10px 40px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-primary)', borderRadius: 8, color: 'var(--text-primary)', outline: 'none' }}
          />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select style={{ padding: '10px 14px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-primary)', borderRadius: 8, color: 'var(--text-primary)', outline: 'none' }}>
            <option>All Types</option><option>Policies (POL)</option><option>Procedures (PROC)</option><option>Forms (FORM)</option>
          </select>
          <select style={{ padding: '10px 14px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-primary)', borderRadius: 8, color: 'var(--text-primary)', outline: 'none' }}>
            <option>All Domains</option><option>SEC</option><option>HRM</option><option>GRC</option>
          </select>
        </div>
      </div>

      <div className="card" style={{ padding: 0, minHeight: 300, display: 'flex', flexDirection: 'column' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>Loading library...</div>
        ) : docs.length === 0 ? (
          <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text-tertiary)', padding: 40 }}>
            <FileText size={48} style={{ margin: '0 auto 16px', opacity: 0.2 }} />
            <h3 style={{ fontSize: '1.1rem', color: 'var(--text-secondary)', marginBottom: 8 }}>Library Empty</h3>
            <p style={{ fontSize: '0.85rem', maxWidth: 300, margin: '0 auto' }}>No documents have been uploaded to the GRC Library yet. Use the Upload tab to populate the repository.</p>
          </div>
        ) : (
          <table className="data-table">
            <thead><tr><th>Document ID</th><th>Title</th><th>Domain</th><th>Version</th><th>Classification</th><th>Actions</th></tr></thead>
            <tbody>
              {/* Rows will go here */}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function UploadTab() {
  const [filesData, setFilesData] = useState([])
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadResults, setUploadResults] = useState([])
  const [uploadError, setUploadError] = useState('')
  const fileRef = useRef(null)

  const onFiles = (fileList) => {
    if (!fileList || fileList.length === 0) return
    const newFiles = []
    let err = ''
    Array.from(fileList).forEach(f => {
      const valid = /\.(pdf|docx|doc|xlsx|md)$/i.test(f.name)
      if (!valid) err = 'Unsupported file type found. Use .pdf, .docx, .xlsx, or .md'
      else if (f.size > 25 * 1024 * 1024) err = 'File too large found (max 25 MB)'
      else {
        const title = f.name.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " ")
        newFiles.push({ file: f, doc_id: '', doc_title: title, update_type: 'minor', classification: 'Internal', change_summary: '' })
      }
    })
    if (err) setUploadError(err)
    if (newFiles.length > 0) {
      setFilesData(prev => [...prev, ...newFiles])
      setUploadError('')
    }
  }

  const handleRemove = (index) => {
    setFilesData(prev => prev.filter((_, i) => i !== index))
  }

  const updateFileData = (index, key, val) => {
    setFilesData(prev => {
      const arr = [...prev]
      arr[index][key] = val
      return arr
    })
  }

  const handleSubmit = async () => {
    if (filesData.length === 0 || uploading) return
    const invalid = filesData.find(fd => !fd.doc_id.trim() || !fd.doc_title.trim())
    if (invalid) { setUploadError('All files must have a Document ID and Title'); return }

    setUploading(true)
    setUploadError('')
    setUploadResults([])

    try {
      const user = auth.currentUser
      if (!user) throw new Error('Not authenticated')
      const idToken = await user.getIdToken()

      const results = []
      for (const fd of filesData) {
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result.split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(fd.file);
        });
        const fileExt = fd.file.name.split('.').pop().toLowerCase();

        const payload = {
          doc_id: fd.doc_id.trim(),
          doc_title: fd.doc_title.trim(),
          update_type: fd.update_type,
          classification: fd.classification,
          change_summary: fd.change_summary || '',
          file_base64: base64,
          file_format: fileExt
        };

        const res = await fetch(UPLOAD_GRC_DOC_URL, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || `Upload failed for ${fd.file.name}`)
        
        // Auto-trigger Auditor Contract Review for PDF/DOCX
        if (['pdf', 'docx'].includes(fileExt)) {
          fetch(UPLOAD_GRC_DOC_URL.replace('uploadGrcDocument', 'auditorContractReview'), {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ doc_id: fd.doc_id.trim() }),
          }).catch(e => console.error('Auditor review trigger failed:', e))
        }
        results.push(data)
      }
      setUploadResults(results)
      setFilesData([])
    } catch (err) {
      setUploadError(err.message || 'Upload failed')
    } finally { setUploading(false) }
  }

  const canSubmit = filesData.length > 0 && filesData.every(fd => fd.doc_id.trim() && fd.doc_title.trim()) && !uploading

  return (
    <div className="card" style={{ maxWidth: 900, margin: '0 auto' }}>
      <h2 style={{ fontSize: '1.2rem', marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid var(--border-primary)' }}>
        Upload GRC Documents
      </h2>
      
      <div
        style={{ border: `2px dashed ${dragOver ? 'var(--sky)' : 'var(--border-primary)'}`, borderRadius: 12, padding: 40, textAlign: 'center', marginBottom: 24, background: dragOver ? 'rgba(21,152,204,0.08)' : 'rgba(0,0,0,0.2)', cursor: 'pointer', transition: 'all 0.2s' }}
        onClick={() => fileRef.current?.click()}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); onFiles(e.dataTransfer.files) }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
      >
        <Upload size={32} style={{ color: 'var(--sky)', margin: '0 auto 12px' }} />
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Drag & Drop multiple files here</div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>Supports .docx, .pdf, .xlsx, .md (Max 25MB per file)</div>
        <input ref={fileRef} type="file" accept=".pdf,.docx,.doc,.xlsx,.md" multiple onChange={(e) => onFiles(e.target.files)} style={{ display: 'none' }} />
      </div>

      {filesData.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {filesData.map((fd, idx) => (
            <div key={idx} style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-primary)', borderRadius: 8, padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--sky)' }}>
                  <FileText size={18} /> <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{fd.file.name}</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>{(fd.file.size / 1024).toFixed(0)} KB</span>
                </div>
                <button type="button" onClick={() => handleRemove(idx)} style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer' }}><X size={18} /></button>
              </div>
              <div className="grid-2" style={{ gap: 12 }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>Document ID *</label>
                  <input type="text" className="input" placeholder="e.g. DTLK-POL-SEC-001" value={fd.doc_id} onChange={e => updateFileData(idx, 'doc_id', e.target.value)} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>Title *</label>
                  <input type="text" className="input" value={fd.doc_title} onChange={e => updateFileData(idx, 'doc_title', e.target.value)} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>Classification</label>
                  <select className="input" value={fd.classification} onChange={e => updateFileData(idx, 'classification', e.target.value)}>
                    <option>Public</option><option>Internal</option><option>Confidential</option><option>Restricted</option>
                  </select>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>Type</label>
                  <select className="input" value={fd.update_type} onChange={e => updateFileData(idx, 'update_type', e.target.value)}>
                    <option value="minor">Minor Update</option><option value="major">Major Update</option>
                  </select>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {uploadError && (
        <div style={{ padding: '10px 16px', background: 'rgba(192,57,43,0.12)', border: '1px solid rgba(192,57,43,0.3)', borderRadius: 8, color: '#ff6b6b', fontSize: '0.85rem', marginTop: 16 }}>
          {uploadError}
        </div>
      )}
      
      {uploadResults.length > 0 && (
        <div style={{ padding: '10px 16px', background: 'rgba(52,191,58,0.12)', border: '1px solid rgba(52,191,58,0.3)', borderRadius: 8, color: '#34BF3A', fontSize: '0.85rem', marginTop: 16 }}>
          <CheckCircle size={16} style={{ verticalAlign: 'middle', marginRight: 8 }} />
          Successfully uploaded {uploadResults.length} document(s).
        </div>
      )}

      <button
        className="btn btn-primary"
        disabled={!canSubmit}
        onClick={handleSubmit}
        style={{ width: '100%', marginTop: 24, display: 'flex', justifyContent: 'center', gap: 8, opacity: canSubmit ? 1 : 0.5 }}
      >
        <Shield size={16} /> {uploading ? 'Uploading All Files…' : 'Audit & Upload All to WORM Storage'}
      </button>
    </div>
  )
}

function ChangeLogTab() {
  return (
    <div className="card" style={{ padding: 0, minHeight: 400, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Immutable Audit Trail</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost btn-sm" style={{ color: 'var(--green)' }}><FileText size={14} /> Export CSV</button>
          <button className="btn btn-ghost btn-sm" style={{ color: 'var(--green)' }}><FileText size={14} /> Export XLSX</button>
        </div>
      </div>
      <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text-tertiary)', padding: 40 }}>
        <History size={48} style={{ margin: '0 auto 16px', opacity: 0.2 }} />
        <h3 style={{ fontSize: '1.1rem', color: 'var(--text-secondary)', marginBottom: 8 }}>No Audit Logs</h3>
        <p style={{ fontSize: '0.85rem', maxWidth: 300, margin: '0 auto' }}>Change log will populate automatically when documents are uploaded or downloaded.</p>
      </div>
    </div>
  )
}
