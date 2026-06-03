import { useEffect, useState, useMemo } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { getPolicyRegistry, deriveAcknowledgmentStatus } from '../../lib/policies'
import OnboardingDetailModal from '../../components/OnboardingDetailModal'
import { ShieldCheck, Search, Download, Loader, CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react'

// Policy Acknowledgment Register — per-employee Pending/Completed, derived from
// each employee's onboarding_evidence rows vs the CURRENT policy registry
// versions (same derivation the timesheet gate uses; no separate status flag).
// Used to sweep existing DLSA employees through a one-time acknowledgment
// campaign and track it to completion. A policy version bump re-flags everyone.

export default function HRAcknowledgments() {
  const [rows, setRows] = useState([])
  const [registry, setRegistry] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState('all') // all | pending | completed
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)

  const load = async () => {
    setLoading(true); setError('')
    try {
      const reg = await getPolicyRegistry()
      setRegistry(reg)
      const empSnap = await getDocs(collection(db, 'employees'))
      const employees = empSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      // Pull each employee's acknowledgment evidence and derive status.
      const out = await Promise.all(employees.map(async (e) => {
        let evidence = []
        try {
          const evSnap = await getDocs(collection(db, 'employees', e.id, 'onboarding_evidence'))
          evidence = evSnap.docs.map(d => d.data())
        } catch { evidence = [] }
        const { complete, missing } = deriveAcknowledgmentStatus(evidence, reg)
        const granted = evidence
          .map(r => r.granted_at || r.acknowledged_at)
          .filter(Boolean)
          .map(t => (t.toDate ? t.toDate() : new Date(t)))
          .sort((a, b) => b - a)[0] || null
        return {
          id: e.id,
          name: e.full_name || e.name || e.id,
          employee_id: e.employee_id || e.id,
          email: e.email || '',
          job_title: e.job_title || e.title || '',
          status: complete ? 'completed' : 'pending',
          missing,
          last_granted_at: granted,
          _raw: e,
        }
      }))
      out.sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'pending' ? -1 : 1))
      setRows(out)
    } catch (e) {
      setError(e.message || 'Could not load the acknowledgment register.')
    } finally {
      setLoading(false)
    }
  }

  // Defer into a microtask so the initial setState isn't synchronous-in-effect.
  useEffect(() => { Promise.resolve().then(load) }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r =>
      (statusFilter === 'all' || r.status === statusFilter) &&
      (!q || r.name.toLowerCase().includes(q) || String(r.employee_id).toLowerCase().includes(q) || r.email.toLowerCase().includes(q))
    )
  }, [rows, statusFilter, search])

  const completedCount = rows.filter(r => r.status === 'completed').length

  const exportCsv = () => {
    const header = ['employee_id', 'name', 'email', 'status', 'missing_policies', 'last_granted_at']
    const lines = rows.map(r => [
      r.employee_id, r.name, r.email, r.status,
      r.missing.map(m => `${m.id}@v${m.version}`).join('; '),
      r.last_granted_at ? r.last_granted_at.toISOString() : '',
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `acknowledgment_register_${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
  }

  const currentVersions = registry.map(p => `${p.id} v${p.version}`).join(' · ')

  return (
    <div style={{ padding: '8px 4px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '1.4rem', fontWeight: 800, color: '#fff', margin: 0 }}>
            <ShieldCheck size={22} color="#1598CC" /> Policy Acknowledgment Register
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: '0.84rem', marginTop: 6, maxWidth: 760 }}>
            Tracks which employees have acknowledged the <strong>current versions</strong> of all onboarding policies
            (Policy Acknowledgment & Privacy Notice Receipt). A version bump re-flags everyone. Current: {currentVersions || '—'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load} disabled={loading} className="btn-action" style={{ background: 'rgba(255,255,255,0.06)', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' }}>
            <RefreshCw size={13} className={loading ? 'spin' : ''} /> Refresh
          </button>
          <button onClick={exportCsv} disabled={loading || !rows.length} className="btn-action" style={{ background: '#1598CC', color: '#fff', border: 'none' }}>
            <Download size={13} /> Export CSV
          </button>
        </div>
      </div>

      {/* Completion summary */}
      {!loading && !error && rows.length > 0 && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
          <div style={{ background: 'rgba(52,191,58,0.10)', border: '1px solid rgba(52,191,58,0.3)', borderRadius: 10, padding: '12px 18px' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#34BF3A' }}>{completedCount} / {rows.length}</div>
            <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.6)' }}>acknowledged (current versions)</div>
          </div>
          <div style={{ background: 'rgba(243,156,18,0.10)', border: '1px solid rgba(243,156,18,0.3)', borderRadius: 10, padding: '12px 18px' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#F39C12' }}>{rows.length - completedCount}</div>
            <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.6)' }}>pending — sweep to completion</div>
          </div>
        </div>
      )}

      {/* Controls */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: 360 }}>
          <Search size={14} color="rgba(255,255,255,0.4)" style={{ position: 'absolute', left: 12, top: 11 }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name / ID / email"
            style={{ width: '100%', padding: '9px 12px 9px 34px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, color: '#fff', fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box' }} />
        </div>
        {['all', 'pending', 'completed'].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid ' + (statusFilter === s ? '#1598CC' : 'rgba(255,255,255,0.15)'), background: statusFilter === s ? 'rgba(21,152,204,0.18)' : 'transparent', color: statusFilter === s ? '#7dd3fc' : 'rgba(255,255,255,0.7)', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize', fontFamily: 'inherit' }}>
            {s}
          </button>
        ))}
      </div>

      {loading && (
        <div style={{ padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.6)' }}>
          <Loader size={26} className="spin" style={{ color: '#1598CC' }} />
          <div style={{ marginTop: 10 }}>Loading register…</div>
        </div>
      )}
      {error && !loading && (
        <div style={{ padding: '14px 18px', borderRadius: 8, background: 'rgba(192,57,43,0.12)', border: '1px solid rgba(192,57,43,0.3)', color: '#fca5a5' }}>
          {error} <button onClick={load} style={{ marginLeft: 8, color: '#7dd3fc', background: 'none', border: 'none', cursor: 'pointer' }}>Retry</button>
        </div>
      )}
      {!loading && !error && filtered.length === 0 && (
        <div style={{ padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.5)' }}>No employees match this filter.</div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'rgba(255,255,255,0.5)', fontSize: '0.74rem', textTransform: 'uppercase' }}>
                <th style={{ padding: '10px 12px' }}>Employee</th>
                <th style={{ padding: '10px 12px' }}>Status</th>
                <th style={{ padding: '10px 12px' }}>Outstanding policies</th>
                <th style={{ padding: '10px 12px' }}>Last acknowledged</th>
                <th style={{ padding: '10px 12px' }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id} style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                  <td style={{ padding: '12px' }}>
                    <div style={{ color: '#fff', fontWeight: 600 }}>{r.name}</div>
                    <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.76rem', fontFamily: 'monospace' }}>{r.employee_id} · {r.email}</div>
                  </td>
                  <td style={{ padding: '12px' }}>
                    {r.status === 'completed' ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#34BF3A', background: 'rgba(52,191,58,0.12)', border: '1px solid rgba(52,191,58,0.3)', padding: '3px 9px', borderRadius: 20, fontSize: '0.76rem', fontWeight: 700 }}>
                        <CheckCircle2 size={12} /> Completed
                      </span>
                    ) : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#F39C12', background: 'rgba(243,156,18,0.12)', border: '1px solid rgba(243,156,18,0.3)', padding: '3px 9px', borderRadius: 20, fontSize: '0.76rem', fontWeight: 700 }}>
                        <AlertTriangle size={12} /> Pending
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '12px', color: 'rgba(255,255,255,0.7)', fontSize: '0.8rem' }}>
                    {r.missing.length === 0 ? '—' : r.missing.map(m => `${m.title} (v${m.version})`).join(', ')}
                  </td>
                  <td style={{ padding: '12px', color: 'rgba(255,255,255,0.6)', fontSize: '0.8rem' }}>
                    {r.last_granted_at ? r.last_granted_at.toLocaleDateString() : '—'}
                  </td>
                  <td style={{ padding: '12px', textAlign: 'right' }}>
                    <button onClick={() => setSelected(r._raw)} style={{ background: 'rgba(21,152,204,0.1)', color: '#1598CC', border: '1px solid rgba(21,152,204,0.3)', padding: '5px 10px', borderRadius: 7, cursor: 'pointer', fontSize: '0.76rem', fontFamily: 'inherit' }}>
                      View / Receipt
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && <OnboardingDetailModal employee={selected} onClose={() => setSelected(null)} />}
      <style>{`.spin { animation: spin 1s linear infinite; } @keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
