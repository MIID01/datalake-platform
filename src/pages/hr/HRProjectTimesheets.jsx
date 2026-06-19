import { useEffect, useMemo, useState, useCallback } from 'react'
import { collection, onSnapshot, doc, getDoc, updateDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { auth, db, GENERATE_PDF_URL, SEND_TIMESHEET_TO_CLIENT_URL, ASSEMBLE_PROJECT_TIMESHEET_URL } from '../../lib/firebase'
import { useAccessProfile } from '../../hooks/useAccessProfile'
import { Calendar, Plus, Trash2, Loader, Check, CalendarDays, FileDown, RefreshCw } from 'lucide-react'

// Client project timesheet — AUTO-ASSEMBLED from the canonical `timesheets`
// (engineers' submissions), rows keyed by POSITION (never names). HR/CTO review +
// add additional-billable (billed UNDER a position) → send to client → client signs.
const NAVY = '#022873'
const STATUS = { INHOUSE: { label: 'In house', color: '#C6EFCE' }, REMOTE: { label: 'Remote', color: '#FFCCCC' }, LEAVE: { label: 'Leave', color: '#BDD7EE' } }
const GREY = '#D9D9D9'
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const STATE_LABEL = { DRAFT: 'Assembled (draft)', SUBMITTED: 'Submitted', CTO_APPROVED: 'Internally approved', SENT_TO_CLIENT: 'Sent to client', CLIENT_SIGNED: 'Client signed', INVOICED: 'Invoiced' }
const daysInMonth = (y, m) => new Date(y, m, 0).getDate()
const pad2 = (n) => String(n).padStart(2, '0')
const isWeekend = (y, m, d) => { const wd = new Date(y, m - 1, d).getDay(); return wd === 5 || wd === 6 }

export default function HRProjectTimesheets() {
  const { profile } = useAccessProfile()
  const canReview = ['ceo', 'cto'].includes(profile?.role_id)
  const me = auth.currentUser?.email || ''
  const now = new Date()

  const [projects, setProjects] = useState([])
  const [projectId, setProjectId] = useState('')
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [ts, setTs] = useState(undefined) // undefined=not loaded, null=none, object=loaded
  const [extras, setExtras] = useState([])
  const [holidays, setHolidays] = useState([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const project = projects.find(p => p.id === projectId)
  const docId = projectId ? `${projectId}_${year}-${pad2(month)}` : ''
  const nDays = daysInMonth(year, month)
  const holidaySet = useMemo(() => new Set(holidays), [holidays])
  const isHol = useCallback((d) => holidaySet.has(`${year}-${pad2(month)}-${pad2(d)}`), [holidaySet, year, month])
  const blocked = (d) => isWeekend(year, month, d) || isHol(d)
  const rows = ts?.rows || []
  const positions = useMemo(() => [...new Set(rows.map(r => r.role).filter(Boolean))], [rows])
  const canEditExtras = canReview && ts && ['DRAFT', 'SUBMITTED'].includes(ts.state)

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'projects'), s => setProjects(s.docs.map(d => ({ id: d.id, ...d.data() }))), () => {})
    const u2 = onSnapshot(doc(db, 'crm_config', 'holidays'), s => setHolidays(s.exists() ? (s.data().dates || []) : []), () => {})
    return () => { u1(); u2() }
  }, [])

  const load = useCallback(() => {
    if (!docId) { setTs(undefined); return }
    setLoading(true); setMsg('')
    getDoc(doc(db, 'project_timesheets', docId)).then(snap => {
      if (snap.exists()) { const d = snap.data(); setTs(d); setExtras(d.additional_billable || []) }
      else { setTs(null); setExtras([]) }
      setLoading(false)
    }).catch(e => { setMsg(e.message); setLoading(false) })
  }, [docId])
  useEffect(() => { load() }, [load])

  const assemble = async () => {
    if (!projectId) return
    setBusy(true); setMsg('')
    try {
      const token = await auth.currentUser.getIdToken()
      const res = await fetch(ASSEMBLE_PROJECT_TIMESHEET_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ project_id: projectId, year, month }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`)
      setMsg(data.rows === 0 ? 'No approved engineer timesheets found for this project/month.' : `Assembled ${data.rows} position row(s) from submitted timesheets.`)
      load()
    } catch (e) { setMsg('Assemble failed: ' + e.message) } finally { setBusy(false) }
  }

  const rowTotal = (r) => Object.entries(r.days || {}).filter(([d, v]) => (v === 'INHOUSE' || v === 'REMOTE') && !blocked(Number(d))).length
  const rowLeave = (r) => Object.values(r.days || {}).filter(v => v === 'LEAVE').length

  const addExtra = () => setExtras(x => [...x, { position: positions[0] || '', category: 'CLIENT_REQUESTED_SERVICE', description: '', qty: 1, unit: 'day', added_by: me }])
  const setExtra = (i, f, v) => setExtras(x => x.map((e, j) => j === i ? { ...e, [f]: v } : e))
  const removeExtra = (i) => setExtras(x => x.filter((_, j) => j !== i))

  const save = async (extra = {}) => {
    setBusy(true); setMsg('')
    try {
      await updateDoc(doc(db, 'project_timesheets', docId), { additional_billable: extras, updated_at: serverTimestamp(), updated_by: me, ...extra })
      setTs(t => ({ ...t, additional_billable: extras, ...extra })); setMsg('Saved.')
    } catch (e) { setMsg('Save failed: ' + e.message) } finally { setBusy(false) }
  }
  const submit = () => save({ state: 'SUBMITTED', submitted_by: me, submitted_at: serverTimestamp() })
  const approve = () => save({ state: 'CTO_APPROVED', cto_approved_by: me, cto_approved_at: serverTimestamp() })

  const sendToClient = async () => {
    if (!window.confirm('Send this approved timesheet to the client for signature (secure email link)?')) return
    setBusy(true); setMsg('')
    try {
      const token = await auth.currentUser.getIdToken()
      const res = await fetch(SEND_TIMESHEET_TO_CLIENT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ docId }) })
      const data = await res.json(); if (!res.ok) throw new Error(data.error || `Failed (${res.status})`)
      setTs(t => ({ ...t, state: 'SENT_TO_CLIENT' })); setMsg('Sent to ' + data.sent_to + '.')
    } catch (e) { setMsg('Send failed: ' + e.message) } finally { setBusy(false) }
  }
  const downloadPdf = async () => {
    setBusy(true); setMsg('')
    try {
      const token = await auth.currentUser.getIdToken()
      const res = await fetch(GENERATE_PDF_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ template: 'project_timesheet', docId }) })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `Failed (${res.status})`) }
      const url = URL.createObjectURL(await res.blob()); const a = document.createElement('a'); a.href = url; a.download = `timesheet-${docId}.pdf`; a.click(); URL.revokeObjectURL(url)
    } catch (e) { setMsg('PDF failed: ' + e.message) } finally { setBusy(false) }
  }

  const addHoliday = async (date) => { if (!date) return; try { await setDoc(doc(db, 'crm_config', 'holidays'), { dates: [...new Set([...holidays, date])].sort(), updated_by: me }, { merge: true }) } catch (e) { alert(e.message) } }
  const removeHoliday = async (date) => { try { await setDoc(doc(db, 'crm_config', 'holidays'), { dates: holidays.filter(h => h !== date) }, { merge: true }) } catch (e) { alert(e.message) } }

  const sel = { padding: '8px 10px', borderRadius: 8, border: '1px solid #E5E7EB', fontSize: '0.86rem', fontFamily: 'inherit', background: '#fff' }

  return (
    <div style={{ padding: 24, fontFamily: "'DM Sans', sans-serif" }}>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: NAVY, display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 4px' }}>
        <Calendar size={20} color="#1598CC" /> Project Timesheets
      </h1>
      <p style={{ fontSize: '0.8rem', color: '#64748b', margin: '0 0 18px' }}>Auto-built from engineers’ submitted timesheets · reviewed by CTO/CEO · signed by the client. Rows are positions, not names.</p>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 18 }}>
        <select style={sel} value={projectId} onChange={e => setProjectId(e.target.value)}>
          <option value="">Select project…</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.project_name || p.id}{p.client_name ? ` — ${p.client_name}` : ''}</option>)}
        </select>
        <select style={sel} value={month} onChange={e => setMonth(Number(e.target.value))}>{MONTHS.map((mn, i) => <option key={mn} value={i + 1}>{mn}</option>)}</select>
        <select style={sel} value={year} onChange={e => setYear(Number(e.target.value))}>{[year - 1, year, year + 1].map(y => <option key={y} value={y}>{y}</option>)}</select>
        {projectId && <button onClick={assemble} disabled={busy} style={primaryBtn(busy)}><RefreshCw size={14} /> {ts ? 'Re-assemble' : 'Assemble from timesheets'}</button>}
        <HolidayManager holidays={holidays} canEdit={canReview || profile?.role_id === 'hr'} onAdd={addHoliday} onRemove={removeHoliday} />
      </div>

      {!projectId ? <Empty>Select a project and month.</Empty>
        : loading ? <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}><Loader size={24} className="spin" /><style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{100%{transform:rotate(360deg)}}`}</style></div>
        : ts === null ? <Empty>No timesheet yet for {project?.project_name} · {MONTHS[month - 1]} {year}. Click <b>Assemble from timesheets</b> to build it from engineers’ submissions.</Empty>
        : ts ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
              <span style={{ padding: '4px 12px', borderRadius: 999, fontSize: '0.74rem', fontWeight: 700, background: NAVY, color: '#fff' }}>{STATE_LABEL[ts.state] || ts.state}</span>
              <span style={{ fontSize: '0.78rem', color: '#64748b' }}>{ts.period_label} · PO {ts.po_number || '—'} · {ts.client_name || '—'}</span>
            </div>

            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 10, fontSize: '0.74rem', color: '#475569' }}>
              {Object.entries(STATUS).map(([k, s]) => <span key={k}><i style={{ display: 'inline-block', width: 12, height: 12, background: s.color, borderRadius: 3, marginRight: 5, verticalAlign: -2 }} />{s.label}</span>)}
              <span><i style={{ display: 'inline-block', width: 12, height: 12, background: GREY, borderRadius: 3, marginRight: 5, verticalAlign: -2 }} />Weekend / Holiday</span>
            </div>

            <div style={{ ...cardStyle, padding: 0, overflowX: 'auto' }}>
              {rows.length === 0 ? <div style={{ padding: 24, color: '#94a3b8', textAlign: 'center' }}>No approved engineer timesheets for this period yet.</div> : (
                <table style={{ borderCollapse: 'collapse', fontSize: '0.72rem', width: '100%' }}>
                  <thead><tr style={{ background: NAVY, color: '#fff' }}>
                    <th style={{ padding: '8px 10px', textAlign: 'left', position: 'sticky', left: 0, background: NAVY, minWidth: 150 }}>{ts.period_label}</th>
                    {Array.from({ length: nDays }, (_, i) => i + 1).map(d => <th key={d} style={{ padding: '6px 0', minWidth: 22, textAlign: 'center', background: blocked(d) ? '#5b6b8c' : NAVY }}>{d}</th>)}
                    <th style={{ padding: '8px 10px', minWidth: 70 }}>Total</th>
                  </tr></thead>
                  <tbody>
                    {rows.map((r, ri) => (
                      <tr key={ri}>
                        <td style={{ padding: '4px 8px', position: 'sticky', left: 0, background: '#fff', borderRight: '1px solid #E5E7EB', fontWeight: 600 }}>{r.role}</td>
                        {Array.from({ length: nDays }, (_, i) => i + 1).map(d => {
                          const v = r.days?.[d]; const bg = blocked(d) ? GREY : (v ? STATUS[v].color : '#fff')
                          return <td key={d} title={blocked(d) ? 'Weekend/Holiday' : (v ? STATUS[v].label : '')} style={{ background: bg, border: '1px solid #E5E7EB', height: 24 }} />
                        })}
                        <td style={{ padding: '4px 8px', textAlign: 'center', fontWeight: 700, borderLeft: '1px solid #E5E7EB' }}>{rowTotal(r).toFixed(2)}{rowLeave(r) ? <span style={{ color: '#1d4ed8', fontWeight: 400, fontSize: '0.66rem' }}> +{rowLeave(r)}L</span> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Additional billable — billed UNDER a position */}
            <div style={{ ...cardStyle, marginTop: 16 }}>
              <div style={{ fontSize: '0.92rem', fontWeight: 700, color: NAVY, marginBottom: 4 }}>Additional billable items</div>
              <div style={{ fontSize: '0.72rem', color: '#64748b', marginBottom: 10 }}>Client-requested extras (travel, ad-hoc services) — billed <b>under a position</b> (e.g. Data Governance), added at CTO/CEO review. The client signs to these too.</div>
              {extras.length === 0 && <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: 8 }}>None.</div>}
              {extras.map((e, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
                  <select disabled={!canEditExtras} value={e.position || ''} onChange={ev => setExtra(i, 'position', ev.target.value)} style={{ ...sel, padding: '6px 8px' }} title="Position this is billed under">
                    <option value="">Position…</option>
                    {positions.map(pn => <option key={pn} value={pn}>{pn}</option>)}
                  </select>
                  <select disabled={!canEditExtras} value={e.category} onChange={ev => setExtra(i, 'category', ev.target.value)} style={{ ...sel, padding: '6px 8px' }}>
                    {['CLIENT_REQUESTED_SERVICE', 'TRAVEL', 'ADDITIONAL_HOURS', 'OTHER'].map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
                  </select>
                  <input disabled={!canEditExtras} value={e.description} onChange={ev => setExtra(i, 'description', ev.target.value)} placeholder="Description" style={{ ...sel, padding: '6px 8px', flex: 1, minWidth: 160 }} />
                  <input disabled={!canEditExtras} type="number" value={e.qty} onChange={ev => setExtra(i, 'qty', Number(ev.target.value))} style={{ ...sel, padding: '6px 8px', width: 70 }} />
                  <select disabled={!canEditExtras} value={e.unit} onChange={ev => setExtra(i, 'unit', ev.target.value)} style={{ ...sel, padding: '6px 8px' }}><option value="day">day(s)</option><option value="hour">hour(s)</option><option value="item">item(s)</option></select>
                  {canEditExtras && <button onClick={() => removeExtra(i)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#C0392B' }}><Trash2 size={14} /></button>}
                </div>
              ))}
              {canEditExtras && <button onClick={addExtra} style={ghostBtn}><Plus size={13} /> Add billable item</button>}
              {!canReview && <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Only the CTO/CEO can add these (at review).</div>}
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 16, alignItems: 'center' }}>
              {canEditExtras && <button onClick={() => save()} disabled={busy} style={ghostBtn}>Save extras</button>}
              <button onClick={downloadPdf} disabled={busy} style={ghostBtn}><FileDown size={14} /> Download PDF</button>
              {ts.state === 'DRAFT' && <button onClick={submit} disabled={busy} style={primaryBtn(busy)}>Submit for review</button>}
              {ts.state === 'SUBMITTED' && canReview && <button onClick={approve} disabled={busy} style={{ ...primaryBtn(busy), background: '#34BF3A' }}><Check size={14} /> Approve (CTO/CEO)</button>}
              {ts.state === 'SUBMITTED' && !canReview && <span style={{ fontSize: '0.78rem', color: '#64748b' }}>Awaiting CTO/CEO review.</span>}
              {ts.state === 'CTO_APPROVED' && <button onClick={sendToClient} disabled={busy} style={primaryBtn(busy)}>Send to client for signature</button>}
              {ts.state === 'SENT_TO_CLIENT' && <><span style={{ fontSize: '0.78rem', color: '#b45309', fontWeight: 600 }}>Awaiting client signature{ts.sign_sent_to ? ` (${ts.sign_sent_to})` : ''}.</span><button onClick={sendToClient} disabled={busy} style={ghostBtn}>Resend link</button></>}
              {ts.state === 'CLIENT_SIGNED' && <span style={{ fontSize: '0.78rem', color: '#15803d', fontWeight: 700 }}>✓ Signed by {ts.client_signer_name || ts.client_signed_by} — ready to invoice.</span>}
              {msg && <span style={{ fontSize: '0.78rem', color: msg.includes('failed') ? '#C0392B' : '#15803d' }}>{msg}</span>}
            </div>
          </>
        ) : null}
    </div>
  )
}

function HolidayManager({ holidays, canEdit, onAdd, onRemove }) {
  const [open, setOpen] = useState(false); const [d, setD] = useState('')
  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} style={ghostBtn}><CalendarDays size={14} /> Holidays ({holidays.length})</button>
      {open && (
        <div style={{ position: 'absolute', top: '110%', left: 0, zIndex: 50, background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, padding: 12, width: 240, boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: 8 }}>Public holidays</div>
          {canEdit && <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}><input type="date" value={d} onChange={e => setD(e.target.value)} style={{ flex: 1, padding: 6, border: '1px solid #E5E7EB', borderRadius: 6, fontSize: '0.78rem' }} /><button onClick={() => { onAdd(d); setD('') }} style={{ ...ghostBtn, padding: '4px 8px' }}>Add</button></div>}
          {holidays.length === 0 && <div style={{ fontSize: '0.74rem', color: '#94a3b8' }}>None set.</div>}
          {holidays.map(h => <div key={h} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.76rem', padding: '2px 0' }}><span>{h}</span>{canEdit && <button onClick={() => onRemove(h)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#C0392B' }}><Trash2 size={12} /></button>}</div>)}
        </div>
      )}
    </div>
  )
}

const cardStyle = { background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 16 }
const ghostBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, border: '1px solid #E5E7EB', background: '#fff', color: '#022873', fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' }
const primaryBtn = (busy) => ({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 8, border: 'none', background: busy ? '#94a3b8' : '#022873', color: '#fff', fontWeight: 700, fontSize: '0.82rem', cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit' })
function Empty({ children }) { return <div style={{ ...cardStyle, textAlign: 'center', color: '#94a3b8', padding: 40 }}>{children}</div> }
