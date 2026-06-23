import { useState, useEffect } from 'react'
import { FileText, Download, Search, AlertTriangle, FileBadge, Clock } from 'lucide-react'
import {
  auth,
  LIST_GRC_DOCUMENTS_URL,
  DOWNLOAD_GRC_DOCUMENT_URL,
  GENERATE_PDF_URL,
} from '../lib/firebase'

// Reusable, read-only GRC document browser. Used both inside the CEO GRC Document
// Center (Library tab) and as the company-wide /employee/policies page. The server
// (listGrcDocuments) already filters by the access matrix, so each viewer only ever
// receives the documents their role may see — this component renders whatever it gets.
export default function PolicyLibrary({ heading = null }) {
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [domainFilter, setDomainFilter] = useState('all')
  const [busyId, setBusyId] = useState(null)
  // "now" captured asynchronously when the list loads (Date.now() is impure — keep
  // it out of render); used only to label review due/overdue badges.
  const [nowMs, setNowMs] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError('')
      try {
        const user = auth.currentUser
        if (!user) throw new Error('Not authenticated')
        const idToken = await user.getIdToken()
        const res = await fetch(LIST_GRC_DOCUMENTS_URL, {
          method: 'GET',
          headers: { Authorization: `Bearer ${idToken}` },
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to load the document library')
        if (!cancelled) { setDocs(Array.isArray(data.documents) ? data.documents : []); setNowMs(Date.now()) }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load the document library')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const handleRawDownload = async (doc) => {
    setBusyId(doc.id + ':raw')
    setError('')
    try {
      const idToken = await auth.currentUser.getIdToken()
      const res = await fetch(DOWNLOAD_GRC_DOCUMENT_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ doc_id: doc.doc_id, version: doc.version }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Download failed')
      if (data.signed_url) window.open(data.signed_url, '_blank', 'noopener')
    } catch (err) {
      setError(err.message || 'Download failed')
    } finally {
      setBusyId(null)
    }
  }

  // Letterhead download: generate-and-stream the branded PDF (official cover +
  // unaltered original). Response is a PDF blob, not JSON.
  const handleLetterhead = async (doc) => {
    setBusyId(doc.id + ':lh')
    setError('')
    try {
      const idToken = await auth.currentUser.getIdToken()
      const res = await fetch(GENERATE_PDF_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ template: 'grc_policy', docId: doc.doc_id }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Could not generate the letterhead copy')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener')
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (err) {
      setError(err.message || 'Could not generate the letterhead copy')
    } finally {
      setBusyId(null)
    }
  }

  const reviewState = (d) => {
    if (!nowMs) return null
    const v = d.next_review_date
    if (!v) return null
    const ms = typeof v === 'string' ? Date.parse(v) : (v._seconds ? v._seconds * 1000 : (v.seconds ? v.seconds * 1000 : NaN))
    if (!Number.isFinite(ms)) return null
    const days = Math.floor((ms - nowMs) / 86400000)
    if (days < 0) return { label: `Overdue ${Math.abs(days)}d`, color: '#EF5829' }
    if (days <= 30) return { label: `Due ${days}d`, color: '#F39C12' }
    return { label: new Date(ms).toISOString().slice(0, 10), color: 'var(--text-tertiary)' }
  }

  const filtered = docs.filter((d) => {
    const q = search.trim().toLowerCase()
    const matchesSearch = !q || (d.doc_id || '').toLowerCase().includes(q) || (d.doc_title || '').toLowerCase().includes(q)
    const matchesType = typeFilter === 'all' || (d.doc_id || '').toUpperCase().includes(typeFilter)
    const matchesDomain = domainFilter === 'all' || (d.domain || '').toUpperCase() === domainFilter
    return matchesSearch && matchesType && matchesDomain
  })

  return (
    <div>
      {heading && (
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 4 }}>{heading}</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Current company policies, procedures and forms. Download the official letterhead copy to read or print.</p>
        </div>
      )}
      <div className="card" style={{ marginBottom: 24, padding: '16px 20px', display: 'flex', gap: 16, alignItems: 'center', background: 'rgba(21, 152, 204, 0.05)' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <Search size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
          <input
            type="text" placeholder="Search by Document ID or Title..."
            value={search} onChange={(e) => setSearch(e.target.value)}
            style={{ width: '100%', padding: '10px 14px 10px 40px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-primary)', borderRadius: 8, color: 'var(--text-primary)', outline: 'none' }}
          />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ padding: '10px 14px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-primary)', borderRadius: 8, color: 'var(--text-primary)', outline: 'none' }}>
            <option value="all">All Types</option><option value="POL">Policies (POL)</option><option value="PRO">Procedures (PRO)</option><option value="FORM">Forms (FORM)</option>
          </select>
          <select value={domainFilter} onChange={(e) => setDomainFilter(e.target.value)} style={{ padding: '10px 14px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-primary)', borderRadius: 8, color: 'var(--text-primary)', outline: 'none' }}>
            <option value="all">All Domains</option><option value="SEC">SEC</option><option value="HRM">HRM</option><option value="GRC">GRC</option><option value="PRI">PRI</option><option value="FIN">FIN</option>
          </select>
        </div>
      </div>

      <div className="card" style={{ padding: 0, minHeight: 300, display: 'flex', flexDirection: 'column' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>Loading library…</div>
        ) : error ? (
          <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text-tertiary)', padding: 40 }}>
            <AlertTriangle size={48} style={{ margin: '0 auto 16px', opacity: 0.4, color: '#EF5829' }} />
            <h3 style={{ fontSize: '1.1rem', color: 'var(--text-secondary)', marginBottom: 8 }}>Could not load the library</h3>
            <p style={{ fontSize: '0.85rem', maxWidth: 360, margin: '0 auto 16px', color: '#ff6b6b' }}>{error}</p>
            <button className="btn btn-ghost btn-sm" onClick={() => window.location.reload()}>Retry</button>
          </div>
        ) : docs.length === 0 ? (
          <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text-tertiary)', padding: 40 }}>
            <FileText size={48} style={{ margin: '0 auto 16px', opacity: 0.2 }} />
            <h3 style={{ fontSize: '1.1rem', color: 'var(--text-secondary)', marginBottom: 8 }}>No policies available</h3>
            <p style={{ fontSize: '0.85rem', maxWidth: 320, margin: '0 auto' }}>There are no documents you can access yet.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text-tertiary)', padding: 40 }}>
            <Search size={48} style={{ margin: '0 auto 16px', opacity: 0.2 }} />
            <h3 style={{ fontSize: '1.1rem', color: 'var(--text-secondary)', marginBottom: 8 }}>No matches</h3>
            <p style={{ fontSize: '0.85rem', maxWidth: 300, margin: '0 auto' }}>No documents match your current search or filters.</p>
          </div>
        ) : (
          <table className="data-table">
            <thead><tr><th>Document ID</th><th>Title</th><th>Domain</th><th>Version</th><th>Classification</th><th>Review</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
            <tbody>
              {filtered.map((d) => {
                const rev = reviewState(d)
                return (
                  <tr key={d.id}>
                    <td style={{ fontFamily: 'monospace' }}>{d.doc_id}</td>
                    <td>{d.doc_title}</td>
                    <td>{d.domain || '—'}</td>
                    <td>v{d.version}</td>
                    <td>{d.classification || '—'}</td>
                    <td>{rev ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: rev.color, fontSize: '0.78rem' }}><Clock size={12} />{rev.label}</span> : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn btn-primary btn-sm" disabled={busyId === d.id + ':lh'} onClick={() => handleLetterhead(d)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: 8 }}>
                        <FileBadge size={14} /> {busyId === d.id + ':lh' ? 'Preparing…' : 'Letterhead'}
                      </button>
                      <button className="btn btn-ghost btn-sm" disabled={busyId === d.id + ':raw'} onClick={() => handleRawDownload(d)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <Download size={14} /> {busyId === d.id + ':raw' ? 'Preparing…' : 'Original'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
