// Soft-delete + restore — the single canonical path for "deleting" a record.
//
// Nothing in the app should call deleteDoc() on a major entity. Instead we mark
// the doc deleted and keep it; an admin can restore it from the Recycle Bin
// (/admin/recycle-bin). This is what makes a mistaken delete recoverable.
//
// Shape written onto the doc:
//   deleted: true            — the flag every list view filters on
//   deleted_at: <ts>         — when
//   deleted_by: <email>      — who
//   deleted_reason: <string> — optional, captured by the confirm modal
// Restore clears `deleted` and stamps restored_at/restored_by.
//
// List views must exclude soft-deleted rows. Use the `notDeleted` predicate
// after mapping a snapshot: snap.docs.map(...).filter(notDeleted).

import { doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db, auth } from './firebase'

// Collections surfaced in the admin Recycle Bin. `title` lists candidate fields
// (first non-empty wins) used to label a row for a human.
export const RECYCLABLE_COLLECTIONS = [
  { name: 'contracts',        label: 'Contracts',        title: ['linked_employee_name', 'contract_extracted_fields.employee_name', 'original_filename'] },
  { name: 'employees',        label: 'Employees',        title: ['full_name', 'name', 'employee_id'] },
  { name: 'clients',          label: 'Clients',          title: ['client_name', 'name'] },
  { name: 'projects',         label: 'Projects',         title: ['project_name', 'name', 'client_name'] },
  { name: 'training_modules', label: 'Training Modules', title: ['title', 'name'] },
  { name: 'job_listings',     label: 'Job Listings',     title: ['title', 'job_title'] },
  { name: 'users',            label: 'Users',            title: ['display_name', 'name', 'email'] },
]

// Predicate for list views: keep only rows that are NOT soft-deleted.
// Existing docs have no `deleted` field, so they pass through unchanged.
export const notDeleted = (d) => !d?.deleted

// Resolve a human label for a recycled row from its collection's title fields.
export function recycleTitle(collectionName, data) {
  const cfg = RECYCLABLE_COLLECTIONS.find((c) => c.name === collectionName)
  const fields = cfg?.title || []
  for (const f of fields) {
    const val = f.includes('.')
      ? f.split('.').reduce((o, k) => (o == null ? o : o[k]), data)
      : data?.[f]
    if (val != null && val !== '') return String(val)
  }
  return data?.id || '(untitled)'
}

export async function softDelete(collectionName, id, { reason } = {}) {
  const u = auth.currentUser
  await updateDoc(doc(db, collectionName, id), {
    deleted: true,
    deleted_at: serverTimestamp(),
    deleted_by: u?.email || 'unknown',
    deleted_reason: reason || null,
    updated_at: serverTimestamp(),
  })
}

export async function restoreDoc(collectionName, id) {
  const u = auth.currentUser
  await updateDoc(doc(db, collectionName, id), {
    deleted: false,
    deleted_at: null,
    deleted_reason: null,
    restored_at: serverTimestamp(),
    restored_by: u?.email || 'unknown',
    updated_at: serverTimestamp(),
  })
}
