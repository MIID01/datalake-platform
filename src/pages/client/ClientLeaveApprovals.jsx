import { useState, useEffect, useMemo } from 'react'
import { auth, db } from '../../lib/firebase'
import {
  collection, query, where, onSnapshot, doc, updateDoc,
  arrayUnion, serverTimestamp, getDoc,
} from 'firebase/firestore'
import {
  CheckCircle2, XCircle, Clock, Calendar, MessageSquare,
  Loader, AlertTriangle, History, Inbox,
} from 'lucide-react'

const STATUS_LABEL = {
  CLIENT_PENDING: { label: 'Awaiting your decision', color: '#F39C12', bg: 'rgba(243,156,18,0.12)' },
  CLIENT_APPROVED: { label: 'You approved → at Datalake PM', color: '#1598CC', bg: 'rgba(21,152,204,0.12)' },
  PM_APPROVED: { label: 'You approved → with HR', color: '#1598CC', bg: 'rgba(21,152,204,0.12)' },
  APPROVED: { label: 'Approved', color: '#34BF3A', bg: 'rgba(52,191,58,0.12)' },
  REJECTED: { label: 'Rejected', color: '#C0392B', bg: 'rgba(192,57,43,0.12)' },
}

function fmtDate(s) {
  if (!s) return '—'
  return new Date(s + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtTimestamp(ts) {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function ClientLeaveApprovals() {
  const [tab, setTab] = useState('pending') // 'pending' | 'history'
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [clientUser, setClientUser] = useState(null)
  const [activeReq, setActiveReq] = useState(null)
  const [comment, setComment] = useState('')
  const [actioning, setActioning] = useState(false)
  const [toast, setToast] = useState(null)

  const userEmail = auth.currentUser?.email

  // Confirm the signed-in user is a client (defense in depth — AuthGate is the real boundary)
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (!auth.currentUser) {
        if (!cancelled) { setLoadError('Not signed in.'); setLoading(false) }
        return
      }
      try {
        const snap = await getDoc(doc(db, 'users', auth.currentUser.uid))
        if (cancelled) return
        if (!snap.exists()) { setLoadError('Your client account is missing a user record.'); setLoading(false); return }
        const d = snap.data()
        setClientUser({ uid: auth.currentUser.uid, email: d.email || auth.currentUser.email, name: d.display_name || d.full_name || d.email, role_id: d.role_id })
      } catch (e) {
        if (!cancelled) { setLoadError(e.message); setLoading(false) }
      }
    }
    run()
    return () => { cancelled = true }
  }, [])

  // Subscribe to leave_requests routed to this client PM
  useEffect(() => {
    if (!userEmail) return
    const q = query(collection(db, 'leave_requests'), where('client_pm_email', '==', userEmail))
    const unsub = onSnapshot(q,
      snap => {
        const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        rows.sort((a, b) => (b.created_at?.seconds || 0) - (a.created_at?.seconds || 0))
        setRequests(rows)
        setLoading(false)
      },
      err => { setLoadError(err.message); setLoading(false) },
    )
    return () => unsub()
  }, [userEmail])

  const pending = useMemo(() => requests.filter(r => r.status === 'CLIENT_PENDING'), [requests])
  const history = useMemo(() => requests.filter(r => r.status !== 'CLIENT_PENDING'), [requests])

  const showToast = (msg, kind = 'success') => {
    setToast({ msg, kind })
    setTimeout(() => setToast(null), 3500)
  }

  const handleDecision = async (req, action) => {
    if (!clientUser) return
    if (action === 'reject' && !comment.trim()) {
      showToast('Please add a comment explaining the rejection', 'error'); return
    }
    setActioning(true)
    try {
      const isApprove = action === 'approve'
      const entry = {
        role: 'client_pm',
        name: clientUser.name,
        email: clientUser.email,
        action: isApprove ? 'approved' : 'rejected',
        comment: comment.trim() || null,
        at: new Date().toISOString(),
      }
      await updateDoc(doc(db, 'leave_requests', req.id), {
        status: isApprove ? 'CLIENT_APPROVED' : 'REJECTED',
        client_approval_at: serverTimestamp(),
        client_approval_comment: comment.trim() || null,
        client_approval_action: isApprove ? 'approved' : 'rejected',
        approval_history: arrayUnion(entry),
        updated_at: serverTimestamp(),
      })
      showToast(isApprove ? 'Approved — forwarded to Datalake PM.' : 'Request rejected.')
      setComment('')
      setActiveReq(null)
    } catch (e) {
      showToast(`Failed: ${e.message}`, 'error')
    } finally {
      setActioning(false)
    }
  }

  if (loadError) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <AlertTriangle size={32} color="#C0392B" style={{ marginBottom: 12 }} />
        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: 6 }}>Unable to load leave approvals</h3>
        <p style={{ color: 'var(--text-tertiary)' }}>{loadError}</p>
      </div>
    )
  }

  const rows = tab === 'pending' ? pending : history

  return (
    <div style={{ position: 'relative' }}>
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          padding: '12px 20px', borderRadius: 10, fontSize: '0.85rem', fontWeight: 600,
          background: toast.kind === 'error' ? 'rgba(192,57,43,0.95)' : 'rgba(52,191,58,0.95)',
          color: '#fff', boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          {toast.kind === 'error' ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />} {toast.msg}
        </div>
      )}

      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Leave Approvals</h1>
        <p style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem', marginTop: 4 }}>
          Approve or reject leave requests from engineers assigned to your projects. Your decision is the first step;
          the request then goes to the Datalake PM, and to HR for longer absences.
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border-primary)', marginBottom: 20 }}>
        <button
          onClick={() => setTab('pending')}
          style={{
            padding: '10px 18px', border: 'none', background: 'transparent', cursor: 'pointer',
            fontSize: '0.88rem', fontWeight: 600,
            color: tab === 'pending' ? 'var(--accent-primary, #1598CC)' : 'var(--text-secondary)',
            borderBottom: `2px solid ${tab === 'pending' ? 'var(--accent-primary, #1598CC)' : 'transparent'}`,
            display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: -1,
          }}
        >
          <Clock size={15} /> Pending {pending.length > 0 && <span style={{
            background: 'rgba(243,156,18,0.15)', color: '#F39C12',
            padding: '1px 8px', borderRadius: 10, fontSize: '0.72rem',
          }}>{pending.length}</span>}
        </button>
        <button
          onClick={() => setTab('history')}
          style={{
            padding: '10px 18px', border: 'none', background: 'transparent', cursor: 'pointer',
            fontSize: '0.88rem', fontWeight: 600,
            color: tab === 'history' ? 'var(--accent-primary, #1598CC)' : 'var(--text-secondary)',
            borderBottom: `2px solid ${tab === 'history' ? 'var(--accent-primary, #1598CC)' : 'transparent'}`,
            display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: -1,
          }}
        >
          <History size={15} /> History ({history.length})
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: activeReq ? '1fr 420px' : '1fr', gap: 20 }}>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {loading ? (
            <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-tertiary)' }}>
              <Loader size={24} className="spin" /><div style={{ marginTop: 8 }}>Loading…</div>
            </div>
          ) : rows.length === 0 ? (
            <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-tertiary)' }}>
              <Inbox size={36} style={{ opacity: 0.4, marginBottom: 10 }} />
              <div style={{ fontWeight: 600 }}>
                {tab === 'pending' ? 'No requests need your decision' : 'No past decisions yet'}
              </div>
              <div style={{ fontSize: '0.8rem', marginTop: 4 }}>
                {tab === 'pending'
                  ? 'Engineers assigned to your projects will appear here when they request leave.'
                  : 'Decisions you make on the Pending tab will show up here.'}
              </div>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Engineer</th><th>Dates</th><th>Type</th><th>Days</th><th>Reason</th><th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const sc = STATUS_LABEL[r.status] || { label: r.status, color: '#78909C', bg: 'rgba(120,144,156,0.12)' }
                  return (
                    <tr key={r.id} style={{ cursor: 'pointer', background: activeReq?.id === r.id ? 'var(--bg-surface)' : 'transparent' }} onClick={() => { setActiveReq(r); setComment('') }}>
                      <td style={{ fontWeight: 600 }}>{r.engineer_name || r.engineer_email}</td>
                      <td style={{ fontSize: '0.82rem' }}>{fmtDate(r.start_date)} — {fmtDate(r.end_date)}</td>
                      <td>{r.leave_type_label || r.leave_type}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{r.working_days}</td>
                      <td style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.reason || '—'}</td>
                      <td>
                        <span style={{ padding: '2px 10px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600, background: sc.bg, color: sc.color }}>
                          {sc.label}
                        </span>
                      </td>
                      <td>
                        {tab === 'pending'
                          ? <button className="btn btn-primary btn-sm" onClick={(e) => { e.stopPropagation(); setActiveReq(r); setComment('') }}>Review</button>
                          : <span style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>{fmtTimestamp(r.client_approval_at)}</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Detail / decision panel */}
        {activeReq && (
          <div className="card animate-fade-in-up" style={{ alignSelf: 'flex-start', position: 'sticky', top: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
              <div>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 700 }}>{activeReq.engineer_name || activeReq.engineer_email}</h3>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: 2 }}>
                  {activeReq.leave_id}
                </div>
              </div>
              <button onClick={() => setActiveReq(null)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--text-tertiary)' }}>×</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14, fontSize: '0.82rem' }}>
              <div>
                <div style={{ color: 'var(--text-tertiary)', fontSize: '0.72rem', textTransform: 'uppercase', fontWeight: 600 }}>Type</div>
                <div>{activeReq.leave_type_label || activeReq.leave_type}</div>
              </div>
              <div>
                <div style={{ color: 'var(--text-tertiary)', fontSize: '0.72rem', textTransform: 'uppercase', fontWeight: 600 }}>Working Days</div>
                <div style={{ fontFamily: 'var(--font-mono)' }}>{activeReq.working_days}</div>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <div style={{ color: 'var(--text-tertiary)', fontSize: '0.72rem', textTransform: 'uppercase', fontWeight: 600 }}>Dates</div>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Calendar size={13} /> {fmtDate(activeReq.start_date)} → {fmtDate(activeReq.end_date)}</div>
              </div>
              {activeReq.project_id && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <div style={{ color: 'var(--text-tertiary)', fontSize: '0.72rem', textTransform: 'uppercase', fontWeight: 600 }}>Project</div>
                  <div>{activeReq.client_name || ''} · {activeReq.project_id}</div>
                </div>
              )}
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ color: 'var(--text-tertiary)', fontSize: '0.72rem', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>Reason</div>
              <div style={{ fontSize: '0.85rem', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{activeReq.reason || '—'}</div>
            </div>

            {activeReq.handover_notes && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ color: 'var(--text-tertiary)', fontSize: '0.72rem', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>Handover</div>
                <div style={{ fontSize: '0.85rem', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{activeReq.handover_notes}</div>
              </div>
            )}

            {tab === 'pending' ? (
              <>
                <div className="form-group" style={{ marginBottom: 14 }}>
                  <label className="form-label">
                    <MessageSquare size={12} style={{ verticalAlign: -1, marginRight: 4 }} />
                    Comment (optional for approval, required for rejection)
                  </label>
                  <textarea className="form-input" rows={3} value={comment}
                    onChange={e => setComment(e.target.value)}
                    placeholder="Visible to the engineer and the Datalake PM…" />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn btn-success" style={{ flex: 1 }}
                    onClick={() => handleDecision(activeReq, 'approve')}
                    disabled={actioning}
                  >
                    {actioning ? <Loader size={14} className="spin" /> : <CheckCircle2 size={14} />} Approve
                  </button>
                  <button
                    className="btn btn-ghost" style={{ flex: 1, color: '#C0392B', borderColor: 'rgba(192,57,43,0.3)' }}
                    onClick={() => handleDecision(activeReq, 'reject')}
                    disabled={actioning}
                  >
                    {actioning ? <Loader size={14} className="spin" /> : <XCircle size={14} />} Reject
                  </button>
                </div>
              </>
            ) : (
              <div>
                <div style={{ color: 'var(--text-tertiary)', fontSize: '0.72rem', textTransform: 'uppercase', fontWeight: 600, marginBottom: 6 }}>Your decision</div>
                <div style={{ fontSize: '0.85rem' }}>
                  <strong>{(activeReq.client_approval_action || '').toUpperCase()}</strong> · {fmtTimestamp(activeReq.client_approval_at)}
                </div>
                {activeReq.client_approval_comment && (
                  <div style={{ marginTop: 8, fontSize: '0.85rem', padding: '8px 12px', background: 'var(--bg-surface)', borderRadius: 8, whiteSpace: 'pre-wrap' }}>
                    {activeReq.client_approval_comment}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <style>{`
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
