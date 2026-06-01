import { Check, Circle } from 'lucide-react'
import { evaluatePassword } from '../lib/password-policy'

/**
 * PasswordChecklist — live "strong password" requirements with checkmarks.
 *
 * Drives off ../lib/password-policy (the same rules the server enforces).
 * Pass `dark` for placement on the navy glass cards (reset page); omit it for
 * the light employee portal. Optionally pass `confirm` to surface a
 * "passwords match" row.
 *
 *   <PasswordChecklist password={pw} confirm={confirmPw} dark />
 */
export default function PasswordChecklist({ password = '', confirm = null, dark = false }) {
  const { rules } = evaluatePassword(password)

  const metColor = '#34BF3A'                                   // brand green
  const pendingColor = dark ? 'rgba(255,255,255,0.45)' : '#94a3b8'
  const textMet = dark ? '#86efac' : '#1f7a2a'
  const textPending = dark ? 'rgba(255,255,255,0.6)' : '#64748b'

  const rows = [...rules]
  // Only show the match row once the user has started typing a confirmation.
  if (confirm !== null && confirm !== '') {
    rows.push({ key: 'match', label: 'Passwords match', met: password === confirm })
  }

  return (
    <ul style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rows.map((r) => (
        <li key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem' }}>
          {r.met
            ? <Check size={15} color={metColor} strokeWidth={3} style={{ flexShrink: 0 }} />
            : <Circle size={15} color={pendingColor} style={{ flexShrink: 0 }} />}
          <span style={{ color: r.met ? textMet : textPending }}>{r.label}</span>
        </li>
      ))}
    </ul>
  )
}
