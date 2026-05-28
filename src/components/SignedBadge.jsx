import { useEffect, useState } from 'react'
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore'
import { db } from '../lib/firebase'
import {
  ShieldCheck, X, Paperclip, Globe, Monitor, Loader, FileSignature, ExternalLink,
} from 'lucide-react'

// ──────────────────────────────────────────────────────────────────
// Reusable signed-badge surface.
//
// Two modes:
//   - inline (`evidence` prop): renders a pill/badge for a single evidence
//     record (used by ApprovalButton's "done" state).
//   - subscribe (`parentCollection` + `parentId`): subscribes to the
//     approval_evidence subcollection and renders one badge per row,
//     newest first. Use this on the parent doc page (invoice, payroll,
//     contract) so any historical approval shows up.
//
// Click the badge → opens EvidenceTrailModal with full audit data.
// ──────────────────────────────────────────────────────────────────

function fmtTimestamp(ts) {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString()
}

function shortHash(h) {
  if (!h) return '—'
  return `${h.slice(0, 8)}…${h.slice(-6)}`
}

const ROLE_LABEL = {
  ceo: 'CEO',
  finance: 'Finance',
  hr: 'HR',
  it_admin: 'IT Admin',
  client_pm: 'Client PM',
  pm: 'PM',
  'legal:external': 'External Legal Counsel',
  legal: 'Legal',
  employee: 'Employee',
  client: 'Client',
}

function roleLabel(role) {
  if (!role) return '—'
  return ROLE_LABEL[role] || role
}

export function SignedBadge({ evidence, onClick, compact = false }) {
  if (!evidence) return null
  const sig = evidence.signature_url
  const name = evidence.approver_name || evidence.approver_email || 'Unknown'
  const role = roleLabel(evidence.approver_role)
  const ts = fmtTimestamp(evidence.approved_at)
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 10,
        padding: compact ? '6px 10px' : '8px 14px',
        borderRadius: 999, border: '1px solid rgba(52,191,58,0.4)',
        background: 'rgba(52,191,58,0.10)', color: 'var(--text-primary)',
        cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
      }}
      title="View evidence trail"
    >
      {sig ? (
        <img src={sig} alt="signature" style={{
          width: compact ? 36 : 48, height: compact ? 20 : 28,
          background: '#fff', borderRadius: 4, objectFit: 'contain',
          border: '1px solid rgba(0,0,0,0.08)',
        }} />
      ) : (
        <ShieldCheck size={compact ? 14 : 16} color="#34BF3A" />
      )}
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
        <span style={{ fontWeight: 700, fontSize: compact ? '0.78rem' : '0.85rem' }}>
          Signed by {name}
        </span>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
          {role} · {ts}
        </span>
      </span>
    </button>
  )
}

// ──────────────────────────────────────────────────────────────────
// SignedBadgeList — subscribes and renders multiple badges.
// ──────────────────────────────────────────────────────────────────
export function SignedBadgeList({ parentCollection, parentId, compact = false }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [active, setActive] = useState(null)

  useEffect(() => {
    if (!parentCollection || !parentId) return
    const q = query(
      collection(db, `${parentCollection}/${parentId}/approval_evidence`),
      orderBy('approved_at', 'desc'),
    )
    const unsub = onSnapshot(q,
      snap => { setItems(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false) },
      () => setLoading(false),
    )
    return () => unsub()
  }, [parentCollection, parentId])

  if (loading) return <span style={{ color: 'var(--text-tertiary)', fontSize: '0.78rem' }}><Loader size={12} className="spin" /> Loading evidence…</span>
  if (items.length === 0) return null

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {items.map(ev => (
        <SignedBadge key={ev.id} evidence={ev} compact={compact} onClick={() => setActive(ev)} />
      ))}
      {active && <EvidenceTrailModal evidence={active} onClose={() => setActive(null)} />}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────
// EvidenceTrailModal — full record inspector.
// ──────────────────────────────────────────────────────────────────
export function EvidenceTrailModal({ evidence, onClose }) {
  if (!evidence) return null
  const row = (label, val, mono = false) => (
    <div style={{ display: 'flex', gap: 12, padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
      <div style={{ width: 160, color: 'rgba(255,255,255,0.55)', fontSize: '0.78rem', textTransform: 'uppercase', fontWeight: 600, flexShrink: 0 }}>
        {label}
      </div>
      <div style={{ flex: 1, fontSize: '0.85rem', color: '#fff', fontFamily: mono ? "'JetBrains Mono', monospace" : 'inherit', wordBreak: 'break-all' }}>
        {val || <span style={{ color: 'rgba(255,255,255,0.35)' }}>—</span>}
      </div>
    </div>
  )

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(6px)', zIndex: 10001,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16, overflowY: 'auto',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#0f1d36', border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 14, maxWidth: 720, width: '100%',
          maxHeight: 'calc(100vh - 32px)', display: 'flex', flexDirection: 'column',
          color: '#fff', fontFamily: "'DM Sans', sans-serif",
        }}
      >
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <FileSignature size={18} color="#34BF3A" />
            <div>
              <div style={{ fontSize: '1rem', fontWeight: 700 }}>Approval Evidence</div>
              <div style={{ fontSize: '0.74rem', color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>
                {evidence.label || 'Approval'}
                {evidence.parent_collection ? ` · ${evidence.parent_collection}/${evidence.parent_id}` : ''}
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.55)', cursor: 'pointer', padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: 20, overflowY: 'auto' }}>
          {evidence.signature_url && (
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', fontWeight: 600, marginBottom: 6 }}>
                Signature {evidence.signature_method ? `(${evidence.signature_method})` : ''}
              </div>
              <div style={{ background: '#fff', borderRadius: 8, padding: 12, textAlign: 'center' }}>
                <img src={evidence.signature_url} alt="signature" style={{
                  maxWidth: '100%', maxHeight: 180, objectFit: 'contain',
                }} />
              </div>
            </div>
          )}

          {row('Approver',     evidence.approver_name)}
          {row('Role',         roleLabel(evidence.approver_role))}
          {row('Email',        evidence.approver_email, true)}
          {row('Approved at',  fmtTimestamp(evidence.approved_at))}
          {row('IP address',   evidence.ip_address || 'not captured (network policy)', true)}
          {row('User agent',   evidence.user_agent, true)}
          {row('Action',       evidence.action)}
          {evidence.requires_document && (
            <>
              {row('Document',     evidence.evidence_filename ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Paperclip size={12} />
                  {evidence.evidence_url ? (
                    <a href={evidence.evidence_url} target="_blank" rel="noreferrer" style={{ color: '#38bdf8', textDecoration: 'none' }}>
                      {evidence.evidence_filename} <ExternalLink size={11} style={{ verticalAlign: -1 }} />
                    </a>
                  ) : evidence.evidence_filename}
                </span>
              ) : null)}
              {row('SHA-256',      <span title={evidence.evidence_sha256} style={{ fontFamily: "'JetBrains Mono', monospace" }}>{shortHash(evidence.evidence_sha256)}</span>)}
              {row('Storage path', evidence.evidence_storage_path, true)}
            </>
          )}
          {evidence.signature_storage_path && row('Signature path', evidence.signature_storage_path, true)}

          {/* Surface any caller-supplied extras (invoice_number, period, etc.) */}
          {Object.entries(evidence).filter(([k]) => ![
            'id', 'approver_uid', 'approver_email', 'approver_name', 'approver_role',
            'approved_at', 'ip_address', 'user_agent', 'evidence_url', 'evidence_filename',
            'evidence_size_bytes', 'evidence_mime_type', 'evidence_sha256', 'evidence_storage_path',
            'requires_document', 'label', 'action', 'parent_collection', 'parent_id',
            'signature_url', 'signature_storage_path', 'signature_method', 'signature_size_bytes',
          ].includes(k)).map(([k, v]) => row(k, typeof v === 'object' ? JSON.stringify(v) : String(v)))}
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid rgba(255,255,255,0.08)', fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Globe size={11} /> IP &amp; user agent recorded at submission time
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Monitor size={11} /> Evidence id: <code style={{ fontFamily: "'JetBrains Mono', monospace" }}>{evidence.id}</code>
          </span>
        </div>
      </div>
    </div>
  )
}

export default SignedBadge
