import { useState, useEffect, useMemo, useRef } from 'react'
import { auth, db, UPLOAD_CONTRACT_PDF_URL } from '../../lib/firebase'
import {
  collection, onSnapshot, doc, setDoc, updateDoc, addDoc, query, orderBy,
  serverTimestamp, arrayUnion,
} from 'firebase/firestore'
import {
  Upload, FileText, Loader, CheckCircle2, AlertTriangle, AlertCircle,
  Send, RefreshCw, X, Eye, Pencil, Scale, Inbox, ShieldCheck,
} from 'lucide-react'

// Status the contract goes through:
//   PENDING_EXTRACTION → EXTRACTED → LEGAL_PENDING → LEGAL_APPROVED → ACTIVE
//   (or EXTRACTION_FAILED / LEGAL_REJECTED branches)
const STATUS_META = {
  PENDING_EXTRACTION:  { label: 'Extracting…',     color: '#1598CC', bg: 'rgba(21,152,204,0.12)' },
  EXTRACTED:           { label: 'Review needed',   color: '#F39C12', bg: 'rgba(243,156,18,0.12)' },
  EXTRACTION_FAILED:   { label: 'Extraction failed', color: '#C0392B', bg: 'rgba(192,57,43,0.12)' },
  LEGAL_PENDING:       { label: 'With Legal',      color: '#9C27B0', bg: 'rgba(156,39,176,0.15)' },
  LEGAL_APPROVED:      { label: 'Legal approved',  color: '#34BF3A', bg: 'rgba(52,191,58,0.15)' },
  LEGAL_REJECTED:      { label: 'Legal flagged',   color: '#C0392B', bg: 'rgba(192,57,43,0.12)' },
  ACTIVE:              { label: 'Active',          color: '#34BF3A', bg: 'rgba(52,191,58,0.25)' },
}

// The 15 fields the Gatekeeper extracts. Match
// functions/hireSequence.js → GATEKEEPER_CONTRACT_EXTRACT_V1.
const FIELD_SPECS = [
  { key: 'employee_name',         label: 'Employee Name',           type: 'text' },
  { key: 'employee_name_ar',      label: 'Employee Name (Arabic)',  type: 'text' },
  { key: 'iqama_national_id',     label: 'Iqama / National ID',     type: 'text' },
  { key: 'job_title',             label: 'Job Title',               type: 'text' },
  { key: 'client_name',           label: 'Client',                  type: 'text' },
  { key: 'po_number',             label: 'PO Number',               type: 'text' },
  { key: 'po_value_sar',          label: 'PO Value (SAR)',          type: 'number' },
  { key: 'contract_start_date',   label: 'Contract Start',          type: 'date' },
  { key: 'contract_end_date',     label: 'Contract End',            type: 'date' },
  { key: 'salary_monthly_sar',    label: 'Monthly Salary (SAR)',    type: 'number' },
  { key: 'housing_allowance_sar', label: 'Housing Allowance (SAR)', type: 'number' },
  { key: 'transport_allowance_sar', label: 'Transport Allowance (SAR)', type: 'number' },
  { key: 'probation_period_months', label: 'Probation (months)',    type: 'number' },
  { key: 'notice_period_days',    label: 'Notice Period (days)',    type: 'number' },
  { key: 'work_location',         label: 'Work Location',           type: 'text' },
]

const styles = {
  page: { padding: '28px 24px', maxWidth: 1200, margin: '0 auto' },
  card: { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 12, padding: 22, marginBottom: 20 },
  dropzone: (active) => ({
    border: `2px dashed ${active ? '#1598CC' : 'rgba(255,255,255,0.18)'}`,
    borderRadius: 12,
    padding: 36,
    textAlign: 'center',
    background: active ? 'rgba(21,152,204,0.08)' : 'rgba(255,255,255,0.02)',
    transition: 'all 0.15s',
    cursor: 'pointer',
  }),
  label:  { fontSize: '0.72rem', fontWeight: 600, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4, display: 'block' },
  input:  { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.25)', color: '#fff', fontSize: '0.85rem', boxSizing: 'border-box', fontFamily: 'inherit' },
  grid2:  { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 },
  table:  { width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' },
  th:     { textAlign: 'left', padding: '10px 12px', color: 'rgba(255,255,255,0.5)', fontWeight: 600, fontSize: '0.7rem', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.1)' },
  td:     { padding: '10px 12px', color: 'rgba(255,255,255,0.85)', borderBottom: '1px solid rgba(255,255,255,0.06)' },
  badge:  (s) => ({ padding: '2px 10px', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600, background: s.bg, color: s.color, whiteSpace: 'nowrap' }),
}

function emptyExtracted() {
  const o = {}
  for (const f of FIELD_SPECS) o[f.key] = ''
  return o
}

// Type-to-filter combobox. Pulled out so the same searchable employee picker
// can be reused on any other page that needs one (Issue 4 requirement).
function EmployeeSearchPicker({ employees, selectedId, onSelect }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const selected = employees.find(e => e.id === selectedId)
  const norm = (s) => String(s || '').toLowerCase()
  const matches = q.trim()
    ? employees.filter(e => {
        const t = norm(q.trim())
        return norm(e.full_name).includes(t)
          || norm(e.name).includes(t)
          || norm(e.email).includes(t)
          || norm(e.employee_id).includes(t)
          || norm(e.job_title).includes(t)
      })
    : employees

  return (
    <div style={{ position: 'relative' }}>
      <input
        type="text"
        style={{
          width: '100%', padding: '9px 12px', borderRadius: 8,
          border: '1px solid rgba(255,255,255,0.15)',
          background: 'rgba(0,0,0,0.25)', color: '#fff',
          fontSize: '0.88rem', fontFamily: 'inherit', boxSizing: 'border-box',
          outline: 'none',
        }}
        placeholder={selected
          ? `${selected.full_name || selected.name || selected.id}${selected.employee_id ? ' · ' + selected.employee_id : ''}`
          : 'Type to search: name, DLSA id, email, job title…'}
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {selected && !q && (
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); onSelect(''); setQ('') }}
          style={{
            position: 'absolute', right: 8, top: 7, background: 'transparent', border: 'none',
            color: 'rgba(255,255,255,0.55)', cursor: 'pointer', padding: 4,
          }}
          title="Clear selection"
        ><X size={13} /></button>
      )}
      {open && (
        <div
          style={{
            position: 'absolute', top: '100%', left: 0, right: 0,
            marginTop: 4, maxHeight: 240, overflowY: 'auto',
            background: '#0f1d36', border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 8, zIndex: 50,
          }}
        >
          {matches.length === 0 ? (
            <div style={{ padding: '12px 14px', color: 'rgba(255,255,255,0.55)', fontSize: '0.82rem' }}>
              No employees match "{q}".
            </div>
          ) : matches.map(emp => (
            <button
              key={emp.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onSelect(emp.id); setQ(''); setOpen(false) }}
              style={{
                width: '100%', textAlign: 'left', padding: '10px 14px',
                border: 'none', background: emp.id === selectedId ? 'rgba(21,152,204,0.15)' : 'transparent',
                color: '#fff', cursor: 'pointer', fontFamily: 'inherit',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
              }}
            >
              <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                {emp.full_name || emp.name || emp.id}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>
                {[emp.employee_id, emp.job_title, emp.email].filter(Boolean).join(' · ')}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function pickReviewSource(contract) {
  // Prefer human-edited fields, fall back to AI extraction.
  return { ...emptyExtracted(), ...(contract.contract_extracted_fields || {}), ...(contract.reviewed_fields || {}) }
}

export default function HRContracts() {
  const [contracts, setContracts] = useState([])
  // Existing-employee uploads need the employees list for the dropdown so HR
  // can attach the contract to (e.g.) Khalid DLSA1003. The "New hire" mode
  // doesn't use this — it relies on the pending_hires row already created by
  // the initiateHire backend.
  const [employees, setEmployees] = useState([])
  // Two upload modes:
  //   'existing' — Qiwa contract for someone already in the employees collection
  //                (the immediate need: 12 current employees were hired before
  //                the platform existed).
  //   'new_hire' — contract for a candidate the CEO has just initiated. Needs
  //                the corresponding pending_hires row to already exist.
  const [uploadMode, setUploadMode] = useState('existing')
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const [activeId, setActiveId] = useState(null)
  const [reviewFields, setReviewFields] = useState({})
  const [actioning, setActioning] = useState(false)
  const [toast, setToast] = useState(null)
  const fileInputRef = useRef(null)

  useEffect(() => {
    const q = query(collection(db, 'contracts'), orderBy('created_at', 'desc'))
    const unsub = onSnapshot(q,
      snap => { setContracts(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false) },
      err => { setLoadError(err.message); setLoading(false) },
    )
    const unsubE = onSnapshot(query(collection(db, 'employees'), orderBy('employee_id')),
      snap => setEmployees(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    )
    return () => { unsub(); unsubE() }
  }, [])

  const active = useMemo(() => contracts.find(c => c.id === activeId) || null, [contracts, activeId])

  // Keep reviewFields in sync when active contract changes or new extraction lands.
  // Effects rule: don't setState directly in the body — defer via microtask.
  useEffect(() => {
    let cancelled = false
    Promise.resolve().then(() => {
      if (cancelled) return
      setReviewFields(active ? pickReviewSource(active) : {})
    })
    return () => { cancelled = true }
  }, [active?.id, active?.contract_extraction_status])  // eslint-disable-line react-hooks/exhaustive-deps

  const showToast = (msg, kind = 'success') => {
    setToast({ msg, kind }); setTimeout(() => setToast(null), 3500)
  }

  // ─── Upload ───────────────────────────────────────────────────
  const handleFiles = async (files) => {
    setUploadError('')
    const file = files?.[0]
    if (!file) return
    if (!['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setUploadError('Upload a PDF, PNG, JPG, or WEBP — got ' + (file.type || 'unknown')); return
    }
    if (file.size > 15 * 1024 * 1024) { setUploadError('File too large (max 15MB).'); return }

    // Existing-employee mode requires HR to pick which employee this contract
    // belongs to BEFORE uploading — otherwise the extracted fields have nowhere
    // to land.
    if (uploadMode === 'existing' && !selectedEmployeeId) {
      setUploadError('Pick which employee this contract belongs to before uploading.')
      return
    }
    const linkedEmp = uploadMode === 'existing'
      ? employees.find(e => e.id === selectedEmployeeId)
      : null

    setUploading(true)
    try {
      // 1. Create the contracts/{id} shell. It's the UI's source of truth.
      const me = auth.currentUser
      const uploader = me?.displayName || me?.email || 'unknown'
      const ref = await addDoc(collection(db, 'contracts'), {
        original_filename: file.name,
        size_bytes: file.size,
        mime_type: file.type,
        contract_extraction_status: 'PENDING_EXTRACTION',
        legal_status: 'NONE',
        status: 'PENDING_EXTRACTION',
        upload_mode: uploadMode,
        linked_employee_id: linkedEmp?.id || null,
        linked_employee_employee_id: linkedEmp?.employee_id || null,
        linked_employee_name: linkedEmp?.full_name || linkedEmp?.name || null,
        uploaded_by: uploader,
        uploaded_at: serverTimestamp(),
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
        status_history: [{
          status: 'PENDING_EXTRACTION', at: new Date().toISOString(), by: uploader,
          notes: linkedEmp
            ? `PDF uploaded for existing employee ${linkedEmp.employee_id || linkedEmp.id}`
            : 'PDF uploaded — Gatekeeper extraction started',
        }],
      })

      // 2. The backend uploadContractPDF expects a matching pending_hires/{hireId}
      //    row to exist (it 404s otherwise). For existing-employee uploads no such
      //    row exists, so we pre-create a shell — kind: 'EXISTING_EMPLOYEE',
      //    linked_employee_id — to keep the backend happy. The mirror trigger then
      //    copies contract_extracted_fields back onto contracts/{id} as usual.
      await setDoc(doc(db, 'pending_hires', ref.id), {
        _kind: uploadMode === 'existing' ? 'EXISTING_EMPLOYEE' : 'NEW_HIRE',
        linked_employee_id: linkedEmp?.id || null,
        linked_contract_id: ref.id,
        contract_extraction_status: 'PENDING',
        created_at: serverTimestamp(),
        created_by: uploader,
      }, { merge: true })

      // 3. Hand the file off to the backend so it goes to the WORM bucket and
      //    fires the Gatekeeper Pub/Sub extraction.
      const idToken = await me.getIdToken()
      const fd = new FormData()
      fd.append('hire_id', ref.id)
      fd.append('contract_pdf', file, file.name)
      const res = await fetch(UPLOAD_CONTRACT_PDF_URL, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + idToken },
        body: fd,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        await updateDoc(doc(db, 'contracts', ref.id), {
          contract_extraction_status: 'EXTRACTION_FAILED',
          status: 'EXTRACTION_FAILED',
          contract_extraction_error: data.error || ('HTTP ' + res.status),
          updated_at: serverTimestamp(),
        })
        throw new Error(data.error || ('Upload failed (' + res.status + ')'))
      }
      if (data.storage_path) {
        await updateDoc(doc(db, 'contracts', ref.id), {
          pdf_storage_path: data.storage_path,
          updated_at: serverTimestamp(),
        })
      }
      showToast(linkedEmp
        ? `Contract uploaded for ${linkedEmp.full_name || linkedEmp.employee_id}. AI extraction in progress.`
        : 'Contract uploaded. AI extraction in progress.')
      setActiveId(ref.id)
      setSelectedEmployeeId('')
    } catch (err) {
      setUploadError(err.message)
    } finally {
      setUploading(false)
    }
  }

  // Reuses an existing contracts/{id} (and its companion pending_hires/{id})
  // and re-runs the upload + extraction. Operator has to pick the file again
  // because the backend endpoint requires it on every call.
  const handleRetryExtraction = async (file) => {
    if (!file || !active) return
    if (!['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      showToast('Upload a PDF, PNG, JPG, or WEBP — got ' + (file.type || 'unknown'), 'error'); return
    }
    if (file.size > 15 * 1024 * 1024) { showToast('File too large (max 15MB).', 'error'); return }

    setActioning(true)
    try {
      const me = auth.currentUser
      const by = me?.displayName || me?.email || 'unknown'
      // Flip back to PENDING so the UI shows the spinner while the backend runs.
      await updateDoc(doc(db, 'contracts', active.id), {
        contract_extraction_status: 'PENDING_EXTRACTION',
        status: 'PENDING_EXTRACTION',
        contract_extraction_error: null,
        extraction_error: null,
        retry_requested_at: serverTimestamp(),
        retry_requested_by: by,
        status_history: arrayUnion({
          status: 'PENDING_EXTRACTION', at: new Date().toISOString(), by,
          notes: 'Retry — operator re-uploaded the PDF',
        }),
        updated_at: serverTimestamp(),
      })
      const idToken = await me.getIdToken()
      const fd = new FormData()
      fd.append('hire_id', active.id)
      fd.append('contract_pdf', file, file.name)
      const res = await fetch(UPLOAD_CONTRACT_PDF_URL, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + idToken },
        body: fd,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        await updateDoc(doc(db, 'contracts', active.id), {
          contract_extraction_status: 'EXTRACTION_FAILED',
          status: 'EXTRACTION_FAILED',
          contract_extraction_error: data.error || ('HTTP ' + res.status),
          updated_at: serverTimestamp(),
        })
        throw new Error(data.error || ('Retry failed (' + res.status + ')'))
      }
      if (data.storage_path) {
        await updateDoc(doc(db, 'contracts', active.id), {
          pdf_storage_path: data.storage_path,
          updated_at: serverTimestamp(),
        })
      }
      showToast('Retry started. AI extraction is running again.')
    } catch (e) {
      showToast('Retry failed: ' + e.message, 'error')
    } finally {
      setActioning(false)
    }
  }

  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation(); setDragActive(false)
    handleFiles(e.dataTransfer.files)
  }
  const handleDrag = (e) => {
    e.preventDefault(); e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true)
    else if (e.type === 'dragleave') setDragActive(false)
  }

  // ─── Save reviewed fields ─────────────────────────────────────
  const handleSaveReview = async () => {
    if (!active) return
    setActioning(true)
    try {
      const me = auth.currentUser
      const by = me?.displayName || me?.email || 'unknown'
      await updateDoc(doc(db, 'contracts', active.id), {
        reviewed_fields: reviewFields,
        reviewed_by: by,
        reviewed_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      })
      // Existing-employee path: the reviewed fields ARE the employee's HR record.
      // Project the 15 Gatekeeper keys onto the employees doc so the directory,
      // payroll, and profile pages immediately reflect the contract.
      if (active.linked_employee_id) {
        const f = reviewFields || {}
        const num = (v) => (v === '' || v == null ? null : Number(v))
        const patch = {
          job_title: f.job_title || null,
          full_name_ar: f.employee_name_ar || null,
          iqama_national_id: f.iqama_national_id || null,
          contract_start: f.contract_start_date || null,
          contract_end:   f.contract_end_date || null,
          salary_monthly_sar:    num(f.salary_monthly_sar),
          housing_allowance_sar: num(f.housing_allowance_sar),
          transport_allowance_sar: num(f.transport_allowance_sar),
          probation_period_months: num(f.probation_period_months),
          notice_period_days:    num(f.notice_period_days),
          work_location: f.work_location || null,
          // Convenience for payroll calcs that want the total wage in one number.
          salary: num(f.salary_monthly_sar),
          contract_synced_from: active.id,
          contract_synced_at: serverTimestamp(),
          updated_at: serverTimestamp(),
        }
        // Drop null keys so we don't overwrite existing data with nulls.
        Object.keys(patch).forEach(k => patch[k] == null && delete patch[k])
        await updateDoc(doc(db, 'employees', active.linked_employee_id), patch)
      }
      showToast(active.linked_employee_id
        ? 'Saved. Employee record updated with contract fields.'
        : 'Reviewed fields saved.')
    } catch (e) {
      showToast('Save failed: ' + e.message, 'error')
    } finally {
      setActioning(false)
    }
  }

  // ─── Send to Legal ────────────────────────────────────────────
  const handleSendToLegal = async () => {
    if (!active) return
    setActioning(true)
    try {
      const me = auth.currentUser
      const by = me?.displayName || me?.email || 'unknown'
      const token = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : ('legal-' + Math.random().toString(36).slice(2) + Date.now().toString(36))
      await updateDoc(doc(db, 'contracts', active.id), {
        legal_status: 'LEGAL_PENDING',
        status: 'LEGAL_PENDING',
        legal_review_token: token,
        legal_review_url: '/legal/review/' + token,
        legal_review_requested_at: serverTimestamp(),
        legal_review_requested_by: by,
        // reviewed_fields is what Legal sees — if HR never saved a review, fall back to AI extraction.
        reviewed_fields: { ...pickReviewSource(active), ...reviewFields },
        status_history: arrayUnion({ status: 'LEGAL_PENDING', at: new Date().toISOString(), by, notes: 'Sent to external counsel for review' }),
        updated_at: serverTimestamp(),
      })
      showToast('Sent to Legal. Email link will be dispatched.')
    } catch (e) {
      showToast('Failed: ' + e.message, 'error')
    } finally {
      setActioning(false)
    }
  }

  // ─── Render ──────────────────────────────────────────────────
  return (
    <div style={styles.page}>
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          padding: '12px 20px', borderRadius: 10, fontSize: '0.85rem', fontWeight: 600,
          background: toast.kind === 'error' ? 'rgba(192,57,43,0.95)' : 'rgba(52,191,58,0.95)',
          color: '#fff', boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          {toast.kind === 'error' ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />} {toast.msg}
        </div>
      )}

      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#fff', margin: 0 }}>Contracts</h1>
        <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: '0.85rem', marginTop: 6 }}>
          Upload the signed Qiwa Unified Employment Contract (PDF). Gatekeeper AI extracts 15 fields;
          you verify them, then send to outsourced legal counsel for sign-off before the employee
          record is created.
        </p>
      </div>

      {/* ── Upload area ───────────────────────────────────── */}
      <div style={styles.card}>
        {/* Mode toggle: new hire vs existing employee */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          {[
            { id: 'existing', label: 'Existing employee', hint: 'Pre-platform hire — attach contract to a current employee.' },
            { id: 'new_hire', label: 'New hire',         hint: 'Use the hire_id from the talent pipeline (initiateHire).' },
          ].map(m => {
            const isOn = uploadMode === m.id
            return (
              <button
                key={m.id}
                onClick={() => { setUploadMode(m.id); setSelectedEmployeeId('') }}
                style={{
                  flex: '1 1 240px', textAlign: 'left',
                  padding: '10px 14px', borderRadius: 10,
                  border: `1px solid ${isOn ? '#1598CC' : 'rgba(255,255,255,0.15)'}`,
                  background: isOn ? 'rgba(21,152,204,0.10)' : 'rgba(255,255,255,0.03)',
                  color: '#fff', cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                <div style={{ fontWeight: 700, fontSize: '0.88rem' }}>{m.label}</div>
                <div style={{ fontSize: '0.74rem', color: 'rgba(255,255,255,0.55)', marginTop: 3 }}>{m.hint}</div>
              </button>
            )
          })}
        </div>

        {uploadMode === 'existing' && (
          <div style={{ marginBottom: 12 }}>
            <label style={styles.label}>Which employee is this contract for?</label>
            <EmployeeSearchPicker
              employees={employees}
              selectedId={selectedEmployeeId}
              onSelect={(id) => setSelectedEmployeeId(id)}
            />
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.webp"
          style={{ display: 'none' }}
          onChange={e => handleFiles(e.target.files)}
        />
        <div
          style={styles.dropzone(dragActive)}
          onClick={() => fileInputRef.current?.click()}
          onDragEnter={handleDrag}
          onDragOver={handleDrag}
          onDragLeave={handleDrag}
          onDrop={handleDrop}
        >
          <Upload size={36} color={dragActive ? '#1598CC' : 'rgba(255,255,255,0.4)'} />
          <div style={{ marginTop: 12, fontSize: '0.95rem', fontWeight: 600, color: '#fff' }}>
            {uploading ? 'Uploading…' : 'Drop the signed contract PDF here'}
          </div>
          <div style={{ marginTop: 4, fontSize: '0.78rem', color: 'rgba(255,255,255,0.55)' }}>
            or click to browse · PDF / PNG / JPG, max 15MB
          </div>
          {uploading && (
            <div style={{ marginTop: 14 }}>
              <Loader size={18} className="spin" color="#1598CC" />
            </div>
          )}
        </div>
        {uploadError && (
          <div style={{ marginTop: 10, padding: '10px 14px', borderRadius: 8, background: 'rgba(192,57,43,0.12)', border: '1px solid rgba(192,57,43,0.3)', color: '#fca5a5', fontSize: '0.82rem' }}>
            <AlertCircle size={14} style={{ verticalAlign: -2, marginRight: 6 }} />{uploadError}
          </div>
        )}
      </div>

      {/* ── Contracts list ───────────────────────────────── */}
      <div style={styles.card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <FileText size={16} color="rgba(255,255,255,0.6)" />
          <h2 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#fff', margin: 0 }}>
            All Contracts <span style={{ color: 'rgba(255,255,255,0.5)', fontWeight: 500, fontSize: '0.82rem' }}>({contracts.length})</span>
          </h2>
        </div>
        {loadError && <div style={{ color: '#fca5a5', fontSize: '0.82rem', marginBottom: 10 }}>Could not load: {loadError}</div>}
        {loading ? (
          <div style={{ padding: 30, textAlign: 'center', color: 'rgba(255,255,255,0.5)' }}><Loader size={18} className="spin" /> Loading…</div>
        ) : contracts.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: 'rgba(255,255,255,0.4)' }}>
            <Inbox size={32} style={{ opacity: 0.4 }} />
            <div style={{ marginTop: 8 }}>No contracts uploaded yet.</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Employee</th>
                  <th style={styles.th}>Client / Project</th>
                  <th style={styles.th}>Uploaded</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}></th>
                </tr>
              </thead>
              <tbody>
                {contracts.map(c => {
                  const f = { ...(c.contract_extracted_fields || {}), ...(c.reviewed_fields || {}) }
                  const meta = STATUS_META[c.status || c.contract_extraction_status] || STATUS_META.PENDING_EXTRACTION
                  return (
                    <tr key={c.id} style={{ cursor: 'pointer', background: activeId === c.id ? 'rgba(21,152,204,0.06)' : 'transparent' }} onClick={() => setActiveId(c.id)}>
                      <td style={styles.td}>{f.employee_name || <span style={{ color: 'rgba(255,255,255,0.4)' }}>—</span>}</td>
                      <td style={styles.td}>{f.client_name || '—'} <span style={{ color: 'rgba(255,255,255,0.4)' }}>{f.po_number ? '· ' + f.po_number : ''}</span></td>
                      <td style={{ ...styles.td, fontSize: '0.76rem', color: 'rgba(255,255,255,0.6)' }}>
                        {c.uploaded_at?.toDate ? c.uploaded_at.toDate().toLocaleString() : '—'}
                      </td>
                      <td style={styles.td}><span style={styles.badge(meta)}>{meta.label}</span></td>
                      <td style={styles.td}>
                        <button onClick={(e) => { e.stopPropagation(); setActiveId(c.id) }} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.8)', padding: '5px 10px', borderRadius: 7, cursor: 'pointer', fontSize: '0.75rem', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Eye size={12} /> Review
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Review panel ──────────────────────────────────── */}
      {active && (
        <div style={styles.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Pencil size={15} color="#38bdf8" />
                <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#fff', margin: 0 }}>Review Extracted Fields</h3>
              </div>
              <p style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.55)', marginTop: 4 }}>
                Edit anything the AI got wrong before sending to Legal. Original AI output is kept on the doc.
              </p>
            </div>
            <button onClick={() => setActiveId(null)} style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.55)', cursor: 'pointer' }}><X size={18} /></button>
          </div>

          {active.contract_extraction_status === 'PENDING_EXTRACTION' && (
            <div style={{ padding: '12px 14px', borderRadius: 8, background: 'rgba(21,152,204,0.08)', border: '1px solid rgba(21,152,204,0.25)', color: '#7dd3fc', fontSize: '0.82rem', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
              <RefreshCw size={14} className="spin" /> Gatekeeper is extracting fields. This page will update automatically.
            </div>
          )}
          {(active.contract_extraction_status === 'EXTRACTION_FAILED' || active.contract_extraction_status === 'OCR_FAILED' || active.contract_extraction_status === 'LLM_FAILED' || active.contract_extraction_status === 'PARSE_FAILED') && (
            <div style={{ padding: '12px 14px', borderRadius: 8, background: 'rgba(192,57,43,0.12)', border: '1px solid rgba(192,57,43,0.3)', color: '#fca5a5', fontSize: '0.82rem', marginBottom: 14 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>
                Extraction failed ({active.contract_extraction_status})
              </div>
              <div style={{ marginBottom: 8, lineHeight: 1.5 }}>
                {active.extraction_error || active.contract_extraction_error || active.contract_extraction_error_detail || 'No error detail was recorded. Check the Cloud Functions logs for gatekeeperContractExtract.'}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.webp"
                  id="retry-file-input"
                  style={{ display: 'none' }}
                  onChange={e => handleRetryExtraction(e.target.files?.[0])}
                />
                <button
                  onClick={() => document.getElementById('retry-file-input').click()}
                  disabled={actioning}
                  style={{
                    padding: '7px 14px', borderRadius: 8,
                    border: '1px solid rgba(192,57,43,0.5)', background: 'rgba(192,57,43,0.18)',
                    color: '#fca5a5', cursor: actioning ? 'not-allowed' : 'pointer',
                    fontSize: '0.78rem', fontFamily: 'inherit', fontWeight: 700,
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                  }}
                >
                  <RefreshCw size={12} /> Retry extraction (re-upload PDF)
                </button>
                <span style={{ fontSize: '0.74rem', color: 'rgba(255,255,255,0.55)' }}>
                  …or fill the fields manually below.
                </span>
              </div>
            </div>
          )}

          <div style={styles.grid2}>
            {FIELD_SPECS.map(f => (
              <div key={f.key}>
                <label style={styles.label}>{f.label}</label>
                <input
                  style={styles.input}
                  type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                  value={reviewFields[f.key] ?? ''}
                  onChange={e => setReviewFields(p => ({ ...p, [f.key]: e.target.value }))}
                />
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 18, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ fontSize: '0.74rem', color: 'rgba(255,255,255,0.5)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <ShieldCheck size={13} /> Original AI extraction preserved on contract_extracted_fields.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={handleSaveReview} disabled={actioning} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.05)', color: '#fff', cursor: actioning ? 'not-allowed' : 'pointer', fontSize: '0.82rem', fontWeight: 600, fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {actioning ? <Loader size={13} className="spin" /> : <Pencil size={13} />} Save Review
              </button>
              <button onClick={handleSendToLegal} disabled={actioning || active.legal_status === 'LEGAL_PENDING' || active.legal_status === 'LEGAL_APPROVED'} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #9C27B0', background: '#9C27B0', color: '#fff', cursor: (actioning || active.legal_status === 'LEGAL_PENDING' || active.legal_status === 'LEGAL_APPROVED') ? 'not-allowed' : 'pointer', fontSize: '0.82rem', fontWeight: 600, fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6, opacity: (active.legal_status === 'LEGAL_PENDING' || active.legal_status === 'LEGAL_APPROVED') ? 0.5 : 1 }}>
                {actioning ? <Loader size={13} className="spin" /> : <Send size={13} />} Send to Legal Review
              </button>
            </div>
          </div>

          {active.legal_status === 'LEGAL_PENDING' && active.legal_review_url && (
            <div style={{ marginTop: 14, padding: '10px 14px', borderRadius: 8, background: 'rgba(156,39,176,0.08)', border: '1px solid rgba(156,39,176,0.25)', color: '#e9b8f3', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Scale size={14} />
              <span>
                With external counsel. Their token link:&nbsp;
                <code style={{ background: 'rgba(0,0,0,0.25)', padding: '2px 6px', borderRadius: 4 }}>{window.location.origin + active.legal_review_url}</code>
              </span>
            </div>
          )}
        </div>
      )}

      <style>{`
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
