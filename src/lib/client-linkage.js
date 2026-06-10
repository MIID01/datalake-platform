// Single source of truth for linking related records (projects, invoices,
// timesheets) to a client. CRMClients (list) and CRMClientDetail both import
// this so the two views can NEVER drift on what "belongs to" a client.
//
// Canonical key is `client_id` (the clients/{id} doc id). We fall back to a
// NORMALIZED client_name compare (trim + case-insensitive) so records seeded
// before client_id was populated — or carrying minor name/whitespace drift —
// still link instead of silently showing 0. This is the Emkan-linkage bug
// (empty client_id + "Emkan Finaance " vs "Emkan Finance") generalized so it
// can't recur for the next client. The real fix is still backfilling client_id;
// this is the defensive net under it.

const normName = (s) => (s == null ? '' : String(s).trim().toLowerCase())

export function matchesClient(record, client) {
  if (!record || !client) return false
  // Primary: canonical foreign key.
  if (record.client_id && client.id && record.client_id === client.id) return true
  // Fallback: normalized name (only when both sides have a name).
  const rn = normName(record.client_name)
  const cn = normName(client.client_name)
  return !!rn && rn === cn
}
