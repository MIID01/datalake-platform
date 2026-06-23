import { useState, useEffect } from 'react'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { db, auth, LIST_ORPHANED_CONTRACT_PDFS_URL, RELINK_CONTRACT_PDF_URL } from '../../lib/firebase'
import { RECYCLABLE_COLLECTIONS, recycleTitle, restoreDoc } from '../../lib/soft-delete'
import { Trash2, RotateCcw, Loader, AlertTriangle, FileText, Archive } from 'lucide-react'

// Admin recovery surface for soft-deleted records. Anything deleted in the app
// (contracts, employees, clients, projects, training, job listings, users) lands
// here and can be restored. Hard-deleted records (pre-soft-delete) are NOT here —
// for those, see the WORM PDF re-link tool for contracts.
export default function RecycleBin() {
  const [byCollection, setByCollection] = useState({}) // name -> rows[]
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)

  // WORM recovery (for contracts hard-deleted before soft-delete existed).
  const [orphans, setOrphans] = useState(null) // null = not yet scanned
  const [wormLoading, setWormLoading] = useState(false)
  const [wormError, setWormError] = useState('')
  const [relinking, setRelinking] = useState(null)

  useEffect(() => {
    let pending = RECYCLABLE_COLLECTIONS.length
    const unsubs = RECYCLABLE_COLLECTIONS.map(({ name }) =>
      onSnapshot(
        query(collection(db, name), where('deleted', '==', true)),
        (snap) => {
          setByCollection((prev) => ({
            ...prev,
            [name]: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
          }))
          if (pending > 0) { pending -= 1; if (pending === 0) setLoading(false) }
        },
        (err) => {
          console.warn(`RecycleBin ${name} listener:`, err.message)
          if (pending > 0) { pending -= 1; if (pending === 0) setLoading(false) }
        },
      ),
    )
    return () => unsubs.forEach((u) => u())
  }, [])

  const rows = RECYCLABLE_COLLECTIONS.flatMap(({ name, label }) =>
    (byCollection[name] || []).map((d) => ({ ...d, _collection: name, _label: label })),
  ).sort((a, b) => (b.deleted_at?.seconds || 0) - (a.deleted_at?.seconds || 0))

  const fmt = (ts) => {
    if (!ts?.toDate) return '—'
    try { return ts.toDate().toLocaleString() } catch { return '—' }
  }

  const handleRestore = async (row) => {
    setError('')
    setBusyId(row.id)
    try {
      await restoreDoc(row._collection, row.id)
    } catch (e) {
      setError(`Could not restore: ${e.message}`)
    } finally {
      setBusyId(null)
    }
  }

  const scanWorm = async () => {
    setWormError('')
    setWormLoading(true)
    try {
      const token = await auth.currentUser.getIdToken()
      const r = await fetch(LIST_ORPHANED_CONTRACT_PDFS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
      setOrphans(data.orphans || [])
    } catch (e) {
      setWormError(`WORM scan failed: ${e.message}`)
    } finally {
      setWormLoading(false)
    }
  }

  const relink = async (o) => {
    setWormError('')
    setRelinking(o.storage_path)
    try {
      const token = await auth.currentUser.getIdToken()
      const r = await fetch(RELINK_CONTRACT_PDF_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ storage_path: o.storage_path, employee_id: o.employee_id || undefined }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
      setOrphans((prev) => (prev || []).filter((x) => x.storage_path !== o.storage_path))
    } catch (e) {
      setWormError(`Re-link failed: ${e.message}`)
    } finally {
      setRelinking(null)
    }
  }

  const fmtBytes = (n) => (n > 0 ? `${(n / 1024).toFixed(0)} KB` : '—')

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <Trash2 size={22} />
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Recycle Bin</h1>
      </div>
      <p style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem', marginBottom: 20 }}>
        Records deleted in the app are kept here so a mistaken delete can be undone. Restoring
        returns the item to its original list. (Items hard-deleted before this feature are not
        here — recover a deleted contract via its retained PDF in the WORM archive.)
      </p>

      {error && (
        <div className="card" style={{ padding: '12px 16px', marginBottom: 16, background: 'rgba(192,57,43,0.08)', border: '1px solid rgba(192,57,43,0.25)', color: '#C0392B', display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-tertiary)' }}>
            <Loader size={28} className="spin" /> <div style={{ marginTop: 8 }}>Loading deleted items…</div>
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-tertiary)' }}>
            Nothing in the Recycle Bin. Deleted records will appear here.
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Item</th>
                <th>Deleted by</th>
                <th>Deleted at</th>
                <th>Reason</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row._collection}/${row.id}`}>
                  <td><span className="badge badge-neutral">{row._label}</span></td>
                  <td style={{ fontWeight: 600 }}>{recycleTitle(row._collection, row)}</td>
                  <td style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{row.deleted_by || '—'}</td>
                  <td style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{fmt(row.deleted_at)}</td>
                  <td style={{ fontSize: '0.82rem', color: 'var(--text-tertiary)' }}>{row.deleted_reason || '—'}</td>
                  <td>
                    <button className="btn btn-sm btn-primary" disabled={busyId === row.id} onClick={() => handleRestore(row)}>
                      {busyId === row.id ? <Loader size={14} className="spin" /> : <RotateCcw size={14} />} Restore
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* WORM recovery — for contracts hard-deleted before soft-delete existed */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '28px 0 8px' }}>
        <Archive size={20} />
        <h2 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0 }}>Recover a contract from the WORM archive</h2>
      </div>
      <p style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem', marginBottom: 14 }}>
        Signed contract PDFs are always retained in the WORM archive even after the database record is gone.
        Scan for PDFs that no current contract references — these are recoverable. Re-linking rebuilds a contract
        record from the PDF and re-runs AI extraction.
      </p>

      {wormError && (
        <div className="card" style={{ padding: '12px 16px', marginBottom: 16, background: 'rgba(192,57,43,0.08)', border: '1px solid rgba(192,57,43,0.25)', color: '#C0392B', display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertTriangle size={16} /> {wormError}
        </div>
      )}

      <button className="btn btn-primary" onClick={scanWorm} disabled={wormLoading} style={{ marginBottom: 16 }}>
        {wormLoading ? <Loader size={15} className="spin" /> : <Archive size={15} />} Scan WORM archive
      </button>

      {orphans !== null && (
        <div className="card" style={{ padding: 0 }}>
          {orphans.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-tertiary)' }}>
              No orphaned PDFs found — every WORM contract PDF is already linked to a record.
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr><th>PDF</th><th>Employee ID</th><th>Size</th><th>Archived</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {orphans.map((o) => (
                  <tr key={o.storage_path}>
                    <td style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <FileText size={14} /> {o.filename}
                    </td>
                    <td style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{o.employee_id || '—'}</td>
                    <td style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{fmtBytes(o.size_bytes)}</td>
                    <td style={{ fontSize: '0.82rem', color: 'var(--text-tertiary)' }}>{o.updated ? new Date(o.updated).toLocaleString() : '—'}</td>
                    <td>
                      <button className="btn btn-sm btn-success" disabled={relinking === o.storage_path} onClick={() => relink(o)}>
                        {relinking === o.storage_path ? <Loader size={14} className="spin" /> : <RotateCcw size={14} />} Re-link
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
