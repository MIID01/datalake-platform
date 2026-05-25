// Shared inline styles for the IT Administration portal (dark teal shell).
export const s = {
  page: { padding: '28px 24px', maxWidth: 1200, margin: '0 auto' },
  h1: { fontSize: '1.4rem', fontWeight: 800, color: '#fff', margin: '0 0 4px' },
  sub: { color: 'rgba(255,255,255,0.55)', fontSize: '0.85rem', margin: '0 0 20px' },
  card: { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: 20 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' },
  th: { textAlign: 'left', padding: '10px 12px', color: 'rgba(255,255,255,0.5)', fontWeight: 600, fontSize: '0.7rem', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.1)' },
  td: { padding: '10px 12px', color: 'rgba(255,255,255,0.85)', borderBottom: '1px solid rgba(255,255,255,0.06)' },
  mono: { fontFamily: "'JetBrains Mono', monospace", fontSize: '0.78rem' },
  btnDisabled: { padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)', fontSize: '0.74rem', cursor: 'not-allowed', display: 'inline-flex', alignItems: 'center', gap: 5 },
  notice: { display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 16px', borderRadius: 10, background: 'rgba(21,152,204,0.1)', border: '1px solid rgba(21,152,204,0.25)', color: '#7dd3fc', fontSize: '0.82rem', marginBottom: 20 },
  loading: { padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.5)' },
  error: { padding: '12px 16px', borderRadius: 10, background: 'rgba(192,57,43,0.12)', border: '1px solid rgba(192,57,43,0.3)', color: '#fca5a5', fontSize: '0.82rem', marginBottom: 16 },
  empty: { padding: 48, textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: '0.85rem' },
}

export function statusBadge(status) {
  const active = status === 'active'
  return { padding: '2px 10px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600, color: active ? '#4ade80' : '#fca5a5', background: active ? 'rgba(52,191,58,0.15)' : 'rgba(192,57,43,0.15)' }
}

export function roleBadge() {
  return { padding: '2px 10px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600, color: '#38bdf8', background: 'rgba(21,152,204,0.15)' }
}

export function fmtTime(ts) {
  if (!ts) return '—'
  const ms = ts?.toDate ? ts.toDate().getTime() : ts?._seconds ? ts._seconds * 1000 : ts?.seconds ? ts.seconds * 1000 : Date.parse(ts)
  return Number.isFinite(ms) ? new Date(ms).toLocaleString() : '—'
}
