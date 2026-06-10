import { useState } from 'react'
import { collection, writeBatch, doc, serverTimestamp, Timestamp } from 'firebase/firestore'
import { auth, db } from '../lib/firebase'
import { DEFAULT_LEAD_RETENTION_DAYS } from '../lib/deals'
import { X, Upload, Loader } from 'lucide-react'

// CSV lead import → deals (source CSV_IMPORT). PDPL: imported contact PII
// requires a documented source + lawful basis before any write.
// Recognised headers (case-insensitive): title, company_name/company,
// value_sar/value, contact_name/name, contact_email/email, contact_phone/phone, owner_email.
function parseCsv(text) {
  const rows = []; let row = [], field = '', inQ = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else inQ = false }
      else field += c
    } else if (c === '"') inQ = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = '' }
    else field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows.filter(r => r.some(c => String(c).trim() !== ''))
}

export default function CSVImportModal({ onClose, onImported }) {
  const [rows, setRows] = useState(null)
  const [lawfulBasis, setLawfulBasis] = useState('consent')
  const [consentSource, setConsentSource] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(0)

  const onFile = async (e) => {
    setErr(''); setDone(0); setRows(null)
    const f = e.target.files?.[0]; if (!f) return
    try {
      const parsed = parseCsv(await f.text())
      if (parsed.length < 2) { setErr('CSV needs a header row + at least one data row.'); return }
      const header = parsed[0].map(h => h.trim().toLowerCase())
      const data = parsed.slice(1).map(r => Object.fromEntries(header.map((h, i) => [h, (r[i] || '').trim()])))
      setRows({ header, data })
    } catch (e) { setErr('Could not read file: ' + e.message) }
  }

  const col = (r, ...names) => { for (const n of names) if (r[n]) return r[n]; return '' }
  const hasPii = (r) => !!(col(r, 'contact_email', 'email') || col(r, 'contact_phone', 'phone') || col(r, 'contact_name', 'contact', 'name'))
  const anyPii = !!rows?.data?.some(hasPii)

  const doImport = async () => {
    setErr('')
    if (!rows?.data?.length) return
    if (anyPii && !consentSource.trim()) { setErr('Imported contact PII needs a documented source (PDPL). Fill the source field below.'); return }
    setBusy(true)
    try {
      const me = auth.currentUser
      const purgeAfter = Timestamp.fromMillis(Date.now() + DEFAULT_LEAD_RETENTION_DAYS * 86400000)
      const chunks = []
      for (let i = 0; i < rows.data.length; i += 400) chunks.push(rows.data.slice(i, i + 400))
      let count = 0
      for (const chunk of chunks) {
        const batch = writeBatch(db)
        chunk.forEach(r => {
          const pii = hasPii(r)
          batch.set(doc(collection(db, 'deals')), {
            title: col(r, 'title', 'deal', 'deal_title') || col(r, 'company_name', 'company') || 'Imported lead',
            value_sar: Number(col(r, 'value_sar', 'value', 'amount')) || 0,
            stage: 'NEW',
            owner_email: col(r, 'owner', 'owner_email') || me?.email || 'unknown',
            client_id: null,
            company_name: col(r, 'company_name', 'company', 'account') || '',
            contact_name: col(r, 'contact_name', 'contact', 'name') || null,
            contact_email: col(r, 'contact_email', 'email') || null,
            contact_phone: col(r, 'contact_phone', 'phone') || null,
            source: 'CSV_IMPORT',
            expected_close: null,
            lawful_basis: pii ? lawfulBasis : null,
            consent_source: pii ? (consentSource.trim() || null) : null,
            pdpl_purge_after: pii ? purgeAfter : null,
            created_at: serverTimestamp(),
            created_by: me?.email || 'unknown',
            created_by_uid: me?.uid || null,
            updated_at: serverTimestamp(),
          })
        })
        await batch.commit()
        count += chunk.length; setDone(count)
      }
      onImported?.(count)
      onClose?.()
    } catch (e) { setErr('Import failed: ' + e.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="card" style={{ width: 'min(720px, 94vw)', maxHeight: '92vh', overflowY: 'auto', margin: 0 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>Import leads (CSV)</h3>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}><X size={18} /></button>
        </div>

        <p style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginBottom: 10 }}>
          Columns: <code>title, company_name, value_sar, contact_name, contact_email, contact_phone, owner_email</code>. Imported as NEW deals (source CSV_IMPORT).
        </p>
        <input type="file" accept=".csv,text/csv" onChange={onFile} style={{ marginBottom: 12 }} />

        {rows && (
          <>
            <div style={{ fontSize: '0.82rem', marginBottom: 8 }}><strong>{rows.data.length}</strong> rows · columns: {rows.header.join(', ')}</div>
            <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid var(--border-primary, #E5E7EB)', borderRadius: 8, marginBottom: 12 }}>
              <table style={{ width: '100%', fontSize: '0.74rem', borderCollapse: 'collapse' }}>
                <thead><tr>{rows.header.map(h => <th key={h} style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--border-primary, #E5E7EB)' }}>{h}</th>)}</tr></thead>
                <tbody>{rows.data.slice(0, 8).map((r, i) => <tr key={i}>{rows.header.map(h => <td key={h} style={{ padding: '5px 8px' }}>{r[h]}</td>)}</tr>)}</tbody>
              </table>
            </div>

            {anyPii && (
              <div style={{ background: 'rgba(239,88,41,0.06)', border: '1px solid rgba(239,88,41,0.25)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#9a3412', marginBottom: 8 }}>PDPL — this file contains contact PII</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
                  <label style={{ fontSize: '0.74rem' }}>Lawful basis
                    <select value={lawfulBasis} onChange={e => setLawfulBasis(e.target.value)} style={inp}><option value="consent">Consent</option><option value="legitimate_interest">Legitimate interest</option></select>
                  </label>
                  <label style={{ fontSize: '0.74rem' }}>Documented source *
                    <input value={consentSource} onChange={e => setConsentSource(e.target.value)} style={inp} placeholder="e.g. consented webinar list, 2026-05, ref #…" />
                  </label>
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginTop: 6 }}>Retained {Math.round(DEFAULT_LEAD_RETENTION_DAYS / 365)} years then purged. No unconsented contact data.</div>
              </div>
            )}
          </>
        )}

        {err && <div style={{ color: '#991b1b', fontSize: '0.82rem', marginBottom: 10 }}>{err}</div>}
        {busy && <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 10 }}>Imported {done}…</div>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary write-action" onClick={doImport} disabled={busy || !rows?.data?.length}>
            {busy ? <Loader size={15} className="spin" /> : <Upload size={15} />} {busy ? ' Importing…' : ` Import ${rows?.data?.length || 0} leads`}
          </button>
        </div>
      </div>
    </div>
  )
}

const inp = { width: '100%', padding: '7px 9px', borderRadius: 7, border: '1px solid var(--border-primary, #E5E7EB)', background: 'var(--bg-surface, #fff)', color: 'var(--text-primary)', fontSize: '0.82rem', boxSizing: 'border-box', fontFamily: 'inherit', marginTop: 4 }
