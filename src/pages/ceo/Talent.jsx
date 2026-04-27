import { useState, useMemo, useEffect } from 'react'
import { talentData } from '../../data/mockCEO'
import { candidates, tierConfig, stageConfig, pipelineStats } from '../../data/mockRecruitment'
import { talentPoolCandidates, talentPoolStats, lifecycleDistribution, channelPerformance, complianceAudit, STATE_COLORS, STATE_LABELS } from '../../data/mockTalentPool'
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { UserPlus, Users, LogOut, CheckCircle, ChevronRight, Eye, XCircle, ArrowRight, Database, Search, Shield, RefreshCw, Trash2, Clock, Filter, AlertTriangle } from 'lucide-react'

const statusColors = {
  Active: 'badge-success', Expiring: 'badge-critical', Offboarded: 'badge-neutral'
}

const ALL_SOURCES = ['WEBSITE', 'LINKEDIN', 'BAYT', 'GULFTALENT', 'HR_EMAIL', 'NETWORK', 'TUNISIA', 'FACEBOOK']
const ALL_STATES = ['PENDING_CONSENT', 'ACTIVE_POOL_YEAR_1', 'ACTIVE_POOL_YEAR_2', 'RENEWAL_PENDING', 'GRACE_PERIOD']

export default function Talent() {
  const [activeSection, setActiveSection] = useState('scoring')
  const [expandedCandidate, setExpandedCandidate] = useState(null)
  const [poolFilterState, setPoolFilterState] = useState('ALL')
  const [poolFilterSource, setPoolFilterSource] = useState('ALL')
  const [renewalToast, setRenewalToast] = useState(null)
  const [purgeToast, setPurgeToast] = useState(null)
  const [liveCandidates, setLiveCandidates] = useState([])

  // Firestore real-time listener for live candidates from /careers form
  useEffect(() => {
    try {
      const q = query(collection(db, 'talent_pool'), orderBy('created_at', 'desc'))
      const unsub = onSnapshot(q, (snapshot) => {
        const candidates = snapshot.docs.map(doc => {
          const data = doc.data()
          const createdAt = data.created_at?.toDate?.()
          const daysInPool = createdAt ? Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24)) : 0
          return {
            id: doc.id,
            name: data.full_name || 'Unknown',
            nameVisible: false,
            email: data.email || '',
            phone: data.phone || '',
            location: data.location || '',
            skills: data.skills || [],
            source: data.source_channel || 'WEBSITE',
            state: data.state || 'PENDING_CONSENT',
            experience: data.experience || '',
            role_interest: data.role_interest || '',
            consentDate: data.consent_granted_at?.toDate?.()?.toISOString?.()?.split('T')[0] || data.created_at?.toDate?.()?.toISOString?.()?.split('T')[0] || null,
            daysInPool: daysInPool,
            retention_expiry: data.pdpl_purge_after?.toDate?.()?.toISOString?.()?.split('T')[0] || '',
            cv_path: data.cv_path || '',
            _live: true,
          }
        })
        setLiveCandidates(candidates)
      }, (err) => {
        console.warn('Firestore listener error (expected if not authenticated):', err.message)
      })
      return () => unsub()
    } catch (err) {
      console.warn('Firestore setup skipped:', err.message)
    }
  }, [])

  const filteredPoolCandidates = useMemo(() => {
    // Merge live Firestore candidates with mock data
    const allCandidates = [...liveCandidates, ...talentPoolCandidates.filter(mock => 
      !liveCandidates.some(live => live.id === mock.id)
    )]
    return allCandidates.filter(c => {
      if (poolFilterState !== 'ALL' && c.state !== poolFilterState) return false
      if (poolFilterSource !== 'ALL' && c.source !== poolFilterSource) return false
      return true
    })
  }, [poolFilterState, poolFilterSource, liveCandidates])

  const handleRenewalSweep = () => {
    setRenewalToast('Renewal emails queued for 5 RENEWAL_PENDING candidates. Gatekeeper AI dispatching...')
    setTimeout(() => setRenewalToast(null), 4000)
  }
  const handlePurge = () => {
    setPurgeToast('PDPL purge executed: 3 GRACE_PERIOD candidates purged. Audit log written to BigQuery.')
    setTimeout(() => setPurgeToast(null), 4000)
  }

  const toggleExpand = (id) => setExpandedCandidate(prev => prev === id ? null : id)

  return (
    <div>
      <div className="flex-between" style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Talent & HR</h1>
        <div style={{ display: 'flex', gap: 6 }}>
          {[
            { id: 'scoring', icon: UserPlus, label: 'Scoring Pipeline' },
            { id: 'talentpool', icon: Database, label: 'Talent Pool' },
            { id: 'engineers', icon: Users, label: 'Active Engineers' },
            { id: 'offboarding', icon: LogOut, label: 'Offboarding' },
          ].map(s => (
            <button
              key={s.id}
              className={`btn btn-sm ${activeSection === s.id ? 'btn-primary' : ''}`}
              style={activeSection !== s.id ? {
                background: 'rgba(255,255,255,0.08)',
                color: 'rgba(255,255,255,0.85)',
                border: '1px solid rgba(255,255,255,0.2)',
              } : {}}
              onClick={() => setActiveSection(s.id)}
            >
              <s.icon size={16} /> {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════ */}
      {/* SCORING PIPELINE — 5-Stage Evaluation */}
      {/* ═══════════════════════════════════════════════════ */}
      {activeSection === 'scoring' && (
        <div className="animate-fade-in-up">
          {/* Pipeline Stats */}
          <div className="grid-4" style={{ marginBottom: 24 }}>
            {[
              { value: pipelineStats.activeInPipeline, label: 'Active in Pipeline', color: 'var(--steel-blue)' },
              { value: `${pipelineStats.offerAcceptRate}%`, label: 'Offer Accept Rate', color: 'var(--green)' },
              { value: `${pipelineStats.avgTimeToOffer}d`, label: 'Avg Time to Offer', color: 'var(--amber)' },
              { value: `${pipelineStats.tierACount}`, label: 'Tier A Candidates', color: 'var(--green)' },
            ].map((stat, i) => (
              <div key={i} className={`card stagger-${i + 1}`} style={{ textAlign: 'center', padding: '16px 12px' }}>
                <div style={{ fontSize: '1.6rem', fontWeight: 800, fontFamily: 'var(--font-heading)', color: stat.color }}>{stat.value}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 4 }}>{stat.label}</div>
              </div>
            ))}
          </div>

          {/* 5-Stage Pipeline Visual */}
          <div className="card" style={{ marginBottom: 24 }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', marginBottom: 14 }}>
              5-Stage Evaluation Flow
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {Object.entries(stageConfig).map(([key, stage], i) => {
                const count = candidates.filter(c => c.currentStage === key).length
                return (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                    <div style={{
                      flex: 1, padding: '12px 14px', borderRadius: 8,
                      background: count > 0 ? `${stage.color}25` : 'var(--bg-surface)',
                      border: `1.5px solid ${count > 0 ? stage.color : 'var(--border-primary)'}`,
                      textAlign: 'center', transition: 'all 0.2s',
                    }}>
                      <div style={{ fontSize: '1.4rem', marginBottom: 4 }}>{stage.icon}</div>
                      <div style={{ fontSize: '0.72rem', fontWeight: 700, color: stage.color }}>{stage.short}</div>
                      <div style={{ fontSize: '0.62rem', color: 'var(--text-tertiary)', marginBottom: 6 }}>{stage.label}</div>
                      <div style={{
                        fontSize: '1.2rem', fontWeight: 800, fontFamily: 'var(--font-heading)',
                        color: count > 0 ? stage.color : 'var(--text-tertiary)',
                      }}>{count}</div>
                    </div>
                    {i < 4 && <ArrowRight size={16} style={{ flexShrink: 0, color: 'var(--text-tertiary)', margin: '0 2px' }} />}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Candidate Cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {candidates.map(c => {
              const stage = stageConfig[c.currentStage]
              const tier = c.tier ? tierConfig[c.tier] : null
              const isExpanded = expandedCandidate === c.id

              return (
                <div key={c.id} className="card" style={{
                  border: tier ? `1.5px solid ${tier.color}` : '1px solid var(--border-card)',
                  padding: 0, overflow: 'hidden',
                }}>
                  {/* Candidate Header Row */}
                  <div
                    style={{ padding: '16px 20px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14 }}
                    onClick={() => toggleExpand(c.id)}
                  >
                    {/* Avatar */}
                    <div style={{
                      width: 42, height: 42, borderRadius: '50%', flexShrink: 0,
                      background: `linear-gradient(135deg, ${stage.color}, ${stage.color}88)`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: 'white', fontWeight: 700, fontSize: '0.75rem',
                    }}>
                      {c.name.split(' ').map(n => n[0]).join('')}
                    </div>
                    {/* Info */}
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{c.name}</span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>{c.id}</span>
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: 2 }}>
                        {c.role} · {c.client} · {c.yearsExp}yr exp · {c.source}
                      </div>
                    </div>
                    {/* Skills */}
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', maxWidth: 200 }}>
                      {c.skills.slice(0, 3).map(s => (
                        <span key={s} className="badge badge-neutral" style={{ fontSize: '0.65rem' }}>{s}</span>
                      ))}
                      {c.skills.length > 3 && <span className="badge badge-neutral" style={{ fontSize: '0.65rem' }}>+{c.skills.length - 3}</span>}
                    </div>
                    {/* Stage badge */}
                    <span style={{
                      padding: '4px 10px', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600,
                      background: `${stage.color}35`, color: stage.color, border: `1px solid ${stage.color}`,
                      whiteSpace: 'nowrap',
                    }}>
                      {stage.icon} {stage.label}
                    </span>
                    {/* Scores */}
                    {c.finalScore && (
                      <div style={{ textAlign: 'center', minWidth: 50 }}>
                        <div style={{ fontSize: '1.4rem', fontWeight: 800, fontFamily: 'var(--font-heading)', color: tier?.color || 'var(--text-primary)' }}>
                          {c.finalScore}
                        </div>
                        <div style={{ fontSize: '0.6rem', color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Score</div>
                      </div>
                    )}
                    {/* Tier */}
                    {tier && (
                      <span style={{
                        padding: '4px 12px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 700,
                        background: tier.bg, color: tier.color, border: `1px solid ${tier.color}`,
                      }}>
                        {tier.label.split('—')[0].trim()}
                      </span>
                    )}
                    {/* Action */}
                    {c.tier === 'A' || c.tier === 'B' ? (
                      <button className="btn btn-success btn-sm" onClick={e => { e.stopPropagation() }} style={{ whiteSpace: 'nowrap' }}>
                        <CheckCircle size={14} /> Approve
                      </button>
                    ) : (
                      <ChevronRight size={18} style={{ color: 'var(--text-tertiary)', transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
                    )}
                  </div>

                  {/* Expanded Scoring Detail */}
                  {isExpanded && (
                    <div style={{ borderTop: '1px solid var(--border-primary)', padding: '20px', background: 'var(--bg-surface)' }}>
                      {/* Score Breakdown */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
                        {/* AI Score */}
                        <div style={{ padding: '14px', borderRadius: 8, border: '1px solid var(--border-primary)', background: 'var(--bg-card)' }}>
                          <div style={{ fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', marginBottom: 8 }}>
                            🤖 S1 — AI Pre-Screen (10%)
                          </div>
                          <div style={{ fontSize: '1.8rem', fontWeight: 800, fontFamily: 'var(--font-heading)', color: c.scores.ai.score >= 80 ? 'var(--green)' : 'var(--amber)' }}>
                            {c.scores.ai.score}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginTop: 4 }}>
                            {c.scores.ai.matchedSkills}/{c.scores.ai.totalRequired} skills matched
                          </div>
                        </div>

                        {/* HR Score */}
                        <div style={{ padding: '14px', borderRadius: 8, border: '1px solid var(--border-primary)', background: 'var(--bg-card)' }}>
                          <div style={{ fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', marginBottom: 8 }}>
                            👤 S2 — HR Screen (30%)
                          </div>
                          {c.scores.hr ? (
                            <>
                              <div style={{ fontSize: '1.8rem', fontWeight: 800, fontFamily: 'var(--font-heading)', color: c.scores.hr.totalScore >= 80 ? 'var(--green)' : 'var(--amber)' }}>
                                {c.scores.hr.totalScore}
                              </div>
                              <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginTop: 4 }}>
                                by {c.scores.hr.evaluator.split('@')[0]}
                              </div>
                            </>
                          ) : (
                            <div style={{ fontSize: '1rem', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>Pending</div>
                          )}
                        </div>

                        {/* Client Technical Score */}
                        <div style={{ padding: '14px', borderRadius: 8, border: '1px solid var(--border-primary)', background: 'var(--bg-card)' }}>
                          <div style={{ fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', marginBottom: 8 }}>
                            ⚙️ S3 — Client Technical (60%)
                          </div>
                          {c.scores.client ? (
                            <>
                              <div style={{ fontSize: '1.8rem', fontWeight: 800, fontFamily: 'var(--font-heading)', color: c.scores.client.totalScore >= 80 ? 'var(--green)' : 'var(--amber)' }}>
                                {c.scores.client.totalScore}
                              </div>
                              <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginTop: 4 }}>
                                by {c.scores.client.evaluator.split('@')[0]}
                              </div>
                            </>
                          ) : (
                            <div style={{ fontSize: '1rem', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>Pending</div>
                          )}
                        </div>
                      </div>

                      {/* HR Scorecard Detail (if available) */}
                      {c.scores.hr && (
                        <div style={{ marginBottom: 16 }}>
                          <div style={{ fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', marginBottom: 8 }}>
                            HR Scorecard Detail
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                            {[
                              { key: 'communicationClarity', label: 'Communication' },
                              { key: 'culturalFit', label: 'Culture Fit' },
                              { key: 'workAuth', label: 'Work Auth' },
                              { key: 'availability', label: 'Availability' },
                              { key: 'salaryAlignment', label: 'Salary' },
                              { key: 'references', label: 'References' },
                              { key: 'relocation', label: 'Relocation' },
                            ].map(item => {
                              const s = c.scores.hr[item.key]
                              const isPassFail = s.raw === 'Pass' || s.raw === 'Fail'
                              return (
                                <div key={item.key} style={{
                                  padding: '8px 10px', borderRadius: 6,
                                  background: isPassFail
                                    ? (s.raw === 'Pass' ? 'var(--green-dim)' : 'var(--red-dim, #fde8e8)')
                                    : 'var(--bg-card)',
                                  border: '1px solid var(--border-primary)', fontSize: '0.75rem',
                                }}>
                                  <div style={{ fontWeight: 600, marginBottom: 2 }}>{item.label}</div>
                                  <div style={{
                                    fontWeight: 700, fontFamily: 'var(--font-heading)',
                                    color: isPassFail ? (s.raw === 'Pass' ? 'var(--green)' : 'var(--red)') : s.raw >= 4 ? 'var(--green)' : 'var(--amber)',
                                  }}>
                                    {isPassFail ? s.raw : `${s.raw}/5`}
                                  </div>
                                  <div style={{ fontSize: '0.62rem', color: 'var(--text-tertiary)', marginTop: 2, lineHeight: 1.3 }}>{s.notes.substring(0, 60)}...</div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {/* Client Scorecard Detail (if available) */}
                      {c.scores.client && (
                        <div>
                          <div style={{ fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', marginBottom: 8 }}>
                            Client Technical Scorecard
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                            {[
                              { key: 'coreTechnical', label: 'Core Technical (30%)' },
                              { key: 'problemSolving', label: 'Problem Solving (20%)' },
                              { key: 'systemDesign', label: 'System Design (15%)' },
                              { key: 'domainKnowledge', label: 'Domain Knowledge (15%)' },
                              { key: 'codeQuality', label: 'Code Quality (10%)' },
                              { key: 'teamFit', label: 'Team Fit (10%)' },
                            ].map(item => {
                              const s = c.scores.client[item.key]
                              return (
                                <div key={item.key} style={{
                                  padding: '8px 10px', borderRadius: 6,
                                  background: 'var(--bg-card)',
                                  border: '1px solid var(--border-primary)', fontSize: '0.75rem',
                                }}>
                                  <div style={{ fontWeight: 600, marginBottom: 2 }}>{item.label}</div>
                                  <div style={{
                                    fontWeight: 700, fontFamily: 'var(--font-heading)',
                                    color: s.raw >= 4 ? 'var(--green)' : s.raw >= 3 ? 'var(--amber)' : 'var(--red)',
                                  }}>{s.raw}/5</div>
                                  <div style={{ fontSize: '0.62rem', color: 'var(--text-tertiary)', marginTop: 2, lineHeight: 1.3 }}>{s.notes.substring(0, 80)}</div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {/* Decision Actions */}
                      {(c.tier === 'A' || c.tier === 'B') && (
                        <div style={{ marginTop: 16, padding: '12px 16px', borderRadius: 8, background: tier ? tierConfig[c.tier].bg : 'var(--bg-surface)', border: `1px solid ${tierConfig[c.tier]?.color || 'var(--border-primary)'}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div style={{ fontSize: '0.82rem' }}>
                            <strong style={{ color: tierConfig[c.tier]?.color }}>{tierConfig[c.tier]?.label}</strong>
                            <span style={{ color: 'var(--text-tertiary)', marginLeft: 8 }}>SLA: {tierConfig[c.tier]?.sla}</span>
                          </div>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button className="btn btn-ghost btn-sm"><XCircle size={14} /> Override</button>
                            <button className="btn btn-success btn-sm"><CheckCircle size={14} /> Approve & Send Offer</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════ */}
      {/* ACTIVE ENGINEERS */}
      {/* ═══════════════════════════════════════════════════ */}
      {activeSection === 'engineers' && (
        <div className="card animate-fade-in-up" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-primary)' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>Active Engineers ({talentData.engineers.length})</h3>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr><th>Name</th><th>ID</th><th>Client</th><th>Role</th><th>Contract End</th><th>Days Left</th><th>Status</th><th>Hours (MTD)</th><th>Leave</th></tr>
              </thead>
              <tbody>
                {talentData.engineers.map(e => {
                  const rowColor = e.daysRemaining < 7 ? 'var(--red-dim)' : e.daysRemaining < 30 ? 'var(--amber-dim, var(--warning-dim))' : 'transparent'
                  return (
                    <tr key={e.id} style={{ background: rowColor }}>
                      <td style={{ fontWeight: 600 }}>{e.name}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>{e.id}</td>
                      <td>{e.client}</td>
                      <td>{e.role}</td>
                      <td>{new Date(e.end).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                      <td>
                        <span style={{ fontWeight: 700, color: e.daysRemaining < 7 ? 'var(--red)' : e.daysRemaining < 30 ? 'var(--amber)' : 'var(--green)' }}>
                          {e.daysRemaining}
                        </span>
                      </td>
                      <td><span className={`badge ${statusColors[e.status]}`}>{e.status}</span></td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{e.hours}</td>
                      <td>{e.leave} days</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════ */}
      {/* TALENT POOL — PDPL Lifecycle Dashboard */}
      {/* ═══════════════════════════════════════════════════ */}
      {activeSection === 'talentpool' && (
        <div className="animate-fade-in-up">
          {/* KPI Cards */}
          <div className="grid-4" style={{ marginBottom: 24 }}>
            {[
              { value: talentPoolStats.activePoolSize, label: 'Active Pool Size', color: 'var(--green)', icon: Database },
              { value: talentPoolStats.pendingConsent, label: 'Pending Consent', color: '#8898aa', icon: Clock },
              { value: talentPoolStats.renewalsThisMonth, label: 'Renewals This Month', color: 'var(--amber)', icon: RefreshCw },
              { value: talentPoolStats.purgedThisMonth, label: 'Purged (PDPL Auto)', color: 'var(--red, #C0392B)', icon: Trash2 },
            ].map((stat, i) => {
              const Icon = stat.icon
              return (
                <div key={i} className={`card stagger-${i + 1}`} style={{ textAlign: 'center', padding: '16px 12px' }}>
                  <Icon size={16} color={stat.color} style={{ marginBottom: 4 }} />
                  <div style={{ fontSize: '1.6rem', fontWeight: 800, fontFamily: 'var(--font-heading)', color: stat.color }}>{stat.value}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 4 }}>{stat.label}</div>
                </div>
              )
            })}
          </div>

          {/* Lifecycle Distribution Bar */}
          <div className="card" style={{ marginBottom: 24 }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', marginBottom: 12 }}>
              PDPL Consent Lifecycle Distribution
            </div>
            <div style={{ display: 'flex', height: 32, borderRadius: 8, overflow: 'hidden', marginBottom: 12 }}>
              {lifecycleDistribution.map(seg => {
                const total = lifecycleDistribution.reduce((s, x) => s + x.count, 0)
                const pct = (seg.count / total) * 100
                return (
                  <div key={seg.state} title={`${seg.label}: ${seg.count}`} style={{
                    width: `${pct}%`, background: seg.color, transition: 'width 0.5s ease',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.65rem', fontWeight: 700, color: '#fff',
                    minWidth: pct > 5 ? 'auto' : 0,
                  }}>
                    {pct > 8 && seg.count}
                  </div>
                )
              })}
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {lifecycleDistribution.map(seg => (
                <div key={seg.state} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem' }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: seg.color, flexShrink: 0 }} />
                  <span style={{ color: 'var(--text-secondary)' }}>{seg.label}</span>
                  <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{seg.count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Toast notifications */}
          {renewalToast && (
            <div className="animate-fade-in-up" style={{ padding: '12px 20px', background: 'rgba(21,152,204,0.15)', border: '1px solid rgba(21,152,204,0.3)', borderRadius: 'var(--radius-md)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.82rem', color: 'var(--sky-blue, #1598CC)' }}>
              <RefreshCw size={16} /> {renewalToast}
            </div>
          )}
          {purgeToast && (
            <div className="animate-fade-in-up" style={{ padding: '12px 20px', background: 'rgba(192,57,43,0.12)', border: '1px solid rgba(192,57,43,0.3)', borderRadius: 'var(--radius-md)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.82rem', color: 'var(--red, #C0392B)' }}>
              <AlertTriangle size={16} /> {purgeToast}
            </div>
          )}

          {/* Candidate Table */}
          <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 24 }}>
            <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Pool Candidates ({filteredPoolCandidates.length}{poolFilterState !== 'ALL' || poolFilterSource !== 'ALL' ? ` of ${talentPoolCandidates.length}` : ''})</h3>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-ghost btn-sm" onClick={handleRenewalSweep}><RefreshCw size={14} /> Trigger Renewal Sweep</button>
                <button className="btn btn-ghost btn-sm" onClick={handlePurge} style={{ color: 'var(--red, #C0392B)' }}><Trash2 size={14} /> Run PDPL Purge</button>
              </div>
            </div>
            {/* Filters */}
            <div style={{ padding: '10px 24px', borderBottom: '1px solid var(--border-primary)', display: 'flex', gap: 12, alignItems: 'center', background: 'var(--bg-surface)' }}>
              <Filter size={14} color="var(--text-tertiary)" />
              <select value={poolFilterState} onChange={e => setPoolFilterState(e.target.value)} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border-primary)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '0.78rem', fontFamily: 'inherit' }}>
                <option value="ALL">All States</option>
                {ALL_STATES.map(s => <option key={s} value={s}>{STATE_LABELS[s]}</option>)}
              </select>
              <select value={poolFilterSource} onChange={e => setPoolFilterSource(e.target.value)} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border-primary)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '0.78rem', fontFamily: 'inherit' }}>
                <option value="ALL">All Sources</option>
                {ALL_SOURCES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
              </select>
              {(poolFilterState !== 'ALL' || poolFilterSource !== 'ALL') && (
                <button onClick={() => { setPoolFilterState('ALL'); setPoolFilterSource('ALL') }} className="btn btn-ghost btn-sm" style={{ fontSize: '0.72rem' }}><XCircle size={12} /> Clear</button>
              )}
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>ID</th><th>Name</th><th>Source</th><th>State</th><th>Skills</th><th>Days in Pool</th><th>Consent</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPoolCandidates.map(c => (
                    <tr key={c.id}>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>{c.id}</td>
                      <td style={{ fontWeight: 600 }}>{c.nameVisible ? c.name : <span style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>{c.name} (PII masked)</span>}</td>
                      <td><span style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: 12, background: 'var(--bg-surface)', color: 'var(--text-secondary)' }}>{c.source.replace('_', ' ')}</span></td>
                      <td>
                        <span style={{
                          padding: '3px 10px', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600,
                          background: `${STATE_COLORS[c.state]}30`, color: STATE_COLORS[c.state],
                        }}>
                          {STATE_LABELS[c.state]}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {c.skills.slice(0, 2).map(s => (
                            <span key={s} style={{ padding: '1px 6px', borderRadius: 8, fontSize: '0.65rem', background: 'rgba(56,189,248,0.18)', color: '#7dd3fc' }}>{s}</span>
                          ))}
                          {c.skills.length > 2 && <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>+{c.skills.length - 2}</span>}
                        </div>
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>{c.daysInPool}d</td>
                      <td>
                        {c.consentDate
                          ? <span style={{ fontSize: '0.72rem', color: '#4ade80' }}>✓ {new Date(c.consentDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                          : <span style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: 8, background: 'rgba(148,163,184,0.15)', color: '#94a3b8', fontStyle: 'italic' }}>Awaiting</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Bottom Row: Channel Performance + Compliance */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {/* Channel Performance */}
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-primary)' }}>
                <h3 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Intake Channel Performance</h3>
              </div>
              <table className="data-table">
                <thead>
                  <tr><th>Channel</th><th>CVs</th><th>Consent %</th><th>Quality</th></tr>
                </thead>
                <tbody>
                  {channelPerformance.map(ch => (
                    <tr key={ch.channel}>
                      <td style={{ fontWeight: 600, fontSize: '0.82rem' }}>{ch.channel}</td>
                      <td>{ch.cvs}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ width: 50, height: 5, borderRadius: 3, background: 'var(--bg-surface)' }}>
                            <div style={{ width: `${ch.consentRate}%`, height: '100%', borderRadius: 3, background: ch.consentRate >= 70 ? '#34BF3A' : ch.consentRate >= 50 ? '#F39C12' : '#C0392B' }} />
                          </div>
                          <span style={{ fontSize: '0.78rem' }}>{ch.consentRate}%</span>
                        </div>
                      </td>
                      <td style={{ fontWeight: 600, color: ch.quality >= 70 ? 'var(--green, #34BF3A)' : ch.quality >= 50 ? 'var(--amber, #F39C12)' : 'var(--red, #C0392B)' }}>{ch.quality}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Compliance Audit Card */}
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <Shield size={18} color="var(--green, #34BF3A)" />
                <h3 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>PDPL Compliance Audit — {complianceAudit.month}</h3>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 20px' }}>
                {[
                  ['Status', complianceAudit.status],
                  ['DSAR Response', complianceAudit.dsarResponseTime],
                  ['Consent Conversion', complianceAudit.consentConversionRate],
                  ['Violations', String(complianceAudit.sensitiveDataViolations)],
                ].map(([label, val], i) => (
                  <div key={i}>
                    <div style={{ fontSize: '0.62rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
                    <div style={{
                      fontSize: '0.9rem', fontWeight: 600,
                      color: val === '0' || val.includes('Passed') ? 'var(--green, #34BF3A)' : 'var(--text-primary)',
                    }}>{val}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 16, padding: '10px 14px', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>
                Generated {complianceAudit.generatedAt} · Cloud Scheduler · Auditor AI
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════ */}
      {/* OFFBOARDING */}
      {/* ═══════════════════════════════════════════════════ */}
      {activeSection === 'offboarding' && (
        <div className="card animate-fade-in-up" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-primary)' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>Offboarding Queue</h3>
          </div>
          {talentData.offboarding.map(e => (
            <div key={e.id} className="approval-item">
              <div className="approval-icon">🔄</div>
              <div className="approval-info">
                <div className="approval-title">{e.name} — {e.client}</div>
                <div className="approval-meta">Contract ends {new Date(e.endDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
              </div>
              <span className={`badge ${e.status === 'In Progress' ? 'badge-warning' : 'badge-info'}`}>{e.status}</span>
              <div className="approval-actions">
                {e.actions.map(a => (
                  <button key={a} className={`btn btn-sm ${a.includes('Extend') ? 'btn-primary' : 'btn-ghost'}`}>{a}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
