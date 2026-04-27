import { clientProjects } from '../../data/mockClient'
import { useCountUp } from '../../hooks/useUtils'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

export default function ClientPOs() {
  const activeProject = clientProjects.find(p => p.status === 'Active')

  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 24 }}>Purchase Orders & Budget</h1>

      {activeProject?.pos.map((po, i) => {
        const utilization = Math.round((po.usedHours / po.totalHours) * 100)
        const burnColor = utilization > 80 ? 'var(--red)' : utilization > 60 ? 'var(--amber)' : 'var(--green)'

        return (
          <div key={po.number} className={`card animate-fade-in-up stagger-${i + 1}`} style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>{po.number}</h3>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)', marginTop: 2 }}>{po.description}</p>
              </div>
              <span className={`badge ${po.status === 'Active' ? 'badge-success' : 'badge-neutral'}`}>{po.status}</span>
            </div>

            {/* Progress bar */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--text-tertiary)', marginBottom: 6 }}>
                <span>Hours Used: <strong style={{ color: 'var(--text-primary)' }}>{po.usedHours.toLocaleString()}</strong> / {po.totalHours.toLocaleString()}</span>
                <span style={{ fontWeight: 700, color: burnColor }}>{utilization}% utilized</span>
              </div>
              <div style={{ height: 10, borderRadius: 5, background: 'var(--border-primary)', overflow: 'hidden' }}>
                <div style={{ width: `${utilization}%`, height: '100%', borderRadius: 5, background: burnColor, transition: 'width 1s ease' }} />
              </div>
            </div>

            {/* Financial breakdown */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16  }}>
              {[
                { label: 'Rate/Hour', value: `SAR ${po.ratePerHour}`, color: 'var(--text-primary)' },
                { label: 'Total Value', value: `SAR ${(po.totalValue / 1000).toFixed(0)}K`, color: 'var(--steel-blue)' },
                { label: 'Invoiced', value: `SAR ${(po.invoiced / 1000).toFixed(0)}K`, color: 'var(--green)' },
                { label: 'Remaining Value', value: `SAR ${((po.totalValue - po.invoiced) / 1000).toFixed(0)}K`, color: 'var(--amber)' },
                { label: 'Hours Remaining', value: `${po.remainingHours.toLocaleString()}h`, color: burnColor },
              ].map((item, j) => (
                <div key={j} style={{ textAlign: 'center', padding: '12px 0', borderTop: '1px solid var(--border-primary)' }}>
                  <div style={{ fontSize: '1.2rem', fontWeight: 700, fontFamily: 'var(--font-heading)', color: item.color }}>{item.value}</div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 4 }}>{item.label}</div>
                </div>
              ))}
            </div>
          </div>
        )
      })}

      {/* Monthly Burn Chart */}
      <div className="chart-card animate-fade-in-up">
        <div className="chart-card-header">
          <h3 className="chart-card-title">Monthly Hours Burn</h3>
        </div>
        <div style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={[
              { month: 'Oct', hours: 320 }, { month: 'Nov', hours: 336 },
              { month: 'Dec', hours: 288 }, { month: 'Jan', hours: 344 },
              { month: 'Feb', hours: 312 }, { month: 'Mar', hours: 344 },
              { month: 'Apr', hours: 280 },
            ]}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" />
              <XAxis dataKey="month" tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} />
              <YAxis tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} />
              <Tooltip contentStyle={{ background: 'var(--bg-elevated, #fff)', border: '1px solid var(--border-card)', borderRadius: 10, color: 'var(--text-primary)' }} formatter={v => `${v} hours`} />
              <Bar dataKey="hours" name="Hours" fill="var(--steel-blue)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
