import { Link } from 'react-router-dom'
import { Square, CheckSquare, Calendar, Loader } from 'lucide-react'

// Open follow-up tasks ("next steps") for a deal or contact (DTLK-CRM-ENT-001 Phase 1).
// Presentational — reads the canonical `crm_tasks` rows the parent loaded (same store
// the Tasks page + follow-up agent use). Completing flips status to DONE via onComplete.
// `today` (YYYY-MM-DD) is resolved once at module load to keep render pure.
const TODAY = new Date().toISOString().slice(0, 10)

export default function NextSteps({ tasks, onComplete, busyId, showDeal = false, today = TODAY }) {
  const t0 = today
  const open = (tasks || []).filter(t => t.status !== 'DONE')
  if (open.length === 0) {
    return <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', padding: '6px 0' }}>No open next steps. Log an activity and schedule one.</div>
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {open.map(t => {
        const overdue = t.due_date && t.due_date < t0
        const busy = busyId === t.id
        return (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: `1px solid ${overdue ? '#FCA5A5' : 'var(--border-primary, #E5E7EB)'}`, borderRadius: 8, background: 'var(--bg-surface, #fff)' }}>
            <button onClick={() => onComplete?.(t)} disabled={busy} title="Mark done"
              style={{ background: 'none', border: 'none', cursor: busy ? 'wait' : 'pointer', color: '#94a3b8', padding: 0, display: 'flex' }}>
              {busy ? <Loader size={17} className="spin" /> : <Square size={18} />}
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.83rem', fontWeight: 600, color: 'var(--text-primary)' }}>{t.title}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 1 }}>
                {t.due_date && <span style={{ color: overdue ? '#C0392B' : 'var(--text-tertiary)', fontWeight: overdue ? 700 : 400, display: 'inline-flex', alignItems: 'center', gap: 3 }}><Calendar size={11} /> {t.due_date}{overdue ? ' · overdue' : ''}</span>}
                {t.assignee_email && <span>{t.assignee_email}</span>}
                {showDeal && t.deal_id && <Link to={`/crm/deals/${t.deal_id}`} style={{ color: '#1598CC', textDecoration: 'none' }}>{t.deal_title || t.deal_id}</Link>}
              </div>
            </div>
            <CheckSquare size={14} color="#cbd5e1" />
          </div>
        )
      })}
    </div>
  )
}
