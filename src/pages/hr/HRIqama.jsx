import { useEffect, useMemo, useState } from 'react'
import {
  collection, onSnapshot, doc, getDoc, query, orderBy,
} from 'firebase/firestore'
import { auth, db, ADVANCE_IQAMA_STAGE_URL } from '../../lib/firebase'
import {
  Shield, AlertTriangle, CheckCircle2, Clock, Search, X, Loader,
  ScrollText, AlertCircle, ChevronDown, ChevronRight, Upload, ShieldAlert,
} from 'lucide-react'

// /hr/iqama — Iqama lifecycle workspace.
//
// Lists every active employee whose work_arrangement requires an Iqama
// (in_house / hybrid / remote_ksa by default) joined to their
// iqama_records doc. Color-codes by days-to-expiry. HR can advance the
// workflow stage per row (request → docs → submitted → issued → renew →
// transfer). Each stage advance hits advanceIqamaStage which writes the
// iqama_evidence row server-side.

const STAGES = [
  { id: 'REQUEST_INITIATED',       label: 'Request Iqama' },
  { id: 'DOCUMENTS_COLLECTED',     label: 'Documents collected' },
  { id: 'SUBMITTED_TO_AUTHORITIES',label: 'Submitted to authorities' },
  { id: 'ISSUED',                  label: 'Issued (enter Iqama # + expiry)' },
  { id: 'RENEWAL_INITIATED',       label: 'Initiate renewal' },
  { id: 'RENEWAL_APPROVED',        label: 'Renewal approved' },
  { id: 'TRANSFER_INITIATED',      label: 'Initiate transfer (نقل كفالة)' },
  { id: 'TRANSFER_COMPLETED',      label: 'Transfer completed' },
]

const STATUS_COLOR = {
  NONE:             { color: '#64748b', bg: 'rgba(100,116,139,0.10)', label: 'Not started' },
  IN_PROCESS:       { color: '#1598CC', bg: 'rgba(21,152,204,0.12)',  label: 'In process' },
  ACTIVE:           { color: '#34BF3A', bg: 'rgba(52,191,58,0.12)',   label: 'Active' },
  EXPIRING:         { color: '#F39C12', bg: 'rgba(243,156,18,0.12)',  label: 'Expiring soon' },
  EXPIRED:          { color: '#C0392B', bg: 'rgba(192,57,43,0.12)',   label: 'EXPIRED' },
  TRANSFER_PENDING: { color: '#9C27B0', bg: 'rgba(156,39,176,0.12)',  label: 'Transfer pending' },
}

const REQUIRES_IQAMA_DEFAULT = ['in_house', 'hybrid', 'remote_ksa']

function daysToExpiry(expiry_date) {
  if (!expiry_date) return null
  const d = new Date(expiry_date + 'T00:00:00Z')
  if (isNaN(d.getTime())) return null
  return Math.ceil((d.getTime() - new Date().setUTCHours(0, 0, 0, 0)) / 86400000)
}

function expiryColor(days) {
  if (days == null) return '#64748b'
  if (days < 0) return '#C0392B'
  if (days <= 30) return '#C0392B'
  if (days <= 60) return '#F39C12'
  if (days <= 90) return '#F39C12'
  return '#34BF3A'
}

export default function HRIqama() {
  const [employees, setEmployees] = useState([])
  const [records, setRecords] = useState({})
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [arrangementFilter, setArrangementFilter] = useState('ALL')
  const [openId, setOpenId] = useState(null)
  const [actioning, setActioning] = useState(null)
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    const unsubE = onSnapshot(collection(db, 'employees'),
      snap => { setEmployees(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false) },
      err => { console.warn(err); setLoading(false) })
    const unsubR = onSnapshot(collection(db, 'iqama_records'),
      snap => {
        const m = {}
        snap.docs.forEach(d => { m[d.id] = d.data() })
        setRecords(m)
      })
    ;(async () => {
      try {
        const s = await getDoc(doc(db, 'platform_settings', 'iqama_config'))
        if (s.exists()) setConfig(s.data())
      } catch (_) {}
    })()
    return () => { unsubE(); unsubR() }
  }, [])

  const arrangementsRequiring = config?.arrangements_requiring_iqama || REQUIRES_IQAMA_DEFAULT

  const rows = useMemo(() => {
    return employees
      .filter(e => {
        const status = (e.employment_status || e.status || '').toLowerCase()
        if (status && status !== 'active') return false
        const arr = (e.work_arrangement || 'in_house').toLowerCase()
        const country = (e.work_location_country || 'KSA').toUpperCase()
        // Cross-border review flag is computed below; but for the iqama
        // requirement we treat remote+nonKSA as "no iqama needed".
        const needs = arrangementsRequiring.includes(arr)
          || (arr === 'remote' && country === 'KSA') // remote_ksa shorthand
        if (!needs) return false
        return true
      })
      .map(e => {
        const r = records[e.employee_id] || records[e.id] || null
        const days = daysToExpiry(r?.expiry_date)
        const status = r?.status || 'NONE'
        return {
          ...e,
          iqama_record: r,
          days_to_expiry: days,
          iqama_status: status,
          cross_border_risk: (e.work_arrangement === 'remote')
            && (String(e.work_location_country || 'KSA').toUpperCase() !== 'KSA'),
        }
      })
      .filter(r => {
        if (statusFilter !== 'ALL' && r.iqama_status !== statusFilter) return false
        if (arrangementFilter !== 'ALL' && (r.work_arrangement || 'in_house') !== arrangementFilter) return false
        if (!search.trim()) return true
        const q = search.trim().toLowerCase()
        return [r.full_name, r.employee_id, r.email, r.iqama_record?.iqama_number, r.nationality]
          .filter(Boolean).some(v => String(v).toLowerCase().includes(q))
      })
      .sort((a, b) => {
        // EXPIRED first, then expiring soon, then NONE, then ACTIVE
        const rank = { EXPIRED: 0, EXPIRING: 1, NONE: 2, IN_PROCESS: 3, TRANSFER_PENDING: 4, ACTIVE: 5 }
        return (rank[a.iqama_status] ?? 9) - (rank[b.iqama_status] ?? 9)
      })
  }, [employees, records, search, statusFilter, arrangementFilter, arrangementsRequiring])

  const counts = useMemo(() => {
    const c = { total: rows.length, active: 0, expiring: 0, expired: 0, none: 0, in_process: 0 }
    rows.forEach(r => {
      if (r.iqama_status === 'ACTIVE') c.active++
      else if (r.iqama_status === 'EXPIRING') c.expiring++
      else if (r.iqama_status === 'EXPIRED') c.expired++
      else if (r.iqama_status === 'NONE') c.none++
      else if (r.iqama_status === 'IN_PROCESS' || r.iqama_status === 'TRANSFER_PENDING') c.in_process++
    })
    return c
  }, [rows])

  const advance = async (employeeId, stage, payload, notes) => {
    setActioning(employeeId + ':' + stage)
    setActionError('')
    try {
      const me = auth.currentUser
      const idToken = await me.getIdToken()
      const res = await fetch(ADVANCE_IQAMA_STAGE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
        body: JSON.stringify({ employee_id: employeeId, stage, payload: payload || {}, notes: notes || null }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Stage advance failed (${res.status})`)
    } catch (err) {
      setActionError(`${employeeId} — ${err.message}`)
    } finally {
      setActioning(null)
    }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Loading Iqama records…</div>

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Shield size={22} color="#022873" /> Iqama Lifecycle
        </h1>
        <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', marginTop: 4 }}>
          Every employee whose work_arrangement requires an Iqama. Expired Iqamas are an employer-liability — act on red rows first.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
        <Stat label="Tracked" value={counts.total} />
        <Stat label="Active" value={counts.active} color="#34BF3A" />
        <Stat label="Expiring" value={counts.expiring} color="#F39C12" />
        <Stat label="Expired" value={counts.expired} color="#C0392B" />
        <Stat label="In process" value={counts.in_process} color="#1598CC" />
        <Stat label="Not started" value={counts.none} color="#64748b" />
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 240 }}>
          <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, ID, email, Iqama #, nationality…"
            style={{ width: '100%', padding: '10px 36px 10px 36px', borderRadius: 8, border: '1px solid var(--border-primary, #E5E7EB)', background: 'var(--bg-surface, #fff)', color: 'var(--text-primary)', fontSize: '0.86rem', fontFamily: 'inherit', boxSizing: 'border-box' }}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', display: 'flex' }}><X size={14} /></button>
          )}
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={selectStyle()}>
          <option value="ALL">All statuses</option>
          <option value="EXPIRED">Expired</option>
          <option value="EXPIRING">Expiring</option>
          <option value="ACTIVE">Active</option>
          <option value="IN_PROCESS">In process</option>
          <option value="TRANSFER_PENDING">Transfer pending</option>
          <option value="NONE">Not started</option>
        </select>
        <select value={arrangementFilter} onChange={e => setArrangementFilter(e.target.value)} style={selectStyle()}>
          <option value="ALL">All arrangements</option>
          <option value="in_house">In-house</option>
          <option value="hybrid">Hybrid</option>
          <option value="remote_ksa">Remote (KSA)</option>
          <option value="remote">Remote</option>
        </select>
      </div>

      {actionError && (
        <div style={{ marginBottom: 14, padding: 10, background: 'rgba(192,57,43,0.1)', border: '1px solid rgba(192,57,43,0.3)', borderRadius: 6, color: '#C0392B', fontSize: '0.84rem', display: 'flex', alignItems: 'center', gap: 6 }}>
          <AlertCircle size={14} /> {actionError}
          <button onClick={() => setActionError('')} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', cursor: 'pointer', color: '#C0392B' }}><X size={14} /></button>
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        {rows.length === 0 ? (
          <div style={{ padding: 36, textAlign: 'center', color: 'var(--text-tertiary)' }}>
            No employees match. Once HR sets a work_arrangement on employee records, they will appear here.
          </div>
        ) : (
          <table className="data-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th style={{ width: 32 }}></th>
                <th>Employee</th>
                <th>Arrangement</th>
                <th>Iqama #</th>
                <th>Expiry</th>
                <th>Days</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const isOpen = openId === r.id
                const meta = STATUS_COLOR[r.iqama_status] || STATUS_COLOR.NONE
                const dColor = expiryColor(r.days_to_expiry)
                return (
                  <>
                    <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setOpenId(isOpen ? null : r.id)}>
                      <td>{isOpen ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}</td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{r.full_name || r.id}</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>{r.employee_id} · {r.nationality || '—'}</div>
                      </td>
                      <td>
                        {(r.work_arrangement || 'in_house').replace('_', ' ')}
                        {r.cross_border_risk && (
                          <div style={{ marginTop: 3, fontSize: '0.7rem', color: '#C0392B', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <ShieldAlert size={11} /> cross-border review
                          </div>
                        )}
                      </td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>{r.iqama_record?.iqama_number || '—'}</td>
                      <td>{r.iqama_record?.expiry_date || '—'}</td>
                      <td>
                        {r.days_to_expiry == null ? <span style={{ color: 'var(--text-tertiary)' }}>—</span>
                          : <span style={{ color: dColor, fontWeight: 700 }}>{r.days_to_expiry < 0 ? `${-r.days_to_expiry} overdue` : r.days_to_expiry}</span>}
                      </td>
                      <td><span style={{ ...badgeStyle(meta) }}>{meta.label}</span></td>
                      <td><span style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)' }}>{isOpen ? 'expanded' : 'click to expand'}</span></td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td></td>
                        <td colSpan={7} style={{ background: 'var(--bg-surface, #f8fafc)', padding: 14 }}>
                          <IqamaStageActions
                            row={r}
                            advance={advance}
                            actioning={actioning}
                          />
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function IqamaStageActions({ row, advance, actioning }) {
  const r = row.iqama_record || {}
  const [iqamaNumber, setIqamaNumber] = useState(r.iqama_number || '')
  const [issueDate, setIssueDate] = useState(r.issue_date || '')
  const [expiryDate, setExpiryDate] = useState(r.expiry_date || '')
  const [profession, setProfession] = useState(r.profession_on_iqama || '')
  const [transferTo, setTransferTo] = useState(r.transfer_to_sponsor || '')
  const [notes, setNotes] = useState('')

  const tableRowSpinner = (stage) => actioning === row.id + ':' + stage

  const stages = [
    { id: 'REQUEST_INITIATED', visible: !r.current_stage || r.current_stage === 'NONE' || r.status === 'NONE' },
    { id: 'DOCUMENTS_COLLECTED', visible: ['REQUEST_INITIATED'].includes(r.current_stage) },
    { id: 'SUBMITTED_TO_AUTHORITIES', visible: ['DOCUMENTS_COLLECTED'].includes(r.current_stage) },
    { id: 'ISSUED', visible: ['SUBMITTED_TO_AUTHORITIES','RENEWAL_INITIATED','RENEWAL_APPROVED'].includes(r.current_stage), needsFields: true },
    { id: 'RENEWAL_INITIATED', visible: ['ISSUED'].includes(r.current_stage) },
    { id: 'RENEWAL_APPROVED', visible: ['RENEWAL_INITIATED'].includes(r.current_stage) },
    { id: 'TRANSFER_INITIATED', visible: ['ISSUED','EXPIRING'].includes(r.current_stage) },
    { id: 'TRANSFER_COMPLETED', visible: ['TRANSFER_INITIATED'].includes(r.current_stage) },
  ]

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 14 }}>
        <Detail label="Iqama #" value={r.iqama_number} />
        <Detail label="Issue date" value={r.issue_date} />
        <Detail label="Expiry date" value={r.expiry_date} />
        <Detail label="Profession on Iqama" value={r.profession_on_iqama} />
        <Detail label="Current stage" value={r.current_stage || '—'} />
        <Detail label="Last updated by" value={r.updated_by || '—'} />
      </div>

      {/* Editor for ISSUED stage */}
      <div style={{ background: '#fff', border: '1px solid var(--border-primary, #E5E7EB)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
        <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 8, letterSpacing: '0.05em' }}>Issued / Renewal — Iqama details</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
          <Field label="Iqama number"><input value={iqamaNumber} onChange={e => setIqamaNumber(e.target.value)} style={inp()} placeholder="2123456789" /></Field>
          <Field label="Issue date"><input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} style={inp()} /></Field>
          <Field label="Expiry date"><input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} style={inp()} /></Field>
          <Field label="Profession on Iqama"><input value={profession} onChange={e => setProfession(e.target.value)} style={inp()} /></Field>
        </div>
      </div>

      {/* Transfer editor */}
      <div style={{ background: '#fff', border: '1px solid var(--border-primary, #E5E7EB)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
        <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 8, letterSpacing: '0.05em' }}>Transfer (نقل كفالة)</div>
        <Field label="Transfer to sponsor (CR / name)"><input value={transferTo} onChange={e => setTransferTo(e.target.value)} style={inp()} placeholder="Receiving entity CR or name" /></Field>
      </div>

      <Field label="Notes (logged in evidence row)">
        <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} style={{ ...inp(), resize: 'vertical' }} placeholder="Optional context for the evidence row" />
      </Field>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
        {stages.map(({ id, visible, needsFields }) => {
          const cfg = STAGES.find(s => s.id === id)
          const payload = id === 'ISSUED' ? { iqama_number: iqamaNumber, issue_date: issueDate, expiry_date: expiryDate, profession_on_iqama: profession }
            : (id === 'TRANSFER_INITIATED' || id === 'TRANSFER_COMPLETED') ? { transfer_to_sponsor: transferTo }
            : {}
          const disabled = !visible || tableRowSpinner(id) || (needsFields && (!iqamaNumber || !expiryDate))
          return (
            <button
              key={id}
              disabled={disabled}
              onClick={() => advance(row.employee_id || row.id, id, payload, notes)}
              style={{
                padding: '8px 14px', borderRadius: 6, border: '1px solid #022873',
                background: disabled ? '#94a3b8' : '#022873', color: '#fff',
                fontSize: '0.78rem', fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                display: 'inline-flex', alignItems: 'center', gap: 6, opacity: visible ? 1 : 0.5,
              }}
              title={visible ? '' : 'Not available from current stage'}
            >
              {tableRowSpinner(id) ? <Loader size={12} className="spin" /> : <ScrollText size={12} />}
              {cfg.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Stat({ label, value, color }) {
  return (
    <div style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--bg-surface, #fff)', border: '1px solid var(--border-primary, #E5E7EB)' }}>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: '1.1rem', fontWeight: 700, color: color || 'var(--text-primary)', marginTop: 4 }}>{value}</div>
    </div>
  )
}
function Detail({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)', marginTop: 2 }}>{value || '—'}</div>
    </div>
  )
}
function Field({ label, children }) {
  return (
    <div>
      <label style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  )
}
function inp() {
  return { width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border-primary, #E5E7EB)', background: 'var(--bg-surface, #fff)', color: 'var(--text-primary)', fontSize: '0.86rem', fontFamily: 'inherit', boxSizing: 'border-box' }
}
function selectStyle() {
  return { padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border-primary, #E5E7EB)', background: 'var(--bg-surface, #fff)', color: 'var(--text-primary)', fontSize: '0.86rem', fontFamily: 'inherit' }
}
function badgeStyle(meta) {
  return { display: 'inline-block', padding: '3px 10px', borderRadius: 999, fontSize: '0.72rem', fontWeight: 700, color: meta.color, background: meta.bg }
}
