// Entity (tenancy) resolver — DTLK-UI-CRM-001 D-1 / §4 fail-safe.
//
// The spec mandates entity_id on every CRM object and entity-scoped queries. No
// multi-entity model exists yet (only the single tenants/datalake branding doc),
// so until the CEO configures entities in CRM Settings we resolve a single default.
// Building the field + the resolver now means the entity-scoped query path exists
// and lights up unchanged when real entities land — no schema migration later.
//
// MIRRORS functions/crmImport.js DEFAULT_ENTITY_ID — keep the two in sync.
export const DEFAULT_ENTITY_ID = 'datalake'

// Resolve the entity to stamp/scope by. Today: the single default. Later: read the
// user's active entity from CRM Settings. Callers must never hardcode the literal.
export function resolveEntityId() {
  return DEFAULT_ENTITY_ID
}
