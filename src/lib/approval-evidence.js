// Universal approval-evidence writer used by <ApprovalButton/>.
// For every approval action (invoice / payroll / contract / etc.) we record:
//   approver_email, approver_name, approver_role, approver_uid
//   approved_at (serverTimestamp)
//   ip_address (best-effort — null when blocked by network policy)
//   user_agent
//   evidence_url, evidence_filename, evidence_sha256, evidence_storage_path (when requiresDocument)
//   label, requires_document, action
// Each row lives at  <parentCollection>/<parentId>/approval_evidence/<auto-id>
// so an auditor can scope a query like:
//     collection(`invoices/${id}/approval_evidence`)
// without joining anything.

import { auth, db, storage } from './firebase'
import {
  collection, addDoc, doc, getDoc, serverTimestamp,
} from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'

// ── SHA-256 (hex) of a Blob/File using Web Crypto ────────────────────
export async function sha256Hex(file) {
  if (!file) return null
  const buf = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// ── Best-effort public IP. Uses ipify, fails open. ───────────────────
// Returns null if the lookup is blocked, slow, or otherwise fails.
// In a KSA-locked deployment, this often returns null — that's fine; the
// server-side audit log captures the IP on the function-call side anyway.
export async function tryGetIp(timeoutMs = 2000) {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    const r = await fetch('https://api.ipify.org?format=json', { signal: ctrl.signal })
    clearTimeout(t)
    if (!r.ok) return null
    const d = await r.json()
    return d.ip || null
  } catch {
    return null
  }
}

// ── Resolve the approver identity ───────────────────────────────────
// Caller can pass an explicit identity (used for external counsel / token-based flows).
// Otherwise we derive from Firebase Auth + the users collection role_id.
export async function resolveIdentity(explicit) {
  if (explicit && explicit.email) return { uid: explicit.uid || null, ...explicit }
  const u = auth.currentUser
  if (!u) {
    return { uid: null, email: null, name: 'Unknown', role: 'anonymous' }
  }
  let role = 'unknown'
  try {
    const snap = await getDoc(doc(db, 'users', u.uid))
    if (snap.exists()) role = snap.data().role_id || 'unknown'
  } catch {
    /* role best-effort */
  }
  return {
    uid: u.uid,
    email: u.email,
    name: u.displayName || u.email,
    role,
  }
}

// ── Main entry ──────────────────────────────────────────────────────
// Writes the evidence row. Returns the full evidence record including the
// Firestore id, so callers can chain a status flip on the parent (e.g.
// "now mark invoice APPROVED with this evidence id").
//
// Upload-first sequence: if the file write fails we never create a phantom
// "approved" row in Firestore. If Firestore write fails after a successful
// storage upload, the orphan in storage is a small price and is recoverable.
export async function recordApproval({
  parentCollection,
  parentId,
  requiresDocument = false,
  file = null,
  // Signature payload — every approval ships with a signature
  // (drawn / uploaded / typed). signatureBlob is a PNG Blob; signatureMethod
  // is one of 'draw' | 'upload' | 'type'.
  signatureBlob = null,
  signatureMethod = null,
  signatureTypedName = null,
  identity: explicitIdentity = null,
  label = 'Approve',
  action = 'approved',
  storagePathPrefix = 'approval-evidence',
  extra = null,    // anything domain-specific the caller wants stored on the evidence row
}) {
  if (!parentCollection || !parentId) {
    throw new Error('recordApproval needs parentCollection and parentId')
  }
  if (requiresDocument && !file) {
    throw new Error('A document is required for this approval — upload one first.')
  }
  if (!signatureBlob) {
    throw new Error('A signature is required — draw, upload, or type your signature first.')
  }

  const identity = await resolveIdentity(explicitIdentity)

  // Storage path follows the parent so audits can list /approval-evidence/<col>/<id>/ and
  // see everything related to that doc in one bucket prefix.
  let evidence_storage_path = null
  let evidence_url = null
  let evidence_filename = null
  let evidence_size_bytes = null
  let evidence_mime_type = null
  let evidence_sha256 = null

  if (requiresDocument && file) {
    evidence_sha256 = await sha256Hex(file)
    evidence_filename = file.name
    evidence_size_bytes = file.size
    evidence_mime_type = file.type || 'application/octet-stream'

    const ts = Date.now()
    evidence_storage_path = `${storagePathPrefix}/${parentCollection}/${parentId}/${ts}_${file.name}`
    const r = ref(storage, evidence_storage_path)
    await uploadBytes(r, file, {
      contentType: evidence_mime_type,
      customMetadata: {
        parent_collection: parentCollection,
        parent_id: parentId,
        approver_email: identity.email || 'anonymous',
        sha256: evidence_sha256,
      },
    })
    try {
      evidence_url = await getDownloadURL(r)
    } catch {
      // If the bucket disallows download URLs the upload still succeeded —
      // record the storage_path so an admin can fetch it server-side.
      evidence_url = null
    }
  }

  // Signature upload — separate object so it can be displayed independently
  // (we want the signature thumbnail without forcing a download of the full PDF).
  const sig_ts = Date.now()
  const signature_storage_path = `${storagePathPrefix}/${parentCollection}/${parentId}/${sig_ts}_signature.png`
  const signature_size_bytes = signatureBlob.size || null
  await uploadBytes(ref(storage, signature_storage_path), signatureBlob, {
    contentType: signatureBlob.type || 'image/png',
    customMetadata: {
      parent_collection: parentCollection,
      parent_id: parentId,
      approver_email: identity.email || 'anonymous',
      signature_method: signatureMethod || 'unknown',
    },
  })
  let signature_url = null
  try {
    signature_url = await getDownloadURL(ref(storage, signature_storage_path))
  } catch {
    signature_url = null
  }

  const ip = await tryGetIp()
  const user_agent = typeof navigator !== 'undefined' ? navigator.userAgent : null

  const payload = {
    approver_uid: identity.uid || null,
    approver_email: identity.email || null,
    approver_name: identity.name || null,
    approver_role: identity.role || null,
    approved_at: serverTimestamp(),
    ip_address: ip,
    user_agent,
    evidence_url,
    evidence_filename,
    evidence_size_bytes,
    evidence_mime_type,
    evidence_sha256,
    evidence_storage_path,
    signature_url,
    signature_storage_path,
    signature_method: signatureMethod,
    signature_size_bytes,
    signature_typed_name: signatureTypedName,
    requires_document: !!requiresDocument,
    label,
    action,
    parent_collection: parentCollection,
    parent_id: parentId,
    ...(extra || {}),
  }

  const docRef = await addDoc(
    collection(db, `${parentCollection}/${parentId}/approval_evidence`),
    payload,
  )

  return { id: docRef.id, ...payload }
}
