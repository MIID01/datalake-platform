import { useState, useMemo, useEffect } from 'react'
import { ShieldCheck, Send, User, Briefcase, MapPin, Clock, DollarSign, Phone, Star, Loader, LogOut, Printer, CheckCircle, AlertTriangle, ArrowRight } from 'lucide-react'
import { collection, onSnapshot, query, where, orderBy } from 'firebase/firestore'
import { db, auth, SUBMIT_HR_SCORE_URL, UPDATE_CANDIDATE_STAGE_URL } from '../../lib/firebase'
import { signIn, signOut, onAuthChange } from '../../lib/auth'
import { LEGAL_FOOTER_EN } from '../../lib/company-legal'

const criteriaConfig = [
  { key: 'communication_clarity', label: 'Communication Clarity', weight: 15, type: 'scale',
    description: 'English and Arabic fluency. Ability to explain technical concepts clearly.',
    guideline: 'Score 5: Exceptional bilingual fluency. Score 3: Adequate. Score 1: Significant difficulty.' },
  { key: 'cultural_fit', label: 'Cultural Fit', weight: 15, type: 'scale',
    description: 'Alignment with Datalake values: ownership, rigor, client-first mindset.',
    guideline: 'Score 5: Perfect culture match. Score 3: Acceptable. Score 1: Misaligned.' },
  { key: 'ksa_work_authorization', label: 'KSA Work Authorization', weight: 20, type: 'passfail',
    description: 'Saudi national, Iqama holder, or visa-ready per Qiwa rules.',
    guideline: 'PASS: Valid work authorization. FAIL: Cannot legally work in KSA.' },
  { key: 'availability_start_date', label: 'Availability & Start Date', weight: 15, type: 'scale',
    description: 'Can start within client-required window. Notice period acceptable.',
    guideline: 'Score 5: Immediate. Score 3: 30 days. Score 1: 90+ days.' },
  { key: 'salary_expectation_alignment', label: 'Salary Expectation Alignment', weight: 20, type: 'passfail',
    description: 'Within 10% of client PO rate structure.',
    guideline: 'PASS: Within range. FAIL: >10% above budget.' },
  { key: 'reference_checks', label: 'Reference Checks', weight: 10, type: 'passfail',
    description: 'Minimum 2 references verified. No disqualifying feedback.',
    guideline: 'PASS: 2+ references verified. FAIL: Unable to verify or negative feedback.' },
  { key: 'relocation_willingness', label: 'Relocation Willingness', weight: 5, type: 'scale',
    description: 'For roles requiring KSA presence. N/A if already local.',
    guideline: 'Score 5: Already local or fully willing. Score 1: Unwilling to relocate.' },
]

export default function HRScoring() {
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authError, setAuthError] = useState('')
  const [candidates, setCandidates] = useState([])
  const [selectedCandidate, setSelectedCandidate] = useState(null)
  const [scores, setScores] = useState({})
  const [notes, setNotes] = useState({})
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitResult, setSubmitResult] = useState(null)
  const [submitError, setSubmitError] = useState('')

  const [overriding, setOverriding] = useState(false)

  useEffect(() => { return onAuthChange(u => { setUser(u); setAuthLoading(false) }) }, [])

  // Load candidates — APPLIED and SCREENED states, newest first
  useEffect(() => {
    if (!user) return
    try {
      const q = query(
        collection(db, 'talent_pool'),
        where('state', 'in', ['APPLIED', 'SCREENED']),
        orderBy('applied_at', 'desc')
      )
      const unsub = onSnapshot(q, snap => {
        setCandidates(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      }, err => console.warn('Candidate listener error:', err.message))
      return () => unsub()
    } catch (err) { console.warn('Candidate listener setup skipped:', err.message) }
  }, [user])

  const handleSignIn = async () => {
    setAuthError('')
    try { await signIn() } catch (err) { setAuthError(err.message) }
  }

  const [hrInterviewNotes, setHrInterviewNotes] = useState('')

  const updateScore = (key, value) => setScores(prev => ({ ...prev, [key]: value }))
  const updateNotes = (key, value) => setNotes(prev => ({ ...prev, [key]: value }))

  const totalScore = useMemo(() => {
    let sum = 0
    criteriaConfig.forEach(c => {
      const val = scores[c.key]
      if (c.type === 'scale' && val) sum += (val / 5) * c.weight
      else if (c.type === 'passfail' && val) { if (val === 'PASS') sum += c.weight }
    })
    return Math.round(sum)
  }, [scores])

  const allScored = criteriaConfig.every(c => scores[c.key])
  const allNoted = criteriaConfig.every(c => notes[c.key]?.trim())
  const hasFailure = criteriaConfig.some(c => c.type === 'passfail' && scores[c.key] === 'FAIL')
  const canSubmit = allScored && allNoted && hrInterviewNotes.trim() && !submitted && !submitting && selectedCandidate

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setSubmitError('')
    try {
      const idToken = await auth.currentUser.getIdToken()
      const payload = {
        candidate_id: selectedCandidate.id,
        hr_interview_notes: hrInterviewNotes,
        scores: criteriaConfig.map(c => ({
          criterion: c.key,
          raw_score: c.type === 'scale' ? scores[c.key] : undefined,
          pass_fail: c.type === 'passfail' ? scores[c.key] : undefined,
          notes: notes[c.key],
        })),
      }
      const res = await fetch(SUBMIT_HR_SCORE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Submission failed')
      setSubmitResult(data)
      setSubmitted(true)
    } catch (err) {
      setSubmitError(err.message)
    } finally { setSubmitting(false) }
  }

  const handleOverride = async () => {
    if (!submitResult || overriding) return
    setOverriding(true)
    try {
      const idToken = await auth.currentUser.getIdToken()
      await fetch(UPDATE_CANDIDATE_STAGE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ candidate_id: selectedCandidate.id, new_state: 'SHORTLISTED', notes: `HR override requested. Score: ${submitResult.hr_score}/100. ${hrInterviewNotes}` }),
      })
      setSubmitResult(prev => ({ ...prev, override_requested: true }))
    } catch (err) { setSubmitError(err.message) }
    setOverriding(false)
  }

  // Auth loading
  if (authLoading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#f5f6f8' }}>
      <Loader size={32} className="spin" style={{ color: '#2C5F7C' }} />
    </div>
  )

  // Auth gate
  if (!user) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'linear-gradient(135deg, #1B2A4A, #2C5F7C)', fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, padding: '48px 40px', maxWidth: 420, width: '90%', textAlign: 'center' }}>
        <img src="/images/icon.svg" alt="Datalake" style={{ width: 48, height: 48, marginBottom: 20 }} />
        <h1 style={{ color: '#fff', fontSize: '1.4rem', fontWeight: 700, marginBottom: 8 }}>HR Interview Scoring</h1>
        <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.85rem', marginBottom: 32 }}>Sign in with your Datalake account</p>
        <a href="/" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, width: '100%', padding: '14px 24px', border: 'none', borderRadius: 12, background: '#1598CC', color: '#fff', fontWeight: 600, fontSize: '0.95rem', fontFamily: 'inherit', cursor: 'pointer', boxShadow: '0 4px 14px rgba(0,0,0,0.2)', textDecoration: 'none' }}>
          Sign in
        </a>
        {authError && <div style={{ marginTop: 16, color: '#ff6b6b', fontSize: '0.82rem' }}>{authError}</div>}
      </div>
    </div>
  )

  const cand = selectedCandidate

  return (
    <div style={{ minHeight: '100vh', background: '#f5f6f8', fontFamily: "'Inter', 'DM Sans', sans-serif" }}>
      {/* Print-only company letterhead header (hidden on screen) */}
      <div className="hrs-print-letterhead" style={{ padding: '0 20px', maxWidth: 900, margin: '16px auto 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #022873', paddingBottom: 10 }}>
          <img src="/images/logo-dark.svg" alt="Datalake" style={{ height: 48 }} />
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontWeight: 700, color: '#022873', fontSize: '0.95rem' }}>Interview Scorecard</div>
            <div style={{ fontSize: '0.7rem', color: '#6e6e6e' }}>DTLK-OPS-PRC-002</div>
          </div>
        </div>
      </div>

      {/* Header */}
      <header className="hrs-no-print" style={{ background: 'linear-gradient(135deg, #1B2A4A, #2C5F7C)', borderBottom: '1px solid rgba(255,255,255,0.1)', padding: '14px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'white' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <img src="/images/icon.svg" alt="Datalake" style={{ height: 32 }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>Datalake HR — Interview Scoring</div>
            <div style={{ fontSize: '0.68rem', opacity: 0.7 }}>DTLK-OPS-PRC-002 · Stage 2 — HR Screen</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <ShieldCheck size={16} style={{ color: '#27ae60' }} />
          <span style={{ fontSize: '0.72rem', opacity: 0.7 }}>{user.email}</span>
          <button onClick={() => signOut()} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', display: 'flex' }}><LogOut size={16} /></button>
        </div>
      </header>

      <div style={{ maxWidth: 900, margin: '28px auto', padding: '0 20px' }}>
        {/* Candidate Selector */}
        {!selectedCandidate && (
          <div style={{ background: 'white', border: '1px solid #e0e0e0', borderRadius: 8, padding: '28px', marginBottom: 20 }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#333', marginBottom: 16 }}>Select Candidate to Score</h3>
            {candidates.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px 20px', color: '#64748b' }}>
                <User size={32} style={{ marginBottom: 8, opacity: 0.3 }} />
                <div style={{ fontSize: '0.9rem' }}>No candidates pending HR screening</div>
                <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: 4 }}>Candidates submitted via /careers will appear here</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {candidates.map(c => (
                  <button key={c.id} onClick={() => setSelectedCandidate(c)} style={{
                    display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', border: '1px solid #e0e0e0', borderRadius: 8,
                    background: 'white', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', transition: 'all 0.15s',
                  }}>
                    <div style={{ width: 42, height: 42, borderRadius: '50%', background: 'linear-gradient(135deg, #2C5F7C, #1B2A4A)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: '0.85rem', flexShrink: 0 }}>
                      {(c.full_name || '??').split(' ').map(n => n[0]).join('').slice(0, 2)}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#333' }}>{c.full_name || 'Unnamed'}</div>
                      <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{c.id} · {c.role_interest || 'No role specified'} · {c.location || ''}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {(c.skills || []).slice(0, 3).map(s => (
                        <span key={s} style={{ padding: '2px 8px', borderRadius: 12, fontSize: '0.68rem', background: '#e8f4fd', color: '#2C5F7C', border: '1px solid #b8d8eb' }}>{s}</span>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Candidate Profile + Scorecard */}
        {cand && (
          <>
            {/* Profile Card */}
            <div style={{ background: 'white', border: '1px solid #e0e0e0', borderRadius: 8, padding: '24px 28px', marginBottom: 20 }}>
              <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
                <div style={{ width: 56, height: 56, borderRadius: '50%', flexShrink: 0, background: 'linear-gradient(135deg, #2C5F7C, #1B2A4A)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: '1.1rem' }}>
                  {(cand.full_name || '??').split(' ').map(n => n[0]).join('').slice(0, 2)}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#333', margin: 0 }}>{cand.full_name || 'Unnamed'}</h2>
                    <span style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: '#64748b', background: '#f0f0f0', padding: '2px 8px', borderRadius: 4 }}>{cand.id}</span>
                    <button className="hrs-no-print" onClick={() => { setSelectedCandidate(null); setScores({}); setNotes({}); setHrInterviewNotes(''); setSubmitted(false); setSubmitResult(null) }} style={{ marginLeft: 'auto', fontSize: '0.75rem', color: '#1598CC', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>← Change candidate</button>
                    <button className="hrs-no-print" onClick={() => window.print()} style={{ fontSize: '0.75rem', color: '#475569', background: '#f0f0f0', border: '1px solid #ddd', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4 }}><Printer size={13} /> Print</button>
                  </div>
                  {cand.consent_granted_at && (
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: '0.72rem', color: '#27ae60', background: '#e8fbe5', padding: '4px 10px', borderRadius: 6, border: '1px solid #b7e8bc' }}>
                      <ShieldCheck size={12} /> PDPL Art. 5 consent obtained on {cand.consent_granted_at?.toDate ? cand.consent_granted_at.toDate().toLocaleDateString('en-SA') : new Date(cand.consent_granted_at?.seconds * 1000 || cand.consent_granted_at).toLocaleDateString('en-SA')}
                    </div>
                  )}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px 20px', fontSize: '0.82rem', color: '#475569' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Briefcase size={14} color="#888" /> {cand.role_interest || 'No role'}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><MapPin size={14} color="#888" /> {cand.location || 'Unknown'}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Star size={14} color="#888" /> {cand.experience || 'N/A'}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Clock size={14} color="#888" /> Notice: {cand.notice_period || 'N/A'}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><DollarSign size={14} color="#888" /> {cand.salary_expectation || 'N/A'}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Phone size={14} color="#888" /> {cand.phone || 'N/A'}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                    {(cand.skills || []).map(s => (
                      <span key={s} style={{ padding: '3px 10px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600, background: '#e8f4fd', color: '#2C5F7C', border: '1px solid #b8d8eb' }}>{s}</span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Scorecard */}
            <div style={{ background: 'white', border: '1px solid #e0e0e0', borderRadius: 8, overflow: 'hidden', marginBottom: 20 }}>
              <div style={{ padding: '16px 28px', borderBottom: '1px solid #e0e0e0', background: 'linear-gradient(135deg, #1B2A4A, #2C5F7C)', color: 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>HR Scorecard</h3>
                  <div style={{ fontSize: '0.68rem', opacity: 0.7 }}>Stage 2 — 30-min structured interview · All fields required</div>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.15)', padding: '8px 16px', borderRadius: 8, textAlign: 'center' }}>
                  <div style={{ fontSize: '1.6rem', fontWeight: 800 }}>{totalScore}</div>
                  <div style={{ fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.7 }}>/ 100</div>
                </div>
              </div>

              <div style={{ padding: '20px 28px' }}>
                {criteriaConfig.map((criterion, i) => (
                  <div key={criterion.key} style={{ padding: '16px 0', borderBottom: i < criteriaConfig.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#333' }}>
                          {criterion.label}
                          <span style={{ fontWeight: 400, fontSize: '0.72rem', color: '#64748b', marginLeft: 8 }}>Weight: {criterion.weight}%</span>
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 2 }}>{criterion.description}</div>
                      </div>
                      {criterion.type === 'scale' ? (
                        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                          {[1, 2, 3, 4, 5].map(n => (
                            <button key={n} onClick={() => !submitted && updateScore(criterion.key, n)} disabled={submitted} style={{
                              width: 36, height: 36, borderRadius: 6,
                              border: scores[criterion.key] === n ? '2px solid #2C5F7C' : '1px solid #ddd',
                              background: scores[criterion.key] === n ? (n >= 4 ? '#e8fbe5' : n >= 3 ? '#fff7ed' : '#fde8e8') : 'white',
                              fontWeight: 700, fontSize: '0.85rem',
                              color: scores[criterion.key] === n ? (n >= 4 ? '#27ae60' : n >= 3 ? '#E8913A' : '#C0392B') : '#999',
                              cursor: submitted ? 'default' : 'pointer', transition: 'all 0.15s', fontFamily: 'inherit',
                            }}>{n}</button>
                          ))}
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                          {['PASS', 'FAIL'].map(v => (
                            <button key={v} onClick={() => !submitted && updateScore(criterion.key, v)} disabled={submitted} style={{
                              padding: '6px 16px', borderRadius: 6,
                              border: scores[criterion.key] === v ? `2px solid ${v === 'PASS' ? '#27ae60' : '#C0392B'}` : '1px solid #ddd',
                              background: scores[criterion.key] === v ? (v === 'PASS' ? '#e8fbe5' : '#fde8e8') : 'white',
                              fontWeight: 700, fontSize: '0.82rem',
                              color: scores[criterion.key] === v ? (v === 'PASS' ? '#27ae60' : '#C0392B') : '#999',
                              cursor: submitted ? 'default' : 'pointer', transition: 'all 0.15s', fontFamily: 'inherit',
                            }}>{v === 'PASS' ? 'Pass' : 'Fail'}</button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: '0.68rem', color: '#64748b', fontStyle: 'italic', marginBottom: 8, padding: '4px 10px', background: '#fafafa', borderRadius: 4, borderLeft: '3px solid #e0e0e0' }}>{criterion.guideline}</div>
                    <textarea value={notes[criterion.key] || ''} onChange={e => !submitted && updateNotes(criterion.key, e.target.value)} placeholder="Required — Provide evaluation notes..." disabled={submitted} style={{
                      width: '100%', minHeight: 50, padding: '8px 12px', border: notes[criterion.key]?.trim() ? '1px solid #27ae60' : '1px solid #ddd',
                      borderRadius: 6, fontSize: '0.78rem', fontFamily: 'inherit', resize: 'vertical', outline: 'none', color: '#333', background: submitted ? '#f9f9f9' : 'white', boxSizing: 'border-box',
                    }} />
                  </div>
                ))}
              </div>
            </div>

            {/* Overall Interview Notes - required */}
            <div style={{ background: 'white', border: '2px solid #f0a500', borderRadius: 8, padding: '20px 28px', marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#333', marginBottom: 4 }}>Overall Interview Notes <span style={{ color: '#C0392B' }}>*</span> <span style={{ fontWeight: 400, fontSize: '0.72rem', color: '#64748b' }}>Required per DTLK-OPS-PRC-002</span></div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: 10 }}>Summarise the candidate's overall performance, key observations, and recommendation.</div>
              <textarea value={hrInterviewNotes} onChange={e => !submitted && setHrInterviewNotes(e.target.value)} placeholder="Required — Provide overall interview assessment and recommendation..." disabled={submitted} rows={4} style={{ width: '100%', padding: '10px 14px', border: hrInterviewNotes.trim() ? '1px solid #27ae60' : '1px solid #f0a500', borderRadius: 6, fontSize: '0.85rem', fontFamily: 'inherit', resize: 'vertical', outline: 'none', color: '#333', background: submitted ? '#f9f9f9' : 'white', boxSizing: 'border-box' }} />
            </div>

            {/* Submit Panel */}
            <div style={{ background: 'white', border: '1px solid #e0e0e0', borderRadius: 8, padding: '20px 28px', marginBottom: 20 }}>
              {submitted && submitResult ? (
                <div style={{ textAlign: 'center' }}>
                  {submitResult.next_action === 'SHORTLISTED' && (
                    <>
                      <div style={{ fontSize: '2rem', marginBottom: 8 }}>✅</div>
                      <div style={{ fontSize: '1rem', fontWeight: 700, color: '#27ae60', marginBottom: 4 }}>Candidate Shortlisted</div>
                      <div style={{ fontSize: '0.85rem', color: '#475569', marginBottom: 12 }}>{submitResult.message}</div>
                      <a href="/hr/interview-prep" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 20px', background: '#1598CC', color: '#fff', borderRadius: 8, fontWeight: 600, fontSize: '0.85rem', textDecoration: 'none' }}>Go to Interview Prep <ArrowRight size={14} /></a>
                    </>
                  )}
                  {submitResult.next_action === 'BELOW_THRESHOLD' && !submitResult.override_requested && (
                    <>
                      <div style={{ fontSize: '2rem', marginBottom: 8 }}>⚠️</div>
                      <div style={{ fontSize: '1rem', fontWeight: 700, color: '#E8913A', marginBottom: 4 }}>Below Threshold — {submitResult.hr_score}/100</div>
                      <div style={{ fontSize: '0.85rem', color: '#475569', marginBottom: 16 }}>Score is below the 70/100 threshold. Request Management override to shortlist anyway?</div>
                      <button onClick={handleOverride} disabled={overriding} style={{ padding: '10px 20px', background: '#E8913A', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, cursor: overriding ? 'default' : 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 8 }}>{overriding ? <><Loader size={14} className="spin" /> Sending...</> : 'Request Management override'}</button>
                    </>
                  )}
                  {submitResult.next_action === 'BELOW_THRESHOLD' && submitResult.override_requested && (
                    <>
                      <div style={{ fontSize: '2rem', marginBottom: 8 }}>📨</div>
                      <div style={{ fontSize: '1rem', fontWeight: 700, color: '#1598CC', marginBottom: 4 }}>Override Request Sent</div>
                      <div style={{ fontSize: '0.85rem', color: '#475569' }}>Management will review in TaskInbox and approve or reject.</div>
                    </>
                  )}
                  {submitResult.next_action === 'REJECTED' && (
                    <>
                      <div style={{ fontSize: '2rem', marginBottom: 8 }}>❌</div>
                      <div style={{ fontSize: '1rem', fontWeight: 700, color: '#C0392B', marginBottom: 4 }}>Candidate Rejected — Hard Fail</div>
                      <div style={{ fontSize: '0.85rem', color: '#475569', marginBottom: 8 }}>{submitResult.message}</div>
                      <div style={{ fontSize: '0.78rem', padding: '8px 16px', background: '#fde8e8', border: '1px solid #C0392B', borderRadius: 6, color: '#C0392B', fontWeight: 600 }}>⚠️ Hard fail: {submitResult.hard_fail_reason?.replace(/_/g, ' ')}</div>
                    </>
                  )}
                  <button onClick={() => { setSelectedCandidate(null); setScores({}); setNotes({}); setHrInterviewNotes(''); setSubmitted(false); setSubmitResult(null) }} style={{ marginTop: 20, padding: '10px 24px', border: 'none', borderRadius: 8, background: '#2C5F7C', color: '#fff', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Score Another Candidate</button>
                </div>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#333' }}>
                      Current Score: <span style={{ fontSize: '1.2rem', color: totalScore >= 70 ? '#27ae60' : totalScore > 0 ? '#C0392B' : '#999' }}>{totalScore}/100</span>
                      {totalScore > 0 && totalScore < 70 && <span style={{ fontSize: '0.72rem', color: '#C0392B', marginLeft: 8 }}>Below threshold (70)</span>}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: 4 }}>
                      {!allScored && '⚠ All criteria must be scored'}
                      {allScored && !allNoted && ' · ⚠ All criteria require written notes'}
                        {allScored && allNoted && !hrInterviewNotes.trim() && ' · ⚠ Overall interview notes required'}
                        {allScored && allNoted && hrInterviewNotes.trim() && '✓ Ready to submit'}
                    </div>
                    {submitError && <div style={{ fontSize: '0.78rem', color: '#C0392B', marginTop: 4 }}>{submitError}</div>}
                  </div>
                  <button onClick={handleSubmit} disabled={!canSubmit} style={{
                    padding: '10px 24px', border: 'none', borderRadius: 8,
                    background: canSubmit ? 'linear-gradient(135deg, #27ae60, #1e8449)' : '#ccc',
                    color: 'white', fontWeight: 700, fontSize: '0.85rem', cursor: canSubmit ? 'pointer' : 'default',
                    display: 'flex', alignItems: 'center', gap: 8, boxShadow: canSubmit ? '0 2px 8px rgba(39,174,96,0.3)' : 'none', fontFamily: 'inherit',
                  }}>
                    {submitting ? <><Loader size={16} className="spin" /> Submitting...</> : <><Send size={16} /> Submit Scorecard</>}
                  </button>
                </div>
              )}
            </div>

            {/* Compliance Footer */}
            <div style={{ padding: '14px 20px', background: 'white', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: '0.68rem', color: '#64748b', lineHeight: 1.7, display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 20 }}>
              <ShieldCheck size={16} style={{ flexShrink: 0, marginTop: 2, color: '#27ae60' }} />
              <div>
                <strong style={{ color: '#475569' }}>DTLK-OPS-PRC-002 Compliance</strong><br />
                This evaluation is conducted under PDPL Art. 5 (candidate consent obtained).
                Video call must be recorded and stored per MHRSD 5-year retention requirement.
                Scores without written notes are rejected. No scoring criterion is based on nationality, religion, gender, or age.
                All submissions are logged to <strong>task_audit_log</strong> (append-only, immutable).
              </div>
            </div>
          </>
        )}
      </div>

      {/* Print-only company letterhead footer (hidden on screen) */}
      <div className="hrs-print-letterhead" style={{ padding: '0 20px 8px', maxWidth: 900, margin: '0 auto' }}>
        <div style={{ display: 'flex', height: 5, borderRadius: 2, overflow: 'hidden', marginBottom: 8 }}>
          <span style={{ flex: 1, background: '#1598CC' }} />
          <span style={{ flex: 1, background: '#34BF3A' }} />
          <span style={{ flex: 1, background: '#EF5829' }} />
        </div>
        <div style={{ textAlign: 'center', fontSize: '0.7rem', color: '#022873' }}>{LEGAL_FOOTER_EN}</div>
      </div>

      <style>{`
        @media print {
          @page { size: A4; margin: 12mm; }
          body { background: #fff !important; }
          .hrs-no-print { display: none !important; }
          .hrs-print-letterhead { display: block !important; }
        }
        .hrs-print-letterhead { display: none; }
      `}</style>
    </div>
  )
}
