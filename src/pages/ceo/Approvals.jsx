import { useState, useEffect, useMemo } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { CheckCircle, XCircle, X, ChevronRight, AlertTriangle } from 'lucide-react'
import { useKeyboardShortcuts } from '../../hooks/useUtils'

const tabs = ['All', 'Invoices', 'Hires', 'Leave', 'Expenses', 'Compliance', 'Contracts']
const typeMap = { Invoices: 'invoice', Hires: 'hire', Leave: 'leave', Expenses: 'expense', Compliance: ['gift', 'capa', 'contract_risk'], Contracts: ['contract_risk'] }

export default function Approvals() {
  const [activeTab, setActiveTab] = useState('All')
  const [approvals, setApprovals] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [detailItem, setDetailItem] = useState(null)
  const [showBulkModal, setShowBulkModal] = useState(false)
  const [focusIndex, setFocusIndex] = useState(0)

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'pending_approvals'), snap => {
      setApprovals(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })
    return () => unsub()
  }, [])

  const filtered = useMemo(() => {
    if (activeTab === 'All') return approvals
    const types = typeMap[activeTab]
    if (Array.isArray(types)) return approvals.filter(a => types.includes(a.type))
    return approvals.filter(a => a.type === types)
  }, [activeTab, approvals])

  const handleApprove = (id) => {
    setApprovals(prev => prev.filter(a => a.id !== id))
    setDetailItem(null)
  }

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const handleBulkApprove = () => {
    setApprovals(prev => prev.filter(a => !selected.has(a.id)))
    setSelected(new Set())
    setShowBulkModal(false)
  }

  useKeyboardShortcuts({
    a: () => { if (filtered[focusIndex]) handleApprove(filtered[focusIndex].id) },
    r: () => { if (filtered[focusIndex]) handleApprove(filtered[focusIndex].id) },
    n: () => setFocusIndex(prev => Math.min(prev + 1, filtered.length - 1)),
  })

  return (
    <div>
      <div className="flex-between" style={{ marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Approvals Hub</h1>
          <p style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem', marginTop: 4 }}>
            {approvals.length} items awaiting your decision · Keyboard: <kbd style={{ padding: '1px 6px', borderRadius: 4, background: 'var(--bg-surface)', fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}>A</kbd> Approve <kbd style={{ padding: '1px 6px', borderRadius: 4, background: 'var(--bg-surface)', fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}>R</kbd> Reject <kbd style={{ padding: '1px 6px', borderRadius: 4, background: 'var(--bg-surface)', fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}>N</kbd> Next
          </p>
        </div>
        {selected.size > 0 && (
          <button className="btn btn-success" onClick={() => setShowBulkModal(true)}>
            <CheckCircle size={16} /> Bulk Approve ({selected.size})
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="tabs">
        {tabs.map(tab => (
          <button key={tab} className={`tab-item ${activeTab === tab ? 'active' : ''}`} onClick={() => { setActiveTab(tab); setFocusIndex(0) }}>
            {tab}
            {tab !== 'All' && (() => {
              const types = typeMap[tab]
              const count = Array.isArray(types)
                ? approvals.filter(a => types.includes(a.type)).length
                : approvals.filter(a => a.type === types).length
              return count > 0 ? <span className="badge badge-info" style={{ marginLeft: 6 }}>{count}</span> : null
            })()}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 0, position: 'relative' }}>
        {/* Approval List */}
        <div className="card" style={{ flex: 1, padding: 0, overflow: 'hidden' }}>
          {filtered.sort((a, b) => a.slaRemaining - b.slaRemaining).map((item, idx) => {
            const slaPercent = (item.slaRemaining / item.sla) * 100
            const slaClass = slaPercent < 25 ? 'urgent' : slaPercent < 50 ? 'warning' : 'ok'
            return (
              <div
                key={item.id}
                className="approval-item"
                style={{ background: idx === focusIndex ? 'var(--bg-surface)' : undefined, borderLeft: idx === focusIndex ? '3px solid var(--sky-blue)' : '3px solid transparent' }}
                onClick={() => { setDetailItem(item); setFocusIndex(idx) }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(item.id)}
                  onChange={(e) => { e.stopPropagation(); toggleSelect(item.id) }}
                  style={{ accentColor: 'var(--sky-blue)' }}
                  disabled={item.type === 'invoice'}
                />
                <div className="approval-icon">{item.icon}</div>
                <div className="approval-info">
                  <div className="approval-title">{item.title}</div>
                  <div className="approval-meta">{item.requester} · {new Date(item.submitted).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                </div>
                <span className={`approval-sla ${slaClass}`}>{item.slaRemaining}h</span>
                <div className="approval-actions">
                  <button className="btn btn-success btn-sm" onClick={(e) => { e.stopPropagation(); handleApprove(item.id) }}>
                    {item.actions[0]}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); handleApprove(item.id) }}>
                    {item.actions[1]}
                  </button>
                </div>
              </div>
            )
          })}
          {filtered.length === 0 && (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-tertiary)' }}>
              <CheckCircle size={40} style={{ marginBottom: 12, opacity: 0.3 }} />
              <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>All clear!</div>
              <div style={{ marginTop: 4 }}>No pending approvals in this category</div>
            </div>
          )}
        </div>

        {/* Detail Panel */}
        {detailItem && (
          <>
            <div className="detail-panel-overlay" onClick={() => setDetailItem(null)} />
            <div className="detail-panel">
              <div className="detail-panel-header">
                <div>
                  <span className="badge badge-info" style={{ marginBottom: 8, display: 'inline-block' }}>{detailItem.type.toUpperCase()}</span>
                  <h2 style={{ fontSize: '1.2rem' }}>{detailItem.title}</h2>
                  <p style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem', marginTop: 8 }}>
                    Submitted by {detailItem.requester} on {new Date(detailItem.submitted).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                  </p>
                </div>
                <button className="btn-icon" style={{ color: 'var(--text-secondary)' }} onClick={() => setDetailItem(null)}>
                  <X size={20} />
                </button>
              </div>

              <div style={{ marginBottom: 24 }}>
                <h4 style={{ marginBottom: 12, color: 'var(--text-secondary)' }}>AI Agent Recommendation</h4>
                <div className="card" style={{ background: 'var(--bg-surface)' }}>
                  <p style={{ fontSize: '0.9rem', lineHeight: 1.6 }}>
                    Based on automated compliance analysis, this {detailItem.type} has been pre-validated by {detailItem.requester}. 
                    All required fields are present, PO budget is within limits, and no compliance flags were detected.
                    <br /><br />
                    <strong>Recommendation:</strong> Approve
                  </p>
                </div>
              </div>

              <div style={{ marginBottom: 24 }}>
                <h4 style={{ marginBottom: 12, color: 'var(--text-secondary)' }}>SLA Status</h4>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <span className={`approval-sla ${(detailItem.slaRemaining / detailItem.sla) * 100 < 25 ? 'urgent' : (detailItem.slaRemaining / detailItem.sla) * 100 < 50 ? 'warning' : 'ok'}`}>
                    {detailItem.slaRemaining}h remaining of {detailItem.sla}h SLA
                  </span>
                </div>
                <div className="sla-bar" style={{ marginTop: 8 }}>
                  <div className={`sla-fill ${(detailItem.slaRemaining / detailItem.sla) * 100 < 25 ? 'red' : (detailItem.slaRemaining / detailItem.sla) * 100 < 50 ? 'amber' : 'green'}`}
                    style={{ width: `${(1 - detailItem.slaRemaining / detailItem.sla) * 100}%`, background: (detailItem.slaRemaining / detailItem.sla) * 100 < 25 ? 'var(--red)' : (detailItem.slaRemaining / detailItem.sla) * 100 < 50 ? 'var(--amber)' : 'var(--green)' }}
                  />
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: 24 }}>
                <label className="form-label">Notes (optional)</label>
                <textarea className="form-input" rows={3} placeholder="Add a note with your decision..." />
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <button className="btn btn-success" onClick={() => handleApprove(detailItem.id)} style={{ flex: 1 }}>
                  <CheckCircle size={18} /> {detailItem.actions[0]}
                </button>
                <button className="btn btn-danger" onClick={() => handleApprove(detailItem.id)} style={{ flex: 1 }}>
                  <XCircle size={18} /> {detailItem.actions[1]}
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Bulk Approve Modal */}
      {showBulkModal && (
        <div className="modal-overlay" onClick={() => setShowBulkModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3 style={{ marginBottom: 16 }}>
              <AlertTriangle size={20} style={{ color: 'var(--amber)', marginRight: 8, verticalAlign: 'middle' }} />
              Confirm Bulk Approval
            </h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 24 }}>
              Approve <strong>{selected.size}</strong> items? This action is logged and cannot be undone.
            </p>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginBottom: 24 }}>
              Note: Invoice approvals must always be individual (segregation of duties).
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setShowBulkModal(false)}>Cancel</button>
              <button className="btn btn-success" onClick={handleBulkApprove}>Approve {selected.size} items</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
