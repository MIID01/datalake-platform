import { Link } from 'react-router-dom'
import { StickyNote, Phone, Users, Mail, CheckSquare, Clock } from 'lucide-react'
import { activityMeta } from '../../lib/activity'

// Presentational, reusable activity feed (DTLK-CRM-ENT-001 Phase 1). Renders a list
// of NORMALIZED activity items (see lib/activity.normalizeActivity) reverse-chron.
// Used by both the deal timeline and the contact (cross-deal) timeline — same render,
// so they can't drift. The parent owns loading; this just draws.
const ICONS = { NOTE: StickyNote, CALL: Phone, MEETING: Users, EMAIL: Mail, TASK: CheckSquare }

const fmtWhen = (ms) => {
  if (!ms) return ''
  const d = new Date(ms)
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function ActivityTimeline({ items, showDeal = false, emptyText = 'No activity logged yet.' }) {
  if (!items || items.length === 0) {
    return <div style={{ fontSize: '0.82rem', color: 'var(--text-tertiary)', textAlign: 'center', padding: 18 }}>{emptyText}</div>
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {items.map(a => {
        const meta = activityMeta(a.type)
        const Icon = ICONS[a.type] || StickyNote
        return (
          <div key={a.id} style={{ display: 'flex', gap: 10, padding: '12px 0', borderTop: '1px solid var(--border-primary, #E5E7EB)' }}>
            <div style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 8, background: meta.color + '1A', color: meta.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon size={15} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: meta.color, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                  {meta.label}{a.type === 'EMAIL' && a.emailTo ? ` → ${a.emailTo}` : ''}
                  {a.outcome ? <span style={{ marginLeft: 6, color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'none', letterSpacing: 0 }}>· {a.outcome}</span> : null}
                </span>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                  {a.occurredBackdated && <Clock size={10} />}{fmtWhen(a.when)}
                </span>
              </div>
              {a.subject && <div style={{ fontSize: '0.84rem', fontWeight: 600, marginTop: 2, color: 'var(--text-primary)' }}>{a.subject}</div>}
              {a.body && <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: 2, whiteSpace: 'pre-wrap' }}>{a.body}</div>}
              <div style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', marginTop: 3, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span>{a.author}</span>
                {showDeal && a.dealId && <Link to={`/crm/deals/${a.dealId}`} style={{ color: '#1598CC', textDecoration: 'none' }}>· {a.dealTitle || a.dealId}</Link>}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
