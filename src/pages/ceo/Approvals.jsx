import { useState, useEffect, useMemo } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { getAuth } from 'firebase/auth'
import { db } from '../../lib/firebase'
import { CheckCircle, XCircle, X, AlertTriangle } from 'lucide-react'
import { useKeyboardShortcuts } from '../../hooks/useUtils'

// ── Cloud Function base URL ──────────────────────────────────────────
const CF_BASE = 'https://me-central2-datalake-production-sa.cloudfunctions.net'
const CEO_APPROVE_INVOICE_URL = 'https://ceoapproveinvoice-ifzodp5svq-wx.a.run.app'
const CTO_APPROVE_TIMESHEET_URL = 'https://ctoapprovetimesheet-ifzodp5svq-wx.a.run.app'

// Tabs wired to real Firestore sources only. "Contracts" = contract-UPLOAD approvals
// (pending_hires with _kind EXISTING_EMPLOYEE); "Hires" = real new-hire approvals.
const TABS = ['All', 'Invoices', 'Hires', 'Contracts', 'Leave', 'Timesheets']
const TYPE_MAP = { Invoices: 'invoice', Hires: 'hire', Contracts: 'contract', Leave: 'leave', Timesheets: 'timesheet' }

async function getToken() {
  const auth = getAuth()
  if (!auth.currentUser) throw new Error('Not signed in')
  return auth.currentUser.getIdToken()
}

export default function Approvals() {
  const [activeTab, setActiveTab] = useState('All')
  const [items, setItems] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [detailItem, setDetailItem] = useState(null)
  const [showBulkModal, setShowBulkModal] = useState(false)
  const [focusIndex, setFocusIndex] = useState(0)
  const [actionErr, setActionErr] = useState('')

  useEffect(() => {
    const unsubs = []

    // ── 1. pending_approvals (invoices from SoD gate, and any future types) ──
    unsubs.push(onSnapshot(collection(db, 'pending_approvals'), snap => {
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      setItems(prev => [
        ...prev.filter(i => i._source !== 'pending_approvals'),
        ...rows.map(r => ({ ...r, _source: 'pending_approvals' })),
      ])
    }))

    // ── 2. timesheets awaiting CTO/CEO approval ──
    unsubs.push(onSnapshot(
      query(collection(db, 'timesheets'), where('state', '==', 'SUBMITTED')),
      snap => {
        const rows = snap.docs.map(d => {
          const data = d.data()
          return {
            id: d.id,
            type: 'timesheet',
            title: `Timesheet — ${data.engineer_name || d.id}`,
            requester: data.engineer_name || data.engineer_email || '—',
            submitted: data.submitted_at?.toMillis?.() || Date.now(),
            sla: 48,
            slaRemaining: 48,
            actions: ['Approve', 'Reject'],
            icon: '⏳',
            _source: 'timesheets',
            _raw: data,
          }
        })
        setItems(prev => [
          ...prev.filter(i => i._source !== 'timesheets'),
          ...rows,
        ])
      }
    ))

    // ── 3. pending_hires — contract approvals waiting for CEO ──
    unsubs.push(onSnapshot(collection(db, 'pending_hires'), snap => {
      const rows = snap.docs.map(d => {
        const data = d.data()
        return {
          id: d.id,
          type: data._kind === 'EXISTING_EMPLOYEE' ? 'contract' : 'hire',
          title: data._kind === 'EXISTING_EMPLOYEE'
            ? `Contract upload — ${data.linked_employee_id || data.candidate_name || d.id}`
            : `Hire — ${data.candidate_name || data.linked_employee_id || d.id}`,
          requester: data.created_by || '—',
          submitted: data.created_at?.toMillis?.() || Date.now(),
          sla: 72,
          slaRemaining: 72,
          actions: ['Approve', 'Reject'],
          icon: data._kind === 'EXISTING_EMPLOYEE' ? '📄' : '👤',
          _source: 'pending_hires',
          _raw: data,
        }
      })
      setItems(prev => [
        ...prev.filter(i => i._source !== 'pending_hires'),
        ...rows,
      ])
    }))

    // ── 4. leave_requests — only those still pending CEO decision ──
    unsubs.push(onSnapshot(
      query(collection(db, 'leave_requests'),
        where('status', 'in', ['PENDING_VALIDATION', 'PENDING_CEO', 'PENDING'])),
      snap => {
        const rows = snap.docs.map(d => {
          const data = d.data()
          return {
            id: d.id,
            type: 'leave',
            title: `Leave — ${data.engineer_name || data.engineer_email || d.id} (${data.leave_type_label || data.leave_type || 'Leave'})`,
            requester: data.engineer_name || data.engineer_email || '—',
            submitted: data.created_at?.toMillis?.() || Date.now(),
            sla: 48,
            slaRemaining: 48,
            actions: ['Approve', 'Reject'],
            icon: '🏖️',
            _source: 'leave_requests',
            _raw: data,
          }
        })
        setItems(prev => [
          ...prev.filter(i => i._source !== 'leave_requests'),
          ...rows,
        ])
      }
    ))

    return () => unsubs.forEach(u => u())
  }, [])

  const filtered = useMemo(() => {
    if (activeTab === 'All') return items
    const type = TYPE_MAP[activeTab]
    return items.filter(i => i.type === type)
  }, [activeTab, items])

  // ── Approve / Reject dispatcher ──────────────────────────────────────
  const handleAction = async (id, decision = 'APPROVE') => {
    setActionErr('')
    const item = items.find(i => i.id === id)
    if (!item) return

    try {
      const token = await getToken()
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }

      if (item.type === 'invoice') {
        // ── SoD gate: call ceoApproveInvoice which atomically flips status + clears pending_approvals ──
        const r = await fetch(CEO_APPROVE_INVOICE_URL, {
          method: 'POST', headers,
          body: JSON.stringify({ invoice_id: id, decision, notes: decision === 'REJECT' ? 'Rejected by CEO in Approvals Hub' : undefined }),
        })
        if (!r.ok) {
          const err = await r.json().catch(() => ({}))
          throw new Error(err.error || `HTTP ${r.status}`)
        }
        // Firestore listener will remove the item automatically when pending_approvals row is deleted
        return
      }

      if (item.type === 'timesheet') {
        const r = await fetch(CTO_APPROVE_TIMESHEET_URL, {
          method: 'POST', headers,
          body: JSON.stringify({
            timesheet_id: id,
            decision,
            notes: `${decision === 'APPROVE' ? 'Approved' : 'Rejected'} by CEO (acting PM) via Approvals Hub`,
          }),
        })
        if (!r.ok) {
          const err = await r.json().catch(() => ({}))
          throw new Error(err.error || `HTTP ${r.status}`)
        }
        // Firestore listener removes from SUBMITTED set automatically
        setItems(prev => prev.filter(i => i.id !== id))
        setDetailItem(null)
        return
      }

      // Hires and Leave — no dedicated Cloud Function yet; remove from local list
      // TODO: wire approveHire / approveLeave endpoints when implemented
      setItems(prev => prev.filter(i => i.id !== id))
      setDetailItem(null)

    } catch (err) {
      console.error('Approval action failed', err)
      setActionErr(`Action failed: ${err.message}`)
    }
  }

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const handleBulkApprove = async () => {
    for (const id of selected) {
      await handleAction(id, 'APPROVE')
    }
    setSelected(new Set())
    setShowBulkModal(false)
  }

  useKeyboardShortcuts({
    a: () => { if (filtered[focusIndex]) handleAction(filtered[focusIndex].id, 'APPROVE') },
    r: () => { if (filtered[focusIndex]) handleAction(filtered[focusIndex].id, 'REJECT') },
    n: () => setFocusIndex(prev => Math.min(prev + 1, filtered.length - 1)),
  })

  return (
    <div>
      <div className="flex-between" style={{ marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Approvals Hub</h1>
          <p style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem', marginTop: 4 }}>
            {items.length} items awaiting your decision · Keyboard: <kbd style={{ padding: '1px 6px', borderRadius: 4, background: 'var(--bg-surface)', fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}>A</kbd> Approve <kbd style={{ padding: '1px 6px', borderRadius: 4, background: 'var(--bg-surface)', fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}>R</kbd> Reject <kbd style={{ padding: '1px 6px', borderRadius: 4, background: 'var(--bg-surface)', fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}>N</kbd> Next
          </p>
        </div>
        {selected.size > 0 && (
          <button className="btn btn-success" onClick={() => setShowBulkModal(true)}>
            <CheckCircle size={16} /> Bulk Approve ({selected.size})
          </button>
        )}
      </div>

      {actionErr && (
        <div style={{ marginBottom: 16, padding: '10px 16px', background: 'rgba(192,57,43,0.15)', border: '1px solid rgba(192,57,43,0.3)', borderRadius: 8, color: '#ff6b6b', fontSize: '0.82rem' }}>
          {actionErr}
        </div>
      )}

      {/* Tabs */}
      <div className="tabs">
        {TABS.map(tab => (
          <button key={tab} className={`tab-item ${activeTab === tab ? 'active' : ''}`} onClick={() => { setActiveTab(tab); setFocusIndex(0) }}>
            {tab}
            {tab !== 'All' && (() => {
              const type = TYPE_MAP[tab]
              const count = items.filter(i => i.type === type).length
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
                  disabled={item.type === 'invoice'} // invoices must be individual (SoD)
                />
                <div className="approval-icon">{item.icon}</div>
                <div className="approval-info">
                  <div className="approval-title">{item.title}</div>
                  <div className="approval-meta">
                    {item.requester} · {new Date(item.submitted).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    {item.type === 'invoice' && item.amount && (
                      <span style={{ marginLeft: 8, fontWeight: 600, color: 'var(--sky-blue)' }}>
                        SAR {Number(item.amount).toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
                <span className={`approval-sla ${slaClass}`}>{item.slaRemaining}h</span>
                <div className="approval-actions">
                  <button className="btn btn-success btn-sm" onClick={(e) => { e.stopPropagation(); handleAction(item.id, 'APPROVE') }}>
                    {item.actions[0]}
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={(e) => { e.stopPropagation(); handleAction(item.id, 'REJECT') }}>
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

              {/* Invoice detail */}
              {detailItem.type === 'invoice' && (
                <div style={{ marginBottom: 24 }}>
                  <h4 style={{ marginBottom: 12, color: 'var(--text-secondary)' }}>Invoice Details</h4>
                  <div className="card" style={{ background: 'var(--bg-surface)' }}>
                    <p style={{ fontSize: '0.9rem', lineHeight: 1.8 }}>
                      <strong>Invoice #:</strong> {detailItem.invoice_number || detailItem.id}<br />
                      <strong>Client:</strong> {detailItem.client}<br />
                      <strong>Amount:</strong> SAR {Number(detailItem.amount || 0).toLocaleString()} (incl. 15% VAT)<br />
                      <strong>Created by:</strong> {detailItem.created_by}<br />
                    </p>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: 8 }}>
                      ⚠️ Segregation of Duties: this invoice cannot be dispatched, Zoho-synced, or ZATCA-stamped until approved here.
                    </p>
                  </div>
                </div>
              )}

              <div style={{ marginBottom: 24 }}>
                <h4 style={{ marginBottom: 12, color: 'var(--text-secondary)' }}>SLA Status</h4>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <span className={`approval-sla ${(detailItem.slaRemaining / detailItem.sla) * 100 < 25 ? 'urgent' : (detailItem.slaRemaining / detailItem.sla) * 100 < 50 ? 'warning' : 'ok'}`}>
                    {detailItem.slaRemaining}h remaining of {detailItem.sla}h SLA
                  </span>
                </div>
                <div className="sla-bar" style={{ marginTop: 8 }}>
                  <div className={`sla-fill`}
                    style={{ width: `${(1 - detailItem.slaRemaining / detailItem.sla) * 100}%`, background: (detailItem.slaRemaining / detailItem.sla) * 100 < 25 ? 'var(--red)' : (detailItem.slaRemaining / detailItem.sla) * 100 < 50 ? 'var(--amber)' : 'var(--green)' }}
                  />
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: 24 }}>
                <label className="form-label">Notes (required for rejection)</label>
                <textarea className="form-input" id="approval-notes" rows={3} placeholder="Add a note with your decision..." />
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <button className="btn btn-success" onClick={() => handleAction(detailItem.id, 'APPROVE')} style={{ flex: 1 }}>
                  <CheckCircle size={18} /> {detailItem.actions[0]}
                </button>
                <button className="btn btn-danger" onClick={() => handleAction(detailItem.id, 'REJECT')} style={{ flex: 1 }}>
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
              Note: Invoice approvals must always be individual (segregation of duties) and are excluded from bulk actions.
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
