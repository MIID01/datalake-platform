// Shared CRM mutation helpers — SINGLE source for calling the audited
// crmArchiveDeals Cloud Function, reused by the board card, list row, bulk bar,
// deal-detail page, and the import-undo banner. (No inline fetch forks.)
import { auth, CRM_ARCHIVE_DEALS_URL, appCheckHeader } from './firebase'

// Soft-delete (archive) / restore deals via the server (Admin SDK + audit + the
// single-vs-bulk role gate). Pass EITHER ids:[...] OR import_batch_id.
//   setDealsArchived({ ids: ['abc'] })                       // delete one
//   setDealsArchived({ ids, restore: true })                 // restore
//   setDealsArchived({ import_batch_id, reason: 'undo import' })
// Returns the parsed JSON ({ affected }) or throws with the server error message.
export async function setDealsArchived({ ids, import_batch_id, restore = false, reason } = {}) {
  const token = await auth.currentUser.getIdToken()
  const resp = await fetch(CRM_ARCHIVE_DEALS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(await appCheckHeader()) },
    body: JSON.stringify({ ids, import_batch_id, restore, reason }),
  })
  const json = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(json.error || `Request failed (${resp.status})`)
  return json
}
