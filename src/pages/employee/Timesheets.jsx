import { useState, useEffect } from 'react'
import { Upload, Calendar, Clock, CheckCircle, XCircle, Plus, FileText, ChevronLeft, ChevronRight, User, Mail, ArrowRight, Briefcase, MapPin, Send, AlertTriangle, Loader, Shield } from 'lucide-react'
import { auth, GET_ENGINEER_PROJECT_VIEW_URL, SUBMIT_TIMESHEET_URL, GET_MY_TIMESHEETS_URL, EXTRACT_TIMESHEET_URL } from '../../lib/firebase'
import { Link } from 'react-router-dom'
import { onAuthChange } from '../../lib/auth'
import { getOrdinal } from '../../lib/utils'
import { getChainGateStatus } from '../../lib/policies'

const stateColors = {
  SUBMITTED: { label: 'Submitted', cls: 'badge-info' },
  CTO_APPROVED: { label: 'CTO Approved', cls: 'badge-success' },
  CEO_ESCALATED: { label: 'Escalated', cls: 'badge-warning' },
  CLIENT_SIGNED: { label: 'Signed', cls: 'badge-success' },
  REJECTED_BY_CTO: { label: 'Rejected', cls: 'badge-critical' },
  REJECTED_BY_CLIENT: { label: 'Client Rejected', cls: 'badge-critical' },
  DRAFT: { label: 'Draft', cls: 'badge-neutral' },
}

// ── Saudi Arabia 2026 Public Holidays ──────────────────────
// Source: Saudi Ministry of Human Resources & government gazette
const SAUDI_HOLIDAYS_2026 = [
  // Founding Day
  { date: '2026-02-22', name: 'Founding Day' },
  { date: '2026-02-23', name: 'Founding Day (observed)' },
  // Eid Al-Fitr (estimated — depends on moon sighting, ~Shawwal 1-3, 1447 AH)
  { date: '2026-03-20', name: 'Eid Al-Fitr' },
  { date: '2026-03-21', name: 'Eid Al-Fitr' },
  { date: '2026-03-22', name: 'Eid Al-Fitr' },
  { date: '2026-03-23', name: 'Eid Al-Fitr' },
  { date: '2026-03-24', name: 'Eid Al-Fitr' },
  // Arafat Day + Eid Al-Adha (estimated — ~Dhul Hijjah 9-13, 1447 AH)
  { date: '2026-05-27', name: 'Arafat Day' },
  { date: '2026-05-28', name: 'Eid Al-Adha' },
  { date: '2026-05-29', name: 'Eid Al-Adha' },
  { date: '2026-05-30', name: 'Eid Al-Adha' },
  { date: '2026-05-31', name: 'Eid Al-Adha' },
  // Saudi National Day
  { date: '2026-09-23', name: 'National Day' },
  { date: '2026-09-24', name: 'National Day (observed)' },
]

const holidayMap = new Map(SAUDI_HOLIDAYS_2026.map(h => [h.date, h.name]))

// Parse a fetch Response as JSON without throwing on non-JSON bodies (e.g. a
// Cloud Function returning a plain-text "Internal Server Error" on a 500).
async function parseJsonSafe(res) {
  const text = await res.text()
  try { return JSON.parse(text) } catch { return null }
}

// Check if a date falls on Saudi weekend (Friday = 5, Saturday = 6)
function isSaudiWeekend(date) {
  const day = date.getDay()
  return day === 5 || day === 6
}

function formatDateKey(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default function Timesheets() {
  const [showForm, setShowForm] = useState(false)
  const [method, setMethod] = useState('manual')
  const [liveProjects, setLiveProjects] = useState([])
  const [projectsLoading, setProjectsLoading] = useState(true)
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [periodStart, setPeriodStart] = useState(new Date(2026, 4, 1))   // May 1, 2026
  const [periodEnd, setPeriodEnd] = useState(new Date(2026, 4, 31))      // May 31, 2026
  const [dayHours, setDayHours] = useState({})
  const [notes, setNotes] = useState('')
  const [myTimesheets, setMyTimesheets] = useState([])
  const [submitLoading, setSubmitLoading] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [submitResult, setSubmitResult] = useState(null)
  const [error, setError] = useState(null)
  const [gate, setGate] = useState({ active: false, onboardingComplete: true, trainingComplete: true, missingPolicies: [], missingModules: [] })
  const totalHours = myTimesheets.filter(t => t.state === 'CLIENT_SIGNED' || t.state === 'CTO_APPROVED').reduce((s, t) => s + (t.total_hours || 0), 0)

  // Fetch submission history from Cloud Function (no direct Firestore access)
  const fetchHistory = async () => {
    const user = auth.currentUser
    if (!user) return
    try {
      const idToken = await user.getIdToken()
      const res = await fetch(GET_MY_TIMESHEETS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
      })
      const data = await parseJsonSafe(res)
      if (!res.ok || !data) throw new Error(data?.error || `Could not load timesheets (server returned ${res.status}).`)
      setMyTimesheets(data.timesheets || [])
    } catch (err) {
      console.warn('Failed to fetch history:', err.message)
      setError(new Error('Could not load timesheets. Please try again.'))
    }
  }

  useEffect(() => {
    const unsub = onAuthChange((user) => { if (user) fetchHistory() })
    return () => unsub()
  }, [])

  const handleSubmitTimesheet = async () => {
    const user = auth.currentUser
    if (!user || !selectedProjectId) return
    setSubmitLoading(true)
    setSubmitResult(null)
    try {
      const idToken = await user.getIdToken()
      const res = await fetch(SUBMIT_TIMESHEET_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({
          project_id: selectedProjectId,
          period_month: periodStart.getMonth() + 1,
          period_year: periodStart.getFullYear(),
          days: Object.fromEntries(
            calendarDays.map(d => [
              String(d.date),
              {
                type: d.isWeekend ? 'weekend' : d.isHoliday ? 'holiday' : (dayHours[d.dateKey] ? 'in_house' : 'none'),
                hours: parseFloat(dayHours[d.dateKey]) || 0
              }
            ])
          ),
          notes: notes.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || data.detail || 'Submission failed')
      setSubmitResult({ success: true, message: data.message, id: data.timesheet_id })
      setDayHours({})
      setNotes('')
      fetchHistory()
    } catch (err) {
      setSubmitResult({ success: false, message: err.message })
    }
    setSubmitLoading(false)
  }

  // Fetch projects from Cloud Function (financial fields pre-stripped server-side)
  // Engineers NEVER read Firestore directly — all access goes through getEngineerProjectView
  useEffect(() => {
    const unsub = onAuthChange(async (user) => {
      if (!user) { setLiveProjects([]); setProjectsLoading(false); return }
      // Mirror the server submitTimesheet gate so the portal shows the locked
      // state (no silent failure). No-ops to "unlocked" when the flag is off.
      getChainGateStatus(user.email).then(setGate).catch(() => {})
      try {
        const idToken = await user.getIdToken()
        const res = await fetch(GET_ENGINEER_PROJECT_VIEW_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        })
        const data = await parseJsonSafe(res)
        if (!res.ok || !data) throw new Error(data?.error || `Could not load projects (server returned ${res.status}).`)
        const projs = (data.projects || []).filter(p => String(p.status || '').toUpperCase() === 'ACTIVE')
        setLiveProjects(projs)
        if (projs.length > 0) setSelectedProjectId(projs[0].project_id)
      } catch (err) {
        console.warn('Failed to fetch projects:', err.message)
        setError(new Error('Could not load your project assignment. Please try again.'))
      }
      setProjectsLoading(false)
    })
    return () => unsub()
  }, [])

  // Submission used to be blocked outside a 1st–28th window. That blocks engineers
  // from late submissions, which blocks the invoice, which delays revenue. Now
  // we only WARN if the timesheet is late for its period — never disable submit.
  const PERIOD_CLOSE_DAY = 28

  const now = new Date()
  const currentDay = now.getDate()
  const isLate = currentDay > PERIOD_CLOSE_DAY

  // Generate all days in billing period (full month)
  const calendarDays = (() => {
    const days = []
    const current = new Date(periodStart)
    while (current <= periodEnd) {
      const dateKey = formatDateKey(current)
      const weekend = isSaudiWeekend(current)
      const holidayName = holidayMap.get(dateKey) || null
      days.push({
        dateKey,
        dateObj: new Date(current),
        date: current.getDate(),
        month: current.getMonth(),
        dayOfWeek: current.getDay(),
        dayLabel: DAY_LABELS[current.getDay()],
        isWeekend: weekend,
        isHoliday: !!holidayName,
        holidayName,
        isNonWorking: weekend || !!holidayName,
      })
      current.setDate(current.getDate() + 1)
    }
    return days
  })();

  const workingDays = calendarDays.filter(d => !d.isNonWorking)
  const totalEnteredHours = Object.values(dayHours).reduce((s, h) => s + (parseFloat(h) || 0), 0)
  const expectedHours = workingDays.length * 8
  const hasProject = !projectsLoading && liveProjects.length > 0

  const handleHourChange = (dateKey, value) => {
    const num = parseFloat(value)
    if (value === '' || (num >= 0 && num <= 24)) {
      setDayHours(prev => ({ ...prev, [dateKey]: value }))
    }
  }

  const fillAllWorkingDays = () => {
    const filled = {}
    calendarDays.forEach(d => {
      if (!d.isNonWorking) filled[d.dateKey] = '8'
    })
    setDayHours(filled)
  }

  const clearAll = () => setDayHours({})

  // Period navigation (month-by-month)
  const shiftPeriod = (direction) => {
    setPeriodStart(prev => {
      const d = new Date(prev)
      d.setMonth(d.getMonth() + direction)
      d.setDate(1)
      return d
    })
    setPeriodEnd(prev => {
      const d = new Date(prev)
      d.setMonth(d.getMonth() + direction + 1)
      d.setDate(0) // Last day of the target month
      return d
    })
    setDayHours({})
  }

  const periodLabel = `${MONTH_NAMES[periodStart.getMonth()]} ${periodStart.getDate()} — ${MONTH_NAMES[periodEnd.getMonth()]} ${periodEnd.getDate()}, ${periodEnd.getFullYear()}`

  if (error) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <AlertTriangle size={48} style={{ color: 'var(--red)', margin: '0 auto 16px' }} />
        <h3 style={{ fontSize: '1.2rem', marginBottom: 8 }}>Unable to load timesheets</h3>
        <p style={{ color: 'var(--text-secondary)' }}>{error.message || 'A network error occurred.'}</p>
        <button className="btn btn-primary" style={{ marginTop: 24 }} onClick={() => window.location.reload()}>Retry</button>
      </div>
    )
  }

  const chainLocked = gate.active && (!gate.onboardingComplete || !gate.trainingComplete)

  return (
    <div style={{ paddingBottom: 60, position: 'relative', minHeight: '100%' }}>
      <div className="flex-between" style={{ marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Timesheets</h1>
          <p style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem', marginTop: 4 }}>
            Total approved hours this contract: <strong style={{ color: 'var(--text-primary)' }}>{totalHours}</strong>
          </p>
        </div>
        <button
          className={`btn ${hasProject && !chainLocked ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => hasProject && !chainLocked && setShowForm(!showForm)}
          disabled={!hasProject || chainLocked}
          style={(!hasProject || chainLocked) ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
          title={chainLocked ? 'Complete onboarding & training first' : (!hasProject ? 'No project assigned' : '')}
        >
          <Plus size={16} /> New Timesheet
        </button>
      </div>

      {/* ── Onboarding → training → timesheet chain lock (feature-flagged) ── */}
      {chainLocked && (
        <div style={{ padding: '14px 20px', borderRadius: 'var(--radius-md)', background: 'rgba(192,57,43,0.10)', border: '1px solid #C0392B', marginBottom: 20, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <Shield size={18} style={{ color: '#C0392B', marginTop: 2, flexShrink: 0 }} />
          <div style={{ fontSize: '0.86rem', lineHeight: 1.6 }}>
            <strong style={{ color: '#C0392B' }}>Complete onboarding &amp; training first</strong>
            <div style={{ color: 'var(--text-secondary)', marginTop: 4 }}>
              Timesheet submission is locked until you finish
              {!gate.onboardingComplete && <> <Link to="/employee/onboarding" style={{ color: '#1598CC', fontWeight: 600 }}>policy acknowledgment</Link>{gate.missingPolicies.length ? ` (${gate.missingPolicies.join(', ')})` : ''}</>}
              {!gate.onboardingComplete && !gate.trainingComplete && ' and'}
              {!gate.trainingComplete && <> <Link to="/employee/training" style={{ color: '#1598CC', fontWeight: 600 }}>required training</Link>{gate.missingModules.length ? ` (${gate.missingModules.join(', ')})` : ''}</>}.
            </div>
          </div>
        </div>
      )}

      {/* ── Late warning banner — does NOT block submission ── */}
      {isLate && (
        <div style={{
          padding: '12px 20px',
          borderRadius: 'var(--radius-md)',
          background: 'var(--amber-dim, rgba(243,156,18,0.10))',
          border: '1px solid var(--amber, #F39C12)',
          marginBottom: 20,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          fontSize: '0.85rem',
        }}>
          <AlertTriangle size={16} style={{ color: 'var(--amber)' }} />
          <div>
            <strong style={{ color: 'var(--amber, #F39C12)' }}>Timesheet is late for this period</strong>
            <span style={{ color: 'var(--text-secondary)', marginLeft: 8 }}>
              The {getOrdinal(PERIOD_CLOSE_DAY)} of the month is the preferred cut-off, but you can still submit.
            </span>
          </div>
        </div>
      )}

      {/* No project assigned — graceful empty state (prevents the form from rendering without an assignment) */}
      {!projectsLoading && !hasProject && (
        <div className="card animate-fade-in-up" style={{ marginBottom: 24, textAlign: 'center', padding: '40px 24px' }}>
          <Briefcase size={40} style={{ color: 'var(--text-tertiary)', margin: '0 auto 16px' }} />
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: 8 }}>No project assigned</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', maxWidth: 420, margin: '0 auto', lineHeight: 1.6 }}>
            You don't have an active project assignment yet, so timesheets can't be created. Please contact the CEO to be assigned to a project.
          </p>
        </div>
      )}

      {/* Submission Form */}
      {showForm && hasProject && !chainLocked && (
        <div className="card animate-fade-in-up" style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            <button className={`btn btn-sm ${method === 'manual' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setMethod('manual')}>
              <Calendar size={14} /> Manual Entry
            </button>
            <button className={`btn btn-sm ${method === 'pdf' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setMethod('pdf')}>
              <Upload size={14} /> PDF Upload
            </button>
          </div>

          {method === 'manual' ? (
            <div>
              {/* Project / Client Selection — NO PO numbers, rates, or approver details shown */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
                <div className="form-group">
                  <label className="form-label">Project</label>
                  <select className="form-input" value={selectedProjectId} onChange={e => setSelectedProjectId(e.target.value)}>
                    {liveProjects.length > 0 ? liveProjects.map(p => (
                      <option key={p.project_id} value={p.project_id}>{p.project_name}</option>
                    )) : <option value="">No projects assigned</option>}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Client</label>
                  <input className="form-input" type="text" value={
                    liveProjects.find(p => p.project_id === selectedProjectId)?.client_name || '—'
                  } readOnly />
                </div>
                <div className="form-group">
                  <label className="form-label">Billing Period</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <button className="btn-icon" style={{ color: 'var(--text-secondary)' }} onClick={() => shiftPeriod(-1)}><ChevronLeft size={18} /></button>
                    <input className="form-input" type="text" value={periodLabel} readOnly style={{ textAlign: 'center', fontWeight: 600 }} />
                    <button className="btn-icon" style={{ color: 'var(--text-secondary)' }} onClick={() => shiftPeriod(1)}><ChevronRight size={18} /></button>
                  </div>
                </div>
              </div>

              {/* Assignment Info — operational fields ONLY (no rates, PO, approver) */}
              {(() => {
                const proj = liveProjects.find(p => p.project_id === selectedProjectId)
                if (!proj) return null
                return (
                  <div style={{
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-primary)',
                    borderRadius: 'var(--radius-md)',
                    padding: '14px 20px',
                    marginBottom: 20,
                  }}>
                    <div style={{ fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', marginBottom: 10 }}>
                      Assignment Details
                    </div>
                    {/* Approval pipeline (generic — no approver names/emails) */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 20, background: 'var(--steel-blue-dim, var(--sky-blue-dim))', border: '1px solid var(--steel-blue, var(--sky-blue))', fontSize: '0.78rem', fontWeight: 600, color: 'var(--steel-blue, var(--sky-blue))' }}>
                        <User size={14} /> You Submit
                      </div>
                      <ArrowRight size={16} style={{ color: 'var(--text-tertiary)' }} />
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 20, background: 'var(--warning-dim)', border: '1px solid var(--amber)', fontSize: '0.78rem', fontWeight: 600, color: 'var(--amber)' }}>
                        <Shield size={14} /> CTO Review
                      </div>
                      <ArrowRight size={16} style={{ color: 'var(--text-tertiary)' }} />
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 20, background: 'var(--warning-dim)', border: '1px solid var(--amber)', fontSize: '0.78rem', fontWeight: 600, color: 'var(--amber)' }}>
                        <Mail size={14} /> Client Sign
                      </div>
                      <ArrowRight size={16} style={{ color: 'var(--text-tertiary)' }} />
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 20, background: 'var(--green-dim)', border: '1px solid var(--green)', fontSize: '0.78rem', fontWeight: 600, color: 'var(--green)' }}>
                        <CheckCircle size={14} /> Approved
                      </div>
                    </div>
                    {/* Operational info only — no financial or approver data */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, fontSize: '0.82rem' }}>
                      <div>
                        <div style={{ color: 'var(--text-tertiary)', fontSize: '0.72rem', marginBottom: 2 }}>Your Role</div>
                        <div style={{ fontWeight: 600 }}>{proj.my_assignment?.role_on_project || '—'}</div>
                      </div>
                      <div>
                        <div style={{ color: 'var(--text-tertiary)', fontSize: '0.72rem', marginBottom: 2 }}><MapPin size={11} style={{verticalAlign:-1}}/> Location</div>
                        <div style={{ fontWeight: 600 }}>{(proj.work_location_type || '').replace(/_/g, ' ')}</div>
                        {proj.work_location_address && <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>{proj.work_location_address}</div>}
                      </div>
                      <div>
                        <div style={{ color: 'var(--text-tertiary)', fontSize: '0.72rem', marginBottom: 2 }}>Project Period</div>
                        <div style={{ fontWeight: 600, fontSize: '0.78rem' }}>
                          {proj.start_date
                            ? new Date(proj.start_date._seconds ? proj.start_date._seconds * 1000 : proj.start_date).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})
                            : '—'}
                          {' — '}
                          {proj.end_date
                            ? new Date(proj.end_date._seconds ? proj.end_date._seconds * 1000 : proj.end_date).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})
                            : '—'}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })()}

              {/* Calendar Grid — Full month view with all days */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <h4 style={{ fontSize: '0.9rem', fontWeight: 600 }}>Daily Hours</h4>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button className="btn btn-ghost btn-sm" onClick={fillAllWorkingDays}>Fill 8h All</button>
                    <button className="btn btn-ghost btn-sm" onClick={clearAll} style={{ color: 'var(--red)' }}>Clear</button>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: totalEnteredHours >= expectedHours ? 'var(--green)' : 'var(--amber)', fontWeight: 700, marginLeft: 8 }}>
                      Total: {totalEnteredHours}h / {expectedHours}h
                    </span>
                  </div>
                </div>

                {/* Legend */}
                <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 12, height: 12, borderRadius: 3, background: 'var(--bg-elevated, #fff)', border: '1px solid var(--border-primary)' }}></span> Working Day
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 12, height: 12, borderRadius: 3, background: 'var(--weekend-bg, #e8e9ec)' }}></span> Weekend (Fri-Sat)
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 12, height: 12, borderRadius: 3, background: 'var(--holiday-bg, #fef3e2)' }}></span> Public Holiday
                  </span>
                </div>

                {/* Day headers — full 7-day week */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, marginBottom: 6 }}>
                  {DAY_LABELS.map(label => (
                    <div key={label} style={{
                      textAlign: 'center',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                      color: (label === 'Fri' || label === 'Sat') ? 'var(--text-tertiary)' : 'var(--text-secondary)',
                      padding: '6px 0',
                    }}>
                      {label}
                    </div>
                  ))}
                </div>

                {/* Calendar grid — 7 columns, all days including weekends/holidays */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
                  {/* Empty slots for days before the period starts (align to correct weekday) */}
                  {Array.from({ length: calendarDays[0]?.dayOfWeek || 0 }, (_, i) => (
                    <div key={`empty-${i}`} />
                  ))}

                  {calendarDays.map(d => {
                    const hours = dayHours[d.dateKey] || ''
                    const hasEntry = hours !== '' && parseFloat(hours) > 0
                    
                    return (
                      <div
                        key={d.dateKey}
                        className="ts-day-cell"
                        style={{
                          '--cell-bg': d.isHoliday
                            ? 'var(--holiday-bg, #fef3e2)'
                            : d.isWeekend
                              ? 'var(--weekend-bg, #e8e9ec)'
                              : hasEntry
                                ? 'var(--filled-bg, #e8f5e9)'
                                : 'var(--bg-elevated, #fff)',
                          '--cell-border': d.isHoliday
                            ? 'var(--holiday-border, #f0c27a)'
                            : d.isWeekend
                              ? 'var(--weekend-border, #ccc)'
                              : hasEntry
                                ? 'var(--green)'
                                : 'var(--border-primary)',
                          borderRadius: 'var(--radius-sm, 8px)',
                          border: '1.5px solid var(--cell-border)',
                          background: 'var(--cell-bg)',
                          padding: '8px 6px',
                          minHeight: 72,
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: 4,
                          position: 'relative',
                          opacity: d.isNonWorking ? 0.75 : 1,
                          transition: 'all 0.15s ease',
                        }}
                      >
                        {/* Date + Day */}
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', fontWeight: 600 }}>
                          {d.dayLabel}
                        </div>
                        <div style={{
                          fontSize: '1rem',
                          fontWeight: 700,
                          fontFamily: 'var(--font-heading)',
                          color: d.isHoliday ? 'var(--holiday-text, #c47a15)' : d.isWeekend ? 'var(--text-tertiary)' : 'var(--text-primary)',
                        }}>
                          {d.date}
                        </div>

                        {/* Input or label */}
                        {d.isNonWorking ? (
                          <div style={{
                            fontSize: '0.62rem',
                            fontWeight: 600,
                            textTransform: 'uppercase',
                            letterSpacing: '0.04em',
                            color: d.isHoliday ? 'var(--holiday-text, #c47a15)' : 'var(--text-tertiary)',
                            textAlign: 'center',
                            lineHeight: 1.2,
                            marginTop: 2,
                          }}>
                            {d.isHoliday ? d.holidayName : 'Weekend'}
                          </div>
                        ) : (
                          <input
                            type="number"
                            min="0"
                            max="24"
                            step="0.5"
                            value={hours}
                            onChange={e => handleHourChange(d.dateKey, e.target.value)}
                            placeholder="0"
                            style={{
                              width: '100%',
                              maxWidth: 48,
                              textAlign: 'center',
                              border: '1px solid var(--border-primary)',
                              borderRadius: 6,
                              padding: '4px 2px',
                              fontSize: '0.9rem',
                              fontWeight: 700,
                              fontFamily: 'var(--font-mono)',
                              background: 'var(--bg-base, #fff)',
                              color: hasEntry ? 'var(--green)' : 'var(--text-tertiary)',
                              outline: 'none',
                              transition: 'border-color 0.15s ease',
                            }}
                            onFocus={e => { e.target.style.borderColor = 'var(--steel-blue, var(--sky-blue))' }}
                            onBlur={e => { e.target.style.borderColor = 'var(--border-primary)' }}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: 16 }}>
                <label className="form-label">Notes (optional)</label>
                <textarea className="form-input" rows={2} placeholder="Additional notes for the client approver..." value={notes} onChange={e => setNotes(e.target.value)} />
              </div>

              {submitResult && (
                <div className="animate-fade-in-up" style={{ padding: '12px 20px', marginBottom: 16, borderRadius: 'var(--radius-md)', background: submitResult.success ? 'rgba(52,191,58,0.12)' : 'rgba(192,57,43,0.12)', border: `1px solid ${submitResult.success ? 'rgba(52,191,58,0.3)' : 'rgba(192,57,43,0.3)'}`, color: submitResult.success ? '#34BF3A' : '#C0392B', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                  {submitResult.success ? <CheckCircle size={16} /> : <AlertTriangle size={16} />} {submitResult.message}
                  {submitResult.id && <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', opacity: 0.8 }}>({submitResult.id})</span>}
                </div>
              )}

              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={handleSubmitTimesheet} disabled={submitLoading || totalEnteredHours === 0} style={{ opacity: submitLoading ? 0.7 : 1 }}>
                  <Send size={16} /> {submitLoading ? 'Submitting...' : 'Submit Timesheet'}
                </button>
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <div style={{ width: 80, height: 80, borderRadius: 16, background: 'var(--bg-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: '2rem' }}>
                📄
              </div>
              <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>Drag & drop your client timesheet PDF/DOC here</p>
              <p style={{ color: 'var(--text-tertiary)', fontSize: '0.78rem', marginBottom: 20 }}>PDF, DOC, DOCX, JPG, PNG allowed. Max 10MB.</p>
              
              <label className="btn btn-primary" style={{ cursor: extracting ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, opacity: extracting ? 0.7 : 1 }}>
                {extracting ? <Loader size={16} className="spin" /> : <Upload size={16} />}
                {extracting ? 'Extracting via AI...' : 'Choose File'}
                <input 
                  type="file" 
                  accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                  style={{ display: 'none' }}
                  disabled={extracting}
                  onChange={async (e) => {
                    const file = e.target.files[0]
                    if (!file) return
                    setExtracting(true)
                    try {
                      const user = auth.currentUser
                      const idToken = await user.getIdToken()
                      const formData = new FormData()
                      formData.append('file', file)
                      const res = await fetch(EXTRACT_TIMESHEET_URL, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${idToken}` },
                        body: formData
                      })
                      const data = await res.json()
                      if (!res.ok) throw new Error(data.error || 'AI Extraction failed')
                      
                      // Merge extracted hours into state
                      setDayHours(prev => ({ ...prev, ...data.dayHours }))
                      setMethod('manual')
                    } catch (err) {
                      alert(`Extraction failed: ${err.message}. Proceeding manually.`)
                      setMethod('manual')
                    } finally {
                      setExtracting(false)
                    }
                  }}
                />
              </label>
            </div>
          )}
        </div>
      )}

      {/* Submission History — from Cloud Function, NO PO numbers or client approver shown */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="data-table">
          <thead>
            <tr><th>Period</th><th>Project</th><th>Client</th><th>Hours</th><th>Status</th><th>Submitted</th></tr>
          </thead>
          <tbody>
            {myTimesheets.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'var(--text-tertiary)' }}>No submitted timesheets yet</td></tr>
            ) : myTimesheets.map(ts => {
              const sc = stateColors[ts.state] || { label: ts.state, cls: 'badge-neutral' }
              return (
                <tr key={ts.timesheet_id}>
                  <td style={{ fontWeight: 600 }}>{ts.period_label}</td>
                  <td>{ts.project_name}</td>
                  <td>{ts.client_name}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{ts.total_hours}h</td>
                  <td><span className={`badge ${sc.cls}`}>{sc.label}</span></td>
                  <td style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>{ts.submitted_at?._seconds ? new Date(ts.submitted_at._seconds * 1000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
