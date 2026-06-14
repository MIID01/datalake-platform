import { Loader, AlertTriangle } from 'lucide-react'

// Reusable confirm dialog — SINGLE source for destructive confirmations across the
// app (per-deal delete on board/list/detail, etc). Controlled: render when `open`.
//   <ConfirmDialog open title="Delete deal?" message="…" confirmLabel="Delete"
//     danger busy={busy} error={err} onConfirm={fn} onCancel={fn} />
export default function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false, busy = false, error = '', onConfirm, onCancel }) {
  if (!open) return null
  return (
    <div className="modal-overlay" onClick={() => !busy && onCancel?.()}>
      <div className="card" style={{ width: 'min(440px,94vw)', margin: 0 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          {danger && <AlertTriangle size={18} color="#C0392B" />}
          <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>{title}</h3>
        </div>
        {message && <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 14 }}>{message}</div>}
        {error && <div style={{ fontSize: '0.8rem', color: '#991b1b', marginBottom: 10 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={() => onCancel?.()} disabled={busy}>{cancelLabel}</button>
          <button className="btn write-action" onClick={() => onConfirm?.()} disabled={busy}
            style={danger ? { background: '#C0392B', color: '#fff', border: 'none' } : undefined}>
            {busy ? <Loader size={15} className="spin" /> : null} {busy ? ' Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
