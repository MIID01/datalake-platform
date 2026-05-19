import { useState, useEffect } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { FileText, Shield, Eye, ExternalLink } from 'lucide-react'

const statusColors = { Active: 'badge-success', Expiring: 'badge-critical', Expired: 'badge-neutral', Terminated: 'badge-neutral' }
const riskColors = { Low: 'badge-success', Medium: 'badge-warning', High: 'badge-critical' }
const typeIcons = { Employment: '👤', 'Client SLA': '🏢', NDA: '🔒', Vendor: '🔧' }

export default function Contracts() {
  const [contractsData, setContractsData] = useState([])
  const [filter, setFilter] = useState('All')

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'contracts'), snap => {
      setContractsData(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })
    return () => unsub()
  }, [])

  const filtered = filter === 'All' ? contractsData : contractsData.filter(c => c.type === filter)

  // Gantt timeline data
  const timelineContracts = contractsData.filter(c => c.status !== 'Expired')

  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 24 }}>Contracts</h1>

      {/* Contract Registry */}
      <div className="card animate-fade-in-up" style={{ padding: 0, overflow: 'hidden', marginBottom: 28 }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>Contract Registry</h3>
          <div style={{ display: 'flex', gap: 6 }}>
            {['All', 'Employment', 'Client SLA', 'NDA', 'Vendor'].map(f => (
              <button key={f} className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFilter(f)}>{f}</button>
            ))}
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr><th>ID</th><th>Type</th><th>Party</th><th>Start</th><th>End</th><th>Value</th><th>Status</th><th>Risk</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id}>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>{c.id}</td>
                  <td><span>{typeIcons[c.type]} {c.type}</span></td>
                  <td style={{ fontWeight: 600 }}>{c.party}</td>
                  <td>{new Date(c.start).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</td>
                  <td>{new Date(c.end).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</td>
                  <td>{c.value > 0 ? `SAR ${c.value.toLocaleString()}` : '—'}</td>
                  <td><span className={`badge ${statusColors[c.status]}`}>{c.status}</span></td>
                  <td><span className={`badge ${riskColors[c.risk]}`}>{c.risk}</span></td>
                  <td><button className="btn btn-ghost btn-sm"><Eye size={14} /> View</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Expiry Timeline (Gantt-style) */}
      <div className="card animate-fade-in-up" style={{ marginBottom: 28 }}>
        <div className="card-header">
          <h3>Contract Expiry Timeline</h3>
          <span className="badge badge-critical">{contractsData.filter(c => c.status === 'Expiring').length} expiring</span>
        </div>
        <div style={{ position: 'relative', padding: '16px 0' }}>
          {timelineContracts.map((c, i) => {
            const start = new Date(c.start).getTime()
            const end = new Date(c.end).getTime()
            const now = Date.now()
            const minDate = new Date('2025-01-01').getTime()
            const maxDate = new Date('2027-12-31').getTime()
            const range = maxDate - minDate
            const leftPercent = ((start - minDate) / range) * 100
            const widthPercent = ((end - start) / range) * 100
            const isExpiring = c.status === 'Expiring'

            return (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', marginBottom: 8, gap: 12 }}>
                <div style={{ width: 140, fontSize: '0.8rem', fontWeight: 600, flexShrink: 0, textAlign: 'right', color: 'var(--text-secondary)' }}>
                  {c.party}
                </div>
                <div style={{ flex: 1, background: 'var(--bg-surface)', borderRadius: 6, height: 24, position: 'relative', overflow: 'hidden' }}>
                  <div style={{
                    position: 'absolute',
                    left: `${leftPercent}%`,
                    width: `${widthPercent}%`,
                    height: '100%',
                    background: isExpiring
                      ? 'linear-gradient(90deg, var(--amber), var(--red))'
                      : `linear-gradient(90deg, var(--sky-blue, var(--steel-blue)), var(--sky-blue-light, var(--steel-blue-light)))`,
                    borderRadius: 6,
                    border: isExpiring ? '1px solid var(--red)' : 'none',
                    opacity: c.status === 'Expired' ? 0.3 : 0.8,
                  }} />
                </div>
                <span className={`badge ${statusColors[c.status]}`} style={{ width: 80, textAlign: 'center', flexShrink: 0 }}>{c.status}</span>
              </div>
            )
          })}
          {/* Timeline axis */}
          <div style={{ display: 'flex', marginTop: 12, paddingLeft: 152, color: 'var(--text-tertiary)', fontSize: '0.68rem' }}>
            {['Jan 25', 'Jul 25', 'Jan 26', 'Jul 26', 'Jan 27', 'Jul 27'].map(label => (
              <span key={label} style={{ flex: 1 }}>{label}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Proposal Audit Trail */}
      <div className="card animate-fade-in-up" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-primary)' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>Proposal Audit Trail</h3>
        </div>
        <table className="data-table">
          <thead><tr><th>Proposal</th><th>Client</th><th>Upload Date</th><th>Risk Level</th><th>AI Flags</th><th>Action</th><th>Reasoning</th></tr></thead>
          <tbody>
            <tr>
              <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>PROP-2026-018</td>
              <td style={{ fontWeight: 600 }}>NEOM</td>
              <td>Apr 18, 2026</td>
              <td><span className="badge badge-critical">HIGH</span></td>
              <td><span className="badge badge-warning">Missing SAMA clause</span></td>
              <td><span className="badge badge-critical">BLOCKED</span></td>
              <td style={{ fontSize: '0.8rem', maxWidth: 200 }}>Proposal missing mandatory SAMA audit rights clause (Section 4.2.1)</td>
            </tr>
            <tr>
              <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>PROP-2026-017</td>
              <td style={{ fontWeight: 600 }}>Emkan</td>
              <td>Apr 12, 2026</td>
              <td><span className="badge badge-success">LOW</span></td>
              <td><span className="badge badge-success">No flags</span></td>
              <td><span className="badge badge-success">APPROVED</span></td>
              <td style={{ fontSize: '0.8rem', maxWidth: 200 }}>All compliance clauses present. Standard engagement terms.</td>
            </tr>
            <tr>
              <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>PROP-2026-015</td>
              <td style={{ fontWeight: 600 }}>MOH</td>
              <td>Apr 5, 2026</td>
              <td><span className="badge badge-warning">MEDIUM</span></td>
              <td><span className="badge badge-warning">Short SLA terms</span></td>
              <td><span className="badge badge-info">APPROVED w/ WARNINGS</span></td>
              <td style={{ fontSize: '0.8rem', maxWidth: 200 }}>SLA response times are aggressive. CEO approved with override note.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
