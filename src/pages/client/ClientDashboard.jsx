import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { clientProfile, clientProjects } from '../../data/mockClient'
import { CheckCircle, Download, Pen, Printer, Type, Upload, Eraser, Clock, Mail, ShieldCheck } from 'lucide-react'

// TODO: When client OTP auth is implemented, create a Cloud Function
// getClientProjectView that filters projects by client_id and strips
// internal fields (standard_rate_sar, engineers_count, notes, compliance_frameworks).
// Client should only see their own projects' operational + PO data.

// Saudi Arabia 2026 Public Holidays
const SAUDI_HOLIDAYS_2026 = new Map([
  ['2026-02-22', 'Founding Day'], ['2026-02-23', 'Founding Day'],
  ['2026-03-20', 'Eid Al-Fitr'], ['2026-03-21', 'Eid Al-Fitr'],
  ['2026-03-22', 'Eid Al-Fitr'], ['2026-03-23', 'Eid Al-Fitr'], ['2026-03-24', 'Eid Al-Fitr'],
  ['2026-05-27', 'Arafat Day'], ['2026-05-28', 'Eid Al-Adha'],
  ['2026-05-29', 'Eid Al-Adha'], ['2026-05-30', 'Eid Al-Adha'], ['2026-05-31', 'Eid Al-Adha'],
  ['2026-09-23', 'National Day'], ['2026-09-24', 'National Day'],
])

function formatDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function getTimestamp() {
  const now = new Date()
  return now.toLocaleString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: true, timeZone: 'Asia/Riyadh',
  }) + ' (AST)'
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// Build attendance from engineer's submitted day-by-day data
// Weekends + holidays are system-enforced, work type comes from engineer's timesheet
function buildAttendance(engineerDays, year, month) {
  const data = {}
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d)
    const dateKey = formatDateKey(date)
    const dayOfWeek = date.getDay()
    if (dayOfWeek === 5 || dayOfWeek === 6) {
      data[d] = 'weekend'
    } else if (SAUDI_HOLIDAYS_2026.has(dateKey)) {
      data[d] = 'holiday'
    } else {
      // Use the engineer's actual submitted data
      data[d] = engineerDays[d] || null
    }
  }
  return data
}

const cellColors = {
  remote: '#f8d7da',
  inhouse: '#d4edda',
  leave: '#cce5ff',
  weekend: '#d6d8db',
  holiday: '#d6d8db',
}

// ─── Signature Pad Canvas Component ───────────────────────
function SignaturePad({ onSave, onCancel }) {
  const canvasRef = useRef(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [hasDrawn, setHasDrawn] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = '#1a4a8a'
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
  }, [])

  const getPos = useCallback((e) => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const clientY = e.touches ? e.touches[0].clientY : e.clientY
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height),
    }
  }, [])

  const startDraw = useCallback((e) => {
    e.preventDefault()
    setIsDrawing(true)
    setHasDrawn(true)
    const ctx = canvasRef.current.getContext('2d')
    const pos = getPos(e)
    ctx.beginPath()
    ctx.moveTo(pos.x, pos.y)
  }, [getPos])

  const draw = useCallback((e) => {
    if (!isDrawing) return
    e.preventDefault()
    const ctx = canvasRef.current.getContext('2d')
    const pos = getPos(e)
    ctx.lineTo(pos.x, pos.y)
    ctx.stroke()
  }, [isDrawing, getPos])

  const endDraw = useCallback(() => setIsDrawing(false), [])

  const clearCanvas = () => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    setHasDrawn(false)
  }

  return (
    <div>
      <div style={{ fontSize: '0.72rem', color: '#64748b', marginBottom: 6, textAlign: 'center' }}>
        Draw your signature below using mouse or touch
      </div>
      <canvas
        ref={canvasRef} width={400} height={120}
        onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
        onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={endDraw}
        style={{
          width: '100%', maxWidth: 400, height: 120,
          border: '2px dashed #1B6B93', borderRadius: 4,
          cursor: 'crosshair', touchAction: 'none',
          display: 'block', margin: '0 auto',
        }}
      />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 10 }}>
        <button onClick={clearCanvas} style={{ padding: '4px 14px', border: '1px solid #ccc', borderRadius: 4, background: 'white', cursor: 'pointer', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 4 }}>
          <Eraser size={13} /> Clear
        </button>
        <button onClick={onCancel} style={{ padding: '4px 14px', border: '1px solid #ccc', borderRadius: 4, background: 'white', cursor: 'pointer', fontSize: '0.75rem' }}>Cancel</button>
        <button onClick={() => onSave(canvasRef.current.toDataURL('image/png'))} disabled={!hasDrawn} style={{
          padding: '4px 14px', border: 'none', borderRadius: 4,
          background: hasDrawn ? '#27ae60' : '#ccc', color: 'white',
          cursor: hasDrawn ? 'pointer' : 'default', fontWeight: 600, fontSize: '0.75rem',
        }}>✓ Confirm Signature</button>
      </div>
    </div>
  )
}

// ─── Engineer submission data (in production: pulled from Firestore after engineer submits) ───
// Each engineer's per-day entry comes directly from their submitted timesheet.
// 'remote' = worked remotely,  'inhouse' = on-site at client,  'leave' = approved leave
// Weekends & holidays are auto-filled by the system, NOT by the engineer.
const engineerSubmissions = [
  {
    id: 'EMP-001', name: 'Mohammed Al-Fahad', role: 'Senior Java Engineer',
    email: 'mohammed.alfahad@datalake.sa',
    submitted: true, submittedDate: '2026-04-21', hours: 176, totalDays: 22,
    // Per-day data from their submitted timesheet (working days only)
    days: {
      1:'inhouse', 2:'inhouse',
      5:'inhouse', 6:'remote', 7:'remote', 8:'inhouse', 9:'inhouse',
      12:'inhouse', 13:'inhouse', 14:'remote', 15:'inhouse', 16:'inhouse',
      19:'inhouse', 20:'remote', 21:'inhouse', 22:'inhouse', 23:'inhouse',
      26:'inhouse', 27:'inhouse', 28:'remote', 29:'inhouse', 30:'inhouse',
    },
  },
  {
    id: 'EMP-002', name: 'Fatimah Al-Harbi', role: 'DevOps Engineer',
    email: 'fatimah.harbi@datalake.sa',
    submitted: true, submittedDate: '2026-04-20', hours: 168, totalDays: 21,
    // She took 1 day approved leave on Apr 9
    days: {
      1:'remote', 2:'remote',
      5:'inhouse', 6:'inhouse', 7:'remote', 8:'remote', 9:'leave',
      12:'remote', 13:'inhouse', 14:'inhouse', 15:'remote', 16:'inhouse',
      19:'remote', 20:'inhouse', 21:'inhouse', 22:'remote', 23:'inhouse',
      26:'inhouse', 27:'remote', 28:'inhouse', 29:'inhouse', 30:'remote',
    },
  },
]

// ─── Main Component ───────────────────────────────────────
export default function ClientTimesheetApproval() {
  const [signing, setSigning] = useState(false)
  const [sigMethod, setSigMethod] = useState('draw')
  const [signatureText, setSignatureText] = useState('')
  const [signatureImage, setSignatureImage] = useState(null)
  const [signed, setSigned] = useState(false)
  const [signedTimestamp, setSignedTimestamp] = useState('')
  const [reminderSent, setReminderSent] = useState(new Set())

  const activeProject = clientProjects.find(p => p.status === 'Active')
  const engineers = engineerSubmissions
  const allSubmitted = engineers.every(e => e.submitted)
  const submittedCount = engineers.filter(e => e.submitted).length

  const year = 2026
  const month = 3
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1)

  const attendanceData = useMemo(() => {
    return engineers.map(eng => ({
      ...eng,
      attendance: buildAttendance(eng.days || {}, year, month),
    }))
  }, [engineers.length])

  const handleSignWithDraw = (dataUrl) => {
    setSignatureImage(dataUrl)
    setSignedTimestamp(getTimestamp())
    setSigned(true)
    setSigning(false)
  }

  const handleSignWithType = () => {
    if (!signatureText.trim()) return
    setSignedTimestamp(getTimestamp())
    setSigned(true)
    setSigning(false)
  }

  const handleUpload = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      setSignatureImage(ev.target.result)
      setSignedTimestamp(getTimestamp())
      setSigned(true)
      setSigning(false)
    }
    reader.readAsDataURL(file)
  }

  const sendReminder = (engId) => {
    setReminderSent(prev => new Set(prev).add(engId))
  }

  const ceoTimestamp = 'April 20, 2026, 02:15:30 PM (AST)'

  return (
    <div style={{ minHeight: '100vh', background: '#f5f6f8', fontFamily: "'Inter', 'DM Sans', sans-serif" }}>
      {/* Simple top header — no sidebar */}
      <header style={{
        background: 'white', borderBottom: '1px solid #e0e0e0',
        padding: '14px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <img src="/images/icon.svg" alt="Datalake" style={{ height: 32 }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#1B2A4A' }}>Datalake — Timesheet Approval</div>
            <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{activeProject?.name}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <ShieldCheck size={16} style={{ color: '#27ae60' }} />
          <span style={{ fontSize: '0.72rem', color: '#64748b' }}>Secure · OTP Verified · PDPL Compliant</span>
          <div style={{
            width: 34, height: 34, borderRadius: '50%',
            background: 'linear-gradient(135deg, #2C5F7C, #1B2A4A)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'white', fontWeight: 700, fontSize: '0.7rem',
          }}>KD</div>
        </div>
      </header>

      <div style={{ maxWidth: 1100, margin: '28px auto', padding: '0 20px' }}>

        {/* ── Engineer Submission Status ── */}
        <div style={{
          background: 'white', border: '1px solid #e0e0e0', borderRadius: 8,
          padding: '20px 28px', marginBottom: 20,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <h3 style={{ fontSize: '0.82rem', fontWeight: 700, color: '#333', marginBottom: 2 }}>
                Engineer Submission Status — {MONTH_NAMES[month]} {year}
              </h3>
              <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                {allSubmitted
                  ? '✅ All engineers have submitted — Ready for your approval'
                  : `⏳ ${submittedCount} of ${engineers.length} engineers submitted`
                }
              </div>
            </div>
            {allSubmitted && (
              <span style={{
                padding: '4px 12px', borderRadius: 20, fontSize: '0.72rem', fontWeight: 600,
                background: '#e8fbe5', color: '#27ae60', border: '1px solid #27ae60',
              }}>Ready for Signature</span>
            )}
          </div>

          {engineers.map((eng, i) => (
            <div key={eng.id} style={{
              display: 'flex', alignItems: 'center', gap: 14,
              padding: '10px 0',
              borderBottom: i < engineers.length - 1 ? '1px solid #f0f0f0' : 'none',
            }}>
              <div style={{
                width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                background: eng.submitted
                  ? 'linear-gradient(135deg, #27ae60, #1e8449)'
                  : 'linear-gradient(135deg, #e67e22, #d35400)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'white', fontSize: '0.65rem', fontWeight: 700,
              }}>
                {eng.submitted ? <CheckCircle size={16} /> : <Clock size={16} />}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{eng.name}</div>
                <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{eng.role}</div>
              </div>
              {eng.submitted ? (
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#27ae60' }}>✓ Submitted</div>
                  <div style={{ fontSize: '0.65rem', color: '#64748b' }}>{eng.submittedDate} · {eng.hours}h</div>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: '0.75rem', color: '#e67e22', fontWeight: 600 }}>Not Submitted</span>
                  {reminderSent.has(eng.id) ? (
                    <span style={{ fontSize: '0.68rem', color: '#64748b', fontStyle: 'italic' }}>Reminder sent ✓</span>
                  ) : (
                    <button onClick={() => sendReminder(eng.id)} style={{
                      padding: '3px 10px', border: '1px solid #e67e22', borderRadius: 4,
                      background: 'white', cursor: 'pointer', fontSize: '0.7rem',
                      fontWeight: 600, color: '#e67e22', display: 'flex', alignItems: 'center', gap: 4,
                    }}>
                      <Mail size={12} /> Send Reminder
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* ── Timesheet Document (only visible when all submitted) ── */}
        {allSubmitted ? (
          <>
            <div style={{
              background: 'white', border: '1px solid #ddd', borderRadius: 8,
              boxShadow: '0 2px 20px rgba(0,0,0,0.08)', color: '#333',
            }}>
              {/* Document Header */}
              <div style={{ padding: '24px 32px', position: 'relative' }}>
                <div style={{ position: 'absolute', top: 16, right: 32, fontFamily: 'var(--font-mono, monospace)', fontSize: '0.75rem', color: '#64748b' }}>
                  DTLK-HR-TS-002
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 32, marginBottom: 20 }}>
                  <div><img src="/images/logo-dark.svg" alt="Datalake" style={{ height: 50 }} /></div>
                  <div style={{ flex: 1, textAlign: 'center' }}>
                    <h1 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#1B6B93', letterSpacing: '0.02em' }}>
                      Timesheet {activeProject?.name.split('—')[0].trim().toUpperCase()} PROJECT
                    </h1>
                  </div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#333' }}>{year}</div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1B6B93' }}>إمكان</div>
                    <div style={{ fontSize: '0.82rem', color: '#64748b' }}>{clientProfile.company}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8, justifyContent: 'flex-end' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>PO:</span>
                      <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>#{activeProject?.pos[0]?.number.replace('PO-', '') || '1165'}</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.72rem', color: '#666' }}>
                      {[
                        { label: 'Remote Days', color: cellColors.remote },
                        { label: 'In house', color: cellColors.inhouse },
                        { label: 'Leave', color: cellColors.leave },
                        { label: 'Public Holidays / WEEKEND', color: cellColors.weekend },
                      ].map(item => (
                        <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                          <span>{item.label}</span>
                          <span style={{ width: 16, height: 12, background: item.color, border: '1px solid #ccc', borderRadius: 2 }} />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Calendar Grid */}
              <div style={{ padding: '0 32px', overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
                  <thead>
                    <tr>
                      <th style={{
                        textAlign: 'left', padding: '8px 10px',
                        background: '#c74634', color: 'white',
                        fontWeight: 700, fontSize: '0.82rem',
                        borderRadius: '4px 0 0 0', whiteSpace: 'nowrap', minWidth: 140,
                      }}>
                        {MONTH_NAMES[month]}{year}
                      </th>
                      {days.map(d => {
                        const date = new Date(year, month, d)
                        const dayOfWeek = date.getDay()
                        const dateKey = formatDateKey(date)
                        const isWeekend = dayOfWeek === 5 || dayOfWeek === 6
                        const isHoliday = SAUDI_HOLIDAYS_2026.has(dateKey)
                        return (
                          <th key={d} style={{
                            padding: '6px 0', textAlign: 'center', minWidth: 22,
                            background: isHoliday ? '#5b9bd5' : isWeekend ? '#808080' : '#c74634',
                            color: 'white', fontWeight: 600, fontSize: '0.7rem',
                            borderLeft: '1px solid rgba(255,255,255,0.2)',
                          }}>{d}</th>
                        )
                      })}
                      <th style={{
                        padding: '6px 8px', textAlign: 'center',
                        background: '#c74634', color: 'white',
                        fontWeight: 700, fontSize: '0.72rem',
                        borderRadius: '0 4px 0 0', whiteSpace: 'nowrap',
                      }}>Total Days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attendanceData.map(eng => (
                      <tr key={eng.id}>
                        <td style={{ padding: '6px 10px', fontWeight: 600, fontSize: '0.78rem', borderBottom: '1px solid #eee', color: '#444', whiteSpace: 'nowrap' }}>
                          {eng.role}
                        </td>
                        {days.map(d => (
                          <td key={d} style={{
                            padding: 0, background: cellColors[eng.attendance[d]] || 'transparent',
                            borderBottom: '1px solid #eee', borderLeft: '1px solid #eee',
                            minWidth: 22, height: 24,
                          }} />
                        ))}
                        <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, fontFamily: 'monospace', fontSize: '0.82rem', borderBottom: '1px solid #eee' }}>
                          {eng.totalDays}.00
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* ─── Dual Signature Block ─── */}
              <div style={{ padding: '40px 32px 24px', display: 'flex', justifyContent: 'space-around', gap: 60 }}>
                {/* Datalake — Pre-signed */}
                <div style={{ textAlign: 'center', flex: 1 }}>
                  <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#333', marginBottom: 2 }}>DATALAKE SA</div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#475569', marginBottom: 4 }}>Approved by</div>
                  <div style={{ fontSize: '0.85rem', color: '#333', marginBottom: 12 }}>Mohammed Alqumri</div>
                  <div style={{
                    border: '1px solid #ccc', borderRadius: 4,
                    padding: '16px 24px', minHeight: 80,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: '#fafafa',
                  }}>
                    <div style={{ fontFamily: "'Dancing Script', cursive", fontSize: '2rem', color: '#1a4a8a', transform: 'rotate(-3deg)' }}>
                      Mohammed Alqumri
                    </div>
                  </div>
                  <div style={{ fontSize: '0.62rem', color: '#64748b', marginTop: 6, fontFamily: 'monospace' }}>
                    {ceoTimestamp}
                  </div>
                </div>

                {/* Client — Sign Here */}
                <div style={{ textAlign: 'center', flex: 1 }}>
                  <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#333', marginBottom: 2 }}>{clientProfile.company} Finance Company</div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#475569', marginBottom: 4 }}>Approved by</div>
                  <div style={{ fontSize: '0.85rem', color: '#333', marginBottom: 12 }}>{clientProfile.contactName}</div>
                  <div style={{
                    border: signed ? '2px solid #27ae60' : signing ? '2px solid #1B6B93' : '1px solid #ccc',
                    borderRadius: 4, padding: signing ? '12px' : '16px 24px', minHeight: 80,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column',
                    background: signed ? '#eafbe7' : signing ? '#f0f8ff' : '#fafafa',
                    cursor: !signed && !signing ? 'pointer' : 'default',
                    transition: 'all 0.2s ease',
                  }}
                    onClick={() => !signed && !signing && setSigning(true)}
                  >
                    {signed ? (
                      signatureImage ? (
                        <img src={signatureImage} alt="Signature" style={{ maxHeight: 70, maxWidth: '90%', objectFit: 'contain' }} />
                      ) : (
                        <div style={{ fontFamily: "'Dancing Script', cursive", fontSize: '2rem', color: '#1a4a8a', transform: 'rotate(-2deg)' }}>
                          {signatureText}
                        </div>
                      )
                    ) : signing ? (
                      <div style={{ width: '100%' }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 4, justifyContent: 'center', marginBottom: 12 }}>
                          {[
                            { id: 'draw', icon: Pen, label: 'Draw' },
                            { id: 'type', icon: Type, label: 'Type' },
                            { id: 'upload', icon: Upload, label: 'Upload' },
                          ].map(m => {
                            const Icon = m.icon
                            return (
                              <button key={m.id} onClick={() => setSigMethod(m.id)} style={{
                                padding: '5px 14px', border: sigMethod === m.id ? '2px solid #1B6B93' : '1px solid #ccc',
                                borderRadius: 4, background: sigMethod === m.id ? '#e8f4fd' : 'white',
                                cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600,
                                display: 'flex', alignItems: 'center', gap: 4,
                                color: sigMethod === m.id ? '#1B6B93' : '#666',
                              }}>
                                <Icon size={13} /> {m.label}
                              </button>
                            )
                          })}
                        </div>
                        {sigMethod === 'draw' && (
                          <SignaturePad onSave={handleSignWithDraw} onCancel={() => setSigning(false)} />
                        )}
                        {sigMethod === 'type' && (
                          <div>
                            <input type="text" value={signatureText}
                              onChange={e => setSignatureText(e.target.value)}
                              placeholder="Type your full name" autoFocus
                              style={{
                                width: '100%', border: 'none', borderBottom: '2px solid #1B6B93',
                                background: 'transparent', textAlign: 'center',
                                fontFamily: "'Dancing Script', cursive",
                                fontSize: '1.6rem', color: '#1a4a8a', outline: 'none', padding: '8px 0',
                              }}
                              onKeyDown={e => e.key === 'Enter' && handleSignWithType()}
                            />
                            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 10 }}>
                              <button onClick={() => { setSigning(false); setSignatureText('') }}
                                style={{ padding: '4px 14px', border: '1px solid #ccc', borderRadius: 4, background: 'white', cursor: 'pointer', fontSize: '0.75rem' }}>Cancel</button>
                              <button onClick={handleSignWithType} disabled={!signatureText.trim()}
                                style={{
                                  padding: '4px 14px', border: 'none', borderRadius: 4,
                                  background: signatureText.trim() ? '#27ae60' : '#ccc', color: 'white',
                                  cursor: signatureText.trim() ? 'pointer' : 'default', fontWeight: 600, fontSize: '0.75rem',
                                }}>✓ Confirm</button>
                            </div>
                          </div>
                        )}
                        {sigMethod === 'upload' && (
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '0.72rem', color: '#64748b', marginBottom: 8 }}>Upload your signature image (PNG, JPG)</div>
                            <label style={{
                              display: 'inline-flex', alignItems: 'center', gap: 6,
                              padding: '8px 20px', border: '2px dashed #1B6B93', borderRadius: 6,
                              background: 'white', cursor: 'pointer', fontSize: '0.82rem',
                              fontWeight: 600, color: '#1B6B93',
                            }}>
                              <Upload size={16} /> Choose File
                              <input type="file" accept="image/*" onChange={handleUpload} style={{ display: 'none' }} />
                            </label>
                            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 10 }}>
                              <button onClick={() => setSigning(false)}
                                style={{ padding: '4px 14px', border: '1px solid #ccc', borderRadius: 4, background: 'white', cursor: 'pointer', fontSize: '0.75rem' }}>Cancel</button>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div style={{ color: '#64748b', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Pen size={16} /> Click to sign
                      </div>
                    )}
                  </div>
                  {signed && (
                    <div style={{ fontSize: '0.62rem', color: '#27ae60', marginTop: 6, fontFamily: 'monospace', fontWeight: 600 }}>
                      ✓ {signedTimestamp}
                    </div>
                  )}
                </div>
              </div>

              {/* Legal Footer */}
              <div style={{
                padding: '16px 32px', borderTop: '1px solid #eee',
                textAlign: 'center', fontSize: '0.72rem', color: '#64748b',
              }}>
                Datalake Saudi Arabia, Riyadh 13243 Rajeh Street, CR:109194773 UEN:7048904952
              </div>
            </div>

            {/* Action buttons */}
            <div style={{ maxWidth: 1100, margin: '16px auto', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              {signed && (
                <>
                  <button style={{ padding: '6px 16px', border: '1px solid #ccc', borderRadius: 6, background: 'white', cursor: 'pointer', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Printer size={14} /> Print
                  </button>
                  <button style={{
                    padding: '6px 16px', border: 'none', borderRadius: 6,
                    background: '#1B6B93', color: 'white', cursor: 'pointer',
                    fontSize: '0.78rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    <Download size={14} /> Download Signed PDF
                  </button>
                </>
              )}
            </div>

            {signed && (
              <div style={{
                padding: '12px 20px', background: '#e8fbe5', borderRadius: 8,
                border: '1px solid #27ae60', fontSize: '0.82rem', color: '#27ae60',
                display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20,
              }}>
                <CheckCircle size={16} />
                Document signed and archived for both <strong>{clientProfile.company}</strong> and <strong>Datalake SA</strong>.
                The CEO has been notified and an invoice will be generated against PO #{activeProject?.pos[0]?.number.replace('PO-', '')}.
              </div>
            )}
          </>
        ) : (
          /* ── Waiting State — Not all engineers submitted ── */
          <div style={{
            background: 'white', border: '1px solid #e0e0e0', borderRadius: 8,
            padding: '48px 32px', textAlign: 'center',
          }}>
            <div style={{ fontSize: '3rem', marginBottom: 12 }}>⏳</div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#333', marginBottom: 8 }}>
              Waiting for Engineer Submissions
            </h2>
            <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: 8, maxWidth: 500, margin: '0 auto 20px' }}>
              The timesheet document will be available for your signature once <strong>all {engineers.length} engineers</strong> on this project
              have submitted their timesheets for <strong>{MONTH_NAMES[month]} {year}</strong>.
            </p>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '8px 20px', background: '#fff7ed', border: '1px solid #e67e22',
              borderRadius: 8, fontSize: '0.82rem', color: '#e67e22', fontWeight: 600,
            }}>
              <Clock size={16} /> {submittedCount} of {engineers.length} submitted — {engineers.length - submittedCount} pending
            </div>
            <p style={{ fontSize: '0.72rem', color: '#64748b', marginTop: 16 }}>
              You can send reminders to engineers who haven't submitted using the status panel above.
            </p>
          </div>
        )}

        {/* PDPL / NCA Compliance Footer */}
        <div style={{
          marginTop: 24, padding: '14px 20px', background: 'white',
          border: '1px solid #e0e0e0', borderRadius: 8,
          fontSize: '0.68rem', color: '#64748b', lineHeight: 1.7,
          display: 'flex', alignItems: 'flex-start', gap: 10,
        }}>
          <ShieldCheck size={16} style={{ flexShrink: 0, marginTop: 2, color: '#27ae60' }} />
          <div>
            <strong style={{ color: '#475569' }}>PDPL & NCA Compliance Notice</strong><br />
            Your personal data is processed under your explicit consent in accordance with the Saudi Personal Data Protection Law (PDPL).
            Engineer data shown on this page is limited to work-related information required for timesheet verification.
            All data is encrypted in transit (TLS 1.3) and at rest (AES-256). Signed documents are stored in a tamper-proof archive
            accessible only to authorized personnel. Your data will be retained for the duration required by Saudi labor law.
            For data access, correction, or deletion requests, contact <strong>privacy@datalake.sa</strong>.
          </div>
        </div>
      </div>
    </div>
  )
}
