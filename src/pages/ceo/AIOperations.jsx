import { useState, useMemo } from 'react'
import {
  Bot, Shield, Activity, Cpu, Play, Pause, Terminal, ChevronDown, ChevronRight,
  CheckCircle, AlertTriangle, XCircle, Clock, Zap, Eye, Send, MoreVertical,
  ArrowRight, CircleDot, X, DollarSign, RefreshCw
} from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { useState as useStateImport, useEffect as useEffectImport } from 'react'
import { collection, onSnapshot, query } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { TIERS, STATUSES, DOMAINS } from '../../data/constants'

// Live Firestore data — falls back to empty arrays when collection is empty
function useAgentData() {
  const [agents, setAgents] = useStateImport([])
  const [registryStats, setRegistryStats] = useStateImport({ activeAgents: 0, totalAgents: 0, domainsOccupied: 0, avgUptime: 0, totalSpendMtd: 0, totalBudgetSar: 1 })
  const [budgetByDomain, setBudgetByDomain] = useStateImport([])
  useEffectImport(() => {
    try {
      const q = query(collection(db, 'ai_agents'))
      const unsub = onSnapshot(q, (snap) => {
        const list = snap.docs.map(d => ({ agent_id: d.id, ...d.data() }))
        setAgents(list)
        const active = list.filter(a => a.status === 'ACTIVE')
        const totalSpend = list.reduce((s, a) => s + (a.cost_mtd || 0), 0)
        const totalBudget = list.reduce((s, a) => s + (a.monthly_budget_sar || 0), 0) || 1
        const avgUp = list.length ? Math.round(list.reduce((s, a) => s + (a.uptime || 0), 0) / list.length) : 0
        const occupiedDomains = new Set(list.filter(a => a.tier === 'SENIOR').map(a => a.domain)).size
        setRegistryStats({ activeAgents: active.length, totalAgents: list.length, domainsOccupied: occupiedDomains, avgUptime: avgUp, totalSpendMtd: totalSpend, totalBudgetSar: totalBudget })
        const domainMap = {}
        list.forEach(a => {
          const d = a.domain || 'UNKNOWN'
          if (!domainMap[d]) domainMap[d] = { domain: d, spend: 0, budget: 0 }
          domainMap[d].spend += a.cost_mtd || 0
          domainMap[d].budget += a.monthly_budget_sar || 0
        })
        setBudgetByDomain(Object.values(domainMap))
      }, (err) => console.warn('ai_agents listener error:', err.message))
      return () => unsub()
    } catch (err) { console.warn('ai_agents setup skipped:', err.message) }
  }, [])
  return { agents, registryStats, budgetByDomain }
}

const TABS = ['Grid View', 'Domain Coverage', 'Budget & Cost']

function StatusDot({ status }) {
  const s = STATUSES[status] || STATUSES.ACTIVE
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 10px',
      borderRadius: 12, fontSize: '0.7rem', fontWeight: 600, background: s.bg, color: s.color,
      textTransform: 'uppercase', letterSpacing: '0.04em',
    }}>
      <span style={{
        width: 7, height: 7, borderRadius: '50%', background: s.color,
        animation: status === 'ACTIVE' || status === 'DRY_RUN' ? 'pulse 2s infinite' : 'none',
      }} />
      {s.label}
    </span>
  )
}

function TierBadge({ tier }) {
  const t = TIERS[tier]
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 4, fontSize: '0.65rem', fontWeight: 700,
      background: `${t.color}20`, color: t.color, letterSpacing: '0.06em',
    }}>{t.short}</span>
  )
}

function HealthIndicator({ health, uptime }) {
  const color = health === 'HEALTHY' ? '#34BF3A' : health === 'DEGRADED' ? '#F39C12' : '#C0392B'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem' }}>
      <CircleDot size={14} color={color} />
      <span style={{ color: 'var(--text-secondary)' }}>{uptime}%</span>
    </div>
  )
}

function BudgetBar({ spent, budget }) {
  const pct = Math.round((spent / budget) * 100)
  const color = pct >= 95 ? '#C0392B' : pct >= 80 ? '#F39C12' : '#34BF3A'
  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: 'var(--text-tertiary)', marginBottom: 3 }}>
        <span>SAR {spent.toLocaleString()}</span>
        <span style={{ color }}>{pct}%</span>
      </div>
      <div style={{ height: 5, borderRadius: 3, background: 'var(--bg-surface)' }}>
        <div style={{ height: '100%', borderRadius: 3, width: `${Math.min(pct, 100)}%`, background: color, transition: 'width 0.5s ease' }} />
      </div>
      <div style={{ fontSize: '0.62rem', color: 'var(--text-tertiary)', marginTop: 2, textAlign: 'right' }}>
        / SAR {budget.toLocaleString()}
      </div>
    </div>
  )
}

function ResultIcon({ result }) {
  if (result === 'success') return <CheckCircle size={13} color="#34BF3A" />
  if (result === 'warning') return <AlertTriangle size={13} color="#F39C12" />
  if (result === 'error') return <XCircle size={13} color="#C0392B" />
  return <Eye size={13} color="#1598CC" />
}

export default function AIOperations() {
  const { agents, registryStats, budgetByDomain } = useAgentData()
  const [activeTab, setActiveTab] = useState(0)
  const [selectedAgent, setSelectedAgent] = useState(null)
  const [commandModal, setCommandModal] = useState(null)
  const [commandJustification, setCommandJustification] = useState('')
  const [commandSent, setCommandSent] = useState(false)

  const agentsByDomain = useMemo(() => {
    const map = {}
    DOMAINS.forEach(d => { map[d.id] = agents.filter(a => a.domain === d.id) })
    return map
  }, [])

  const handleCommand = () => {
    setCommandSent(true)
    setTimeout(() => { setCommandSent(false); setCommandModal(null); setCommandJustification('') }, 2000)
  }

  // ── GRID VIEW ──
  const renderGridView = () => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
      {agents.map((agent, i) => (
        <div
          key={agent.agent_id}
          onClick={() => setSelectedAgent(agent)}
          className="animate-fade-in-up"
          style={{
            animationDelay: `${i * 0.05}s`,
            background: 'var(--bg-card)', border: '1px solid var(--border-card)',
            borderRadius: 'var(--radius-lg)', padding: '20px', cursor: 'pointer',
            borderLeft: `4px solid ${TIERS[agent.tier].color}`,
            transition: 'all 0.2s ease', boxShadow: 'var(--shadow-card)',
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 'var(--radius-md)',
                background: `${TIERS[agent.tier].color}15`,
                border: `1px solid ${TIERS[agent.tier].color}30`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Bot size={20} color={TIERS[agent.tier].color} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>{agent.display_name}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--text-tertiary)' }}>{agent.agent_id}</div>
              </div>
            </div>
            <StatusDot status={agent.status} />
          </div>

          {/* Meta */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 14px', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: '0.62rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Domain</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{DOMAINS.find(d => d.id === agent.domain)?.label}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.62rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Tier</div>
              <TierBadge tier={agent.tier} />
            </div>
            <div>
              <div style={{ fontSize: '0.62rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Model</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{agent.model_backend}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.62rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Health</div>
              <HealthIndicator health={agent.health} uptime={agent.uptime} />
            </div>
          </div>

          {/* Quick Stats */}
          <div style={{ display: 'flex', gap: 12, borderTop: '1px solid var(--border-primary)', paddingTop: 10 }}>
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{agent.tasks_today}</div>
              <div style={{ fontSize: '0.6rem', color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Tasks Today</div>
            </div>
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: agent.error_rate > 1 ? '#C0392B' : 'var(--text-primary)' }}>{agent.error_rate}%</div>
              <div style={{ fontSize: '0.6rem', color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Error Rate</div>
            </div>
            <div style={{ flex: 1 }}>
              <BudgetBar spent={agent.cost_mtd} budget={agent.monthly_budget_sar} />
            </div>
          </div>
        </div>
      ))}
    </div>
  )

  // ── DOMAIN COVERAGE VIEW ──
  const renderDomainCoverage = () => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
      {DOMAINS.map((domain, i) => {
        const domainAgents = agentsByDomain[domain.id] || []
        const hasSenior = domainAgents.some(a => a.tier === 'SENIOR')
        return (
          <div key={domain.id} className="animate-fade-in-up" style={{
            animationDelay: `${i * 0.04}s`,
            background: 'var(--bg-card)', border: '1px solid var(--border-card)',
            borderRadius: 'var(--radius-lg)', padding: '20px',
            borderTop: `3px solid ${hasSenior ? '#34BF3A' : '#5a6a84'}`,
            boxShadow: 'var(--shadow-card)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: '1.3rem' }}>{domain.icon}</span>
                <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>{domain.label}</span>
              </div>
              <span style={{
                padding: '2px 10px', borderRadius: 12, fontSize: '0.68rem', fontWeight: 600,
                background: hasSenior ? 'rgba(52,191,58,0.12)' : 'rgba(90,106,132,0.12)',
                color: hasSenior ? '#34BF3A' : '#5a6a84',
              }}>
                {hasSenior ? 'Covered' : 'Vacant'}
              </span>
            </div>

            {domainAgents.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {domainAgents.map(a => (
                  <div key={a.agent_id} style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                    background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                  }} onClick={() => setSelectedAgent(a)}>
                    <Bot size={14} color={TIERS[a.tier].color} />
                    <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>{a.display_name}</span>
                    <TierBadge tier={a.tier} />
                    <StatusDot status={a.status} />
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.78rem', fontStyle: 'italic' }}>
                No agent assigned — SR slot open for registration
              </div>
            )}
          </div>
        )
      })}
    </div>
  )

  // ── BUDGET VIEW ──
  const renderBudgetView = () => {
    const chartData = budgetByDomain.map(d => ({
      name: d.domain, spend: d.spend, remaining: d.budget - d.spend,
    }))
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Budget Chart */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 'var(--radius-lg)', padding: '20px', boxShadow: 'var(--shadow-card)' }}>
          <h3 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 16 }}>AI Spend by Domain — April 2026</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" />
              <XAxis type="number" tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} tickFormatter={v => `${(v / 1000).toFixed(1)}K`} />
              <YAxis type="category" dataKey="name" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} width={110} />
              <Tooltip formatter={(v) => `SAR ${v.toLocaleString()}`} contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-card)', borderRadius: 8, fontSize: '0.8rem' }} />
              <Bar dataKey="spend" stackId="a" fill="#EF5829" radius={[0, 0, 0, 0]} name="Spent" />
              <Bar dataKey="remaining" stackId="a" fill="var(--bg-surface)" radius={[0, 4, 4, 0]} name="Remaining" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Per-Agent Budget Table */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 'var(--radius-lg)', padding: '20px', boxShadow: 'var(--shadow-card)' }}>
          <h3 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 16 }}>Per-Agent Cost Tracker</h3>
          <table style={{ width: '100%', borderSpacing: 0 }}>
            <thead>
              <tr>
                {['Agent', 'Model', 'Spend', 'Budget', 'Util'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border-primary)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {agents.map(a => {
                const pct = Math.round((a.cost_mtd / a.monthly_budget_sar) * 100)
                const color = pct >= 95 ? '#C0392B' : pct >= 80 ? '#F39C12' : '#34BF3A'
                return (
                  <tr key={a.agent_id} style={{ borderBottom: '1px solid var(--border-primary)' }}>
                    <td style={{ padding: '10px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>{a.display_name}</td>
                    <td style={{ padding: '10px', fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>{a.model_backend}</td>
                    <td style={{ padding: '10px', fontSize: '0.8rem', color: 'var(--text-primary)' }}>SAR {a.cost_mtd.toLocaleString()}</td>
                    <td style={{ padding: '10px', fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>SAR {a.monthly_budget_sar.toLocaleString()}</td>
                    <td style={{ padding: '10px', fontSize: '0.8rem', fontWeight: 700, color }}>{pct}%</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, padding: '10px', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Total AI Spend (MTD)</span>
            <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>SAR {registryStats.totalSpendMtd.toLocaleString()} <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)' }}>/ {registryStats.totalBudgetSar.toLocaleString()}</span></span>
          </div>
        </div>
      </div>
    )
  }

  // ── AGENT COCKPIT PANEL ──
  const renderAgentCockpit = () => {
    if (!selectedAgent) return null
    const a = selectedAgent
    return (
      <div style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
        display: 'flex', justifyContent: 'flex-end', zIndex: 1000,
      }} onClick={(e) => { if (e.target === e.currentTarget) setSelectedAgent(null) }}>
        <div style={{
          width: '65%', maxWidth: 780, height: '100%', overflowY: 'auto',
          background: 'var(--bg-primary)', borderLeft: '1px solid var(--border-card)',
          animation: 'slideInRight 0.3s ease', padding: '28px',
        }}>
          {/* Cockpit Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{
                width: 48, height: 48, borderRadius: 'var(--radius-md)',
                background: `${TIERS[a.tier].color}15`, border: `1px solid ${TIERS[a.tier].color}30`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Bot size={24} color={TIERS[a.tier].color} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: '1.2rem', color: 'var(--text-primary)' }}>{a.display_name}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>{a.agent_id} · v{a.version}</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <StatusDot status={a.status} />
              <TierBadge tier={a.tier} />
              <button onClick={() => setSelectedAgent(null)} style={{ padding: 6, borderRadius: 6, border: '1px solid var(--border-primary)' }} aria-label="Close cockpit">
                <X size={18} color="var(--text-tertiary)" />
              </button>
            </div>
          </div>

          {/* Quick Stats Row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
            {[
              { label: 'Tasks Today', value: a.tasks_today, icon: Zap, color: '#1598CC' },
              { label: 'Error Rate', value: `${a.error_rate}%`, icon: AlertTriangle, color: a.error_rate > 1 ? '#C0392B' : '#34BF3A' },
              { label: 'Uptime', value: `${a.uptime}%`, icon: Activity, color: '#34BF3A' },
              { label: 'Latency p95', value: `${a.latency_p95}ms`, icon: Clock, color: a.latency_p95 > 500 ? '#F39C12' : '#1598CC' },
            ].map((stat, i) => {
              const Icon = stat.icon
              return (
                <div key={i} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 'var(--radius-md)', padding: '14px', textAlign: 'center' }}>
                  <Icon size={16} color={stat.color} style={{ marginBottom: 4}} />
                  <div style={{ fontSize: '1.2rem', fontWeight: 700, color: stat.color }}>{stat.value}</div>
                  <div style={{ fontSize: '0.6rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{stat.label}</div>
                </div>
              )
            })}
          </div>

          {/* Budget Bar */}
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 'var(--radius-md)', padding: '16px', marginBottom: 20 }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Monthly Budget</div>
            <BudgetBar spent={a.cost_mtd} budget={a.monthly_budget_sar} />
          </div>

          {/* Info Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 20px', background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 'var(--radius-md)', padding: '16px', marginBottom: 20 }}>
            {[
              ['Domain', DOMAINS.find(d => d.id === a.domain)?.label],
              ['Model', a.model_backend],
              ['Location', a.model_location === 'SOVEREIGN_HOSTED' ? '🇸🇦 Sovereign KSA' : 'External'],
              ['Escalation', a.escalation_path],
              ['Parent', a.parent_agent_id ? agents.find(p => p.agent_id === a.parent_agent_id)?.display_name : 'None (Top-Level)'],
              ['Registered', new Date(a.registered_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })],
            ].map(([label, value], i) => (
              <div key={i}>
                <div style={{ fontSize: '0.62rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-primary)', fontWeight: 500 }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Capabilities */}
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 'var(--radius-md)', padding: '16px', marginBottom: 20 }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Capabilities</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {a.capabilities.map(c => (
                <span key={c} style={{ padding: '3px 10px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600, background: 'rgba(21,152,204,0.1)', color: 'var(--sky-blue, #1598CC)', border: '1px solid rgba(21,152,204,0.2)' }}>
                  {c.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          </div>

          {/* Compliance + IAM */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 'var(--radius-md)', padding: '16px' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Compliance</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {a.compliance_tags.map(t => (
                  <span key={t} style={{ padding: '2px 8px', borderRadius: 4, fontSize: '0.68rem', fontWeight: 600, background: 'rgba(52,191,58,0.1)', color: '#34BF3A' }}>{t}</span>
                ))}
              </div>
            </div>
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 'var(--radius-md)', padding: '16px' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Conflict Rules</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {a.conflict_rules.slice(0, 3).map(r => (
                  <span key={r} style={{ padding: '2px 8px', borderRadius: 4, fontSize: '0.65rem', fontWeight: 600, background: 'rgba(192,57,43,0.1)', color: '#C0392B' }}>{r.replace(/_/g, ' ')}</span>
                ))}
              </div>
            </div>
          </div>

          {/* Command Dispatch */}
          {a.commands.length > 0 && (
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 'var(--radius-md)', padding: '16px', marginBottom: 20 }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                <Terminal size={13} style={{ verticalAlign: -2, marginRight: 6 }} /> Command Dispatch
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {a.commands.map(cmd => (
                  <button
                    key={cmd.id}
                    onClick={() => setCommandModal(cmd)}
                    style={{
                      padding: '10px 14px', borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-primary)', background: 'var(--bg-surface)',
                      textAlign: 'left', cursor: 'pointer', transition: 'all 0.15s',
                    }}
                  >
                    <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>{cmd.label}</div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)' }}>{cmd.description}</div>
                  </button>
                ))}
              </div>
              {/* Universal commands */}
              <div style={{ display: 'flex', gap: 8, marginTop: 10, borderTop: '1px solid var(--border-primary)', paddingTop: 10 }}>
                <button style={{ flex: 1, padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-primary)', background: 'var(--bg-surface)', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer' }}>
                  {a.status === 'ACTIVE' ? <><Pause size={13} /> Pause Agent</> : <><Play size={13} /> Resume Agent</>}
                </button>
                <button style={{ flex: 1, padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-primary)', background: 'var(--bg-surface)', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer' }}>
                  <RefreshCw size={13} /> Force Status Report
                </button>
              </div>
            </div>
          )}

          {/* Dry-Run Log (if applicable) */}
          {a.dry_run_log && (
            <div style={{ background: 'var(--bg-card)', border: '1px solid rgba(21,152,204,0.3)', borderRadius: 'var(--radius-md)', padding: '16px', marginBottom: 20 }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 600, color: '#1598CC', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                Dry-Run Log — Day {a.dry_run_log.length}/7
              </div>
              {a.dry_run_log.map((day, i) => (
                <div key={i} style={{ display: 'flex', gap: 12, padding: '8px 0', borderBottom: i < a.dry_run_log.length - 1 ? '1px solid var(--border-primary)' : 'none', fontSize: '0.78rem' }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)', minWidth: 50 }}>Day {day.day}</span>
                  <span style={{ color: 'var(--text-secondary)' }}>{day.decisions} decisions</span>
                  <span style={{ color: '#C0392B' }}>{day.wouldBlock} blocks</span>
                  <span style={{ color: '#F39C12' }}>{day.wouldAlert} alerts</span>
                  <span style={{ color: 'var(--text-tertiary)', fontStyle: 'italic', flex: 1 }}>{day.notes}</span>
                </div>
              ))}
              <button style={{ marginTop: 10, width: '100%', padding: '10px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'linear-gradient(135deg, #34BF3A, #27ae60)', color: 'white', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer' }}>
                Activate Agent (End Dry-Run)
              </button>
            </div>
          )}

          {/* Activity Stream */}
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 'var(--radius-md)', padding: '16px' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
              <Activity size={13} style={{ verticalAlign: -2, marginRight: 6 }} /> Live Activity Stream
            </div>
            {a.activity_stream.map((event, i) => (
              <div key={i} style={{
                display: 'flex', gap: 10, padding: '10px 0', alignItems: 'flex-start',
                borderBottom: i < a.activity_stream.length - 1 ? '1px solid var(--border-primary)' : 'none',
              }}>
                <ResultIcon result={event.result} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-primary)', lineHeight: 1.4 }}>{event.action}</div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                    {new Date(event.ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}
                    {event.score && <> · Score: <strong>{event.score}</strong></>}
                    {event.note && <> · {event.note}</>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // ── COMMAND MODAL ──
  const renderCommandModal = () => {
    if (!commandModal) return null
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}>
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-card)', borderRadius: 'var(--radius-lg)', padding: '28px', maxWidth: 440, width: '90%', boxShadow: 'var(--shadow-elevated)' }}>
          {commandSent ? (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <CheckCircle size={40} color="#34BF3A" style={{ marginBottom: 12 }} />
              <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>Command Dispatched</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>Logged to datalake_audit.command_log</div>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                  <Terminal size={16} style={{ verticalAlign: -2, marginRight: 8 }} /> {commandModal.label}
                </h3>
                <button onClick={() => setCommandModal(null)} style={{ padding: 4 }}><X size={18} color="var(--text-tertiary)" /></button>
              </div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: 16 }}>{commandModal.description}</div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>Business Justification (required)</label>
                <textarea
                  value={commandJustification}
                  onChange={e => setCommandJustification(e.target.value)}
                  placeholder="Why is this command being executed..."
                  style={{ width: '100%', minHeight: 80, padding: '10px 14px', border: '1px solid var(--border-primary)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: '0.85rem', resize: 'vertical', outline: 'none' }}
                />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setCommandModal(null)} style={{ flex: 1, padding: '10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-primary)', background: 'transparent', color: 'var(--text-secondary)', fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer' }}>Cancel</button>
                <button
                  onClick={handleCommand}
                  disabled={!commandJustification.trim()}
                  style={{
                    flex: 1, padding: '10px', borderRadius: 'var(--radius-sm)', border: 'none',
                    background: commandJustification.trim() ? '#EF5829' : 'var(--bg-surface)',
                    color: commandJustification.trim() ? 'white' : 'var(--text-tertiary)',
                    fontWeight: 700, fontSize: '0.82rem', cursor: commandJustification.trim() ? 'pointer' : 'default',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}
                >
                  <Send size={14} /> Execute Command
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>AI Operations</h1>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: 4 }}>DTLK-ARCH-AI-002 · Agent Registry & Command Cockpit</p>
        </div>
        <button style={{
          padding: '10px 20px', borderRadius: 'var(--radius-sm)',
          background: 'var(--sky-blue, #1598CC)', color: 'white',
          fontWeight: 600, fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 8,
          boxShadow: 'var(--shadow-glow-blue)', cursor: 'pointer',
        }}>
          <Bot size={16} /> Register New Agent
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid-4" style={{ marginBottom: 24 }}>
        {[
          { label: 'Active Agents', value: registryStats.activeAgents, sub: `${registryStats.totalAgents} total registered`, color: '#34BF3A' },
          { label: 'Domains Covered', value: `${registryStats.domainsOccupied}/8`, sub: '4 vacant SR slots', color: '#1598CC' },
          { label: 'Avg Uptime', value: `${registryStats.avgUptime}%`, sub: 'All agents healthy', color: '#34BF3A' },
          { label: 'AI Spend MTD', value: `SAR ${(registryStats.totalSpendMtd / 1000).toFixed(1)}K`, sub: `of ${(registryStats.totalBudgetSar / 1000).toFixed(1)}K budget`, color: Math.round((registryStats.totalSpendMtd / registryStats.totalBudgetSar) * 100) >= 80 ? '#F39C12' : '#1598CC' },
        ].map((kpi, i) => (
          <div key={i} className="stat-card animate-fade-in-up" style={{ '--stat-accent': kpi.color, animationDelay: `${i * 0.05}s` }}>
            <div className="stat-label">{kpi.label}</div>
            <div className="stat-value" style={{ color: kpi.color }}>{kpi.value}</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginTop: 4 }}>{kpi.sub}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="tabs">
        {TABS.map((tab, i) => (
          <button key={tab} className={`tab-item ${activeTab === i ? 'active' : ''}`} onClick={() => setActiveTab(i)}>{tab}</button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 0 && renderGridView()}
      {activeTab === 1 && renderDomainCoverage()}
      {activeTab === 2 && renderBudgetView()}

      {/* Slide-out Agent Cockpit */}
      {selectedAgent && renderAgentCockpit()}

      {/* Command Modal */}
      {commandModal && renderCommandModal()}
    </div>
  )
}
