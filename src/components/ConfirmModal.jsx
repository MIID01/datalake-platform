import { useState } from 'react'
import { AlertTriangle, Loader } from 'lucide-react'

// Reusable confirmation modal — the deliberate friction in front of a delete.
// Not a one-click action: for destructive ops set `danger` and optionally
// `typeToConfirm` (the exact text the user must retype) and/or `requireReason`.
//
// Props:
//   open            — controls visibility
//   title           — heading
//   message         — string or node explaining the consequence
//   confirmLabel    — button text (default "Confirm")
//   danger          — red styling for destructive actions
//   typeToConfirm   — if set, Confirm stays disabled until the user types this
//   requireReason   — if true, shows a required reason field; passed to onConfirm
//   busy            — shows a spinner and disables actions
//   onConfirm(reason) / onCancel
export default function ConfirmModal({
  open,
  title = 'Are you sure?',
  message,
  confirmLabel = 'Confirm',
  danger = false,
  typeToConfirm = null,
  requireReason = false,
  busy = false,
  onConfirm,
  onCancel,
}) {
  const [typed, setTyped] = useState('')
  const [reason, setReason] = useState('')
  const [wasOpen, setWasOpen] = useState(false)

  // Reset transient state on the open transition, during render (React's
  // sanctioned "adjust state when a prop changes" pattern — no effect needed).
  if (open && !wasOpen) { setWasOpen(true); setTyped(''); setReason('') }
  if (!open && wasOpen) setWasOpen(false)

  if (!open) return null

  const typeOk = !typeToConfirm || typed.trim() === typeToConfirm.trim()
  const reasonOk = !requireReason || reason.trim().length >= 3
  const canConfirm = typeOk && reasonOk && !busy

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onCancel}>
      <div className="card animate-fade-in-up" style={{ width: 'min(460px, 92vw)', margin: 0 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: danger ? 'rgba(192,57,43,0.12)' : 'rgba(21,152,204,0.12)',
            color: danger ? '#C0392B' : '#1598CC',
          }}>
            <AlertTriangle size={18} />
          </div>
          <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>{title}</h3>
        </div>

        <div style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 16 }}>
          {message}
        </div>

        {requireReason && (
          <div className="form-group" style={{ marginBottom: 14 }}>
            <label className="form-label">Reason (recorded on the item)</label>
            <textarea className="form-input" rows={2} value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why are you deleting this? (min 3 characters)" />
          </div>
        )}

        {typeToConfirm && (
          <div className="form-group" style={{ marginBottom: 14 }}>
            <label className="form-label">
              Type <code style={{ background: 'var(--bg-surface)', padding: '1px 6px', borderRadius: 4 }}>{typeToConfirm}</code> to confirm
            </label>
            <input className="form-input" value={typed}
              onChange={(e) => setTyped(e.target.value)} autoFocus />
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => onConfirm?.(reason.trim())}
            disabled={!canConfirm}
          >
            {busy ? <Loader size={15} className="spin" /> : null} {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
