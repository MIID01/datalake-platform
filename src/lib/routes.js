// Single source of truth for each role's portal home and portal path prefix.

// The path a role lands on after sign-in / when sent back to their portal.
export function homePathForRole(role) {
  switch (role) {
    case 'ceo': return '/ceo'
    case 'hr': return '/hr'
    case 'cto': return '/cto'
    case 'client': return '/client'
    case 'finance': return '/ceo/finance'
    case 'employee':
    default: return '/employee/dashboard'
  }
}

// The path prefix a role is allowed to stay within. Used by AuthGate to detect
// when a user has wandered outside their portal and should be redirected home.
export function portalPrefixForRole(role) {
  switch (role) {
    case 'ceo': return '/ceo'
    case 'hr': return '/hr'
    case 'cto': return '/cto'
    case 'client': return '/client'
    case 'finance': return '/ceo/finance'
    case 'employee': return '/employee'
    default: return null
  }
}
