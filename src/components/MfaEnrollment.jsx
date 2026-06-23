import { useState, useEffect } from 'react'
import { multiFactor, TotpMultiFactorGenerator } from 'firebase/auth'
import { auth } from '../lib/firebase'
import { ShieldCheck, Loader, Check } from 'lucide-react'

// Opt-in TOTP (authenticator-app) second factor. DORMANT until BOTH:
//   1. Identity Platform (GCIP) is enabled in the GCP console (TOTP MFA requires it), and
//   2. VITE_MFA_ENABLED === 'true' in the build env.
// Rendering nothing when the flag is off means zero impact on the live login path
// until MFA has been enabled and tested. The matching sign-in challenge lives in
// LandingPage (handles auth/multi-factor-auth-required), which is always safe because
// it only triggers for users who have actually enrolled.
const MFA_ENABLED = import.meta.env.VITE_MFA_ENABLED === 'true'

function errText(e) {
  const c = String(e?.code || '')
  if (c.includes('operation-not-allowed')) return 'MFA is not enabled on this project yet (Identity Platform). Contact IT.'
  if (c.includes('invalid-verification-code') || c.includes('invalid-credential')) return 'That code is incorrect — enter the current 6-digit code from your app.'
  if (c.includes('requires-recent-login')) return 'For security, sign out and back in, then try again.'
  return e?.message || 'Could not complete MFA setup.'
}

export default function MfaEnrollment() {
  const [enrolled, setEnrolled] = useState([])
  const [stage, setStage] = useState('idle') // idle | secret | done
  const [secret, setSecret] = useState(null)
  const [qrUrl, setQrUrl] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    const u = auth.currentUser
    if (u) { try { setEnrolled(multiFactor(u).enrolledFactors || []) } catch { /* ignore */ } }
  }, [])

  if (!MFA_ENABLED) return null

  const begin = async () => {
    setBusy(true); setMsg(null)
    try {
      const u = auth.currentUser
      const session = await multiFactor(u).getSession()
      const s = await TotpMultiFactorGenerator.generateSecret(session)
      setSecret(s)
      setQrUrl(s.generateQrCodeUrl(u.email || 'user', 'Datalake'))
      setStage('secret')
    } catch (e) { setMsg({ kind: 'error', text: errText(e) }) } finally { setBusy(false) }
  }

  const verify = async () => {
    if (!code.trim()) return
    setBusy(true); setMsg(null)
    try {
      const assertion = TotpMultiFactorGenerator.assertionForEnrollment(secret, code.trim())
      await multiFactor(auth.currentUser).enroll(assertion, 'Authenticator app')
      setEnrolled(multiFactor(auth.currentUser).enrolledFactors || [])
      setStage('done'); setCode('')
      setMsg({ kind: 'success', text: 'Two-factor authentication enabled.' })
    } catch (e) { setMsg({ kind: 'error', text: errText(e) }) } finally { setBusy(false) }
  }

  const alreadyOn = enrolled.length > 0

  return (
    <div className="card" style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <ShieldCheck size={18} style={{ color: 'var(--green)' }} />
        <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>Two-Factor Authentication (TOTP)</h3>
        {alreadyOn && <span className="badge badge-success" style={{ marginLeft: 'auto' }}><Check size={12} /> Enabled</span>}
      </div>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 16 }}>
        Add an authenticator app (Google Authenticator, Microsoft Authenticator, etc.) as a second factor at sign-in.
      </p>

      {msg && (
        <div style={{ padding: '10px 14px', marginBottom: 14, borderRadius: 8, fontSize: '0.82rem',
          background: msg.kind === 'error' ? 'rgba(192,57,43,0.10)' : 'rgba(52,191,58,0.12)',
          color: msg.kind === 'error' ? '#C0392B' : '#15803d' }}>{msg.text}</div>
      )}

      {alreadyOn ? (
        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          Your account is protected with an authenticator app. To replace it, contact IT to reset MFA.
        </div>
      ) : stage === 'idle' || stage === 'done' ? (
        <button className="btn btn-primary" onClick={begin} disabled={busy}>
          {busy ? <Loader size={16} className="spin" /> : <ShieldCheck size={16} />} Set up authenticator
        </button>
      ) : (
        <div>
          <p style={{ fontSize: '0.85rem', marginBottom: 10 }}>1. Scan this QR in your authenticator app (or enter the key manually):</p>
          {qrUrl && (
            <img alt="TOTP QR" style={{ width: 168, height: 168, background: '#fff', padding: 8, borderRadius: 8 }}
              src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(qrUrl)}`} />
          )}
          {secret?.secretKey && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', margin: '10px 0', wordBreak: 'break-all', color: 'var(--text-secondary)' }}>
              Key: {secret.secretKey}
            </div>
          )}
          <p style={{ fontSize: '0.85rem', margin: '12px 0 6px' }}>2. Enter the current 6-digit code:</p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input className="form-input" inputMode="numeric" maxLength={6} value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, ''))} placeholder="123456" style={{ maxWidth: 140, letterSpacing: '0.2em' }} />
            <button className="btn btn-success" onClick={verify} disabled={busy || code.length < 6}>
              {busy ? 'Verifying…' : 'Verify & enable'}
            </button>
          </div>
        </div>
      )}
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{100%{transform:rotate(360deg)}}`}</style>
    </div>
  )
}
