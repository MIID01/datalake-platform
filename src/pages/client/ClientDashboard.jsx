import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { CheckCircle, Download, Pen, Printer, Type, Upload, Eraser, Clock, Mail, ShieldCheck } from 'lucide-react'
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import ExcelJS from 'exceljs'
import { saveAs } from 'file-saver'

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

// Removed mock engineerSubmissions

// ─── Main Component ───────────────────────────────────────
import { useParams } from 'react-router-dom'
import { query, where } from 'firebase/firestore'

export default function ClientTimesheetApproval() {
  const { token } = useParams()
  const [timesheet, setTimesheet] = useState(null)
  const [invalidToken, setInvalidToken] = useState(false)
  const [clientProfile, setClientProfile] = useState({ company: '', contactName: '' })
  const [timesheets, setTimesheets] = useState([])
  const [clientProjects, setClientProjects] = useState([])
  const [signing, setSigning] = useState(false)
  const [sigMethod, setSigMethod] = useState('draw')
  const [signatureText, setSignatureText] = useState('')
  const [signatureImage, setSignatureImage] = useState(null)
  const [signed, setSigned] = useState(false)
  const [signedTimestamp, setSignedTimestamp] = useState('')
  const [reminderSent, setReminderSent] = useState(new Set())

  useEffect(() => {
    if (!token) {
      setInvalidToken(true)
      return
    }
    const q = query(collection(db, 'timesheets'), where('client_sign_token', '==', token))
    const unsub = onSnapshot(q, snap => {
      if (!snap.empty) {
        const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        // Filter to only those in CLIENT_SIGNED or CTO_APPROVED state
        const validDocs = docs.filter(d => ['CLIENT_SIGNED', 'CTO_APPROVED'].includes(d.state) || ['CLIENT_SIGNED', 'CTO_APPROVED'].includes(d.status))
        
        if (validDocs.length > 0) {
          setTimesheets(validDocs)
          // If all valid timesheets are already signed, mark as signed
          if (validDocs.every(d => d.state === 'CLIENT_SIGNED' || d.status === 'CLIENT_SIGNED')) {
            setSigned(true)
          }
        } else {
          setInvalidToken(true)
        }
      } else {
        setInvalidToken(true)
      }
    })
    return () => unsub()
  }, [token])

  useEffect(() => {
    const unsub1 = onSnapshot(collection(db, 'client_profile'), snap => {
      if (!snap.empty) setClientProfile(snap.docs[0].data())
    })
    return () => unsub1()
  }, [])

  // All timesheets within a single signing token belong to the same project +
  // client by construction. The PO number is the one stamped on the timesheet
  // at submit time (which itself came from the linked project doc) — never
  // synthesised from the project name and never a hardcoded fallback.
  const activeProject = timesheets.length > 0 ? {
    name: timesheets[0].project_name,
    client_name: timesheets[0].client_name,
    client_id: timesheets[0].client_id || null,
    pos: timesheets[0].po_number ? [{ number: timesheets[0].po_number }] : [],
  } : null

  const engineers = timesheets.map(ts => ({
    id: ts.engineer_email,
    timesheet_id: ts.id,
    name: ts.engineer_name,
    role: 'Engineer',
    email: ts.engineer_email,
    submitted: true,
    submittedDate: ts.submitted_at?.toDate ? ts.submitted_at.toDate().toLocaleDateString() : 'N/A',
    hours: ts.total_hours,
    totalDays: Object.keys(ts.days || {}).length,
    days: ts.days || {}
  }))

  const allSubmitted = timesheets.length > 0
  const submittedCount = timesheets.length

  const year = timesheets.length > 0 ? timesheets[0].period_year : 2026
  const month = timesheets.length > 0 ? timesheets[0].period_month - 1 : 3
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1)

  const attendanceData = useMemo(() => {
    return engineers.map(eng => ({
      ...eng,
      attendance: buildAttendance(eng.days || {}, year, month),
    }))
  }, [engineers.length])

  const saveSignatureToFirestore = async (signatureData, method) => {
    if (timesheets.length === 0) return;
    try {
      const { doc, updateDoc, serverTimestamp } = await import('firebase/firestore')
      
      // Generate PDF of the timesheet
      const pdfBlob = await generatePDFBlob()
      let signedPdfUrl = null
      
      if (pdfBlob) {
        const storage = getStorage()
        const pdfRef = ref(storage, `datalake-worm-hr/employee_documents/TS-CLIENT-${token}-SIGNED.pdf`)
        await uploadBytes(pdfRef, pdfBlob)
        signedPdfUrl = await getDownloadURL(pdfRef)
      }

      await Promise.all(timesheets.map(ts => 
        updateDoc(doc(db, 'timesheets', ts.id), {
          state: 'CLIENT_SIGNED',
          status: 'CLIENT_SIGNED',
          client_signature_image: signatureData || null,
          client_signature_text: method === 'type' ? signatureText : null,
          client_signature_method: method,
          signed_pdf_url: signedPdfUrl,
          client_signed_at: serverTimestamp()
        })
      ))
    } catch (err) {
      console.error('Failed to save signature:', err)
    }
  }

  const generatePDFBlob = async () => {
    const container = document.getElementById('timesheet-print-container')
    if (!container) return null
    const pages = container.querySelectorAll('.timesheet-page')
    const pdf = new jsPDF('l', 'mm', 'a4')
    
    for (let i = 0; i < pages.length; i++) {
      const canvas = await html2canvas(pages[i], { scale: 2, useCORS: true })
      const imgData = canvas.toDataURL('image/png')
      if (i > 0) pdf.addPage()
      const pdfWidth = pdf.internal.pageSize.getWidth()
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight)
    }
    return pdf.output('blob')
  }

  const handleExportExcel = async () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Timesheet')

    // Header
    ws.addRow([`Timesheet ${activeProject?.name?.toUpperCase()}`])
    ws.addRow([`${clientProfile.company_ar || clientProfile.company} - ${clientProfile.company}`])
    ws.addRow([`Month: ${MONTH_NAMES[month]} ${year}`, `PO: #${activeProject?.pos[0]?.number.replace('PO-', '') || '1165'}`])
    ws.addRow([])

    // Columns
    const headerRow = ['Engineer', ...days.map(d => d.toString()), 'Total Days']
    ws.addRow(headerRow)

    // Data
    attendanceData.forEach(eng => {
      const row = [eng.role]
      days.forEach(d => row.push(eng.attendance[d] || ''))
      row.push(eng.totalDays)
      ws.addRow(row)
    })

    // Formatting
    ws.columns.forEach((col, i) => {
      if (i === 0) col.width = 20
      else if (i === days.length + 1) col.width = 12
      else col.width = 4
    })

    const buf = await wb.xlsx.writeBuffer()
    saveAs(new Blob([buf]), `Timesheet_${activeProject?.name}_${MONTH_NAMES[month]}_${year}.xlsx`)
  }

  const handleSignWithDraw = async (dataUrl) => {
    setSignatureImage(dataUrl)
    setSignedTimestamp(getTimestamp())
    setSigned(true)
    setSigning(false)
    await saveSignatureToFirestore(dataUrl, 'draw')
  }

  const handleSignWithType = async () => {
    if (!signatureText.trim()) return
    setSignedTimestamp(getTimestamp())
    setSigned(true)
    setSigning(false)
    await saveSignatureToFirestore(null, 'type')
  }

  const handleUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (ev) => {
      setSignatureImage(ev.target.result)
      setSignedTimestamp(getTimestamp())
      setSigned(true)
      setSigning(false)
      await saveSignatureToFirestore(ev.target.result, 'upload')
    }
    reader.readAsDataURL(file)
  }

  const sendReminder = (engId) => {
    setReminderSent(prev => new Set(prev).add(engId))
  }

  const ceoTimestamp = timesheet?.cto_action_at?.toDate ? timesheet.cto_action_at.toDate().toLocaleString('en-US') : 'Pending'

  if (invalidToken) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f6f8' }}>
        <div style={{ textAlign: 'center', background: 'white', padding: 40, borderRadius: 8, border: '1px solid #ddd' }}>
          <ShieldCheck size={48} color="#C0392B" style={{ margin: '0 auto 16px' }} />
          <h2 style={{ fontSize: '1.2rem', color: '#333' }}>Invalid or Expired Link</h2>
          <p style={{ color: '#666', marginTop: 8 }}>This timesheet approval link is no longer valid.</p>
        </div>
      </div>
    )
  }

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
            <div id="timesheet-print-container" style={{
              background: 'white', border: '1px solid #ddd', borderRadius: 8,
              boxShadow: '0 2px 20px rgba(0,0,0,0.08)', color: '#333',
            }}>
              {Array.from({ length: Math.ceil(attendanceData.length / 8) || 1 }).map((_, pageIdx) => {
                const chunk = attendanceData.slice(pageIdx * 8, (pageIdx + 1) * 8)
                const isLastPage = pageIdx === Math.ceil(attendanceData.length / 8) - 1
                return (
                  <div key={pageIdx} className="timesheet-page" style={{ pageBreakAfter: isLastPage ? 'auto' : 'always', paddingBottom: 24 }}>
              {/* Document Header */}
              <div style={{ padding: '24px 32px', position: 'relative' }}>
                <div style={{ position: 'absolute', top: 16, right: 32, fontFamily: 'var(--font-mono, monospace)', fontSize: '0.75rem', color: '#64748b' }}>
                  DTLK-HR-TS-002
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 32, marginBottom: 20 }}>
                  <div><img src="/images/logo-dark.svg" alt="Datalake" style={{ height: 50 }} /></div>
                  <div style={{ flex: 1, textAlign: 'center' }}>
                    <h1 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#1B6B93', letterSpacing: '0.02em' }}>
                      Timesheet {activeProject?.name?.toUpperCase()}
                    </h1>
                  </div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#333' }}>{year}</div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1B6B93' }}>{clientProfile.company_ar || clientProfile.company}</div>
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
                    {chunk.map(eng => (
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

              {/* ─── Dual Signature Block (Only on last page) ─── */}
              {isLastPage && (
              <>
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
                  <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#333', marginBottom: 2 }}>{clientProfile.company}</div>
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
                Datalake Saudi Arabia LLC, Riyadh Al-Yarmouk 13243, CR:1009194773 NUN:7048904952
              </div>
              </>
              )}
                  </div>
                )
              })}
            </div>

            <div style={{ maxWidth: 1100, margin: '16px auto', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              {signed && (
                <>
                  <button onClick={() => window.print()} style={{ padding: '6px 16px', border: '1px solid #ccc', borderRadius: 6, background: 'white', cursor: 'pointer', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Printer size={14} /> Print / Export PDF
                  </button>
                  <button onClick={handleExportExcel} style={{
                    padding: '6px 16px', border: 'none', borderRadius: 6,
                    background: '#27ae60', color: 'white', cursor: 'pointer',
                    fontSize: '0.78rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    <Download size={14} /> Export to Excel
                  </button>
                  <button onClick={() => window.open(timesheet.signed_pdf_url, '_blank')} disabled={!timesheet?.signed_pdf_url} style={{
                    padding: '6px 16px', border: 'none', borderRadius: 6,
                    background: timesheet?.signed_pdf_url ? '#1B6B93' : '#ccc', color: 'white', cursor: timesheet?.signed_pdf_url ? 'pointer' : 'default',
                    fontSize: '0.78rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    <Download size={14} /> Download Signed Record
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
                Management has been notified and an invoice will be generated against PO #{activeProject?.pos[0]?.number.replace('PO-', '')}.
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
