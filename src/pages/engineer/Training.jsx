import { trainingModules } from '../../data/mockEngineer'
import { BookOpen, CheckCircle, Clock, AlertTriangle, Download, PlayCircle } from 'lucide-react'

const statusConfig = {
  'Not Started': { color: 'var(--text-tertiary)', bg: 'var(--bg-surface)', icon: '⬜' },
  'In Progress': { color: 'var(--amber)', bg: 'var(--warning-dim)', icon: '🟡' },
  'Completed': { color: 'var(--green)', bg: 'var(--green-dim)', icon: '✅' },
}

export default function Training() {
  const completed = trainingModules.filter(m => m.status === 'Completed').length
  const total = trainingModules.length
  const mandatory = trainingModules.filter(m => m.mandatory)
  const mandatoryComplete = mandatory.filter(m => m.status === 'Completed').length

  return (
    <div>
      <div className="flex-between" style={{ marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Training & Compliance</h1>
          <p style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem', marginTop: 4 }}>
            {completed} of {total} modules complete · {mandatoryComplete} of {mandatory.length} mandatory
          </p>
        </div>
      </div>

      {/* Progress Summary */}
      <div className="card animate-fade-in-up" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '2.5rem', fontWeight: 800, fontFamily: 'var(--font-heading)', color: 'var(--green)' }}>{completed}/{total}</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>Modules Complete</div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ height: 8, borderRadius: 4, background: 'var(--border-primary)', overflow: 'hidden' }}>
              <div style={{ width: `${(completed / total) * 100}%`, height: '100%', borderRadius: 4, background: 'var(--green)', transition: 'width 0.5s ease' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
              <span>{mandatoryComplete}/{mandatory.length} mandatory complete</span>
              <span>{Math.round((completed / total) * 100)}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Module Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
        {trainingModules.map((mod, i) => {
          const config = statusConfig[mod.status]
          return (
            <div key={mod.id} className={`card animate-fade-in-up stagger-${(i % 5) + 1}`}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>{config.icon}</span>
                  <h4 style={{ fontSize: '0.95rem', fontWeight: 700 }}>{mod.title}</h4>
                </div>
                {mod.mandatory && <span className="badge badge-critical" style={{ fontSize: '0.6rem' }}>MANDATORY</span>}
              </div>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-tertiary)', marginBottom: 12, lineHeight: 1.5 }}>{mod.description}</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                <span className="badge badge-neutral">{mod.frequency}</span>
                {mod.dueDate && <span className="badge badge-neutral">Due: {new Date(mod.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
                {mod.score && <span className="badge badge-success">Score: {mod.score}%</span>}
              </div>
              {mod.status === 'In Progress' && mod.progress && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ height: 6, borderRadius: 3, background: 'var(--border-primary)', overflow: 'hidden' }}>
                    <div style={{ width: `${mod.progress}%`, height: '100%', borderRadius: 3, background: 'var(--amber)' }} />
                  </div>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>{mod.progress}% complete</span>
                </div>
              )}
              <div>
                {mod.status === 'Completed' ? (
                  <button className="btn btn-ghost btn-sm"><Download size={14} /> Certificate</button>
                ) : (
                  <button className="btn btn-primary btn-sm">
                    <PlayCircle size={14} /> {mod.status === 'In Progress' ? 'Continue' : 'Start Module'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
