import { useState, useEffect, useMemo } from 'react'
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore'
import { db, auth, UPDATE_CANDIDATE_STAGE_URL } from '../../lib/firebase'
import { Search, Filter, User, ChevronDown, ChevronUp, Star, Clock, Briefcase, MapPin, FileText, ArrowRight, UserPlus } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'

const LIFECYCLE_STATES = ['APPLIED','SCREENED','SHORTLISTED','INTERVIEW_SCHEDULED','INTERVIEWED','SCORED','SELECTED','INTERVIEW_PREP','CLIENT_SUBMITTED','HIRED','ONBOARDING','ACTIVE_EMPLOYEE','REJECTED']

const STATE_STYLE = {
  APPLIED:             { bg: '#e8f4fd', color: '#2C5F7C', border: '#b8d8eb' },
  SCREENED:            { bg: '#fff7ed', color: '#E8913A', border: '#fde0b8' },
  SHORTLISTED:         { bg: '#e8fbe5', color: '#27ae60', border: '#b7e8bc' },
  INTERVIEW_SCHEDULED: { bg: '#f0e6ff', color: '#7c3aed', border: '#d8b4fe' },
  INTERVIEWED:         { bg: '#fef9c3', color: '#b45309', border: '#fde68a' },
  SCORED:              { bg: '#e0f2fe', color: '#0369a1', border: '#bae6fd' },
  SELECTED:            { bg: '#dcfce7', color: '#15803d', border: '#86efac' },
  INTERVIEW_PREP:      { bg: '#fce7f3', color: '#9d174d', border: '#f9a8d4' },
  CLIENT_SUBMITTED:    { bg: '#ede9fe', color: '#5b21b6', border: '#c4b5fd' },
  HIRED:               { bg: '#d1fae5', color: '#065f46', border: '#6ee7b7' },
  ONBOARDING:          { bg: '#cffafe', color: '#0e7490', border: '#67e8f9' },
  ACTIVE_EMPLOYEE:     { bg: '#d1fae5', color: '#065f46', border: '#34d399' },
  REJECTED:            { bg: '#fde8e8', color: '#C0392B', border: '#fca5a5' },
}

export default function HRTalentPool() {
  const [candidates, setCandidates] = useState([])
  const [jobListings, setJobListings] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('ALL')
  const [filterJob, setFilterJob] = useState('ALL')
  const [filterScoreMin, setFilterScoreMin] = useState(0)
  const [sortBy, setSortBy] = useState('applied_at_desc')
  const [expandedId, setExpandedId] = useState(null)
  const [stageUpdating, setStageUpdating] = useState(null)
  const [stageError, setStageError] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    const q = query(collection(db, 'talent_pool'), orderBy('applied_at', 'desc'))
    const unsub = onSnapshot(q, snap => {
      setCandidates(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoading(false)
    }, () => setLoading(false))
    return () => unsub()
  }, [])

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'job_listings'), snap => {
      setJobListings(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })
    return () => unsub()
  }, [])

  const filtered = useMemo(() => {
    let list = [...candidates]
    if (filterStatus !== 'ALL') list = list.filter(c => c.state === filterStatus)
    if (filterJob !== 'ALL') list = list.filter(c => c.job_listing_id === filterJob)
    if (filterScoreMin > 0) list = list.filter(c => (c.hr_score || 0) >= filterScoreMin)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(c =>
        (c.full_name || '').toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q) ||
        (c.role_interest || '').toLowerCase().includes(q) ||
        (c.skills || []).some(s => s.toLowerCase().includes(q))
      )
    }
    const getMs = (val) => val?.seconds ? val.seconds * 1000 : (val ? new Date(val).getTime() : 0)
    switch (sortBy) {
      case 'applied_at_desc': list.sort((a, b) => getMs(b.applied_at) - getMs(a.applied_at)); break
      case 'applied_at_asc':  list.sort((a, b) => getMs(a.applied_at) - getMs(b.applied_at)); break
      case 'score_desc':      list.sort((a, b) => (b.hr_score || 0) - (a.hr_score || 0)); break
      case 'name_asc':        list.sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '')); break
    }
    return list
  }, [candidates, filterStatus, filterJob, filterScoreMin, search, sortBy])

  const formatDate = ts => {
    if (!ts) return '—'
    const d = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000)
    return d.toLocaleDateString('en-SA', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  const inp = { padding: '9px 14px', border: '1px solid #1e3050', borderRadius: 8, fontSize: '0.85rem', fontFamily: 'inherit', outline: 'none', color: '#e2e8f0', background: '#0d1829' }

  return (
    <div style={{ padding: '32px 24px', maxWidth: 1200, margin: '0 auto', fontFamily: "'DM Sans', 'Inter', sans-serif" }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#e2e8f0', margin: 0 }}>Talent Pool</h1>
        <div style={{ fontSize: '0.82rem', color: '#64748b', marginTop: 4 }}>
          {candidates.length} total candidates · {candidates.filter(c => c.state === 'SHORTLISTED').length} shortlisted · {candidates.filter(c => c.state === 'APPLIED').length} pending review
        </div>
      </div>

      {/* Search + Filters */}
      <div style={{ background: '#111e33', border: '1px solid #1e3050', borderRadius: 12, padding: 20, marginBottom: 24, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 240px' }}>
          <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#475569' }} />
          <input style={{ ...inp, paddingLeft: 36, width: '100%', boxSizing: 'border-box' }} placeholder="Search name, email, skills…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select style={{ ...inp, flex: '0 0 180px' }} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="ALL">All Stages</option>
          {LIFECYCLE_STATES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
        <select style={{ ...inp, flex: '0 0 180px' }} value={filterJob} onChange={e => setFilterJob(e.target.value)}>
          <option value="ALL">All Jobs</option>
          {jobListings.map(j => <option key={j.id} value={j.id}>{j.title}</option>)}
        </select>
        <select style={{ ...inp, flex: '0 0 150px' }} value={filterScoreMin} onChange={e => setFilterScoreMin(Number(e.target.value))}>
          <option value={0}>Any Score</option>
          <option value={50}>Score ≥ 50</option>
          <option value={70}>Score ≥ 70</option>
          <option value={85}>Score ≥ 85</option>
        </select>
        <select style={{ ...inp, flex: '0 0 160px' }} value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="applied_at_desc">Newest First</option>
          <option value="applied_at_asc">Oldest First</option>
          <option value="score_desc">Highest Score</option>
          <option value="name_asc">Name A–Z</option>
        </select>
      </div>

      {stageError && <div style={{ padding: '10px 16px', background: 'rgba(239,88,41,0.1)', border: '1px solid rgba(239,88,41,0.3)', borderRadius: 8, color: '#fb923c', fontSize: '0.82rem', marginBottom: 16 }}>{stageError}</div>}

      {/* Candidate List */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 48, color: '#64748b' }}>Loading talent pool…</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48, color: '#64748b', background: '#111e33', borderRadius: 12, border: '1px dashed #1e3050' }}>
          <User size={36} style={{ opacity: 0.3, marginBottom: 10 }} />
          <div>No candidates match the current filters</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map(c => {
            const st = STATE_STYLE[c.state] || STATE_STYLE.APPLIED
            const isExpanded = expandedId === c.id
            const job = jobListings.find(j => j.id === c.job_listing_id)
            return (
              <div key={c.id} style={{ background: '#111e33', border: `1px solid ${isExpanded ? '#1598CC' : '#1e3050'}`, borderRadius: 12, overflow: 'hidden', transition: 'border 0.15s' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', cursor: 'pointer' }} onClick={() => setExpandedId(isExpanded ? null : c.id)}>
                  <div style={{ width: 42, height: 42, borderRadius: '50%', background: 'linear-gradient(135deg, #022873, #1598CC)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: '0.85rem', flexShrink: 0 }}>
                    {(c.full_name || '??').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.9rem', color: '#e2e8f0' }}>{c.full_name || 'Unnamed'}</span>
                      <span style={{ fontFamily: 'monospace', fontSize: '0.65rem', color: '#475569', background: '#0d1829', padding: '1px 6px', borderRadius: 4 }}>{c.id}</span>
                      <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: '0.65rem', fontWeight: 700, background: st.bg, color: st.color, border: `1px solid ${st.border}` }}>{(c.state || 'UNKNOWN').replace(/_/g, ' ')}</span>
                      {c.hr_score && <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: '0.72rem', color: c.hr_score >= 70 ? '#27ae60' : '#E8913A', fontWeight: 700 }}><Star size={11} /> {c.hr_score}/100</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 12, fontSize: '0.75rem', color: '#64748b', marginTop: 2, flexWrap: 'wrap' }}>
                      {c.role_interest && <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><Briefcase size={11} /> {c.role_interest}</span>}
                      {c.location && <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><MapPin size={11} /> {c.location}</span>}
                      {job && <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><FileText size={11} /> {job.title}</span>}
                      <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><Clock size={11} /> Applied {formatDate(c.applied_at)}</span>
                    </div>
                  </div>
                  <div style={{ flexShrink: 0, color: '#475569' }}>{isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</div>
                </div>

                {isExpanded && (
                  <div style={{ borderTop: '1px solid #1e3050', padding: '16px 18px', background: '#0d1829' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, marginBottom: 16 }}>
                      {[['Email', c.email], ['Phone', c.phone], ['Experience', c.experience], ['Employer', c.current_employer], ['Salary', c.salary_expectation], ['Notice', c.notice_period]].map(([k, v]) => v ? (
                        <div key={k} style={{ padding: '8px 12px', background: '#111e33', borderRadius: 8, border: '1px solid #1e3050' }}>
                          <div style={{ fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>{k}</div>
                          <div style={{ fontSize: '0.82rem', color: '#e2e8f0', fontWeight: 600 }}>{v}</div>
                        </div>
                      ) : null)}
                    </div>
                    {c.skills?.length > 0 && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
                        {c.skills.map(s => <span key={s} style={{ padding: '2px 8px', borderRadius: 20, fontSize: '0.68rem', background: '#1e3050', color: '#94a3b8', border: '1px solid #2d4a6e' }}>{s}</span>)}
                      </div>
                    )}
                    {c.hr_interview_notes && (
                      <div style={{ padding: '10px 14px', background: '#111e33', border: '1px solid #1e3050', borderRadius: 8, fontSize: '0.78rem', color: '#94a3b8', marginBottom: 14 }}>
                        <span style={{ color: '#64748b', fontSize: '0.68rem', textTransform: 'uppercase' }}>HR Interview Notes: </span>{c.hr_interview_notes}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      {c.state === 'SHORTLISTED' && (
                        <Link to="/hr/interview-prep" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', background: '#1598CC', color: '#fff', borderRadius: 7, fontSize: '0.78rem', fontWeight: 600, textDecoration: 'none' }}>
                          Go to Interview Prep <ArrowRight size={12} />
                        </Link>
                      )}
                      {c.state === 'APPLIED' && (
                        <button
                          disabled={stageUpdating === c.id}
                          onClick={async () => {
                            setStageUpdating(c.id); setStageError('')
                            try {
                              const token = await auth.currentUser.getIdToken()
                              const res = await fetch(UPDATE_CANDIDATE_STAGE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ candidate_id: c.id, new_state: 'SCREENED', notes: 'Manually screened via talent pool' }) })
                              if (!res.ok) { const d = await res.json(); throw new Error(d.error) }
                            } catch (err) { setStageError(err.message) }
                            setStageUpdating(null)
                          }}
                          style={{ padding: '7px 14px', borderRadius: 7, border: '1px solid #1e3050', background: 'transparent', color: '#94a3b8', cursor: stageUpdating === c.id ? 'default' : 'pointer', fontSize: '0.78rem', fontFamily: 'inherit' }}
                        >
                          {stageUpdating === c.id ? 'Updating…' : 'Mark Screened'}
                        </button>
                      )}
                      {c.state === 'HIRED' && (
                        <button
                          onClick={() => navigate('/hr/employees', { state: { candidate: c } })}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', background: '#27ae60', color: '#fff', borderRadius: 7, border: 'none', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}
                        >
                          <UserPlus size={12} /> Convert to Employee
                        </button>
                      )}
                      {c.cv_path && <span style={{ fontSize: '0.72rem', color: '#475569' }}>CV: {c.cv_path.split('/').pop()}</span>}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
