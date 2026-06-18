import { useState, useEffect, useMemo } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db, auth, PREPARE_INTERVIEW_CV_URL, SEND_INTERVIEW_CV_URL, DOWNLOAD_CANDIDATE_CV_URL, UPDATE_CANDIDATE_STAGE_URL } from '../../lib/firebase'
import { FolderKanban, User, FileText, Send, CheckCircle, AlertTriangle, Loader, Search, Calendar, ChevronRight, ChevronLeft, Download, Eye, Shield, Star, ClipboardList } from 'lucide-react'

const BRAND = { navy: '#022873', sky: '#1598CC', orange: '#EF5829', green: '#34BF3A' }

const s = {
  page: { padding: '32px 24px', maxWidth: 1100, margin: '0 auto', minHeight: '100vh', background: '#0a1628', borderRadius: 0 },
  h1: { fontSize: '1.5rem', fontWeight: 700, color: '#e2e8f0', marginBottom: 8 },
  sub: { fontSize: '0.82rem', color: '#64748b', marginBottom: 28 },
  card: { background: '#111e33', border: '1px solid #1e3050', borderRadius: 14, padding: 24, marginBottom: 20 },
  cardTitle: { fontSize: '1rem', fontWeight: 700, color: '#e2e8f0', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 },
  label: { fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', marginBottom: 6, display: 'block', textTransform: 'uppercase', letterSpacing: '0.05em' },
  input: { width: '100%', padding: '10px 14px', border: '1px solid #1e3050', borderRadius: 8, fontSize: '0.88rem', fontFamily: 'inherit', outline: 'none', color: '#e2e8f0', background: '#0d1829', boxSizing: 'border-box', minHeight: 44 },
  select: { width: '100%', padding: '10px 14px', border: '1px solid #1e3050', borderRadius: 8, fontSize: '0.88rem', fontFamily: 'inherit', outline: 'none', color: '#e2e8f0', background: '#0d1829', boxSizing: 'border-box', minHeight: 44 },
  textarea: { width: '100%', padding: '10px 14px', border: '1px solid #1e3050', borderRadius: 8, fontSize: '0.85rem', fontFamily: 'inherit', outline: 'none', color: '#e2e8f0', background: '#0d1829', boxSizing: 'border-box', minHeight: 100, resize: 'vertical' },
  btn: (color, disabled) => ({ padding: '12px 24px', borderRadius: 10, border: 'none', cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: '0.88rem', background: disabled ? '#1e293b' : color, color: '#fff', display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 48, transition: 'all 0.2s', opacity: disabled ? 0.5 : 1 }),
  badge: (color) => ({ padding: '3px 10px', borderRadius: 12, fontSize: '0.7rem', fontWeight: 700, background: `${color}22`, color, border: `1px solid ${color}44` }),
  row: { display: 'flex', gap: 16, flexWrap: 'wrap' },
  col: { flex: 1, minWidth: 200 },
  steps: { display: 'flex', gap: 4, marginBottom: 28 },
  step: (active, done) => ({ flex: 1, height: 4, borderRadius: 2, background: done ? BRAND.green : active ? BRAND.sky : '#1e293b', transition: 'all 0.3s' }),
  alert: (type) => ({ padding: '12px 16px', borderRadius: 10, fontSize: '0.82rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, background: type === 'error' ? 'rgba(239,88,41,0.15)' : type === 'warn' ? 'rgba(251,191,36,0.15)' : 'rgba(52,191,58,0.15)', color: type === 'error' ? '#fb923c' : type === 'warn' ? '#fbbf24' : '#4ade80', border: `1px solid ${type === 'error' ? 'rgba(239,88,41,0.3)' : type === 'warn' ? 'rgba(251,191,36,0.3)' : 'rgba(52,191,58,0.3)'}` }),
  candidateRow: (sel) => ({ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', border: sel ? `2px solid ${BRAND.sky}` : '1px solid #1e3050', borderRadius: 10, cursor: 'pointer', background: sel ? 'rgba(21,152,204,0.12)' : '#0d1829', transition: 'all 0.15s', marginBottom: 8 }),
  avatar: (name) => ({ width: 40, height: 40, borderRadius: '50%', background: `linear-gradient(135deg, ${BRAND.navy}, ${BRAND.sky})`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: '0.82rem', flexShrink: 0, children: (name || '??').split(' ').map(n => n[0]).join('').slice(0, 2) }),
  infoGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 },
  infoItem: { padding: '10px 14px', background: '#0d1829', borderRadius: 8, border: '1px solid #1e3050' },
  infoLabel: { fontSize: '0.68rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 },
  infoVal: { fontSize: '0.88rem', color: '#e2e8f0', fontWeight: 600 },
}

function InfoItem({ label, value }) {
  return (
    <div style={s.infoItem}>
      <div style={s.infoLabel}>{label}</div>
      <div style={s.infoVal}>{value || '—'}</div>
    </div>
  )
}

function Initials({ name }) {
  const letters = (name || '??').split(' ').map(n => n[0]).join('').slice(0, 2)
  return (
    <div style={{ width: 40, height: 40, borderRadius: '50%', background: `linear-gradient(135deg, ${BRAND.navy}, ${BRAND.sky})`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: '0.82rem', flexShrink: 0 }}>
      {letters}
    </div>
  )
}

export default function InterviewCVPrep() {
  const [step, setStep] = useState(0)
  const [projects, setProjects] = useState([])
  const [candidates, setCandidates] = useState([])
  const [selectedProject, setSelectedProject] = useState(null)
  const [selectedCandidate, setSelectedCandidate] = useState(null)
  const [jdText, setJdText] = useState('')
  const [meetingDate, setMeetingDate] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [preparing, setPreparing] = useState(false)
  const [sending, setSending] = useState(false)
  const [prepResult, setPrepResult] = useState(null)
  const [sendResult, setSendResult] = useState(null)
  const [ccEmails, setCcEmails] = useState('')
  const [error, setError] = useState('')
  const [userRole, setUserRole] = useState(null)

  // Load projects + candidates + user role
  useEffect(() => {
    async function load() {
      try {
        const [projSnap, candSnap] = await Promise.all([
          getDocs(query(collection(db, 'projects'), where('status', '==', 'ACTIVE'))),
          // Candidates live in talent_pool (the CV store) — NOT employees. The old
          // employees/state=='deployable' query was wrong on both collection and
          // field (employees use employment_status), so it always returned nothing
          // and the CV-prep list was empty. Load the pool; the cv-filter below
          // narrows to candidates that actually have a CV.
          getDocs(collection(db, 'talent_pool')),
        ])
        setProjects(projSnap.docs.map(d => ({ id: d.id, ...d.data() })))
        setCandidates(candSnap.docs.map(d => ({ id: d.id, ...d.data() })))

        // Get user role
        if (auth.currentUser) {
          const userSnap = await getDocs(query(collection(db, 'users'), where('email', '==', auth.currentUser.email)))
          if (!userSnap.empty) setUserRole(userSnap.docs[0].data().role_id)
        }
      } catch (err) { console.warn('Load error:', err.message) }
      setLoading(false)
    }
    load()
  }, [])

  // Filter candidates
  const filteredCandidates = useMemo(() => {
    return candidates.filter(c => {
      // Skip rejected candidates — not relevant for interview CV prep.
      if (c.state === 'REJECTED') return false
      // Must have cv_path or cv_data
      if (!c.cv_path && !c.cv_data) return false
      if (!searchQuery.trim()) return true
      const q = searchQuery.toLowerCase()
      return (
        (c.full_name || '').toLowerCase().includes(q) ||
        (c.current_employer || '').toLowerCase().includes(q) ||
        (c.role_interest || '').toLowerCase().includes(q) ||
        (c.location || '').toLowerCase().includes(q) ||
        (c.skills || []).some(sk => sk.toLowerCase().includes(q))
      )
    })
  }, [candidates, searchQuery])

  const disabledCandidates = useMemo(() => {
    return candidates.filter(c => !c.cv_path && !c.cv_data)
  }, [candidates])

  const handlePrepare = async () => {
    setPreparing(true)
    setError('')
    try {
      const idToken = await auth.currentUser.getIdToken()
      const res = await fetch(PREPARE_INTERVIEW_CV_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          candidate_id: selectedCandidate.id,
          project_id: selectedProject.id,
          jd_text: jdText.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
      setPrepResult(data)
      setStep(4)
    } catch (err) { setError(err.message) }
    setPreparing(false)
  }

  const handleSend = async () => {
    setSending(true)
    setError('')
    try {
      const idToken = await auth.currentUser.getIdToken()
      const res = await fetch(SEND_INTERVIEW_CV_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          candidate_id: selectedCandidate.id,
          project_id: selectedProject.id,
          meeting_date: meetingDate || undefined,
          cc: ccEmails.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
      setSendResult(data)
    } catch (err) { setError(err.message) }
    setSending(false)
  }

  const [cvDownloading, setCvDownloading] = useState(false)
  const [cvDownloadUrl, setCvDownloadUrl] = useState(null)
  const [stagingResult, setStagingResult] = useState(null)

  const handleDownloadOriginalCV = async () => {
    if (!selectedCandidate || cvDownloading) return
    setCvDownloading(true)
    try {
      const idToken = await auth.currentUser.getIdToken()
      const res = await fetch(DOWNLOAD_CANDIDATE_CV_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ candidate_id: selectedCandidate.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setCvDownloadUrl(data.signed_url)
      window.open(data.signed_url, '_blank')
    } catch (err) { setError(err.message) }
    setCvDownloading(false)
  }

  const handleScheduleInterview = async () => {
    if (!selectedCandidate || !meetingDate) return
    try {
      const idToken = await auth.currentUser.getIdToken()
      await fetch(UPDATE_CANDIDATE_STAGE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ candidate_id: selectedCandidate.id, new_state: 'INTERVIEW_SCHEDULED', notes: `Interview scheduled for ${meetingDate}`, interview_date: meetingDate }),
      })
      setStagingResult('INTERVIEW_SCHEDULED')
    } catch (err) { setError(err.message) }
  }

  const resetAll = () => {
    setStep(0); setSelectedProject(null); setSelectedCandidate(null)
    setJdText(''); setMeetingDate(''); setPrepResult(null); setSendResult(null); setError(''); setStagingResult(null); setCvDownloadUrl(null); setCcEmails('')
  }

  if (loading) return (
    <div style={{ ...s.page, textAlign: 'center', paddingTop: 80 }}>
      <Loader size={28} style={{ color: BRAND.sky, animation: 'spin 1s linear infinite', margin: '0 auto 12px' }} />
      <div style={{ color: '#64748b', fontSize: '0.88rem' }}>Loading projects and candidates...</div>
    </div>
  )

  return (
    <div style={s.page}>
      <h1 style={s.h1}>Interview CV Preparation</h1>
      <div style={s.sub}>Prepare and dispatch candidate Skills Portfolio to clients · DTLK-FORM-HR-CV-002 v1.1</div>

      {/* Progress bar */}
      <div style={s.steps}>
        {[0,1,2,3,4].map(i => <div key={i} style={s.step(step === i, step > i)} />)}
      </div>

      {error && <div style={s.alert('error')}><AlertTriangle size={16} />{error}</div>}

      {/* ── STEP 0: Select Project ── */}
      {step === 0 && (
        <div style={s.card}>
          <div style={s.cardTitle}><FolderKanban size={20} color={BRAND.sky} />Select Project</div>
          <label style={s.label}>Active Project</label>
          <select style={s.select} value={selectedProject?.id || ''} onChange={e => {
            const p = projects.find(p => p.id === e.target.value)
            setSelectedProject(p || null)
          }}>
            <option value="">Choose a project...</option>
            {projects.map(p => <option key={p.id} value={p.id} style={{ background: '#0f1d36' }}>{p.project_name} — {p.client_name}</option>)}
          </select>

          {selectedProject && (
            <div style={{ marginTop: 16 }}>
              <div style={s.infoGrid}>
                <InfoItem label="Client" value={selectedProject.client_name} />
                <InfoItem label="Client Contact" value={selectedProject.client_approver_name} />
                <InfoItem label="Contact Email" value={selectedProject.client_approver_email} />
                <InfoItem label="PO Number" value={selectedProject.po_number} />
              </div>
              {!selectedProject.client_approver_email && (
                <div style={{ ...s.alert('error'), marginTop: 12 }}><AlertTriangle size={16} />No client approver email on this project. Cannot send CV.</div>
              )}
            </div>
          )}

          <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
            <button style={s.btn(BRAND.sky, !selectedProject || !selectedProject.client_approver_email)} disabled={!selectedProject || !selectedProject.client_approver_email} onClick={() => setStep(1)}>
              Next <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 1: Select Candidate ── */}
      {step === 1 && (
        <div style={s.card}>
          <div style={s.cardTitle}><User size={20} color={BRAND.sky} />Select Candidate</div>
          <div style={{ position: 'relative', marginBottom: 16 }}>
            <Search size={16} style={{ position: 'absolute', left: 12, top: 14, color: '#475569' }} />
            <input style={{ ...s.input, paddingLeft: 36 }} placeholder="Search by name, employer, role, skills, location..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          </div>

          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            {filteredCandidates.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 32, color: '#64748b' }}>No eligible candidates found</div>
            ) : filteredCandidates.map(c => (
              <div key={c.id} style={s.candidateRow(selectedCandidate?.id === c.id)} onClick={() => setSelectedCandidate(c)}>
                <Initials name={c.full_name} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#e2e8f0' }}>{c.full_name}</div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                    {c.role_interest || 'N/A'} · {c.current_employer || 'N/A'} · {c.location || ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  {c.hr_passed === true && <span style={s.badge(BRAND.green)}>HR ✓</span>}
                  {c.hr_passed === false && <span style={s.badge(BRAND.orange)}>HR ✗</span>}
                  <span style={s.badge(BRAND.sky)}>{c.state}</span>
                </div>
              </div>
            ))}
          </div>

          {disabledCandidates.length > 0 && (
            <div style={{ marginTop: 12, fontSize: '0.72rem', color: '#475569' }}>
              {disabledCandidates.length} candidate(s) hidden (no consent, no CV, or PURGED)
            </div>
          )}

          <div style={{ marginTop: 20, display: 'flex', justifyContent: 'space-between' }}>
            <button style={s.btn('#1e293b', false)} onClick={() => setStep(0)}><ChevronLeft size={16} /> Back</button>
            <button style={s.btn(BRAND.sky, !selectedCandidate)} disabled={!selectedCandidate} onClick={() => setStep(2)}>Next <ChevronRight size={16} /></button>
          </div>
        </div>
      )}

      {/* ── STEP 2: Review & Confirm ── */}
      {step === 2 && (
        <div style={s.card}>
          <div style={s.cardTitle}><Eye size={20} color={BRAND.sky} />Review & Confirm</div>
          <div style={s.row}>
            <div style={s.col}>
              <div style={{ ...s.label, marginBottom: 10 }}>Candidate</div>
              <div style={s.infoGrid}>
                <InfoItem label="Name" value={selectedCandidate.full_name} />
                <InfoItem label="Role" value={selectedCandidate.role_interest} />
                <InfoItem label="Experience" value={selectedCandidate.experience} />
                <InfoItem label="Location" value={selectedCandidate.location} />
                <InfoItem label="Employer" value={selectedCandidate.current_employer} />
                <InfoItem label="Skills" value={(selectedCandidate.skills || []).join(', ')} />
              </div>
            </div>
            <div style={{ ...s.col, maxWidth: 300 }}>
              <div style={{ ...s.label, marginBottom: 10 }}>Recipient</div>
              <div style={s.infoGrid}>
                <InfoItem label="Client" value={selectedProject.client_name} />
                <InfoItem label="Contact" value={selectedProject.client_approver_name} />
                <InfoItem label="Email" value={selectedProject.client_approver_email} />
                <InfoItem label="Project" value={selectedProject.project_name} />
              </div>
            </div>
          </div>

          {/* HR Score + Notes summary */}
          {selectedCandidate.hr_score && (
            <div style={{ marginTop: 16, padding: '14px 16px', background: 'rgba(52,191,58,0.08)', border: '1px solid rgba(52,191,58,0.3)', borderRadius: 10 }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#4ade80', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Star size={14} /> HR Score: {selectedCandidate.hr_score}/100 — Scored by {selectedCandidate.hr_evaluated_by}
              </div>
              {selectedCandidate.hr_interview_notes && (
                <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>{selectedCandidate.hr_interview_notes}</div>
              )}
            </div>
          )}

          {/* Original CV download */}
          <div style={{ marginTop: 16, padding: '14px 16px', background: 'rgba(21,152,204,0.08)', border: '1px solid rgba(21,152,204,0.3)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: BRAND.sky, marginBottom: 2 }}>Original CV on File</div>
              <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{selectedCandidate.cv_path?.split('/').pop() || 'CV file'}</div>
            </div>
            <button style={s.btn(BRAND.sky, cvDownloading)} disabled={cvDownloading} onClick={handleDownloadOriginalCV}>
              {cvDownloading ? <><Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> Loading...</> : <><Eye size={14} /> View Original CV</>}
            </button>
          </div>
          
          {cvDownloadUrl && (
            <div style={{ marginTop: 16 }}>
              <iframe src={cvDownloadUrl} style={{ width: '100%', height: 400, border: '1px solid #1e3050', borderRadius: 8 }} title="Original CV" />
            </div>
          )}

          <div style={{ marginTop: 20 }}>
            <label style={s.label}>Custom Job Description (optional)</label>
            <textarea style={s.textarea} placeholder="Leave empty to auto-generate from project context..." value={jdText} onChange={e => setJdText(e.target.value)} />
          </div>

          <div style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div>
              <label style={s.label}>Interview Date (optional — included in email)</label>
              <input type="date" style={{ ...s.input, maxWidth: 220 }} value={meetingDate} onChange={e => setMeetingDate(e.target.value)} />
            </div>
            {meetingDate && !stagingResult && (
              <button style={s.btn(BRAND.green, false)} onClick={handleScheduleInterview}>
                <Calendar size={14} /> Schedule Interview
              </button>
            )}
            {stagingResult === 'INTERVIEW_SCHEDULED' && (
              <div style={{ fontSize: '0.82rem', color: '#4ade80', fontWeight: 600 }}>✓ Candidate moved to INTERVIEW_SCHEDULED</div>
            )}
          </div>

          <div style={{ marginTop: 20, display: 'flex', justifyContent: 'space-between' }}>
            <button style={s.btn('#1e293b', false)} onClick={() => setStep(1)}><ChevronLeft size={16} /> Back</button>
            <button style={s.btn(BRAND.sky, false)} onClick={() => setStep(3)}>Continue to Prepare <ChevronRight size={16} /></button>
          </div>
        </div>
      )}


      {/* ── STEP 3: Prepare ── */}
      {step === 3 && (
        <div style={s.card}>
          <div style={s.cardTitle}><FileText size={20} color={BRAND.sky} />Prepare Interview CV</div>

          <div style={{ display: 'flex', gap: 20, marginBottom: 20 }}>
            <div style={{ ...s.infoItem, flex: 1 }}>
              <div style={s.infoLabel}>Candidate</div>
              <div style={s.infoVal}>{selectedCandidate.full_name}</div>
            </div>
            <div style={{ ...s.infoItem, flex: 1 }}>
              <div style={s.infoLabel}>Project</div>
              <div style={s.infoVal}>{selectedProject.project_name}</div>
            </div>
            <div style={{ ...s.infoItem, flex: 1 }}>
              <div style={s.infoLabel}>Client</div>
              <div style={s.infoVal}>{selectedProject.client_name}</div>
            </div>
          </div>

          <div style={{ padding: '14px 16px', background: 'rgba(21,152,204,0.1)', borderRadius: 10, border: '1px solid rgba(21,152,204,0.25)', fontSize: '0.82rem', color: '#94a3b8', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
            <Shield size={16} color={BRAND.sky} />
            PDPL consent verified. CV will be reformatted using the Datalake Skills Portfolio template.
          </div>

          {preparing ? (
            <div style={{ textAlign: 'center', padding: '40px 20px' }}>
              <Loader size={32} style={{ color: BRAND.sky, animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
              <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: '0.95rem', marginBottom: 8 }}>Extracting CV data and generating Datalake format…</div>
              <div style={{ color: '#64748b', fontSize: '0.78rem' }}>This may take up to 60 seconds</div>
            </div>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <button style={s.btn('#1e293b', false)} onClick={() => setStep(2)}><ChevronLeft size={16} /> Back</button>
              <button style={s.btn(BRAND.orange, false)} onClick={handlePrepare}>
                <FileText size={16} /> Prepare CV
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── STEP 4: Preview & Send ── */}
      {step === 4 && prepResult && (
        <>
          <div style={s.alert('success')}><CheckCircle size={16} />CV prepared successfully — {prepResult.format.toUpperCase()} stored securely (PDPL retention)</div>

          <div style={s.card}>
            <div style={s.cardTitle}><Eye size={20} color={BRAND.green} />Preview</div>
            {prepResult.format === 'docx' ? (
              <div style={{ textAlign: 'center', padding: '32px 20px' }}>
                <FileText size={48} style={{ color: BRAND.sky, marginBottom: 16 }} />
                <div style={{ color: '#e2e8f0', fontWeight: 600, marginBottom: 8 }}>DTLK-FORM-HR-CV-002-v1.1_{prepResult.candidate_name.replace(/\s+/g, '_')}.docx</div>
                <a href={prepResult.signed_url} target="_blank" rel="noopener noreferrer" style={{ ...s.btn(BRAND.sky, false), textDecoration: 'none', display: 'inline-flex' }}>
                  <Download size={16} /> Download DOCX
                </a>
                <div style={{ fontSize: '0.72rem', color: '#475569', marginTop: 12 }}>Signed URL expires in 60 minutes</div>
              </div>
            ) : (
              <iframe src={prepResult.signed_url} style={{ width: '100%', height: 500, border: '1px solid #1e3050', borderRadius: 8 }} title="CV Preview" />
            )}
          </div>

          <div style={s.card}>
            <div style={s.cardTitle}><Send size={20} color={BRAND.sky} />Send to Client</div>

            <div style={s.infoGrid}>
              <InfoItem label="To" value={`${prepResult.client_approver_name} <${prepResult.client_approver_email}>`} />
              <InfoItem label="From" value="hr@datalake.sa" />
              <InfoItem label="Candidate" value={prepResult.candidate_name} />
            </div>

            {sendResult ? (
              <div style={{ marginTop: 20, textAlign: 'center' }}>
                <div style={s.alert('success')}><CheckCircle size={16} />Email sent successfully</div>
                <div style={s.infoGrid}>
                  <InfoItem label="Sent To" value={sendResult.sent_to} />
                  <InfoItem label="Gmail Message ID" value={sendResult.gmail_message_id} />
                  <InfoItem label="Sent At" value={sendResult.sent_at} />
                </div>
                <button style={{ ...s.btn(BRAND.sky, false), marginTop: 20 }} onClick={resetAll}>Prepare Another CV</button>
              </div>
            ) : userRole !== 'ceo' ? (
              <div style={{ ...s.alert('warn'), marginTop: 16 }}><AlertTriangle size={16} />Only Management can dispatch CVs to clients. Your role: {userRole || 'unknown'}</div>
            ) : (
              <div style={{ marginTop: 16 }}>
                <label style={s.label}>CC (optional) — add anyone else who should receive this</label>
                <input
                  style={s.input}
                  placeholder="name@example.com, another@example.com"
                  value={ccEmails}
                  onChange={e => setCcEmails(e.target.value)}
                />
                <div style={{ fontSize: '0.7rem', color: '#475569', marginTop: 6, marginBottom: 14 }}>
                  Comma-separated. Goes out as CC alongside {prepResult.client_approver_email}.
                </div>
                <button style={s.btn(BRAND.green, sending)} disabled={sending} onClick={handleSend}>
                  {sending ? <><Loader size={16} style={{ animation: 'spin 1s linear infinite' }} /> Sending...</> : <><Send size={16} /> Send to {prepResult.client_approver_name}</>}
                </button>
              </div>
            )}
          </div>

          <button style={{ ...s.btn('#1e293b', false), marginTop: 8 }} onClick={resetAll}>← Start Over</button>
        </>
      )}

      {/* Compliance footer */}
      <div style={{ padding: '14px 20px', background: '#0d1829', border: '1px solid #1e3050', borderRadius: 10, fontSize: '0.68rem', color: '#475569', lineHeight: 1.7, display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 20 }}>
        <Shield size={14} style={{ flexShrink: 0, marginTop: 2 }} />
        <div>
          <strong style={{ color: '#64748b' }}>DTLK-OPS-PRC-002 / PDPL Art. 4, 5</strong><br />
          Candidate CVs are processed under PDPL consent. PURGED candidates are blocked. All preparation and dispatch events are recorded in task_audit_log (append-only). Output files are archived in WORM storage (datalake-worm-hr). CV dispatch requires Management authorization (separation of duties).
        </div>
      </div>

    </div>
  )
}
