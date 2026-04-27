// CTO Projects — same view as CEO Projects, but read-only (no create/assign buttons)
import { useState, useMemo, useEffect } from 'react'
import { Briefcase, DollarSign, Users, Clock, ChevronDown, MapPin } from 'lucide-react'
import { collection, onSnapshot, query, orderBy, where } from 'firebase/firestore'
import { db } from '../../lib/firebase'

const STATUS_COLORS = {
  ACTIVE: { label: 'Active', color: '#34BF3A', bg: 'rgba(52,191,58,0.12)' },
  PAUSED: { label: 'Paused', color: '#F39C12', bg: 'rgba(243,156,18,0.12)' },
  COMPLETED: { label: 'Completed', color: '#8898aa', bg: 'rgba(136,152,170,0.12)' },
  CANCELLED: { label: 'Cancelled', color: '#C0392B', bg: 'rgba(192,57,43,0.12)' },
}

function fmtDate(d) { if (!d) return '—'; const dt = d?.toDate ? d.toDate() : new Date(d); return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) }
function fmtSAR(n) { return n ? `SAR ${Number(n).toLocaleString()}` : '—' }

export default function CTOProjects() {
  const [projects, setProjects] = useState([])
  const [assignments, setAssignments] = useState([])
  const [expandedId, setExpandedId] = useState(null)

  useEffect(() => {
    const q = query(collection(db, 'projects'), orderBy('created_at', 'desc'))
    const unsub = onSnapshot(q, snap => setProjects(snap.docs.map(d => ({ id: d.id, ...d.data() }))), err => console.warn(err.message))
    return () => unsub()
  }, [])

  useEffect(() => {
    const q = query(collection(db, 'engineer_project_assignments'), where('status', '==', 'ACTIVE'))
    const unsub = onSnapshot(q, snap => setAssignments(snap.docs.map(d => ({ id: d.id, ...d.data() }))), err => console.warn(err.message))
    return () => unsub()
  }, [])

  const getAssignments = (pid) => assignments.filter(a => a.project_id === pid)

  const stats = useMemo(() => {
    const active = projects.filter(p => p.status === 'ACTIVE')
    return {
      active: active.length,
      totalPO: fmtSAR(active.reduce((s, p) => s + (p.po_value_sar || 0), 0)),
      engineers: new Set(assignments.map(a => a.engineer_id)).size,
    }
  }, [projects, assignments])

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Projects</h1>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: 4 }}>Full visibility — all engagements, assignments, and PO data (read-only)</p>
      </div>

      <div className="grid-4" style={{ marginBottom: 24 }}>
        {[
          { value: stats.active, label: 'Active Projects', color: '#1598CC', icon: Briefcase },
          { value: stats.totalPO, label: 'Total PO Value', color: '#022873', icon: DollarSign },
          { value: stats.engineers, label: 'Engineers Deployed', color: '#34BF3A', icon: Users },
        ].map((s, i) => {
          const Icon = s.icon
          return (
            <div key={i} className="stat-card animate-fade-in-up" style={{ '--stat-accent': s.color, animationDelay: `${i * 0.05}s` }}>
              <div className="stat-label"><Icon size={14} style={{ verticalAlign: -2, marginRight: 4 }} />{s.label}</div>
              <div className="stat-value" style={{ color: s.color, fontSize: typeof s.value === 'string' ? '1.1rem' : undefined }}>{s.value}</div>
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {projects.length === 0 && (
          <div className="card" style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--text-tertiary)' }}>
            <Briefcase size={40} style={{ marginBottom: 12, opacity: 0.3 }} />
            <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>No projects yet</div>
          </div>
        )}
        {projects.map((p, i) => {
          const isExpanded = expandedId === p.project_id
          const pA = getAssignments(p.project_id)
          const st = STATUS_COLORS[p.status] || STATUS_COLORS.ACTIVE
          return (
            <div key={p.project_id} className="animate-fade-in-up" style={{ animationDelay: `${i * 0.03}s`, background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 'var(--radius-lg)', borderLeft: `4px solid ${st.color}`, boxShadow: 'var(--shadow-card)' }}>
              <div style={{ padding: '16px 20px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14 }} onClick={() => setExpandedId(isExpanded ? null : p.project_id)}>
                <div style={{ width: 36, height: 36, borderRadius: 'var(--radius-md)', background: `${st.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Briefcase size={16} color={st.color} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--text-tertiary)' }}>{p.project_id}</span>
                    <span style={{ padding: '1px 8px', borderRadius: 12, fontSize: '0.62rem', fontWeight: 600, background: st.bg, color: st.color }}>{st.label}</span>
                  </div>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{p.project_name}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginTop: 2 }}>{p.client_name} · {fmtSAR(p.po_value_sar)} · {pA.length} engineer{pA.length !== 1 ? 's' : ''}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>{fmtDate(p.start_date)} — {fmtDate(p.end_date)}</div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', marginTop: 2 }}><MapPin size={11} style={{ verticalAlign: -1 }} /> {(p.work_location_type || '').replace(/_/g, ' ')}</div>
                </div>
                <ChevronDown size={16} color="var(--text-tertiary)" style={{ flexShrink: 0, transition: 'transform 0.2s', transform: isExpanded ? 'rotate(180deg)' : 'none' }} />
              </div>
              {isExpanded && (
                <div style={{ padding: '0 20px 16px 70px', borderTop: '1px solid var(--border-primary)', paddingTop: 14 }}>
                  <div style={{ display: 'flex', gap: 20, fontSize: '0.72rem', color: 'var(--text-tertiary)', marginBottom: 12, flexWrap: 'wrap' }}>
                    <span>PO: <strong style={{ color: 'var(--text-primary)' }}>{p.po_number}</strong></span>
                    <span>Approver: <strong style={{ color: 'var(--text-primary)' }}>{p.client_approver_name}</strong> ({p.client_approver_email})</span>
                    <span>Rate: {p.rate_structure} {p.rate_amount_sar ? `— SAR ${Number(p.rate_amount_sar).toLocaleString()}` : ''}</span>
                  </div>
                  {pA.length > 0 && (
                    <div>
                      <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-tertiary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Engineers</div>
                      {pA.map(a => (
                        <div key={a.assignment_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--bg-surface)', borderRadius: 8, marginBottom: 4, fontSize: '0.82rem' }}>
                          <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg,#1598CC,#022873)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: '0.65rem', flexShrink: 0 }}>
                            {a.engineer_name?.split(' ').map(n => n[0]).join('').slice(0, 2)}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 600 }}>{a.engineer_name}</div>
                            <div style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)' }}>{a.role_on_project} · {a.allocation_percentage}% · SAR {a.rate_sar?.toLocaleString()}/hr</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
