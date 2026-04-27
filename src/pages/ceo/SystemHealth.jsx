import { systemHealth } from '../../data/mockCEO'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { Activity, Server, Database, Cloud, MessageSquare, Clock, CreditCard } from 'lucide-react'

const iconMap = {
  'Gatekeeper AI': '🤖', 'Auditor AI': '🛡️', 'Controller AI': '⚙️',
  'Cloud SQL': '🗄️', 'BigQuery': '📊', 'Cloud Storage': '📦',
  'Pub/Sub': '📡', 'Cloud Scheduler': '⏰', 'Zoho Books API': '📗', 'Zoho Payroll API': '💵',
}

// Mock 24-hour metric data
const generate24hrData = (baseline, variance) => {
  return Array.from({ length: 24 }, (_, i) => ({
    hour: `${i}:00`,
    value: baseline + Math.round((Math.random() - 0.5) * variance * 2)
  }))
}

export default function SystemHealth() {
  const allGreen = systemHealth.every(s => s.status === 'green')

  return (
    <div>
      <div className="flex-between" style={{ marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>System Health</h1>
          <p style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem', marginTop: 4 }}>
            Real-time status of all AI microservices and infrastructure
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className={`health-indicator ${allGreen ? 'green' : 'amber'}`} style={{ width: 10, height: 10 }} />
          <span style={{ fontWeight: 600, color: allGreen ? 'var(--green)' : 'var(--amber)' }}>
            {allGreen ? 'All Systems Operational' : 'Minor Issues Detected'}
          </span>
        </div>
      </div>

      {/* AI Agents */}
      <h3 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>AI Microservices</h3>
      <div className="grid-3" style={{ marginBottom: 28 }}>
        {systemHealth.slice(0, 3).map((comp, i) => (
          <div key={comp.name} className={`card animate-fade-in-up stagger-${i + 1}`} style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <span className={`health-indicator ${comp.status}`} />
                <span style={{ fontSize: '1.1rem' }}>{iconMap[comp.name]}</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{comp.name}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>Last exec: {comp.lastExec}</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 16 }}>
                <div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800, fontFamily: 'var(--font-heading)', color: 'var(--green)' }}>{comp.successRate}%</div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Success Rate</div>
                </div>
                <div style={{ flex: 1, height: 50 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={generate24hrData(comp.successRate, 2)}>
                      <Line type="monotone" dataKey="value" stroke="var(--green)" strokeWidth={1.5} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
            <div style={{ padding: '10px 20px', background: 'var(--bg-surface)', borderTop: '1px solid var(--border-primary)', fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
              {comp.metric}
            </div>
          </div>
        ))}
      </div>

      {/* Infrastructure */}
      <h3 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Infrastructure</h3>
      <div className="grid-4" style={{ marginBottom: 28 }}>
        {systemHealth.slice(3).map((comp, i) => (
          <div key={comp.name} className={`health-card animate-fade-in-up stagger-${(i % 5) + 1}`}>
            <span style={{ fontSize: '1.4rem' }}>{iconMap[comp.name]}</span>
            <span className={`health-indicator ${comp.status}`} />
            <div className="health-info">
              <div className="health-name">{comp.name}</div>
              <div className="health-metric">{comp.metric}</div>
            </div>
          </div>
        ))}
      </div>

      {/* 24-Hour Overview Chart */}
      <div className="chart-card animate-fade-in-up">
        <div className="chart-card-header">
          <h3 className="chart-card-title">System Performance (24 Hours)</h3>
        </div>
        <div style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={generate24hrData(99, 3)}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" />
              <XAxis dataKey="hour" tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }} interval={3} />
              <YAxis domain={[90, 100]} tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }} tickFormatter={v => `${v}%`} />
              <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-card)', borderRadius: 10, color: 'var(--text-primary)' }} formatter={v => `${v}%`} />
              <Line type="monotone" dataKey="value" name="Availability" stroke="var(--green)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
