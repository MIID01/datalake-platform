// Single source of truth for each role's portal home and portal path prefix.

// The path a role lands on after sign-in / when sent back to their portal.
export function homePathForRole(role) {
  switch (role) {
    case 'ceo': return '/ceo'
    case 'auditor': return '/ceo/audit-export'
    case 'it_admin': return '/admin'
    case 'hr': return '/hr'
    case 'cto': return '/cto'
    case 'pm': return '/pm'
    case 'client': return '/client'
    case 'finance': return '/finance'
    case 'business':
    case 'sales': return '/crm/clients'
    case 'employee':
    default: return '/employee/dashboard'
  }
}

// The path prefix a role is allowed to stay within. Used by AuthGate to detect
// when a user has wandered outside their portal and should be redirected home.
// `auditor` returns null on purpose: read-only audit access roams every portal,
// but every write is blocked by Firestore rules (no role-write paths granted to
// `auditor`) and the UI hides action buttons via the data-role attribute.
export function portalPrefixForRole(role) {
  switch (role) {
    case 'ceo': return '/ceo'
    case 'auditor': return null
    case 'it_admin': return '/admin'
    case 'hr': return '/hr'
    case 'cto': return '/cto'
    case 'pm': return '/pm'
    case 'client': return '/client'
    case 'finance': return '/finance'
    case 'business':
    case 'sales': return '/crm'
    case 'employee': return '/employee'
    default: return null
  }
}

export function isReadOnlyRole(role) {
  return role === 'auditor'
}
