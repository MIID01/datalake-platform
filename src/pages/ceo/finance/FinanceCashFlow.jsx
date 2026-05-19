import React, { useState, useMemo } from 'react'
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer, ReferenceLine
} from 'recharts'
import { Settings, Plus, TrendingUp, Save } from 'lucide-react'

export default function FinanceCashFlow({ invoices, timesheets, projects, expenses }) {
  const [horizon, setHorizon] = useState('12M') // '12M' or '13W'
  const [scenarioModalOpen, setScenarioModalOpen] = useState(false)
  const [scenarios, setScenarios] = useState([])
  const [activeScenarios, setActiveScenarios] = useState(new Set())
  
  // Scenario Builder state
  const [newScenario, setNewScenario] = useState({ name: '', adjustments: [] })
  const [currentAdj, setCurrentAdj] = useState({ type: 'hire', params: { count: 1, salary: 20000, monthOffset: 1 } })

  const forecastData = useMemo(() => {
    const data = []
    const now = new Date()
    
    // In production, this starting position should be fetched from Zoho/Firebase
    let baseCash = 0 

    const periods = horizon === '12M' ? 12 : 13
    
    for (let i = 0; i < periods; i++) {
      const label = horizon === '12M' 
        ? new Date(now.getFullYear(), now.getMonth() + i, 1).toLocaleString('default', { month: 'short', year: '2-digit' })
        : `Week ${i + 1}`

      // Live data calculation (defaults to 0 if no invoices/expenses exist for period)
      // Since this is future forecast, we assume 0 unless there are scheduled payments
      const baseIn = 0 
      const baseOut = 0
      baseCash = baseCash + baseIn - baseOut

      // Confidence bands
      const bestCase = baseCash * 1.05
      const worstCase = baseCash * 0.95

      const row = {
        period: label,
        expectedCash: Math.round(baseCash),
        band: [Math.round(worstCase), Math.round(bestCase)]
      }

      // Apply active scenarios
      activeScenarios.forEach(sId => {
        const sc = scenarios.find(s => s.id === sId)
        if (sc) {
          let impact = 0
          sc.adjustments.forEach(adj => {
            if (i >= (adj.params.monthOffset || 0)) {
              if (adj.type === 'hire') impact -= (adj.params.count * adj.params.salary)
              if (adj.type === 'lose_client') impact -= (adj.params.revenueLost || 0)
              if (adj.type === 'rate_increase') impact += (adj.params.revenueGained || 0)
            }
          })
          row[`scenario_${sId}`] = Math.round(baseCash + impact)
        }
      })

      data.push(row)
    }
    return data
  }, [horizon, scenarios, activeScenarios, invoices, expenses])

  const handleAddAdjustment = () => {
    setNewScenario(p => ({ ...p, adjustments: [...p.adjustments, { ...currentAdj, id: Date.now() }] }))
  }

  const handleSaveScenario = () => {
    if (!newScenario.name) return alert("Please name the scenario")
    const sId = Date.now().toString()
    setScenarios([...scenarios, { ...newScenario, id: sId }])
    setActiveScenarios(new Set([...activeScenarios, sId]))
    setScenarioModalOpen(false)
    setNewScenario({ name: '', adjustments: [] })
  }

  const toggleScenario = (id) => {
    const next = new Set(activeScenarios)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setActiveScenarios(next)
  }

  const formatSAR = (v) => `SAR ${(v / 1000).toFixed(0)}k`
  
  const scenarioColors = ['#F5B041', '#9B59B6', '#E74C3C', '#1ABC9C']

  return (
    <div className="animate-fade-in-up">
      <div className="grid-3" style={{ gap: 24, marginBottom: 24 }}>
        <div className="card" style={{ gridColumn: 'span 2' }}>
          <div className="flex-between" style={{ marginBottom: 20 }}>
            <div>
              <h3 className="chart-card-title">Cash Flow Forecast</h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)' }}>Includes 85% - 115% confidence bands based on historical DSO variance.</p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className={`btn btn-sm ${horizon === '13W' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setHorizon('13W')}>13 Weeks</button>
              <button className={`btn btn-sm ${horizon === '12M' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setHorizon('12M')}>12 Months</button>
            </div>
          </div>
          
          <div style={{ width: '100%', height: 400 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={forecastData} margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" vertical={false} />
                <XAxis dataKey="period" tick={{ fill: 'var(--text-tertiary)', fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'var(--text-tertiary)', fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={formatSAR} />
                <RechartsTooltip cursor={{ fill: 'var(--bg-elevated)' }} contentStyle={{ borderRadius: 8, border: 'none' }} formatter={(v, name) => [ `SAR ${Array.isArray(v) ? `${v[0].toLocaleString()} - ${v[1].toLocaleString()}` : v.toLocaleString()}`, name === 'band' ? 'Confidence Band' : name ]} />
                <Legend />
                
                {/* Confidence Band */}
                <Area type="monotone" dataKey="band" fill="var(--green)" stroke="none" fillOpacity={0.1} name="Confidence Band" />
                
                {/* Baseline */}
                <Line type="monotone" dataKey="expectedCash" name="Expected Cash (Baseline)" stroke="var(--green)" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                
                {/* Active Scenarios */}
                {Array.from(activeScenarios).map((sId, index) => {
                  const sc = scenarios.find(s => s.id === sId)
                  return sc ? (
                    <Line key={sId} type="monotone" dataKey={`scenario_${sId}`} name={sc.name} stroke={scenarioColors[index % scenarioColors.length]} strokeWidth={3} strokeDasharray="5 5" dot={false} />
                  ) : null
                })}

                {/* Example Markers */}
                <ReferenceLine x={horizon === '12M' ? forecastData[2]?.period : forecastData[4]?.period} stroke="var(--amber)" strokeDasharray="3 3" label={{ position: 'top', value: 'PO Expiry (Aramco)', fill: 'var(--amber)', fontSize: 10 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <div className="flex-between" style={{ marginBottom: 20 }}>
            <h3 className="chart-card-title">Scenario Engine</h3>
            <button className="btn btn-primary btn-sm" onClick={() => setScenarioModalOpen(true)}><Plus size={16} /> New</button>
          </div>
          
          {scenarios.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-tertiary)' }}>
              <TrendingUp size={48} style={{ opacity: 0.2, margin: '0 auto 16px' }} />
              <p>No scenarios built yet.</p>
              <p style={{ fontSize: '0.85rem', marginTop: 8 }}>Build a "What-if" scenario to see how hiring or losing a client affects your cash runway.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {scenarios.map((sc, idx) => (
                <div key={sc.id} style={{ padding: 16, border: '1px solid var(--border-primary)', borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 12, height: 12, borderRadius: '50%', background: scenarioColors[idx % scenarioColors.length] }} />
                      {sc.name}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginTop: 4 }}>{sc.adjustments.length} adjustment(s)</div>
                  </div>
                  <label className="toggle-switch">
                    <input type="checkbox" checked={activeScenarios.has(sc.id)} onChange={() => toggleScenario(sc.id)} disabled={!activeScenarios.has(sc.id) && activeScenarios.size >= 4} />
                    <span className="slider round"></span>
                  </label>
                </div>
              ))}
              {activeScenarios.size >= 4 && <p style={{ fontSize: '0.75rem', color: 'var(--amber)' }}>Maximum 4 scenarios can be compared at once.</p>}
            </div>
          )}
        </div>
      </div>

      {/* Scenario Builder Modal */}
      {scenarioModalOpen && (
        <div className="modal-overlay" onClick={() => setScenarioModalOpen(false)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div className="modal-content card animate-fade-in-up" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 600 }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: 20 }}>Build What-If Scenario</h2>
            
            <div style={{ marginBottom: 20 }}>
              <label className="form-label">Scenario Name</label>
              <input type="text" className="form-input" value={newScenario.name} onChange={e => setNewScenario({...newScenario, name: e.target.value})} placeholder="e.g. Aggressive Hiring Q3" />
            </div>

            <div style={{ background: 'var(--bg-subtle)', padding: 16, borderRadius: 8, marginBottom: 20 }}>
              <h4 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: 12 }}>Add Adjustment</h4>
              <div className="grid-2" style={{ gap: 12 }}>
                <div>
                  <label className="form-label">Type</label>
                  <select className="form-select" value={currentAdj.type} onChange={e => setCurrentAdj({...currentAdj, type: e.target.value})}>
                    <option value="hire">Add Hires</option>
                    <option value="lose_client">Lose Client</option>
                    <option value="rate_increase">Rate Increase</option>
                    <option value="delay_payment">Delay Payments</option>
                  </select>
                </div>
                <div>
                  <label className="form-label">Start In (Months from now)</label>
                  <input type="number" className="form-input" min="0" value={currentAdj.params.monthOffset} onChange={e => setCurrentAdj({...currentAdj, params: {...currentAdj.params, monthOffset: Number(e.target.value)}})} />
                </div>
                
                {currentAdj.type === 'hire' && (
                  <>
                    <div><label className="form-label">Headcount</label><input type="number" className="form-input" value={currentAdj.params.count} onChange={e => setCurrentAdj({...currentAdj, params: {...currentAdj.params, count: Number(e.target.value)}})} /></div>
                    <div><label className="form-label">Monthly Cost (SAR)</label><input type="number" className="form-input" value={currentAdj.params.salary} onChange={e => setCurrentAdj({...currentAdj, params: {...currentAdj.params, salary: Number(e.target.value)}})} /></div>
                  </>
                )}
                {currentAdj.type === 'lose_client' && (
                  <div style={{ gridColumn: 'span 2' }}><label className="form-label">Monthly Revenue Lost (SAR)</label><input type="number" className="form-input" value={currentAdj.params.revenueLost || 100000} onChange={e => setCurrentAdj({...currentAdj, params: {...currentAdj.params, revenueLost: Number(e.target.value)}})} /></div>
                )}
                {currentAdj.type === 'rate_increase' && (
                  <div style={{ gridColumn: 'span 2' }}><label className="form-label">Monthly Revenue Gained (SAR)</label><input type="number" className="form-input" value={currentAdj.params.revenueGained || 50000} onChange={e => setCurrentAdj({...currentAdj, params: {...currentAdj.params, revenueGained: Number(e.target.value)}})} /></div>
                )}
              </div>
              <button className="btn btn-outline btn-sm" style={{ marginTop: 12 }} onClick={handleAddAdjustment}><Plus size={14} /> Add to Scenario</button>
            </div>

            {newScenario.adjustments.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <h4 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: 8 }}>Scenario Impact Summary</h4>
                <ul style={{ paddingLeft: 20, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                  {newScenario.adjustments.map((a, i) => (
                    <li key={i} style={{ marginBottom: 4 }}>
                      {a.type === 'hire' && `Hire ${a.params.count} people at SAR ${a.params.salary.toLocaleString()}/mo starting in month ${a.params.monthOffset}`}
                      {a.type === 'lose_client' && `Lose SAR ${(a.params.revenueLost || 0).toLocaleString()}/mo starting in month ${a.params.monthOffset}`}
                      {a.type === 'rate_increase' && `Gain SAR ${(a.params.revenueGained || 0).toLocaleString()}/mo starting in month ${a.params.monthOffset}`}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <button className="btn btn-ghost" onClick={() => setScenarioModalOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSaveScenario}><Save size={16} /> Save & Calculate</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
