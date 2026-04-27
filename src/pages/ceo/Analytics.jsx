import { analyticsData } from '../../data/mockCEO'
import { useCountUp } from '../../hooks/useUtils'
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts'

const COLORS = ['var(--sky-blue)', 'var(--green)', 'var(--orange)', 'var(--amber)', '#9B59B6', '#3bb5e5']

function GaugeKPI({ value, target, label }) {
  const display = useCountUp(value * 10, 1000) / 10
  const color = value >= target ? 'var(--green)' : 'var(--amber)'
  return (
    <div className="stat-card" style={{ '--stat-accent': color, textAlign: 'center' }}>
      <div style={{ position: 'relative', width: 140, height: 140, margin: '0 auto 12px' }}>
        <svg width="140" height="140" viewBox="0 0 140 140">
          <circle cx="70" cy="70" r="56" fill="none" stroke="var(--border-primary)" strokeWidth="10" />
          <circle cx="70" cy="70" r="56" fill="none" stroke={color} strokeWidth="10"
            strokeDasharray={`${2 * Math.PI * 56}`}
            strokeDashoffset={`${2 * Math.PI * 56 * (1 - display / 100)}`}
            strokeLinecap="round" transform="rotate(-90 70 70)"
            style={{ transition: 'stroke-dashoffset 1s ease' }}
          />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
          <span style={{ fontSize: '2rem', fontWeight: 800, fontFamily: 'var(--font-heading)', color }}>{display}%</span>
        </div>
      </div>
      <div className="stat-label">{label}</div>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: 4 }}>Target: ≥{target}%</div>
    </div>
  )
}

export default function Analytics() {
  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 24 }}>Analytics</h1>

      {/* Top Row: KPIs */}
      <div className="grid-4" style={{ marginBottom: 28 }}>
        <GaugeKPI value={analyticsData.zeroTouchRatio} target={90} label="Zero-Touch Ratio" />
        <div className="stat-card animate-fade-in-up stagger-2" style={{ '--stat-accent': 'var(--sky-blue)' }}>
          <div className="stat-label">Revenue per Engineer</div>
          <div className="stat-value" style={{ color: 'var(--sky-blue)', fontSize: '2rem' }}>SAR {analyticsData.revenuePerEngineer.value.toLocaleString()}</div>
          <div className="stat-trend up">↑ {analyticsData.revenuePerEngineer.trend}%</div>
        </div>
        <div className="stat-card animate-fade-in-up stagger-3" style={{ '--stat-accent': 'var(--green)' }}>
          <div className="stat-label">Time to Hire</div>
          <div className="stat-value" style={{ color: 'var(--green)', fontSize: '2rem' }}>{analyticsData.timeToHire.value} days</div>
          <div className="stat-trend up">↓ {Math.abs(analyticsData.timeToHire.trend)} days improvement</div>
        </div>
        <div className="stat-card animate-fade-in-up stagger-4" style={{ '--stat-accent': 'var(--amber)' }}>
          <div className="stat-label">Active Clients</div>
          <div className="stat-value" style={{ color: 'var(--amber)', fontSize: '2rem' }}>6</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: 8 }}>+2 in pipeline</div>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid-2" style={{ marginBottom: 24 }}>
        {/* Revenue Trend */}
        <div className="chart-card animate-fade-in-up stagger-1">
          <div className="chart-card-header">
            <h3 className="chart-card-title">Revenue Trend (24 Months)</h3>
          </div>
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={analyticsData.revenueTrend}>
                <defs>
                  <linearGradient id="gRevTrend" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#1598CC" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#1598CC" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" />
                <XAxis dataKey="month" tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }} />
                <YAxis tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }} tickFormatter={v => `${(v / 1000).toFixed(0)}K`} />
                <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-card)', borderRadius: 10, color: 'var(--text-primary)' }} formatter={v => `SAR ${v.toLocaleString()}`} />
                <Area type="monotone" dataKey="actual" name="Actual" stroke="#1598CC" fill="url(#gRevTrend)" strokeWidth={2} />
                <Line type="monotone" dataKey="target" name="Target" stroke="var(--amber)" strokeWidth={2} strokeDasharray="5 5" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Compliance Pass Rate (Donut) */}
        <div className="chart-card animate-fade-in-up stagger-2">
          <div className="chart-card-header">
            <h3 className="chart-card-title">Compliance Pass Rate by Framework</h3>
          </div>
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={Object.entries(analyticsData.revenueTrend.length ? { NCA: 96, SAMA: 92, SDAIA: 95, MHRSD: 93 } : {}).map(([name, value]) => ({ name, value }))}
                  cx="50%" cy="50%" innerRadius={60} outerRadius={100}
                  paddingAngle={4} dataKey="value" label={({ name, value }) => `${name}: ${value}%`}
                >
                  {COLORS.map((c, i) => <Cell key={i} fill={c} />)}
                </Pie>
                <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-card)', borderRadius: 10, color: 'var(--text-primary)' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* GCP Infrastructure Costs */}
        <div className="chart-card animate-fade-in-up stagger-3">
          <div className="chart-card-header">
            <h3 className="chart-card-title">GCP Infrastructure Cost</h3>
          </div>
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={analyticsData.gcpCosts}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" />
                <XAxis dataKey="month" tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }} />
                <YAxis tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }} tickFormatter={v => `$${v}`} />
                <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-card)', borderRadius: 10, color: 'var(--text-primary)' }} formatter={v => `$${v}`} />
                <Legend />
                <Area type="monotone" dataKey="compute" stackId="1" name="Compute" stroke="#1598CC" fill="#1598CC" fillOpacity={0.6} />
                <Area type="monotone" dataKey="storage" stackId="1" name="Storage" stroke="#34BF3A" fill="#34BF3A" fillOpacity={0.6} />
                <Area type="monotone" dataKey="bigquery" stackId="1" name="BigQuery" stroke="#EF5829" fill="#EF5829" fillOpacity={0.6} />
                <Area type="monotone" dataKey="networking" stackId="1" name="Network" stroke="#F39C12" fill="#F39C12" fillOpacity={0.6} />
                <Area type="monotone" dataKey="other" stackId="1" name="Other" stroke="#9B59B6" fill="#9B59B6" fillOpacity={0.6} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Payroll vs Revenue */}
        <div className="chart-card animate-fade-in-up stagger-4">
          <div className="chart-card-header">
            <h3 className="chart-card-title">Payroll vs Revenue</h3>
          </div>
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analyticsData.revenueTrend.map(d => ({ month: d.month, revenue: d.actual, payroll: Math.round(d.actual * 0.45) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" />
                <XAxis dataKey="month" tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }} />
                <YAxis tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }} tickFormatter={v => `${(v / 1000).toFixed(0)}K`} />
                <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-card)', borderRadius: 10, color: 'var(--text-primary)' }} formatter={v => `SAR ${v.toLocaleString()}`} />
                <Legend />
                <Bar dataKey="revenue" name="Revenue" fill="#1598CC" radius={[4, 4, 0, 0]} />
                <Bar dataKey="payroll" name="Payroll" fill="#EF5829" radius={[4, 4, 0, 0]} opacity={0.7} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  )
}
