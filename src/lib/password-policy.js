// Password policy — single source of truth for the CLIENT side.
//
// These rules MUST mirror the server-side Firebase Auth password policy set by
// functions/set-password-policy.js. Firebase enforces the same constraints on
// confirmPasswordReset() / updatePassword(); this module only powers the live
// UI (checkmarks) so the user sees green before they ever hit the server.
//
// If you change a rule here, change it in functions/set-password-policy.js too.

export const PASSWORD_MIN_LENGTH = 12

// Each rule: a stable key, the label shown next to the checkmark, and a test().
export const PASSWORD_RULES = [
  { key: 'length',  label: `At least ${PASSWORD_MIN_LENGTH} characters`, test: (pw) => pw.length >= PASSWORD_MIN_LENGTH },
  { key: 'upper',   label: 'One uppercase letter (A–Z)',                 test: (pw) => /[A-Z]/.test(pw) },
  { key: 'lower',   label: 'One lowercase letter (a–z)',                 test: (pw) => /[a-z]/.test(pw) },
  { key: 'number',  label: 'One number (0–9)',                           test: (pw) => /[0-9]/.test(pw) },
  { key: 'special', label: 'One special character (!@#$…)',              test: (pw) => /[^A-Za-z0-9]/.test(pw) },
]

// Evaluate a candidate password against every rule.
// Returns { rules: [{ key, label, met }], allMet }.
export function evaluatePassword(password) {
  const pw = String(password || '')
  const rules = PASSWORD_RULES.map((r) => ({ key: r.key, label: r.label, met: r.test(pw) }))
  return { rules, allMet: rules.every((r) => r.met) }
}
