import { useEffect, useMemo, useState, useCallback } from 'react'
import { collection, onSnapshot, doc, getDoc, setDoc, updateDoc, serverTimestamp, query, where, getDocs } from 'firebase/firestore'
import { auth, db, GENERATE_PDF_URL } from '../../lib/firebase'
import { useAccessProfile } from '../../hooks/useAccessProfile'
import { Calendar, Plus, Trash2, Save, Loader, Check, CalendarDays, FileDown } from 'lucide-react'

// Client project timesheet — the in-platform replacement for the Emkan Excel grid
// (DTLK-HR-TS-002). Rows = roles, cols = days. Canonical store: project_timesheets.
// Compiled by CRM/HR → CTO/CEO review (adds LABELED additional-billable, never
// disguised attendance) → client-signs. Reads roles from engineer_project_assignments,
// client logo/name from clients, weekends auto, holidays from crm_config/holidays.
const NAVY = '#022873'
const STATUS = {
  INHOUSE: { label: 'In house', color: '#C6EFCE' },
  REMOTE:  { label: 'Remote',   color: '#FFCCCC' },
  LEAVE:   { label: 'Leave',    color: '#BDD7EE' },
}
const CYCLE = ['', 'INHOUSE', 'REMOTE', 'LEAVE']
const GREY = '#D9D9D9'
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const STATE_LABEL = { DRAFT: 'Draft', SUBMITTED: 'Submitted', CTO_APPROVED: 'Internally approved', CLIENT_SIGNED: 'Client signed', INVOICED: 'Invoiced' }
const daysInMonth = (y, m) => new Date(y, m, 0).getDate() // m = 1-based
const pad2 = (n) => String(n).padStart(2, '0')
const isWeekend = (y, m, d) => { const wd = new Date(y, m - 1, d).getDay(); return wd === 5 || wd === 6 } // Fri/Sat

export default function CRMProjectTimesheets() {
  const { profile } = useAccessProfile()
  const canReview = ['ceo', 'cto'].includes(profile?.role_id)
  const me = auth.currentUser?.email || ''
  const now = new Date()

  const [projects, setProjects] = useState([])
  const [projectId, setProjectId] = useState('')
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [ts, setTs] = useState(undefined) // undefined=not loaded, null=doesn't exist, object=loaded
  const [rows, setRows] = useState([])
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
  const canEdit = ts && ['DRAFT', 'SUBMITTED'].includes(ts.state) // grid editable until internally approved

  // Projects + holidays
  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'projects'),
      s => setProjects(s.docs.map(d => ({ id: d.id, ...d.data() }))), e => console.warn('projects:', e.message))
    const u2 = onSnapshot(doc(db, 'crm_config', 'holidays'),
      s => setHolidays(s.exists() ? (s.data().dates || []) : []), () => {})
    return () => { u1(); u2() }
  }, [])

  // Load the timesheet doc when project/period changes
  useEffect(() => {
    if (!docId) { setTs(undefined); return }
    setLoading(true); setMsg('')
    getDoc(doc(db, 'project_timesheets', docId)).then(snap => {
      if (snap.exists()) {
        const d = snap.data()
        setTs(d); setRows(d.rows || []); setExtras(d.additional_billable || [])
      } else { setTs(null); setRows([]); setExtras([]) }
      setLoading(false)
    }).catch(e => { setMsg(e.message); setLoading(false) })
  }, [docId])

  const create = async () => {
    if (!project) return
    setBusy(true); setMsg('')
    try {
      // Seed rows from the project's active assignments (best-effort; roles are editable).
      let seeded = []
      try {
        const qs = await getDocs(query(collection(db, 'engineer_project_assignments'), where('project_id', '==', projectId)))
        seeded = qs.docs.map(d => d.data())
          .filter(a => !a.state || String(a.state).toUpperCase().includes('ACTIVE'))
          .map(a => ({ role: a.role || a.role_title || a.position || a.engineer_name || 'Role', engineer_id: a.engineer_id || a.uid || '', engineer_name: a.engineer_name || a.engineer_email || '', days: {} }))
      } catch { /* assignments optional */ }
      if (!seeded.length) seeded = [{ role: 'Role 1', engineer_id: '', engineer_name: '', days: {} }]
      const payload = {
        project_id: projectId, client_id: project.client_id || project.clientId || '',
        project_name: project.project_name || '', client_name: project.client_name || '',
        po_number: project.po_number || '', year, month, period_label: `${MONTHS[month - 1]} ${year}`,
        rows: seeded, additional_billable: [], state: 'DRAFT',
        created_by: me, created_at: serverTimestamp(), updated_at: serverTimestamp(), updated_by: me,
      }
      await setDoc(doc(db, 'project_timesheets', docId), payload)
      setTs(payload); setRows(seeded); setExtras([])
      setMsg('Timesheet created.')
    } catch (e) { setMsg('Create failed: ' + e.message) } finally { setBusy(false) }
  }

  const cycleCell = (ri, d) => {
    if (!canEdit || blocked(d)) return
    setRows(rs => rs.map((r, i) => {
      if (i !== ri) return r
      const cur = r.days?.[d] || ''
      const next = CYCLE[(CYCLE.indexOf(cur) + 1) % CYCLE.length]
      const days = { ...(r.days || {}) }
      if (next) days[d] = next; else delete days[d]
      return { ...r, days }
    }))
  }
  const rowTotal = (r) => Object.entries(r.days || {}).filter(([d, v]) => (v === 'INHOUSE' || v === 'REMOTE') && !blocked(Number(d))).length
  const rowLeave = (r) => Object.values(r.days || {}).filter(v => v === 'LEAVE').length

  const addRow = () => setRows(rs => [...rs, { role: `Role ${rs.length + 1}`, engineer_id: '', engineer_name: '', days: {} }])
  const removeRow = (ri) => setRows(rs => rs.filter((_, i) => i !== ri))
  const setRole = (ri, v) => setRows(rs => rs.map((r, i) => i === ri ? { ...r, role: v } : r))

  const addExtra = () => setExtras(x => [...x, { description: '', category: 'TRAVEL', qty: 1, unit: 'day', added_by: me, reason: '' }])
  const setExtra = (i, f, v) => setExtras(x => x.map((e, j) => j === i ? { ...e, [f]: v } : e))
  const removeExtra = (i) => setExtras(x => x.filter((_, j) => j !== i))

  const save = async (extra = {}) => {
    setBusy(true); setMsg('')
    try {
      await updateDoc(doc(db, 'project_timesheets', docId), {
        rows, additional_billable: extras, updated_at: serverTimestamp(), updated_by: me, ...extra,
      })
      setTs(t => ({ ...t, rows, additional_billable: extras, ...extra }))
      setMsg('Saved.')
    } catch (e) { setMsg('Save failed: ' + e.message) } finally { setBusy(false) }
  }
  const submit = () => save({ state: 'SUBMITTED', submitted_by: me, submitted_at: serverTimestamp() })
  const approve = () => save({ state: 'CTO_APPROVED', cto_approved_by: me, cto_approved_at: serverTimestamp() })

  const downloadPdf = async () => {
    setBusy(true); setMsg('')
    try {
      const token = await auth.currentUser.getIdToken()
      const res = await fetch(GENERATE_PDF_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ template: 'project_timesheet', docId }),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `Failed (${res.status})`) }
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a'); a.href = url; a.download = `timesheet-${docId}.pdf`; a.click(); URL.revokeObjectURL(url)
    } catch (e) { setMsg('PDF failed: ' + e.message) } finally { setBusy(false) }
  }

  const addHoliday = async (date) => {
    if (!date) return
    const next = [...new Set([...holidays, date])].sort()
    try { await setDoc(doc(db, 'crm_config', 'holidays'), { dates: next, updated_at: serverTimestamp(), updated_by: me }, { merge: true }) }
    catch (e) { alert('Holiday save failed: ' + e.message) }
  }
  const removeHoliday = async (date) => {
    const next = holidays.filter(h => h !== date)
    try { await setDoc(doc(db, 'crm_config', 'holidays'), { dates: next }, { merge: true }) } catch (e) { alert(e.message) }
  }

  const sel = { padding: '8px 10px', borderRadius: 8, border: '1px solid #E5E7EB', fontSize: '0.86rem', fontFamily: 'inherit', background: '#fff' }

  return (
    <div style={{ padding: '24px', fontFamily: "'DM Sans', sans-serif" }}>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: NAVY, display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 4px' }}>
        <Calendar size={20} color="#1598CC" /> Project Timesheets
      </h1>
      <p style={{ fontSize: '0.8rem', color: '#64748b', margin: '0 0 18px' }}>Monthly client timesheet — reviewed by CTO/CEO before the client signs.</p>

      {/* Pickers */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 18 }}>
        <select style={sel} value={projectId} onChange={e => setProjectId(e.target.value)}>
          <option value="">Select project…</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.project_name || p.id}{p.client_name ? ` — ${p.client_name}` : ''}</option>)}
        </select>
        <select style={sel} value={month} onChange={e => setMonth(Number(e.target.value))}>
          {MONTHS.map((mn, i) => <option key={mn} value={i + 1}>{mn}</option>)}
        </select>
        <select style={sel} value={year} onChange={e => setYear(Number(e.target.value))}>
          {[year - 1, year, year + 1, now.getFullYear(), now.getFullYear() + 1].filter((v, i, a) => a.indexOf(v) === i).sort().map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <HolidayManager holidays={holidays} canEdit={canReview || profile?.role_id === 'hr'} onAdd={addHoliday} onRemove={removeHoliday} />
      </div>

      {!projectId ? (
        <Empty>Select a project and month to begin.</Empty>
      ) : loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}><Loader size={24} className="spin" /><div>Loading…</div><style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{100%{transform:rotate(360deg)}}`}</style></div>
      ) : ts === null ? (
        <div style={{ ...cardStyle, textAlign: 'center', padding: 40 }}>
          <div style={{ color: '#64748b', marginBottom: 14 }}>No timesheet for <b>{project?.project_name}</b> · {MONTHS[month - 1]} {year} yet.</div>
          <button onClick={create} disabled={busy} style={primaryBtn(busy)}>{busy ? 'Creating…' : 'Create timesheet'}</button>
        </div>
      ) : ts ? (
        <>
          {/* Status bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <span style={{ padding: '4px 12px', borderRadius: 999, fontSize: '0.74rem', fontWeight: 700, background: '#022873', color: '#fff' }}>{STATE_LABEL[ts.state] || ts.state}</span>
            <span style={{ fontSize: '0.78rem', color: '#64748b' }}>{ts.period_label} · PO {ts.po_number || '—'} · {ts.client_name || '—'}</span>
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 10, fontSize: '0.74rem', color: '#475569' }}>
            {Object.entries(STATUS).map(([k, s]) => <span key={k}><i style={{ display: 'inline-block', width: 12, height: 12, background: s.color, borderRadius: 3, marginRight: 5, verticalAlign: -2 }} />{s.label}</span>)}
            <span><i style={{ display: 'inline-block', width: 12, height: 12, background: GREY, borderRadius: 3, marginRight: 5, verticalAlign: -2 }} />Weekend / Holiday</span>
            {canEdit && <span style={{ color: '#94a3b8' }}>· click a cell to cycle</span>}
          </div>

          {/* Grid */}
          <div style={{ ...cardStyle, padding: 0, overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: '0.72rem', width: '100%' }}>
              <thead>
                <tr style={{ background: NAVY, color: '#fff' }}>
                  <th style={{ padding: '8px 10px', textAlign: 'left', position: 'sticky', left: 0, background: NAVY, minWidth: 150 }}>{MONTHS[month - 1]} {year}</th>
                  {Array.from({ length: nDays }, (_, i) => i + 1).map(d => (
                    <th key={d} style={{ padding: '6px 0', minWidth: 22, textAlign: 'center', background: blocked(d) ? '#5b6b8c' : NAVY }}>{d}</th>
                  ))}
                  <th style={{ padding: '8px 10px', minWidth: 70 }}>Total</th>
                  {canEdit && <th style={{ width: 30 }} />}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, ri) => (
                  <tr key={ri}>
                    <td style={{ padding: '4px 8px', position: 'sticky', left: 0, background: '#fff', borderRight: '1px solid #E5E7EB' }}>
                      {canEdit
                        ? <input value={r.role} onChange={e => setRole(ri, e.target.value)} style={{ width: 140, border: '1px solid #eee', borderRadius: 4, padding: '3px 5px', fontSize: '0.74rem' }} />
                        : <span style={{ fontWeight: 600 }}>{r.role}</span>}
                    </td>
                    {Array.from({ length: nDays }, (_, i) => i + 1).map(d => {
                      const v = r.days?.[d]
                      const bg = blocked(d) ? GREY : (v ? STATUS[v].color : '#fff')
                      return <td key={d} onClick={() => cycleCell(ri, d)} title={blocked(d) ? 'Weekend/Holiday' : (v ? STATUS[v].label : '')} style={{ background: bg, border: '1px solid #E5E7EB', height: 24, cursor: canEdit && !blocked(d) ? 'pointer' : 'default' }} />
                    })}
                    <td style={{ padding: '4px 8px', textAlign: 'center', fontWeight: 700, borderLeft: '1px solid #E5E7EB' }}>
                      {rowTotal(r).toFixed(2)}{rowLeave(r) ? <span style={{ color: '#1d4ed8', fontWeight: 400, fontSize: '0.66rem' }}> +{rowLeave(r)}L</span> : null}
                    </td>
                    {canEdit && <td style={{ textAlign: 'center' }}><button onClick={() => removeRow(ri)} title="Remove role" style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#C0392B' }}><Trash2 size={13} /></button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
            {canEdit && <div style={{ padding: 10 }}><button onClick={addRow} style={ghostBtn}><Plus size={13} /> Add role</button></div>}
          </div>

          {/* Additional billable — CTO/CEO only, labeled, never disguised as attendance */}
          <div style={{ ...cardStyle, marginTop: 16 }}>
            <div style={{ fontSize: '0.92rem', fontWeight: 700, color: NAVY, marginBottom: 4 }}>Additional billable items</div>
            <div style={{ fontSize: '0.72rem', color: '#64748b', marginBottom: 10 }}>Client-requested extras (travel, ad-hoc services) added at CTO/CEO review — kept separate from attendance, recorded with who added it. The client signs to these too.</div>
            {extras.length === 0 && <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: 8 }}>None.</div>}
            {extras.map((e, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
                <select disabled={!canReview} value={e.category} onChange={ev => setExtra(i, 'category', ev.target.value)} style={{ ...sel, padding: '6px 8px' }}>
                  {['TRAVEL', 'CLIENT_REQUESTED_SERVICE', 'ADDITIONAL_HOURS', 'OTHER'].map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
                </select>
                <input disabled={!canReview} value={e.description} onChange={ev => setExtra(i, 'description', ev.target.value)} placeholder="Description" style={{ ...sel, padding: '6px 8px', flex: 1, minWidth: 180 }} />
                <input disabled={!canReview} type="number" value={e.qty} onChange={ev => setExtra(i, 'qty', Number(ev.target.value))} style={{ ...sel, padding: '6px 8px', width: 70 }} />
                <select disabled={!canReview} value={e.unit} onChange={ev => setExtra(i, 'unit', ev.target.value)} style={{ ...sel, padding: '6px 8px' }}>
                  <option value="day">day(s)</option><option value="hour">hour(s)</option><option value="item">item(s)</option>
                </select>
                {canReview && <button onClick={() => removeExtra(i)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#C0392B' }}><Trash2 size={14} /></button>}
              </div>
            ))}
            {canReview && <button onClick={addExtra} style={ghostBtn}><Plus size={13} /> Add billable item</button>}
            {!canReview && <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Only the CTO/CEO can add these (at review).</div>}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 16, alignItems: 'center' }}>
            {canEdit && <button onClick={() => save()} disabled={busy} style={ghostBtn}><Save size={14} /> Save</button>}
            <button onClick={downloadPdf} disabled={busy} style={ghostBtn}><FileDown size={14} /> Download PDF</button>
            {ts.state === 'DRAFT' && canEdit && <button onClick={submit} disabled={busy} style={primaryBtn(busy)}>Submit for review</button>}
            {ts.state === 'SUBMITTED' && canReview && <button onClick={approve} disabled={busy} style={{ ...primaryBtn(busy), background: '#34BF3A' }}><Check size={14} /> Approve (CTO/CEO)</button>}
            {ts.state === 'SUBMITTED' && !canReview && <span style={{ fontSize: '0.78rem', color: '#64748b' }}>Awaiting CTO/CEO review.</span>}
            {ts.state === 'CTO_APPROVED' && <span style={{ fontSize: '0.78rem', color: '#15803d', fontWeight: 600 }}>✓ Internally approved — client sign-off + PDF next.</span>}
            {msg && <span style={{ fontSize: '0.78rem', color: msg.includes('failed') ? '#C0392B' : '#15803d' }}>{msg}</span>}
          </div>
        </>
      ) : null}
    </div>
  )
}

function HolidayManager({ holidays, canEdit, onAdd, onRemove }) {
  const [open, setOpen] = useState(false)
  const [d, setD] = useState('')
  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} style={ghostBtn}><CalendarDays size={14} /> Holidays ({holidays.length})</button>
      {open && (
        <div style={{ position: 'absolute', top: '110%', left: 0, zIndex: 50, background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, padding: 12, width: 240, boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: 8 }}>Public holidays</div>
          {canEdit && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <input type="date" value={d} onChange={e => setD(e.target.value)} style={{ flex: 1, padding: 6, border: '1px solid #E5E7EB', borderRadius: 6, fontSize: '0.78rem' }} />
              <button onClick={() => { onAdd(d); setD('') }} style={{ ...ghostBtn, padding: '4px 8px' }}>Add</button>
            </div>
          )}
          {holidays.length === 0 && <div style={{ fontSize: '0.74rem', color: '#94a3b8' }}>None set.</div>}
          {holidays.map(h => (
            <div key={h} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.76rem', padding: '2px 0' }}>
              <span>{h}</span>{canEdit && <button onClick={() => onRemove(h)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#C0392B' }}><Trash2 size={12} /></button>}
            </div>
          ))}
          {!canEdit && <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: 6 }}>CEO/HR can edit.</div>}
        </div>
      )}
    </div>
  )
}

const cardStyle = { background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 16 }
const ghostBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, border: '1px solid #E5E7EB', background: '#fff', color: '#022873', fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' }
const primaryBtn = (busy) => ({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 8, border: 'none', background: busy ? '#94a3b8' : '#022873', color: '#fff', fontWeight: 700, fontSize: '0.82rem', cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit' })
function Empty({ children }) { return <div style={{ ...cardStyle, textAlign: 'center', color: '#94a3b8', padding: 40 }}>{children}</div> }
