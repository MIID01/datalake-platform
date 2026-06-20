import { useState, useRef, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db, EXTRACT_CV_URL, CLOUD_FUNCTION_URL } from '../lib/firebase'
import { MapPin, Briefcase, DollarSign, Upload, X, CheckCircle, ArrowLeft, ChevronDown, Loader, Sparkles, FileText, Shield } from 'lucide-react'
import '../styles/careers.css'

const experienceOptions = ['0-2 years', '3-5 years', '6-10 years', '10+ years']
const noticeOptions = ['Immediate', '1 month', '2 months', '3+ months']
const STAGES = { UPLOAD: 'upload', PROCESSING: 'processing', REVIEW: 'review' }

const PDPL_ITEMS = [
  'I consent to Datalake collecting, storing, and processing my personal data for the purpose of evaluating me for current and future role opportunities.',
  'I understand my data will be retained for 12 months, renewable for an additional 12 months with my explicit consent.',
  'I understand I can request access to, correction of, or deletion of my data at any time by visiting datalake.sa/data-rights or emailing privacy@datalake.sa.',
  "I understand that Datalake complies with Saudi Arabia's PDPL (Personal Data Protection Law) and stores my data in KSA sovereign region only.",
  'I consent to Datalake using AI (self-hosted in KSA me-central2 region) to extract structured data from my CV. No data leaves KSA sovereign infrastructure.',
]

const PROC_LABELS = ['Uploading CV…', 'Extracting with Datalake AI…', 'Mapping fields…', 'Done']

export default function Careers() {
  const navigate = useNavigate()
  const formRef = useRef(null)
  const fileInputRef = useRef(null)

  // Live job listings from Firestore.
  //
  // The query is intentionally a single-field filter (no orderBy on
  // created_at) so it does NOT require a composite index — anyone can add a
  // listing in /hr/jobs without an ops index-migration step. We sort newest-
  // first on the client; the open-roles list is tiny (single digits) so this
  // is free.
  //
  // Errors are surfaced to the UI instead of being swallowed — a silent
  // empty page is exactly how this broke before.
  const [openRoles, setOpenRoles] = useState([])
  const [jobsLoading, setJobsLoading] = useState(true)
  const [jobsError, setJobsError] = useState('')
  useEffect(() => {
    // One-time read (not a live listener) — a public, ad-traffic page shouldn't open a
    // realtime Firestore connection per visitor; job listings don't change mid-visit.
    let alive = true
    ;(async () => {
      try {
        const snap = await getDocs(query(collection(db, 'job_listings'), where('status', '==', 'open')))
        if (!alive) return
        const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        rows.sort((a, b) => (b.created_at?.toMillis?.() ?? 0) - (a.created_at?.toMillis?.() ?? 0))
        setOpenRoles(rows)
        // Deep-link from a campaign ad (?job=<id>) pre-selects that role.
        const jobParam = new URLSearchParams(window.location.search).get('job')
        if (jobParam) {
          const r = rows.find(x => x.id === jobParam)
          if (r) { setSelectedJobId(jobParam); setForm(p => ({ ...p, roleInterest: p.roleInterest || r.title })) }
        }
        setJobsLoading(false); setJobsError('')
      } catch (err) {
        if (!alive) return
        console.error('careers job_listings query failed:', err)
        setJobsError(err.message || 'Could not load open roles'); setJobsLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  // Stage — CV upload → AI extraction → review form
  const [stage, setStage] = useState(STAGES.UPLOAD)

  // CV blob kept in state for re-attach on final submit
  const [cvFile, setCvFile] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [cvError, setCvError] = useState('')

  // Processing
  const [procStep, setProcStep] = useState(0)
  const [procError, setProcError] = useState('')
  const [extracting, setExtracting] = useState(false) // in-flight guard — blocks the retry-storm that OOM'd OCR

  // Form state (pre-filled after extraction)
  const [form, setForm] = useState({
    fullName: '', email: '', phone: '', location: '',
    experience: '', linkedin: '', employer: '',
    salaryRange: '', noticePeriod: '', roleInterest: '',
  })
  const [skills, setSkills] = useState([])
  const [skillInput, setSkillInput] = useState('')
  const [consent, setConsent] = useState(Array(5).fill(false))
  const [submitted, setSubmitted] = useState(false)
  const [candidateId, setCandidateId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [selectedJobId, setSelectedJobId] = useState(null)

  // --- Helpers ---
  const updateForm = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const validateFile = (file) => {
    if (!file) return false
    if (file.size > 5 * 1024 * 1024) { setCvError('File must be under 5 MB'); return false }
    if (!/\.(pdf|docx|doc)$/i.test(file.name)) { setCvError('Only PDF or DOCX files accepted'); return false }
    setCvError('')
    return true
  }

  // --- Stage 1: Upload handlers ---
  const onFileSelect = (file) => {
    if (!validateFile(file)) return
    setCvFile(file)
  }

  const handleFileInput = (e) => onFileSelect(e.target.files[0])

  const handleDrop = useCallback((e) => {
    e.preventDefault(); setDragOver(false)
    const file = e.dataTransfer.files[0]
    onFileSelect(file)
  }, [])

  const handleDragOver = useCallback((e) => { e.preventDefault(); setDragOver(true) }, [])
  const handleDragLeave = useCallback(() => setDragOver(false), [])

  // --- Stage 2: Extract CV ---
  const startExtraction = async () => {
    if (!cvFile || extracting) return // block concurrent re-submit while a request is in flight
    setExtracting(true)
    setStage(STAGES.PROCESSING)
    setProcStep(0)
    setProcError('')

    try {
      setProcStep(1)
      const fd = new FormData()
      fd.append('cv', cvFile)

      setProcStep(2)
      const res = await fetch(EXTRACT_CV_URL, { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Extraction failed')

      setProcStep(3)
      // Map extracted fields → form
      const d = data.extracted || data
      setForm(prev => ({
        ...prev,
        fullName: d.full_name || d.fullName || prev.fullName,
        email: d.email || prev.email,
        phone: d.phone || prev.phone,
        location: d.location || prev.location,
        experience: d.years_experience || d.experience || prev.experience,
        linkedin: d.linkedin_url || d.linkedin || prev.linkedin,
        employer: d.current_employer || d.employer || prev.employer,
        salaryRange: d.salary_expectation || d.salaryRange || prev.salaryRange,
        noticePeriod: d.notice_period || d.noticePeriod || prev.noticePeriod,
        roleInterest: d.role_interest || d.current_role || d.roleInterest || prev.roleInterest,
      }))
      if (d.skills) {
        const s = Array.isArray(d.skills) ? d.skills : d.skills.split(',').map(x => x.trim()).filter(Boolean)
        setSkills(s)
      }

      await new Promise(r => setTimeout(r, 600))
      setStage(STAGES.REVIEW)
    } catch (err) {
      console.error('CV extraction error:', err)
      setProcError(err.message || 'Extraction failed. Please try again.')
    } finally {
      setExtracting(false) // re-enable on success OR failure
    }
  }

  // --- Stage 3: Review + Submit ---
  const handleSkillKeyDown = (e) => {
    if ((e.key === ',' || e.key === 'Enter') && skillInput.trim()) {
      e.preventDefault()
      const ns = skillInput.trim().replace(/,/g, '')
      if (ns && !skills.includes(ns)) setSkills(p => [...p, ns])
      setSkillInput('')
    }
  }
  const removeSkill = (s) => setSkills(p => p.filter(x => x !== s))
  const toggleConsent = (i) => setConsent(p => p.map((v, j) => j === i ? !v : v))

  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)
  const requiredFields = ['fullName', 'email', 'phone', 'location', 'experience', 'noticePeriod', 'roleInterest']
  const allRequired = requiredFields.every(f => form[f]?.trim())
  const allConsented = consent.every(Boolean)
  const canSubmit = allRequired && isEmailValid && cvFile && allConsented

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!canSubmit || submitting) return
    setSubmitting(true)
    setSubmitError('')
    try {
      const fd = new FormData()
      fd.append('full_name', form.fullName)
      fd.append('email', form.email)
      fd.append('phone', form.phone)
      fd.append('location', form.location)
      fd.append('experience', form.experience)
      fd.append('notice_period', form.noticePeriod)
      fd.append('skills', skills.join(', '))
      fd.append('linkedin_url', form.linkedin)
      fd.append('current_employer', form.employer)
      fd.append('salary_expectation', form.salaryRange)
      fd.append('role_interest', form.roleInterest)
      fd.append('consent_granted', 'true')
      fd.append('ai_extraction_consent', 'true')
      if (selectedJobId) fd.append('job_listing_id', selectedJobId)
      // Recruiting-campaign attribution — carry UTM params from the ad/link through
      // to the application (LinkedIn, Google Ads, referral, …).
      const sp = new URLSearchParams(window.location.search)
      ;['utm_source', 'utm_medium', 'utm_campaign', 'campaign_id'].forEach(k => { const v = sp.get(k); if (v) fd.append(k, v) })
      // Re-attach original CV blob
      fd.append('cv', cvFile)

      const res = await fetch(CLOUD_FUNCTION_URL, { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Submission failed')
      setCandidateId(data.candidate_id)
      setSubmitted(true)
    } catch (err) {
      console.error('Submit error:', err)
      setSubmitError(err.message || 'Failed to submit. Please try again.')
    } finally { setSubmitting(false) }
  }

  const scrollToUpload = () => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  // ────────── RENDER ──────────

  return (
    <div className="careers-page">
      {/* Header */}
      <header className="careers-header">
        <div className="careers-header-left">
          <img src="/images/icon.svg" alt="Datalake" style={{ height: 30 }} />
          <div>
            <div className="careers-header-title">Datalake Careers</div>
            <div className="careers-header-sub">analytics · data · technology</div>
          </div>
        </div>
        <button className="careers-back" onClick={() => navigate('/')} aria-label="Back to main site">
          <ArrowLeft size={16} /> Back to main site
        </button>
      </header>

      {/* Hero */}
      <section className="careers-hero">
        <h1>Build with Datalake</h1>
        <p>
          Analytics, data, technology — join the team delivering Saudi Arabia's zero-friction enterprise platforms.
          We're hiring engineers who want to build infrastructure that matters.
        </p>
      </section>

      {/* Open Roles */}
      <section className="careers-roles">
        {jobsLoading ? (
          <div style={{ textAlign: 'center', padding: 32, color: '#64748b', fontSize: '0.9rem' }}>Loading open positions…</div>
        ) : jobsError ? (
          <div style={{ textAlign: 'center', padding: 32, color: '#C0392B', fontSize: '0.9rem' }}>
            Could not load open roles right now ({jobsError}). Please refresh in a moment.
          </div>
        ) : openRoles.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 32, color: '#64748b', fontSize: '0.9rem' }}>
            No open positions at the moment. Check back soon or submit a general application below.
          </div>
        ) : openRoles.map((role) => (
          <div key={role.id} className={`careers-role-card${selectedJobId === role.id ? ' selected' : ''}`} style={{ cursor: 'pointer', outline: selectedJobId === role.id ? '2px solid #1598CC' : 'none' }}>
            <div className="role-meta">
              <span className="role-id">{role.id.slice(0, 8).toUpperCase()}</span>
              <span className="role-type">Full-time</span>
            </div>
            <h3 className="role-title">{role.title}</h3>
            <div className="role-details">
              {role.location && <div className="role-detail"><MapPin size={14} color="#8898aa" /> {role.location}</div>}
              {role.salary_range && <div className="role-detail"><DollarSign size={14} color="#8898aa" /> {role.salary_range}</div>}
              {role.client && <div className="role-detail"><Briefcase size={14} color="#8898aa" /> {role.client}</div>}
            </div>
            <button className="role-apply-btn" onClick={() => { setSelectedJobId(role.id); setForm(p => ({ ...p, roleInterest: p.roleInterest || role.title })); document.getElementById('careers-upload-section')?.scrollIntoView({ behavior: 'smooth' }) }} aria-label={`Apply for ${role.title}`}>
              {selectedJobId === role.id ? '✓ Selected — Upload CV below' : 'Apply Now'}
            </button>
          </div>
        ))}
      </section>

      {/* ══════ STAGE 1 — Upload ══════ */}
      {stage === STAGES.UPLOAD && (
        <section ref={formRef} className="careers-form-section">
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#022873', marginBottom: 8, textAlign: 'center' }}>
            Apply Now
          </h2>
          <p style={{ textAlign: 'center', color: '#64748b', fontSize: '0.9rem', marginBottom: 24 }}>
            Upload your CV and our AI will auto-fill the application form for you.
          </p>
          <div className="form-card" style={{ maxWidth: 520, margin: '0 auto' }}>
            <div
              className={`drop-zone${dragOver ? ' drag-over' : ''}`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              aria-label="Upload CV"
            >
              {cvFile ? (
                <div className="file-attached">
                  <FileText size={24} color="#34BF3A" />
                  <div className="info">
                    <div className="name">{cvFile.name}</div>
                    <div className="size">{(cvFile.size / 1024).toFixed(0)} KB</div>
                  </div>
                  <button type="button" onClick={(e) => { e.stopPropagation(); setCvFile(null) }} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', color: '#475569' }} aria-label="Remove file">
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <div style={{ textAlign: 'center' }}>
                  <Upload size={36} color="#1598CC" style={{ marginBottom: 12 }} />
                  <div style={{ fontWeight: 600, color: '#1A1A2E', marginBottom: 4 }}>Drag & drop your CV here</div>
                  <div style={{ fontSize: '0.82rem', color: '#64748b' }}>PDF or DOCX · max 5 MB</div>
                </div>
              )}
              <input ref={fileInputRef} type="file" accept=".pdf,.docx,.doc" onChange={handleFileInput} style={{ display: 'none' }} />
            </div>
            {cvError && <div className="upload-error" style={{ marginTop: 6 }}>{cvError}</div>}
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button
                type="button"
                disabled={!cvFile || extracting}
                onClick={startExtraction}
                className={`submit-btn${cvFile && !extracting ? ' enabled' : ''}`}
                style={{ flex: 1 }}
              >
                <Sparkles size={16} style={{ marginRight: 6 }} /> {extracting ? 'Extracting…' : 'Extract & Auto-Fill'}
              </button>
              <button
                type="button"
                onClick={() => setStage(STAGES.REVIEW)}
                style={{ flex: 0, padding: '10px 20px', background: 'none', border: '1px solid #e2e8f0', borderRadius: 8, color: '#64748b', cursor: 'pointer', fontSize: '0.85rem', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
              >
                Skip — Fill Manually
              </button>
            </div>
            <div style={{ marginTop: 12, fontSize: '0.72rem', color: '#94a3b8', textAlign: 'center' }}>
              <Shield size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
              All processing in me-central2 (Dammam). Self-hosted AI — no data leaves KSA.
            </div>
          </div>
        </section>
      )}

      {/* ══════ STAGE 2 — Processing ══════ */}
      {stage === STAGES.PROCESSING && (
        <section className="careers-form-section">
          <div className="form-card" style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center', padding: '48px 32px' }}>
            <Sparkles size={40} color="#1598CC" style={{ marginBottom: 16 }} />
            <h2 style={{ fontSize: '1.3rem', fontWeight: 700, color: '#022873', marginBottom: 8 }}>Extracting Your CV</h2>
            <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: 24 }}>This can take up to ~60 seconds — please don't refresh or resubmit.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'left', marginBottom: 24 }}>
              {PROC_LABELS.map((label, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.88rem', color: i <= procStep ? '#1A1A2E' : '#cbd5e1', fontWeight: i === procStep ? 600 : 400, transition: 'all 0.3s' }}>
                  {i < procStep ? <CheckCircle size={18} color="#34BF3A" /> : i === procStep ? <Loader size={18} color="#1598CC" className="spin" /> : <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid #e2e8f0' }} />}
                  {label}
                </div>
              ))}
            </div>
            {procError && (
              <div style={{ padding: '12px 16px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, color: '#DC2626', fontSize: '0.85rem', marginBottom: 16 }}>
                {procError}
                <div style={{ marginTop: 8, display: 'flex', gap: 8, justifyContent: 'center' }}>
                  <button onClick={startExtraction} disabled={extracting} style={{ padding: '6px 16px', borderRadius: 6, border: '1px solid #DC2626', background: 'transparent', color: extracting ? '#94a3b8' : '#DC2626', cursor: extracting ? 'not-allowed' : 'pointer', fontSize: '0.82rem', fontFamily: 'inherit' }}>{extracting ? 'Extracting…' : 'Retry'}</button>
                  <button onClick={() => setStage(STAGES.REVIEW)} style={{ padding: '6px 16px', borderRadius: 6, border: '1px solid #e2e8f0', background: 'transparent', color: '#64748b', cursor: 'pointer', fontSize: '0.82rem', fontFamily: 'inherit' }}>Fill Manually</button>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ══════ STAGE 3 — Review ══════ */}
      {stage === STAGES.REVIEW && (
        <section ref={formRef} className="careers-form-section">
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#022873', marginBottom: 24, textAlign: 'center' }}>
            Apply Now
          </h2>
          <div className="form-card">
            <div className="ai-banner" style={{ background: '#F0FDF4', borderColor: '#86EFAC' }}>
              <Sparkles size={18} color="#22C55E" />
              <span>Review the auto-filled fields below and correct anything that looks off. Your CV is still required.</span>
            </div>

            <form onSubmit={handleSubmit}>
              {/* Name + Email */}
              <div className="form-row">
                <div>
                  <label className="form-label" htmlFor="fullName">Full Name *</label>
                  <input id="fullName" className="form-input" placeholder="e.g. Mohammed Al-Otaibi" value={form.fullName} onChange={e => updateForm('fullName', e.target.value)} required />
                </div>
                <div>
                  <label className="form-label" htmlFor="email">Email *</label>
                  <input id="email" type="email" className={`form-input${form.email && !isEmailValid ? ' error' : ''}`} placeholder="you@example.com" value={form.email} onChange={e => updateForm('email', e.target.value)} required />
                  {form.email && !isEmailValid && <div style={{ fontSize: '0.72rem', color: '#C0392B', marginTop: 4 }}>Invalid email format</div>}
                </div>
              </div>

              {/* Phone + Location */}
              <div className="form-row">
                <div>
                  <label className="form-label" htmlFor="phone">Phone (with country code) *</label>
                  <input id="phone" className="form-input" placeholder="+966 5XX XXX XXXX" value={form.phone} onChange={e => updateForm('phone', e.target.value)} required />
                </div>
                <div>
                  <label className="form-label" htmlFor="location">Current Location *</label>
                  <input id="location" className="form-input" placeholder="Riyadh, KSA" value={form.location} onChange={e => updateForm('location', e.target.value)} required />
                </div>
              </div>

              {/* Experience + Notice */}
              <div className="form-row">
                <div>
                  <label className="form-label" htmlFor="experience">Years of Experience *</label>
                  <div className="select-wrap">
                    <select id="experience" className="form-select" value={form.experience} onChange={e => updateForm('experience', e.target.value)} required>
                      <option value="">Select...</option>
                      {experienceOptions.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                    <ChevronDown size={16} />
                  </div>
                </div>
                <div>
                  <label className="form-label" htmlFor="noticePeriod">Notice Period *</label>
                  <div className="select-wrap">
                    <select id="noticePeriod" className="form-select" value={form.noticePeriod} onChange={e => updateForm('noticePeriod', e.target.value)} required>
                      <option value="">Select...</option>
                      {noticeOptions.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                    <ChevronDown size={16} />
                  </div>
                </div>
              </div>

              {/* Skills */}
              <div className="form-group">
                <label className="form-label">Primary Skills (type and press comma or Enter)</label>
                <div className="skills-box">
                  {skills.map(skill => (
                    <span key={skill} className="skill-tag">
                      {skill}
                      <button type="button" onClick={() => removeSkill(skill)} aria-label={`Remove ${skill}`}><X size={12} /></button>
                    </span>
                  ))}
                  <input
                    className="skill-input"
                    value={skillInput}
                    onChange={e => setSkillInput(e.target.value)}
                    onKeyDown={handleSkillKeyDown}
                    placeholder={skills.length === 0 ? 'e.g. Python, React, AWS...' : ''}
                  />
                </div>
              </div>

              {/* LinkedIn + Employer */}
              <div className="form-row">
                <div>
                  <label className="form-label" htmlFor="linkedin">LinkedIn URL</label>
                  <input id="linkedin" className="form-input" placeholder="linkedin.com/in/yourname" value={form.linkedin} onChange={e => updateForm('linkedin', e.target.value)} />
                </div>
                <div>
                  <label className="form-label" htmlFor="employer">Current Employer</label>
                  <input id="employer" className="form-input" placeholder="Company name" value={form.employer} onChange={e => updateForm('employer', e.target.value)} />
                </div>
              </div>

              {/* Salary + Role */}
              <div className="form-row">
                <div>
                  <label className="form-label" htmlFor="salary">Expected Salary Range (SAR)</label>
                  <input id="salary" className="form-input" placeholder="e.g. 20,000 – 25,000" value={form.salaryRange} onChange={e => updateForm('salaryRange', e.target.value)} />
                </div>
                <div>
                  <label className="form-label" htmlFor="roleInterest">Role Interested In *</label>
                  <div className="select-wrap">
                    <select id="roleInterest" className="form-select" value={form.roleInterest} onChange={e => updateForm('roleInterest', e.target.value)} required>
                      <option value="">Select...</option>
                      {openRoles.map(r => <option key={r.id} value={r.title}>{r.title} — {r.location}</option>)}
                      <option value="Other">Other</option>
                    </select>
                    <ChevronDown size={16} />
                  </div>
                </div>
              </div>

              {/* CV Upload — required */}
              <div className="form-group">
                <label className="form-label" htmlFor="cvUpload">Upload Your CV *</label>
                <div
                  className={`drop-zone${dragOver ? ' drag-over' : ''}`}
                  style={{ padding: '20px', minHeight: 'auto' }}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onClick={() => fileInputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                  aria-label="Upload CV"
                >
                  {cvFile ? (
                    <div className="file-attached" style={{ margin: 0, border: 'none', padding: 0 }}>
                      <FileText size={18} color="#34BF3A" />
                      <div className="info">
                        <div className="name">{cvFile.name}</div>
                        <div className="size">{(cvFile.size / 1024).toFixed(0)} KB</div>
                      </div>
                      <button type="button" onClick={(e) => { e.stopPropagation(); setCvFile(null) }} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', color: '#475569' }} aria-label="Remove file">
                        <X size={16} />
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#64748b' }}>
                      <Upload size={20} color="#1598CC" />
                      <span>Drag & drop or click to upload · PDF / DOCX · max 5 MB</span>
                    </div>
                  )}
                  <input ref={fileInputRef} id="cvUpload" type="file" accept=".pdf,.docx,.doc" onChange={handleFileInput} style={{ display: 'none' }} />
                </div>
                {cvError && <div className="upload-error" style={{ marginTop: 6 }}>{cvError}</div>}
              </div>

              {/* PDPL Consent — 5 checkboxes */}
              <div className="consent-box">
                <h4 className="consent-title">
                  <Shield size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                  Data Protection Notice (PDPL Compliance)
                </h4>
                <p className="consent-intro">By submitting this application, I confirm that:</p>

                {PDPL_ITEMS.map((text, i) => (
                  <div key={i} className="check-row" onClick={() => toggleConsent(i)} role="checkbox" aria-checked={consent[i]} tabIndex={0} onKeyDown={e => e.key === ' ' && (e.preventDefault(), toggleConsent(i))}>
                    <div className={`check-box${consent[i] ? ' checked' : ''}`}>
                      {consent[i] && <CheckCircle size={14} color="#34BF3A" />}
                    </div>
                    <span className="check-text">{text}</span>
                  </div>
                ))}

                <div className="privacy-link">
                  <a href="#">View full Privacy Policy</a>
                </div>
              </div>

              {/* Submit */}
              <button type="submit" disabled={!canSubmit || submitting} className={`submit-btn${canSubmit && !submitting ? ' enabled' : ''}`} aria-label="Submit application">
                {submitting ? (
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                    <Loader size={18} className="spin" /> Submitting…
                  </span>
                ) : 'Submit Application'}
              </button>

              {submitError && <div className="submit-error">{submitError}</div>}

              {!canSubmit && (
                <div className="validation-hint">
                  {!allRequired && 'Fill all required fields'}
                  {allRequired && !isEmailValid && ' · Fix email format'}
                  {allRequired && isEmailValid && !cvFile && ' · Upload your CV'}
                  {allRequired && isEmailValid && cvFile && !allConsented && ' · Accept all PDPL consent items'}
                </div>
              )}
            </form>
          </div>
        </section>
      )}

      {/* Footer */}
      <footer className="careers-footer">
        <div className="links">
          <a href="#">Privacy Policy</a>
          <a href="#">Terms of Service</a>
          <a href="mailto:privacy@datalake.sa">Contact</a>
        </div>
        <div>Datalake Saudi Arabia LLC, Riyadh Al-Yarmouk 13243, CR:1009194773 NUN:7048904952</div>
      </footer>

      {/* Success Modal */}
      {submitted && (
        <div className="careers-modal-overlay" role="dialog" aria-modal="true" aria-label="Application submitted">
          <div className="careers-modal">
            <div className="success-icon">
              <CheckCircle size={32} color="#34BF3A" />
            </div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#1A1A2E', marginBottom: 8 }}>Application Received!</h2>
            <p style={{ fontSize: '0.9rem', color: '#475569', lineHeight: 1.6, marginBottom: 4 }}>
              We've sent a confirmation to <strong>{form.email}</strong>.
            </p>
            <p style={{ fontSize: '0.9rem', color: '#475569', marginBottom: 20 }}>
              Your candidate ID is <strong style={{ fontFamily: "'JetBrains Mono', monospace", color: '#022873' }}>{candidateId}</strong>
            </p>
            <p style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: 24, lineHeight: 1.5 }}>
              You'll hear back from us within 5 business days. Your data is now in our talent pool with your consent.
            </p>
            <button className="modal-return-btn" onClick={() => navigate('/')}>
              Return to Datalake
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
