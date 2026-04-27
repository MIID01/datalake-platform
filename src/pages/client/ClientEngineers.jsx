import { clientProjects } from '../../data/mockClient'
import { Users, Calendar, Clock, TrendingUp } from 'lucide-react'

export default function ClientEngineers() {
  const allEngineers = clientProjects.flatMap(p =>
    p.engineers.map(e => ({ ...e, project: p.name, projectStatus: p.status }))
  )
  const active = allEngineers.filter(e => e.status === 'Active')
  const offboarded = allEngineers.filter(e => e.status === 'Offboarded')

  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 24 }}>My Engineers</h1>

      {/* Active Engineers */}
      <h3 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
        Active ({active.length})
      </h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, marginBottom: 32 }}>
        {active.map(eng => (
          <div key={eng.id} className="card animate-fade-in-up">
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
              <div style={{
                width: 52, height: 52, borderRadius: '50%',
                background: 'linear-gradient(135deg, var(--steel-blue), var(--navy))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'white', fontWeight: 800, fontSize: '0.9rem', fontFamily: 'var(--font-heading)',
              }}>
                {eng.name.split(' ').map(n => n[0]).join('')}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>{eng.name}</div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-tertiary)' }}>{eng.role}</div>
              </div>
              <span className="badge badge-success">Active</span>
            </div>

            {/* Skills */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
              {eng.skills.map(s => (
                <span key={s} className="badge badge-neutral">{s}</span>
              ))}
            </div>

            {/* Metrics */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, padding: '12px 0', borderTop: '1px solid var(--border-primary)' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, fontFamily: 'var(--font-heading)', color: 'var(--steel-blue)' }}>{eng.currentMonthHours}h</div>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>This Month</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, fontFamily: 'var(--font-heading)', color: 'var(--green)' }}>{eng.attendance}%</div>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Attendance</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, fontFamily: 'var(--font-heading)', color: eng.daysRemaining < 30 ? 'var(--amber)' : 'var(--green)' }}>{eng.daysRemaining}d</div>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Days Left</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{eng.po}</div>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>PO Number</div>
              </div>
            </div>

            {/* Contract Period */}
            <div style={{ marginTop: 12, padding: '8px 12px', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', fontSize: '0.78rem', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Calendar size={14} />
              <span>{new Date(eng.startDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })} — {new Date(eng.endDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>
              <span style={{ marginLeft: 'auto', fontWeight: 600 }}>{eng.project}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Offboarded */}
      {offboarded.length > 0 && (
        <>
          <h3 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
            Offboarded ({offboarded.length})
          </h3>
          <div className="card" style={{ padding: 0, overflow: 'hidden', opacity: 0.7 }}>
            <table className="data-table">
              <thead><tr><th>Name</th><th>Role</th><th>Project</th><th>PO</th><th>Period</th><th>Attendance</th></tr></thead>
              <tbody>
                {offboarded.map(eng => (
                  <tr key={eng.id}>
                    <td style={{ fontWeight: 600 }}>{eng.name}</td>
                    <td>{eng.role}</td>
                    <td>{eng.project}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>{eng.po}</td>
                    <td>{new Date(eng.startDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })} — {new Date(eng.endDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</td>
                    <td>{eng.attendance}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
