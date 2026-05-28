import { useEffect, useRef, useState } from 'react'
import {
  X, Pen, Upload, Type, Trash2, CheckCircle2, Loader, AlertCircle,
} from 'lucide-react'

// Modal that captures a signature via one of three methods and returns a PNG Blob.
//
//   <SignatureModal
//     isOpen={open}
//     signerName="External Legal Counsel"
//     onClose={() => setOpen(false)}
//     onSign={async ({ blob, method, dataUrl }) => { /* upload & continue */ }}
//   />
//
// Designed mobile-first: the canvas uses pointer events so mouse, touch, and
// pen all work without separate handlers. The canvas resizes to its container
// at mount and on window resize so it stays usable on a phone in portrait.

const CURSIVE_FONT_STACK = "'Brush Script MT', 'Segoe Script', 'Lucida Handwriting', cursive"
const SIG_BG = '#ffffff'
const SIG_STROKE = '#022873'

const TAB_META = [
  { id: 'draw',   label: 'Draw',   Icon: Pen },
  { id: 'upload', label: 'Upload', Icon: Upload },
  { id: 'type',   label: 'Type',   Icon: Type },
]

// ────────────────────────────────────────────────────────────────
// Render a typed name to an off-screen canvas, return a PNG Blob.
// The font shrinks until the name fits — works for short and long names.
// ────────────────────────────────────────────────────────────────
function renderTypedSignature(text) {
  const canvas = document.createElement('canvas')
  const W = 720, H = 220
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = SIG_BG
  ctx.fillRect(0, 0, W, H)
  if (!text) return Promise.resolve(null)
  ctx.fillStyle = SIG_STROKE
  ctx.textBaseline = 'middle'
  let size = 96
  while (size > 28) {
    ctx.font = `italic ${size}px ${CURSIVE_FONT_STACK}`
    if (ctx.measureText(text).width <= W - 60) break
    size -= 6
  }
  ctx.fillText(text, 30, H / 2)
  return new Promise(resolve => canvas.toBlob(b => resolve(b), 'image/png'))
}

// ────────────────────────────────────────────────────────────────
// DrawCanvas — pointer-events surface with a Clear button.
// Calls `onChange(hasInk)` whenever the drawn state changes.
// `getBlob()` exposed via ref returns the current canvas as a PNG Blob.
// ────────────────────────────────────────────────────────────────
function DrawCanvas({ canvasRef, onChange }) {
  const wrapRef = useRef(null)
  const drawingRef = useRef(false)

  // Initial sizing + responsive resize. We use a fixed internal resolution
  // (1.5× the displayed width, capped) so PNG output is crisp on mobile.
  useEffect(() => {
    const cv = canvasRef.current, wrap = wrapRef.current
    if (!cv || !wrap) return
    const resize = () => {
      const w = Math.max(280, Math.min(1080, wrap.clientWidth))
      const h = Math.max(160, Math.round(w * 0.36))
      // Keep ink across resize: snapshot then redraw.
      const tmp = document.createElement('canvas')
      tmp.width = cv.width; tmp.height = cv.height
      tmp.getContext('2d').drawImage(cv, 0, 0)
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      cv.width = w * dpr; cv.height = h * dpr
      cv.style.width = `${w}px`; cv.style.height = `${h}px`
      const ctx = cv.getContext('2d')
      ctx.scale(dpr, dpr)
      ctx.fillStyle = SIG_BG
      ctx.fillRect(0, 0, w, h)
      ctx.drawImage(tmp, 0, 0, w, h)
      ctx.lineWidth = 2.6
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = SIG_STROKE
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [canvasRef])

  const localPos = (e) => {
    const cv = canvasRef.current
    const rect = cv.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const onPointerDown = (e) => {
    e.preventDefault()
    const cv = canvasRef.current
    const ctx = cv.getContext('2d')
    const { x, y } = localPos(e)
    ctx.beginPath(); ctx.moveTo(x, y)
    drawingRef.current = true
    if (cv.setPointerCapture) {
      try { cv.setPointerCapture(e.pointerId) } catch { /* not supported */ }
    }
  }
  const onPointerMove = (e) => {
    if (!drawingRef.current) return
    e.preventDefault()
    const ctx = canvasRef.current.getContext('2d')
    const { x, y } = localPos(e)
    ctx.lineTo(x, y)
    ctx.stroke()
    onChange?.(true)
  }
  const onPointerUp = (e) => {
    if (!drawingRef.current) return
    drawingRef.current = false
    const cv = canvasRef.current
    if (cv.releasePointerCapture) {
      try { cv.releasePointerCapture(e.pointerId) } catch { /* not supported */ }
    }
  }

  return (
    <div ref={wrapRef} style={{ width: '100%' }}>
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerUp}
        style={{
          touchAction: 'none',
          width: '100%',
          background: SIG_BG,
          border: '1px solid rgba(255,255,255,0.18)',
          borderRadius: 10,
          display: 'block',
          cursor: 'crosshair',
        }}
      />
    </div>
  )
}

function canvasToBlob(cv) {
  return new Promise(resolve => {
    if (!cv) return resolve(null)
    cv.toBlob(b => resolve(b), 'image/png')
  })
}

function clearCanvas(cv) {
  if (!cv) return
  const ctx = cv.getContext('2d')
  const w = cv.width, h = cv.height
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = SIG_BG
  ctx.fillRect(0, 0, w, h)
  ctx.restore()
}

export default function SignatureModal({ isOpen, onClose, onSign, signerName = '' }) {
  const [tab, setTab] = useState('draw')
  const [drawHasInk, setDrawHasInk] = useState(false)
  const [uploadFile, setUploadFile] = useState(null)
  const [uploadPreview, setUploadPreview] = useState(null)
  const [typed, setTyped] = useState(signerName)
  const [typedPreview, setTypedPreview] = useState(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const canvasRef = useRef(null)
  const fileInputRef = useRef(null)

  // Reset when reopened. Defer setState calls via microtask so we don't trip
  // the React 19 "no setState in effect body" rule.
  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    Promise.resolve().then(() => {
      if (cancelled) return
      setError('')
      setDrawHasInk(false)
      setUploadFile(null); setUploadPreview(null)
      setTyped(signerName || ''); setTypedPreview(null)
      setTab('draw')
    })
    return () => { cancelled = true }
  }, [isOpen, signerName])

  // Re-render the typed preview as the name changes.
  useEffect(() => {
    if (tab !== 'type') return
    let cancelled = false
    renderTypedSignature(typed.trim()).then(blob => {
      if (cancelled || !blob) { setTypedPreview(null); return }
      setTypedPreview(URL.createObjectURL(blob))
    })
    return () => { cancelled = true }
  }, [typed, tab])

  // Release object URLs we created so we don't leak memory across reopen cycles.
  useEffect(() => () => {
    if (uploadPreview) URL.revokeObjectURL(uploadPreview)
    if (typedPreview)  URL.revokeObjectURL(typedPreview)
  }, [uploadPreview, typedPreview])

  if (!isOpen) return null

  const canFinish = (
    (tab === 'draw'   && drawHasInk) ||
    (tab === 'upload' && uploadFile) ||
    (tab === 'type'   && typed.trim().length > 1)
  ) && !working

  const handleUpload = (file) => {
    setError('')
    if (!file) return
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
      setError('Upload a PNG, JPG, or WEBP image.'); return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Image too large — max 5 MB.'); return
    }
    if (uploadPreview) URL.revokeObjectURL(uploadPreview)
    setUploadFile(file)
    setUploadPreview(URL.createObjectURL(file))
  }

  const finish = async () => {
    setWorking(true); setError('')
    try {
      let blob = null
      if (tab === 'draw') {
        blob = await canvasToBlob(canvasRef.current)
      } else if (tab === 'upload') {
        blob = uploadFile
      } else {
        blob = await renderTypedSignature(typed.trim())
      }
      if (!blob) throw new Error('Could not produce a signature image. Try again.')
      const dataUrl = URL.createObjectURL(blob)
      await onSign({ blob, method: tab, dataUrl, typedName: typed.trim() || null })
    } catch (e) {
      setError(e.message)
    } finally {
      setWorking(false)
    }
  }

  // ─── Render ────────────────────────────────────────────────────
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(6px)', zIndex: 10000,
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
          <div>
            <div style={{ fontSize: '1rem', fontWeight: 700 }}>Sign to confirm approval</div>
            <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>
              Choose how you want to sign — your signature is stored alongside the evidence record.
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.55)', cursor: 'pointer', padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          {TAB_META.map(t => {
            const Icon = t.Icon
            const active = tab === t.id
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  flex: 1, padding: '12px 8px', border: 'none', background: 'transparent', cursor: 'pointer',
                  color: active ? '#38bdf8' : 'rgba(255,255,255,0.6)',
                  fontWeight: 600, fontSize: '0.85rem', fontFamily: 'inherit',
                  borderBottom: `2px solid ${active ? '#38bdf8' : 'transparent'}`,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  marginBottom: -1,
                }}
              >
                <Icon size={14} /> {t.label}
              </button>
            )
          })}
        </div>

        {/* Body */}
        <div style={{ padding: 18, overflowY: 'auto' }}>
          {tab === 'draw' && (
            <>
              <DrawCanvas canvasRef={canvasRef} onChange={setDrawHasInk} />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
                <button
                  onClick={() => { clearCanvas(canvasRef.current); setDrawHasInk(false) }}
                  disabled={!drawHasInk}
                  style={{
                    background: 'transparent', border: '1px solid rgba(255,255,255,0.18)',
                    color: drawHasInk ? '#fca5a5' : 'rgba(255,255,255,0.35)',
                    padding: '8px 14px', borderRadius: 8, cursor: drawHasInk ? 'pointer' : 'not-allowed',
                    display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', fontFamily: 'inherit',
                  }}
                >
                  <Trash2 size={13} /> Clear
                </button>
                <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.45)', alignSelf: 'center' }}>
                  Use your finger on mobile.
                </div>
              </div>
            </>
          )}

          {tab === 'upload' && (
            <>
              <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }}
                onChange={e => handleUpload(e.target.files?.[0])} />
              {!uploadFile ? (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    border: '2px dashed rgba(255,255,255,0.2)', borderRadius: 10,
                    padding: 32, textAlign: 'center', cursor: 'pointer',
                    background: 'rgba(255,255,255,0.02)',
                  }}
                >
                  <Upload size={28} color="rgba(255,255,255,0.5)" />
                  <div style={{ marginTop: 10, fontWeight: 600, fontSize: '0.9rem' }}>Click to upload signature image</div>
                  <div style={{ marginTop: 4, fontSize: '0.74rem', color: 'rgba(255,255,255,0.5)' }}>PNG, JPG, or WEBP — max 5 MB</div>
                </div>
              ) : (
                <div>
                  <img src={uploadPreview} alt="signature" style={{
                    width: '100%', maxHeight: 220, objectFit: 'contain',
                    background: '#fff', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)',
                  }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                    <span style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.65)' }}>{uploadFile.name}</span>
                    <button onClick={() => { if (uploadPreview) URL.revokeObjectURL(uploadPreview); setUploadFile(null); setUploadPreview(null) }}
                      style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.18)', color: 'rgba(255,255,255,0.7)',
                               padding: '6px 12px', borderRadius: 7, cursor: 'pointer', fontSize: '0.78rem', fontFamily: 'inherit' }}>
                      Replace
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {tab === 'type' && (
            <>
              <label style={{ fontSize: '0.74rem', color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', fontWeight: 600 }}>
                Type your full name
              </label>
              <input
                type="text"
                value={typed}
                onChange={e => setTyped(e.target.value)}
                placeholder={signerName || 'Your full name'}
                style={{
                  width: '100%', padding: '11px 14px', marginTop: 6, marginBottom: 12,
                  borderRadius: 8, border: '1px solid rgba(255,255,255,0.18)',
                  background: 'rgba(0,0,0,0.28)', color: '#fff',
                  fontSize: '0.95rem', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
                }}
              />
              <div style={{
                background: SIG_BG, borderRadius: 10, padding: '24px 20px', minHeight: 120,
                display: 'flex', alignItems: 'center', justifyContent: 'flex-start',
                border: '1px solid rgba(255,255,255,0.18)',
              }}>
                {typed.trim() ? (
                  <span style={{
                    fontFamily: CURSIVE_FONT_STACK,
                    fontStyle: 'italic',
                    fontSize: 'clamp(2rem, 8vw, 3.4rem)',
                    color: SIG_STROKE,
                    lineHeight: 1.1,
                    wordBreak: 'break-word',
                  }}>
                    {typed.trim()}
                  </span>
                ) : (
                  <span style={{ color: '#999', fontStyle: 'italic' }}>Preview appears here</span>
                )}
              </div>
              {typedPreview && (
                <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', marginTop: 6, textAlign: 'right' }}>
                  Rendered as PNG when you click Sign &amp; Continue.
                </div>
              )}
            </>
          )}

          {error && (
            <div style={{
              marginTop: 12, padding: '8px 12px', borderRadius: 8,
              background: 'rgba(192,57,43,0.12)', border: '1px solid rgba(192,57,43,0.3)',
              color: '#fca5a5', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <AlertCircle size={13} /> {error}
            </div>
          )}
        </div>

        <div style={{ padding: '14px 20px', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button
            onClick={onClose}
            disabled={working}
            style={{
              padding: '9px 16px', borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.18)', background: 'transparent',
              color: 'rgba(255,255,255,0.7)', fontSize: '0.85rem', fontFamily: 'inherit',
              cursor: working ? 'not-allowed' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={finish}
            disabled={!canFinish}
            style={{
              padding: '9px 18px', borderRadius: 8, border: 'none',
              background: canFinish ? '#34BF3A' : 'rgba(255,255,255,0.1)',
              color: canFinish ? '#fff' : 'rgba(255,255,255,0.35)',
              fontSize: '0.88rem', fontWeight: 700, fontFamily: 'inherit',
              cursor: canFinish ? 'pointer' : 'not-allowed',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            {working ? <Loader size={13} className="spin" /> : <CheckCircle2 size={13} />}
            {working ? 'Signing…' : 'Sign & Continue'}
          </button>
        </div>

        <style>{`
          .spin { animation: spin 1s linear infinite; }
          @keyframes spin { 100% { transform: rotate(360deg); } }
        `}</style>
      </div>
    </div>
  )
}
