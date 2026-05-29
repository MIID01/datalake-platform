import { useEffect, useMemo, useState } from 'react'
import {
  collection, doc, getDoc, getDocs, query, orderBy, limit,
} from 'firebase/firestore'
import { db } from '../../lib/firebase'
import {
  TrendingUp, DollarSign, Users, ShieldCheck, AlertTriangle, FileText,
  CheckCircle2, XCircle, Calendar, Loader, ChevronDown,
  Briefcase, BarChart3, Inbox,
} from 'lucide-react'

// Backend report shape (functions/reports.js → monthly_reports/{year_month}):
//   { period, generated_at, generated_by,
//     summary: { revenue_total, payroll_total, gross_margin, margin_pct,
//                active_engineers, active_clients, new_hires, departures },
//     compliance: { scan_status, findings_count, critical_count, high_count,
//                   open_capas, overdue_capas, evidence_integrity_pass_rate },
//     hr: { expiring_contracts: [{employee_id, name, end_date, days_remaining}],
//           leave_summary: { total_days_taken, by_type: {...} },
//           pdpl_purged_count },
//     finance: { invoices_sent, invoices_paid, invoices_overdue, po_utilization },
//     ai_agent_activity: { gatekeeper_actions, controller_actions, auditor_actions } }

const SAR = (n) => 'SAR ' + Math.round(Number(n) || 0).toLocaleString()
const PCT = (n) => n == null ? '—' : `${Number(n).toFixed(1)}%`
const NUM = (n) => n == null ? '—' : Number(n).toLocaleString()

function fmtYearMonth(yyyy_mm) {
  if (!yyyy_mm || typeof yyyy_mm !== 'string') return '—'
  const [y, m] = yyyy_mm.split('-')
  const d = new Date(Number(y), Number(m) - 1, 1)
  if (Number.isNaN(d.getTime())) return yyyy_mm
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

function fmtTimestamp(ts) {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

// Build a 12-month list ending with the current month for the dropdown.
// We merge in any period that exists in Firestore in case there's a gap or a
// back-filled historical month.
function buildMonthOptions(existing) {
  const now = new Date()
  const out = []
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    out.push(`${y}-${m}`)
  }
  for (const p of existing) if (!out.includes(p)) out.push(p)
  return out.sort().reverse()
}

const cardBase = {
  background: 'var(--bg-card, #fff)',
  border: '1px solid var(--border-card, #E5E7EB)',
  borderRadius: 12,
  padding: 18,
}

function StatCard({ label, value, sub, color, Icon }) {
  return (
    <div className="stat-card" style={{ ...cardBase, '--stat-accent': color }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, color: 'var(--text-tertiary)', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {Icon && <Icon size={13} />} {label}
      </div>
      <div style={{ fontSize: '1.5rem', fontWeight: 800, color, fontFamily: 'var(--font-heading)' }}>{value}</div>
      {sub && <div style={{ marginTop: 4, fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>{sub}</div>}
    </div>
  )
}

function SectionHeader({ Icon, title, sub }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
      {Icon && <Icon size={18} color="var(--text-secondary)" />}
      <div>
        <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>{title}</h2>
        {sub && <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: 2 }}>{sub}</div>}
      </div>
    </div>
  )
}

export default function MonthlyReports() {
  const [knownPeriods, setKnownPeriods] = useState([])
  const [selected, setSelected] = useState(null)
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notFound, setNotFound] = useState(false)

  // Discover what monthly_reports actually exist. We list the most recent 24 so
  // the dropdown can include historical periods that fell outside the 12-month
  // default window (e.g. a backfilled report from last year).
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const snap = await getDocs(query(
          collection(db, 'monthly_reports'),
          orderBy('generated_at', 'desc'),
          limit(24),
        ))
        if (cancelled) return
        const periods = snap.docs
          .map(d => d.data().period || d.id)
          .filter(Boolean)
        setKnownPeriods(periods)
        // Default to the most recent existing report. If none, fall back to the
        // current calendar month so the user still sees the right empty-state.
        const now = new Date()
        const fallback = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
        setSelected(periods[0] || fallback)
      } catch (e) {
        if (!cancelled) {
          setError(e.message)
          setLoading(false)
        }
      }
    }
    run()
    return () => { cancelled = true }
  }, [])

  // Load the selected period's report doc on demand.
  useEffect(() => {
    if (!selected) return
    let cancelled = false
    const run = async () => {
      setLoading(true); setError(''); setNotFound(false); setReport(null)
      try {
        const snap = await getDoc(doc(db, 'monthly_reports', selected))
        if (cancelled) return
        if (snap.exists()) {
          setReport({ id: snap.id, ...snap.data() })
        } else {
          setNotFound(true)
        }
      } catch (e) {
        if (!cancelled) setError(e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [selected])

  const monthOptions = useMemo(() => buildMonthOptions(knownPeriods), [knownPeriods])

  const summary    = report?.summary    || {}
  const compliance = report?.compliance || {}
  const hr         = report?.hr         || {}
  const finance    = report?.finance    || {}
  const ai         = report?.ai_agent_activity || {}

  const isPass = compliance.scan_status === 'PASS'

  // ─── Render ────────────────────────────────────────────────────
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Monthly Report</h1>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)', marginTop: 4 }}>
            Auto-generated on the 1st of each month by <code style={{ fontFamily: 'var(--font-mono)' }}>generateMonthlyReport</code>.
            Reads <code style={{ fontFamily: 'var(--font-mono)' }}>monthly_reports/{'{year_month}'}</code>.
          </p>
        </div>
        {/* Month selector */}
        <div style={{ position: 'relative', minWidth: 260 }}>
          <Calendar size={14} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--text-tertiary)', pointerEvents: 'none' }} />
          <select
            value={selected || ''}
            onChange={e => setSelected(e.target.value)}
            style={{
              padding: '10px 36px 10px 34px',
              borderRadius: 8,
              border: '1px solid var(--border-primary, #E5E7EB)',
              background: 'var(--bg-card, #fff)',
              fontSize: '0.88rem', fontFamily: 'inherit',
              width: '100%', appearance: 'none', cursor: 'pointer',
            }}
          >
            {monthOptions.map(p => (
              <option key={p} value={p}>
                {fmtYearMonth(p)}{knownPeriods.includes(p) ? '' : ' (no report)'}
              </option>
            ))}
          </select>
          <ChevronDown size={14} style={{ position: 'absolute', right: 12, top: 12, color: 'var(--text-tertiary)', pointerEvents: 'none' }} />
        </div>
      </div>

      {loading && (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>
          <Loader size={22} className="spin" /> <div style={{ marginTop: 8 }}>Loading report…</div>
        </div>
      )}

      {error && !loading && (
        <div style={{ padding: 24, borderRadius: 10, border: '1px solid rgba(192,57,43,0.3)', background: 'rgba(192,57,43,0.08)', color: '#C0392B' }}>
          <AlertTriangle size={16} style={{ verticalAlign: -3, marginRight: 6 }} />
          Could not load report: {error}
        </div>
      )}

      {!loading && !error && notFound && (
        <div style={{ ...cardBase, padding: 36, textAlign: 'center', color: 'var(--text-tertiary)' }}>
          <Inbox size={36} style={{ opacity: 0.4, marginBottom: 10 }} />
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            No report yet for {fmtYearMonth(selected)}
          </div>
          <div style={{ fontSize: '0.82rem', marginTop: 6 }}>
            The monthly cron runs at 00:00 Asia/Riyadh on the 1st of each month and writes
            <code style={{ fontFamily: 'var(--font-mono)', margin: '0 4px' }}>monthly_reports/{selected}</code>.
            If you need this period now, run the publish step manually from the Cloud Functions console.
          </div>
        </div>
      )}

      {!loading && !error && report && (
        <>
          {/* Meta */}
          <div style={{ ...cardBase, padding: '12px 18px', marginBottom: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div style={{ fontSize: '0.85rem' }}>
              <strong>{fmtYearMonth(report.period)}</strong>
              <span style={{ color: 'var(--text-tertiary)', marginLeft: 10 }}>
                Generated {fmtTimestamp(report.generated_at)} by <code style={{ fontFamily: 'var(--font-mono)' }}>{report.generated_by || '—'}</code>
              </span>
            </div>
          </div>

          {/* SUMMARY (revenue + people) */}
          <SectionHeader Icon={BarChart3} title="Summary" sub="Revenue, payroll, and headcount for the period." />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 24 }}>
            <StatCard label="Revenue" value={SAR(summary.revenue_total)} color="#1598CC" Icon={TrendingUp} />
            <StatCard label="Payroll Cost" value={SAR(summary.payroll_total)} color="#EF5829" Icon={DollarSign} />
            <StatCard label="Gross Margin" value={SAR(summary.gross_margin)} sub={`${PCT(summary.margin_pct)} margin`} color={Number(summary.margin_pct) >= 40 ? '#34BF3A' : Number(summary.margin_pct) >= 20 ? '#F39C12' : '#C0392B'} Icon={Briefcase} />
            <StatCard label="Active Engineers" value={NUM(summary.active_engineers)} color="#1598CC" Icon={Users} />
            <StatCard label="Active Clients" value={NUM(summary.active_clients)} color="#1598CC" Icon={Users} />
            <StatCard label="New Hires" value={NUM(summary.new_hires)} sub={`${NUM(summary.departures)} departures`} color="#34BF3A" Icon={Users} />
          </div>

          {/* COMPLIANCE */}
          <SectionHeader Icon={ShieldCheck} title="Compliance" sub="Auditor AI scan results + open CAPAs for the period." />
          <div style={{ ...cardBase, marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              {isPass ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 999, background: 'rgba(52,191,58,0.12)', color: '#34BF3A', fontWeight: 700, fontSize: '0.85rem' }}>
                  <CheckCircle2 size={14} /> Scan passed
                </span>
              ) : (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 999, background: 'rgba(192,57,43,0.12)', color: '#C0392B', fontWeight: 700, fontSize: '0.85rem' }}>
                  <XCircle size={14} /> {NUM(compliance.findings_count)} findings
                </span>
              )}
              {compliance.evidence_integrity_pass_rate != null && (
                <span style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
                  Evidence integrity: {PCT(compliance.evidence_integrity_pass_rate)}
                </span>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
              <StatCard label="Critical" value={NUM(compliance.critical_count)} color="#C0392B" />
              <StatCard label="High"     value={NUM(compliance.high_count)}     color="#F39C12" />
              <StatCard label="Open CAPAs"    value={NUM(compliance.open_capas)}    color="#1598CC" />
              <StatCard label="Overdue CAPAs" value={NUM(compliance.overdue_capas)} color="#C0392B" />
            </div>
          </div>

          {/* HR */}
          <SectionHeader Icon={Users} title="HR" sub="Contracts approaching expiry, leave taken in the period, PDPL deletions." />
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14, marginBottom: 24 }}>
            <div style={cardBase}>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', fontWeight: 600, marginBottom: 10 }}>
                Expiring contracts (next 60 days)
              </div>
              {(hr.expiring_contracts || []).length === 0 ? (
                <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>
                  No contracts expire in the next 60 days.
                </div>
              ) : (
                <table className="data-table">
                  <thead><tr><th>Employee</th><th>End Date</th><th>Days Left</th></tr></thead>
                  <tbody>
                    {(hr.expiring_contracts || []).map((c, i) => (
                      <tr key={c.employee_id || i}>
                        <td style={{ fontWeight: 600 }}>{c.name || c.employee_id}</td>
                        <td>{c.end_date || '—'}</td>
                        <td style={{ color: Number(c.days_remaining) < 30 ? '#C0392B' : Number(c.days_remaining) < 60 ? '#F39C12' : 'var(--text-secondary)', fontWeight: 600 }}>
                          {NUM(c.days_remaining)} days
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <StatCard label="Leave days taken" value={NUM(hr.leave_summary?.total_days_taken)} color="#1598CC" Icon={Calendar} />
              <StatCard label="PDPL records purged" value={NUM(hr.pdpl_purged_count)} color="#9C27B0" Icon={ShieldCheck} />
              {hr.leave_summary?.by_type && Object.keys(hr.leave_summary.by_type).length > 0 && (
                <div style={cardBase}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', fontWeight: 600, marginBottom: 6 }}>By type</div>
                  {Object.entries(hr.leave_summary.by_type).map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', padding: '4px 0' }}>
                      <span style={{ textTransform: 'capitalize' }}>{k}</span>
                      <span style={{ fontWeight: 700 }}>{NUM(v)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* FINANCE */}
          <SectionHeader Icon={DollarSign} title="Finance" sub="Invoice activity for the period + PO utilisation." />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginBottom: 24 }}>
            <StatCard label="Invoices sent"    value={NUM(finance.invoices_sent)}    color="#1598CC" Icon={FileText} />
            <StatCard label="Invoices paid"    value={NUM(finance.invoices_paid)}    color="#34BF3A" Icon={CheckCircle2} />
            <StatCard label="Invoices overdue" value={NUM(finance.invoices_overdue)} color="#C0392B" Icon={AlertTriangle} />
          </div>
          {finance.po_utilization && Object.keys(finance.po_utilization).length > 0 && (
            <div style={{ ...cardBase, marginBottom: 24 }}>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', fontWeight: 600, marginBottom: 10 }}>PO Utilisation</div>
              <table className="data-table">
                <thead><tr><th>PO</th><th>Used / Total</th><th>%</th></tr></thead>
                <tbody>
                  {Object.entries(finance.po_utilization).map(([po, v]) => {
                    const used = Number(v?.used || v?.po_used || 0)
                    const tot  = Number(v?.total || v?.po_value || 0)
                    const pct  = tot > 0 ? (used / tot) * 100 : null
                    return (
                      <tr key={po}>
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>{po}</td>
                        <td>{SAR(used)} / {SAR(tot)}</td>
                        <td>{PCT(pct)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* AI ACTIVITY */}
          {ai && (ai.gatekeeper_actions || ai.controller_actions || ai.auditor_actions) ? (
            <>
              <SectionHeader Icon={Briefcase} title="AI Agent Activity" sub="Actions taken by each AI agent during the period." />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginBottom: 24 }}>
                <StatCard label="Gatekeeper" value={NUM(ai.gatekeeper_actions)} color="#9C27B0" />
                <StatCard label="Controller" value={NUM(ai.controller_actions)} color="#1598CC" />
                <StatCard label="Auditor"    value={NUM(ai.auditor_actions)}    color="#34BF3A" />
              </div>
            </>
          ) : null}
        </>
      )}

      <style>{`
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
