import { useRef, useState } from 'react'
import {
  Upload, CheckCircle2, Loader, AlertCircle, X, Paperclip, ShieldCheck,
} from 'lucide-react'
import { recordApproval } from '../lib/approval-evidence'

// Universal approval button.
//
//   <ApprovalButton
//     parentCollection="invoices"
//     parentId={invoiceId}
//     requiresDocument={true}                 // material approvals attach a signed PDF
//     label="Approve Invoice"
//     onApproved={async (evidence) => { /* flip status here */ }}
//     identity={{ email, name, role }}        // optional — for token-based flows where
//                                             // there is no Firebase Auth user
//   />
//
// When requiresDocument is true the button stays disabled until a PDF is
// dropped/selected. On click: SHA-256 the file → upload to Cloud Storage →
// write the evidence row → invoke onApproved with the resulting record.
//
// When requiresDocument is false: same flow, no file step.

const VARIANT_STYLES = {
  primary: { bg: '#1598CC', border: '#1598CC', color: '#fff' },
  success: { bg: '#34BF3A', border: '#34BF3A', color: '#fff' },
  ceo:     { bg: '#EF5829', border: '#EF5829', color: '#fff' },
  legal:   { bg: '#9C27B0', border: '#9C27B0', color: '#fff' },
}

const cardBase = {
  border: '1px solid var(--border-primary, #E5E7EB)',
  borderRadius: 10,
  padding: 14,
  background: 'var(--bg-surface, rgba(255,255,255,0.03))',
}

function formatBytes(n) {
  if (n == null) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

export default function ApprovalButton({
  parentCollection,
  parentId,
  requiresDocument = false,
  label = 'Approve',
  acceptedTypes = '.pdf,.png,.jpg,.jpeg,.webp',
  maxSizeMb = 15,
  identity = null,
  storagePathPrefix = 'approval-evidence',
  extra = null,
  onApproved,
  disabled = false,
  variant = 'primary',
  // optional: render a tighter version when sitting inside a busy row
  compact = false,
}) {
  const [file, setFile] = useState(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(null)   // the evidence record after success
  const [dragActive, setDragActive] = useState(false)
  const fileInputRef = useRef(null)

  const v = VARIANT_STYLES[variant] || VARIANT_STYLES.primary

  const canClick = !disabled && !working && !done && (!requiresDocument || !!file)

  const pickFile = (f) => {
    setError('')
    if (!f) return
    if (f.size > maxSizeMb * 1024 * 1024) {
      setError(`File too large — max ${maxSizeMb} MB.`)
      return
    }
    setFile(f)
  }

  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation(); setDragActive(false)
    pickFile(e.dataTransfer.files?.[0])
  }
  const handleDrag = (e) => {
    e.preventDefault(); e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true)
    else if (e.type === 'dragleave') setDragActive(false)
  }

  const handleClick = async () => {
    if (!canClick) return
    setWorking(true); setError('')
    try {
      const evidence = await recordApproval({
        parentCollection, parentId,
        requiresDocument, file,
        identity, storagePathPrefix,
        label, extra,
      })
      setDone(evidence)
      if (onApproved) await onApproved(evidence)
    } catch (e) {
      setError(e.message || 'Failed to record approval')
    } finally {
      setWorking(false)
    }
  }

  // Render — happy path: already done.
  if (done) {
    return (
      <div style={{ ...cardBase, borderColor: 'rgba(52,191,58,0.3)', background: 'rgba(52,191,58,0.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: done.evidence_filename ? 6 : 0 }}>
          <CheckCircle2 size={16} color="#34BF3A" />
          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            {label} — recorded
          </span>
        </div>
        {done.evidence_filename && (
          <div style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <span><Paperclip size={11} style={{ verticalAlign: -1, marginRight: 3 }} />{done.evidence_filename}</span>
            {done.evidence_sha256 && (
              <span style={{ fontFamily: 'var(--font-mono)' }}>
                sha256: {done.evidence_sha256.slice(0, 12)}…
              </span>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={cardBase}>
      {requiresDocument && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept={acceptedTypes}
            style={{ display: 'none' }}
            onChange={e => pickFile(e.target.files?.[0])}
          />
          {!file ? (
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              style={{
                border: `2px dashed ${dragActive ? '#1598CC' : 'var(--border-primary, #E5E7EB)'}`,
                borderRadius: 8,
                padding: compact ? 14 : 22,
                textAlign: 'center',
                cursor: 'pointer',
                background: dragActive ? 'rgba(21,152,204,0.06)' : 'transparent',
                marginBottom: 10,
              }}
            >
              <Upload size={compact ? 18 : 24} color="var(--text-tertiary)" />
              <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', marginTop: 6 }}>
                Drop the signed PDF here
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginTop: 2 }}>
                or click to browse · max {maxSizeMb} MB
              </div>
            </div>
          ) : (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 12px', borderRadius: 8,
              border: '1px solid var(--border-primary, #E5E7EB)',
              background: 'rgba(21,152,204,0.06)',
              marginBottom: 10,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <Paperclip size={14} color="#1598CC" />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {file.name}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
                    {formatBytes(file.size)} · {file.type || 'unknown type'}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setFile(null)}
                disabled={working}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: 4 }}
                title="Remove"
              >
                <X size={14} />
              </button>
            </div>
          )}
        </>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <ShieldCheck size={12} />
          Evidence is recorded with approver, timestamp, IP, user agent
          {requiresDocument && ' + SHA-256 of the file'}.
        </div>
        <button
          onClick={handleClick}
          disabled={!canClick}
          style={{
            padding: compact ? '7px 14px' : '9px 20px',
            borderRadius: 8,
            border: `1px solid ${canClick ? v.border : 'var(--border-primary, #E5E7EB)'}`,
            background: canClick ? v.bg : 'var(--bg-surface)',
            color: canClick ? v.color : 'var(--text-tertiary)',
            fontSize: compact ? '0.8rem' : '0.85rem',
            fontWeight: 700,
            fontFamily: 'inherit',
            cursor: canClick ? 'pointer' : 'not-allowed',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          {working ? <Loader size={13} className="spin" /> : <CheckCircle2 size={13} />}
          {working ? 'Recording…' : label}
        </button>
      </div>

      {error && (
        <div style={{
          marginTop: 10, padding: '8px 12px', borderRadius: 8,
          background: 'rgba(192,57,43,0.08)', border: '1px solid rgba(192,57,43,0.3)',
          color: '#C0392B', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <AlertCircle size={13} /> {error}
        </div>
      )}

      <style>{`
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
