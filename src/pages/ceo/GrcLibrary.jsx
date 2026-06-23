import { useState, useEffect, useRef } from 'react'
import { FileText, Download, Upload, Shield, Filter, History, Search, CheckCircle, X, AlertTriangle, Sparkles, FileBadge } from 'lucide-react'
import {
  auth,
  UPLOAD_GRC_DOC_URL,
  LIST_GRC_DOCUMENTS_URL,
  GET_GRC_CHANGELOG_URL,
  DOWNLOAD_GRC_DOCUMENT_URL,
  EXTRACT_GRC_METADATA_URL,
} from '../../lib/firebase'
import PolicyLibrary from '../../components/PolicyLibrary'

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

// The browse/download experience now lives in the reusable, access-matrix-aware
// PolicyLibrary component (also used by the company-wide /employee/policies page).
function LibraryTab() {
  return <PolicyLibrary />
}

// Category + domain dropdowns compose the canonical doc_id format the backend
// regex (DTLK-XXX-YYY-NNN) requires. CEO no longer has to memorise the codes.
const DOC_CATEGORIES = [
  { code: 'POL',  label: 'Policy' },
  { code: 'PRO',  label: 'Procedure' },
  { code: 'FORM', label: 'Form' },
  { code: 'REG',  label: 'Register' },
  { code: 'REP',  label: 'Report' },
  { code: 'STD',  label: 'Standard' },
  { code: 'GDL',  label: 'Guideline' },
]
const DOC_DOMAINS = [
  { code: 'GRC',  label: 'GRC' },
  { code: 'HR',   label: 'HR' },
  { code: 'HRM',  label: 'HR Management' },
  { code: 'PRI',  label: 'Privacy / PDPL' },
  { code: 'SEC',  label: 'Information Security' },
  { code: 'ITS',  label: 'IT Security' },
  { code: 'FIN',  label: 'Finance' },
  { code: 'RSK',  label: 'Risk' },
  { code: 'OPS',  label: 'Operations' },
  { code: 'LGL',  label: 'Legal' },
]

const DOC_ID_RE = /^DTLK-[A-Z]+-[A-Z]+-\d{3,}$/

// Try to lift a canonical doc_id out of a filename like
// "DTLK-POL-PRI-001_Privacy_Policy.pdf" → "DTLK-POL-PRI-001".
function extractDocIdFromFilename(name) {
  const m = name && name.match(/(DTLK-[A-Z]+-[A-Z]+-\d{3,})/i)
  return m ? m[1].toUpperCase() : null
}

function UploadTab() {
  const [filesData, setFilesData] = useState([])
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadResults, setUploadResults] = useState([])
  const [uploadError, setUploadError] = useState('')
  const fileRef = useRef(null)
  const idCounter = useRef(0)

  const fileToBase64 = (f) => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(f)
  })

  // AI auto-mapping: read the file's OWN text and pre-fill the metadata form so the
  // operator reviews instead of typing. Strictly grounded server-side — fields the
  // document doesn't state come back empty and are flagged, never invented.
  const autoMapFile = async (uid, file) => {
    try {
      const idToken = await auth.currentUser.getIdToken()
      const base64 = await fileToBase64(file)
      const res = await fetch(EXTRACT_GRC_METADATA_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_base64: base64, file_format: file.name.split('.').pop().toLowerCase(), filename: file.name }),
      })
      const data = await res.json().catch(() => ({}))
      setFilesData(prev => prev.map(fd => {
        if (fd._id !== uid) return fd
        if (!res.ok || !data.success || !data.extracted) {
          return { ...fd, extracting: false, aiSuggested: false, aiNote: data?.reason || data?.error || 'AI could not read this file — please enter the details manually.' }
        }
        const s = data.suggestions || {}
        const cat = s.suggested_category || fd.category
        const dom = s.suggested_domain || fd.domain
        const composedId = (cat && dom) ? `DTLK-${cat}-${dom}-${String(fd.sequence || '001').padStart(3, '0')}` : fd.doc_id
        const tags = (s.framework_tags && s.framework_tags.length) ? s.framework_tags.join(', ') : fd.framework_tags
        return {
          ...fd,
          extracting: false,
          aiSuggested: true,
          aiMissing: data.missing || [],
          aiNote: '',
          doc_title: s.doc_title || fd.doc_title,
          category: cat,
          domain: dom,
          doc_id: (fd.doc_id && !DOC_ID_RE.test(fd.doc_id)) ? fd.doc_id : composedId,
          classification: s.classification || fd.classification,
          effective_date: s.effective_date || fd.effective_date,
          next_review_date: s.next_review_date || fd.next_review_date,
          owner: s.owner || fd.owner,
          approver: s.approver || fd.approver,
          regulatory_basis: s.regulatory_basis || fd.regulatory_basis,
          framework_tags: tags,
          one_line_summary: s.one_line_summary || fd.one_line_summary,
        }
      }))
    } catch {
      setFilesData(prev => prev.map(fd => fd._id === uid ? { ...fd, extracting: false, aiSuggested: false, aiNote: 'AI mapping failed — please enter the details manually.' } : fd))
    }
  }

  const onFiles = (fileList) => {
    if (!fileList || fileList.length === 0) return
    const newFiles = []
    const toMap = []
    let err = ''
    Array.from(fileList).forEach(f => {
      const valid = /\.(pdf|docx|doc|xlsx|md)$/i.test(f.name)
      if (!valid) err = 'Unsupported file type found. Use .pdf, .docx, .xlsx, or .md'
      else if (f.size > 25 * 1024 * 1024) err = 'File too large found (max 25 MB)'
      else {
        const detectedId = extractDocIdFromFilename(f.name) || ''
        // Title: strip extension + detected id, leftover underscores → spaces.
        const titleRaw = f.name
          .replace(/\.[^/.]+$/, "")
          .replace(/DTLK-[A-Z]+-[A-Z]+-\d{3,}_?/i, '')
          .replace(/[_-]/g, " ")
          .trim()
        const title = titleRaw || f.name.replace(/\.[^/.]+$/, "")
        // Pre-fill category + domain from a detected id so the dropdowns line up.
        const [, , detCat, detDom] = (detectedId.match(/^DTLK-([A-Z]+)-([A-Z]+)-/) || []) // weird tuple destructure to make linter happy
        const uid = ++idCounter.current
        // AI mapping runs for text-bearing formats; xlsx has no text extractor → manual.
        const willMap = /\.(pdf|docx|doc|md)$/i.test(f.name)
        newFiles.push({
          _id: uid,
          file: f,
          doc_id: detectedId,
          doc_title: title,
          category: detCat || '',
          domain: detDom || '',
          sequence: detectedId ? detectedId.split('-').pop() : '001',
          update_type: 'minor',
          classification: 'Internal',
          change_summary: '',
          effective_date: '',
          next_review_date: '',
          owner: '',
          approver: '',
          regulatory_basis: '',
          framework_tags: '',
          one_line_summary: '',
          extracting: willMap,
          aiSuggested: false,
          aiMissing: [],
          aiNote: willMap ? '' : 'No text extractor for this format — please enter details manually.',
        })
        if (willMap) toMap.push({ uid, file: f })
      }
    })
    if (err) setUploadError(err)
    if (newFiles.length > 0) {
      setFilesData(prev => [...prev, ...newFiles])
      setUploadError('')
      // Kick off AI mapping after state commit.
      toMap.forEach(({ uid, file }) => autoMapFile(uid, file))
    }
  }

  // When the operator picks a category / domain / sequence, rebuild the doc_id.
  // Only auto-composes when no doc_id has been manually typed yet OR when the
  // existing doc_id matches the same DTLK-XXX-YYY-NNN pattern (so we don't
  // clobber a custom override).
  const recomposeDocId = (fd, patch) => {
    const cat = patch.category ?? fd.category
    const dom = patch.domain   ?? fd.domain
    const seq = patch.sequence ?? fd.sequence
    if (!cat || !dom) return fd.doc_id
    const next = `DTLK-${cat}-${dom}-${String(seq || '001').padStart(3, '0')}`
    // If user has typed a fully custom doc_id that doesn't match the pattern,
    // leave it alone.
    if (fd.doc_id && !DOC_ID_RE.test(fd.doc_id)) return fd.doc_id
    return next
  }

  const handleRemove = (index) => {
    setFilesData(prev => prev.filter((_, i) => i !== index))
  }

  const updateFileData = (index, key, val) => {
    setFilesData(prev => {
      const arr = [...prev]
      const fd = { ...arr[index], [key]: val }
      // When category/domain/sequence change, refresh the suggested doc_id
      // unless the operator has typed a non-standard custom value.
      if (key === 'category' || key === 'domain' || key === 'sequence') {
        fd.doc_id = recomposeDocId(arr[index], { [key]: val })
      }
      arr[index] = fd
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
          // AI-mapped (operator-confirmed) metadata — backend already stores these.
          effective_date: fd.effective_date || null,
          next_review_date: fd.next_review_date || null,
          owner: fd.owner || '',
          approver: fd.approver || '',
          regulatory_basis: fd.regulatory_basis || '',
          framework_tags: (fd.framework_tags || '').split(',').map(t => t.trim()).filter(Boolean),
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

        // NOTE: Auditor contract review (auditorContractReview) is a restricted,
        // server-to-server function and must NOT be invoked from the browser.
        // If an automatic review is wanted on upload, chain it server-side from
        // the uploadGrcDocument handler. (The previous client-side trigger here
        // was dead code — its host string never matched, so it re-POSTed to the
        // upload endpoint instead.)
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

              {fd.extracting && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', marginBottom: 12, background: 'rgba(21,152,204,0.1)', border: '1px solid rgba(21,152,204,0.3)', borderRadius: 6, color: 'var(--sky)', fontSize: '0.8rem' }}>
                  <Sparkles size={14} /> Reading the document and mapping its metadata…
                </div>
              )}
              {fd.aiSuggested && !fd.extracting && (
                <div style={{ padding: '8px 12px', marginBottom: 12, background: 'rgba(52,191,58,0.1)', border: '1px solid rgba(52,191,58,0.3)', borderRadius: 6, color: '#34BF3A', fontSize: '0.8rem' }}>
                  <Sparkles size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                  AI-suggested from the document — please review before uploading.
                  {fd.one_line_summary ? <span style={{ display: 'block', color: 'var(--text-secondary)', marginTop: 4 }}>“{fd.one_line_summary}”</span> : null}
                  {Array.isArray(fd.aiMissing) && fd.aiMissing.length > 0 && (
                    <span style={{ display: 'block', color: '#F39C12', marginTop: 4 }}>
                      Not found in the document (please confirm): {fd.aiMissing.join(', ')}
                    </span>
                  )}
                </div>
              )}
              {fd.aiNote && !fd.extracting && (
                <div style={{ padding: '8px 12px', marginBottom: 12, background: 'rgba(243,156,18,0.1)', border: '1px solid rgba(243,156,18,0.3)', borderRadius: 6, color: '#F39C12', fontSize: '0.8rem' }}>
                  <AlertTriangle size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />{fd.aiNote}
                </div>
              )}

              <div className="grid-2" style={{ gap: 12 }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>Category</label>
                  <select className="input" value={fd.category} onChange={e => updateFileData(idx, 'category', e.target.value)}>
                    <option value="">— Select —</option>
                    {DOC_CATEGORIES.map(c => <option key={c.code} value={c.code}>{c.label} ({c.code})</option>)}
                  </select>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>Domain</label>
                  <select className="input" value={fd.domain} onChange={e => updateFileData(idx, 'domain', e.target.value)}>
                    <option value="">— Select —</option>
                    {DOC_DOMAINS.map(d => <option key={d.code} value={d.code}>{d.label} ({d.code})</option>)}
                  </select>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>Sequence (NNN)</label>
                  <input type="text" className="input" value={fd.sequence} onChange={e => updateFileData(idx, 'sequence', e.target.value.replace(/[^0-9]/g, ''))} placeholder="001" />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>Document ID *</label>
                  <input type="text" className="input" placeholder="DTLK-POL-SEC-001" value={fd.doc_id} onChange={e => updateFileData(idx, 'doc_id', e.target.value.toUpperCase())} />
                  {fd.doc_id && !DOC_ID_RE.test(fd.doc_id) && (
                    <div style={{ fontSize: '0.74rem', color: '#F39C12', marginTop: 4 }}>
                      Non-standard format. Backend requires DTLK-XXX-YYY-NNN.
                    </div>
                  )}
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
                  <label>Effective Date</label>
                  <input type="date" className="input" value={fd.effective_date} onChange={e => updateFileData(idx, 'effective_date', e.target.value)} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>Next Review / Expiry Date <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>(drives the agent's expiry checks)</span></label>
                  <input type="date" className="input" value={fd.next_review_date} onChange={e => updateFileData(idx, 'next_review_date', e.target.value)} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>Owner</label>
                  <input type="text" className="input" placeholder="e.g. CISO / HR Manager" value={fd.owner} onChange={e => updateFileData(idx, 'owner', e.target.value)} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>Approver</label>
                  <input type="text" className="input" placeholder="e.g. CEO" value={fd.approver} onChange={e => updateFileData(idx, 'approver', e.target.value)} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>Regulatory Basis</label>
                  <input type="text" className="input" placeholder="e.g. NCA ECC-1:2018, PDPL" value={fd.regulatory_basis} onChange={e => updateFileData(idx, 'regulatory_basis', e.target.value)} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>Framework Tags <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>(comma-separated)</span></label>
                  <input type="text" className="input" placeholder="e.g. SAMA CSF, ISO 27001" value={fd.framework_tags} onChange={e => updateFileData(idx, 'framework_tags', e.target.value)} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>Update Type <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>(used when doc_id already exists — backend bumps version)</span></label>
                  <select className="input" value={fd.update_type} onChange={e => updateFileData(idx, 'update_type', e.target.value)}>
                    <option value="minor">Minor Update</option><option value="major">Major Update</option>
                  </select>
                </div>
                <div className="form-group" style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
                  <label>Change Summary <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>(required when uploading a new version of an existing doc)</span></label>
                  <input type="text" className="input" placeholder="e.g. Updated Section 4 — added PDPL Art. 18 deletion clause" value={fd.change_summary} onChange={e => updateFileData(idx, 'change_summary', e.target.value)} />
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
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError('')
      try {
        const user = auth.currentUser
        if (!user) throw new Error('Not authenticated')
        const idToken = await user.getIdToken()
        const res = await fetch(GET_GRC_CHANGELOG_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to load the change log')
        if (!cancelled) setLogs(Array.isArray(data.logs) ? data.logs : [])
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load the change log')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const fmtTime = (ts) => {
    if (!ts) return '—'
    const ms = ts._seconds ? ts._seconds * 1000 : ts.seconds ? ts.seconds * 1000 : Date.parse(ts)
    return Number.isFinite(ms) ? new Date(ms).toLocaleString() : '—'
  }

  return (
    <div className="card" style={{ padding: 0, minHeight: 400, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Immutable Audit Trail</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost btn-sm" style={{ color: 'var(--green)' }}><FileText size={14} /> Export CSV</button>
          <button className="btn btn-ghost btn-sm" style={{ color: 'var(--green)' }}><FileText size={14} /> Export XLSX</button>
        </div>
      </div>
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>Loading change log…</div>
      ) : error ? (
        <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text-tertiary)', padding: 40 }}>
          <AlertTriangle size={48} style={{ margin: '0 auto 16px', opacity: 0.4, color: '#EF5829' }} />
          <h3 style={{ fontSize: '1.1rem', color: 'var(--text-secondary)', marginBottom: 8 }}>Could not load the change log</h3>
          <p style={{ fontSize: '0.85rem', maxWidth: 360, margin: '0 auto', color: '#ff6b6b' }}>{error}</p>
        </div>
      ) : logs.length === 0 ? (
        <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text-tertiary)', padding: 40 }}>
          <History size={48} style={{ margin: '0 auto 16px', opacity: 0.2 }} />
          <h3 style={{ fontSize: '1.1rem', color: 'var(--text-secondary)', marginBottom: 8 }}>No Audit Logs</h3>
          <p style={{ fontSize: '0.85rem', maxWidth: 300, margin: '0 auto' }}>Change log will populate automatically when documents are uploaded or downloaded.</p>
        </div>
      ) : (
        <table className="data-table">
          <thead><tr><th>Timestamp</th><th>Document</th><th>Action</th><th>Actor</th><th>Version</th><th>Summary</th></tr></thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id}>
                <td>{fmtTime(l.timestamp)}</td>
                <td>{l.doc_id}</td>
                <td>{l.action_type}</td>
                <td>{l.actor_email || '—'}</td>
                <td>v{l.new_version}</td>
                <td>{l.change_summary || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
