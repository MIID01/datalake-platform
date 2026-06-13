import { useState, useMemo } from 'react'
import { auth, CRM_IMPORT_LEADS_URL, appCheckHeader } from '../lib/firebase'
import { DEFAULT_LEAD_RETENTION_DAYS } from '../lib/deals'
import { X, Upload, Loader, ArrowRight, ArrowLeft, CheckCircle2, AlertTriangle } from 'lucide-react'

// CSV lead import → deals (source CSV_IMPORT).
//
// Hard rules (this modal is the fix for the un-validated batch that wrote
// thousands of "Imported lead" junk rows):
//   1. EXPLICIT column mapping — the user maps each CSV column to a deal field.
//      Unmapped columns (e.g. a stray "a1" URL column) are NEVER ingested.
//   2. PER-ROW validation — a row with no title AND no company_name is REJECTED,
//      never written as a placeholder. A non-numeric value is rejected.
//   3. PREVIEW → CONFIRM — nothing is written until the user sees
//      "X valid / Y skipped" and explicitly confirms.
//   4. PDPL gate — if any valid row carries contact PII, a lawful basis +
//      documented source are required before any write.

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

// Target deal fields the user can map a CSV column onto. `aliases` only drive the
// auto-guess; the user can always override. Nothing is read unless mapped.
const FIELDS = [
  { key: 'title',         label: 'Deal title',    identifying: true,  aliases: ['title', 'deal', 'deal_title', 'opportunity', 'name'] },
  { key: 'company_name',  label: 'Company',       identifying: true,  aliases: ['company_name', 'company', 'account', 'organisation', 'organization'] },
  { key: 'value_sar',     label: 'Value (SAR)',   numeric: true,      aliases: ['value_sar', 'value', 'amount', 'deal_value'] },
  { key: 'contact_name',  label: 'Contact name',  pii: true,          aliases: ['contact_name', 'contact', 'full_name', 'person'] },
  { key: 'contact_email', label: 'Contact email', pii: true, email: true, aliases: ['contact_email', 'email', 'e-mail', 'mail'] },
  { key: 'contact_phone', label: 'Contact phone', pii: true,          aliases: ['contact_phone', 'phone', 'mobile', 'tel', 'telephone'] },
  { key: 'owner_email',   label: 'Owner email',                       aliases: ['owner_email', 'owner', 'assigned_to', 'rep'] },
  { key: 'expected_close',label: 'Expected close',                    aliases: ['expected_close', 'close_date', 'expected', 'closing'] },
]
const IGNORE = '__ignore__'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const toNum = (v) => Number(String(v == null ? '' : v).replace(/[^0-9.-]/g, ''))

export default function CSVImportModal({ onClose, onImported }) {
  const [step, setStep] = useState('upload') // upload → map → preview
  const [parsed, setParsed] = useState(null)  // { header:[], data:[{}] }
  const [mapping, setMapping] = useState({})   // fieldKey → header | IGNORE
  const [lawfulBasis, setLawfulBasis] = useState('consent')
  const [consentSource, setConsentSource] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(0)

  const onFile = async (e) => {
    setErr(''); setDone(0); setParsed(null); setMapping({}); setStep('upload')
    const f = e.target.files?.[0]; if (!f) return
    try {
      const rows = parseCsv(await f.text())
      if (rows.length < 2) { setErr('CSV needs a header row + at least one data row.'); return }
      const header = rows[0].map(h => h.trim())
      const data = rows.slice(1).map(r => Object.fromEntries(header.map((h, i) => [h, (r[i] || '').trim()])))
      // Auto-guess: match each field's aliases against headers (case-insensitive).
      const norm = (s) => s.toLowerCase().replace(/[\s_-]+/g, '')
      const guess = {}
      const taken = new Set()
      for (const f of FIELDS) {
        const hit = header.find(h => !taken.has(h) && f.aliases.some(a => norm(a) === norm(h)))
        if (hit) { guess[f.key] = hit; taken.add(hit) }
      }
      setParsed({ header, data }); setMapping(guess); setStep('map')
    } catch (e) { setErr('Could not read file: ' + e.message) }
  }

  const mapped = (key) => mapping[key] && mapping[key] !== IGNORE ? mapping[key] : null
  const hasIdentifyingMap = !!(mapped('title') || mapped('company_name'))

  // Validate every row against the current mapping. Pure → memoised.
  const result = useMemo(() => {
    const mp = (key) => mapping[key] && mapping[key] !== IGNORE ? mapping[key] : null
    if (!parsed || !(mp('title') || mp('company_name'))) return null
    const valid = [], skipped = []
    parsed.data.forEach((r, idx) => {
      const get = (k) => { const h = mp(k); return h ? (r[h] || '').trim() : '' }
      const title = get('title'), company = get('company_name')
      if (!title && !company) { skipped.push({ idx, reason: 'no title or company' }); return }
      const rawVal = get('value_sar')
      let value = 0
      if (mp('value_sar') && rawVal !== '') {
        value = toNum(rawVal)
        if (!isFinite(value) || isNaN(value) || rawVal.replace(/[^0-9.-]/g, '') === '') {
          skipped.push({ idx, reason: `value "${rawVal}" is not a number` }); return
        }
        if (value < 0) { skipped.push({ idx, reason: 'negative value' }); return }
      }
      let email = get('contact_email') || ''
      let emailWarn = false
      if (email && !EMAIL_RE.test(email)) { email = ''; emailWarn = true } // drop garbage PII, keep the lead
      valid.push({
        title: title || company, company_name: company,
        value_sar: value,
        contact_name: get('contact_name') || null,
        contact_email: email || null,
        contact_phone: get('contact_phone') || null,
        owner_email: get('owner_email') || null,
        expected_close: get('expected_close') || null,
        _emailWarn: emailWarn,
      })
    })
    const anyPii = valid.some(v => v.contact_email || v.contact_phone || v.contact_name)
    const emailWarns = valid.filter(v => v._emailWarn).length
    return { valid, skipped, anyPii, emailWarns }
  }, [parsed, mapping])

  // Write path is SERVER-SIDE (functions/crmImport.js): the server re-validates,
  // enforces the PDPL gate, stamps entity_id + import_batch_id, and audits BEFORE
  // the write. We send only the mapped fields (never arbitrary columns), chunked
  // under one client-generated import_batch_id so undo can target the whole batch.
  const doImport = async () => {
    setErr('')
    if (!result?.valid.length) { setErr('Nothing valid to import.'); return }
    if (result.anyPii && !consentSource.trim()) { setErr('Imported contact PII needs a documented source (PDPL). Fill the source field below.'); return }
    setBusy(true)
    try {
      const token = await auth.currentUser.getIdToken()
      const appCheck = await appCheckHeader()
      const batchId = `IMPORT-${(crypto.randomUUID?.() || String(Date.now()) + Math.round(performance.now()))}`
      const consent = { lawful_basis: lawfulBasis, consent_source: consentSource.trim() }
      let written = 0
      const skipped = []
      for (let i = 0; i < result.valid.length; i += 500) {
        const rows = result.valid.slice(i, i + 500).map(v => ({
          title: v.title, company_name: v.company_name, value_sar: v.value_sar,
          contact_name: v.contact_name, contact_email: v.contact_email, contact_phone: v.contact_phone,
          owner_email: v.owner_email, expected_close: v.expected_close,
        }))
        const resp = await fetch(CRM_IMPORT_LEADS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...appCheck },
          body: JSON.stringify({ rows, consent, import_batch_id: batchId, base_idx: i }),
        })
        const json = await resp.json().catch(() => ({}))
        if (!resp.ok) throw new Error(json.error || `Import failed (${resp.status})`)
        written += json.written || 0
        if (Array.isArray(json.skipped)) skipped.push(...json.skipped)
        setDone(written)
      }
      onImported?.(written, batchId, skipped.length)
      onClose?.()
    } catch (e) { setErr('Import failed: ' + e.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="card" style={{ width: 'min(760px, 94vw)', maxHeight: '92vh', overflowY: 'auto', margin: 0 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>Import leads (CSV)</h3>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}><X size={18} /></button>
        </div>
        <Steps step={step} />

        {/* STEP 1 — upload */}
        {step === 'upload' && (
          <>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginBottom: 10 }}>
              Pick a CSV. The next step lets you map each column to a deal field — columns you don't map are ignored, so a stray column can't create junk rows.
            </p>
            <input type="file" accept=".csv,text/csv" onChange={onFile} style={{ marginBottom: 12 }} />
          </>
        )}

        {/* STEP 2 — explicit column mapping */}
        {step === 'map' && parsed && (
          <>
            <div style={{ fontSize: '0.82rem', marginBottom: 10 }}>
              <strong>{parsed.data.length}</strong> data rows · {parsed.header.length} columns. Map columns → deal fields. A lead needs at least <strong>Deal title</strong> or <strong>Company</strong>.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
              {FIELDS.map(f => (
                <label key={f.key} style={{ fontSize: '0.76rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  {f.label}{f.identifying ? ' *' : ''}{f.pii ? ' (PII)' : ''}
                  <select value={mapping[f.key] || IGNORE} onChange={e => setMapping(m => ({ ...m, [f.key]: e.target.value }))} style={inp}>
                    <option value={IGNORE}>— ignore —</option>
                    {parsed.header.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <PreviewTable header={parsed.header} data={parsed.data} />
            {!hasIdentifyingMap && <div style={{ color: '#9a3412', fontSize: '0.78rem', marginTop: 8, display: 'flex', gap: 6, alignItems: 'center' }}><AlertTriangle size={14} /> Map at least Deal title or Company to continue.</div>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', marginTop: 14 }}>
              <button className="btn btn-ghost" onClick={() => { setStep('upload'); setParsed(null) }}><ArrowLeft size={14} /> Back</button>
              <button className="btn btn-primary" onClick={() => setStep('preview')} disabled={!hasIdentifyingMap}>Preview <ArrowRight size={14} /></button>
            </div>
          </>
        )}

        {/* STEP 3 — preview → confirm */}
        {step === 'preview' && result && (
          <>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 12, fontSize: '0.85rem' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#15803d', fontWeight: 700 }}><CheckCircle2 size={16} /> {result.valid.length} valid</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: result.skipped.length ? '#9a3412' : 'var(--text-tertiary)', fontWeight: 700 }}><AlertTriangle size={16} /> {result.skipped.length} skipped</span>
              {result.emailWarns > 0 && <span style={{ color: 'var(--text-tertiary)', fontSize: '0.78rem' }}>· {result.emailWarns} invalid email(s) dropped (lead kept)</span>}
            </div>

            {result.valid.length > 0 && (
              <>
                <div style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>Sample of valid rows (first 8)</div>
                <div style={{ maxHeight: 180, overflow: 'auto', border: '1px solid var(--border-primary, #E5E7EB)', borderRadius: 8, marginBottom: 12 }}>
                  <table style={{ width: '100%', fontSize: '0.74rem', borderCollapse: 'collapse' }}>
                    <thead><tr>{['title', 'company_name', 'value_sar', 'contact_email'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                    <tbody>{result.valid.slice(0, 8).map((v, i) => <tr key={i}><td style={td}>{v.title}</td><td style={td}>{v.company_name || '—'}</td><td style={td}>{v.value_sar}</td><td style={td}>{v.contact_email || '—'}</td></tr>)}</tbody>
                  </table>
                </div>
              </>
            )}

            {result.skipped.length > 0 && (
              <div style={{ fontSize: '0.76rem', color: 'var(--text-tertiary)', marginBottom: 12 }}>
                <strong>Skipped (not written):</strong> {summariseSkips(result.skipped)}
              </div>
            )}

            {result.anyPii && (
              <div style={{ background: 'rgba(239,88,41,0.06)', border: '1px solid rgba(239,88,41,0.25)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#9a3412', marginBottom: 8 }}>PDPL — valid rows contain contact PII</div>
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

            {err && <div style={{ color: '#991b1b', fontSize: '0.82rem', marginBottom: 10 }}>{err}</div>}
            {busy && <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 10 }}>Imported {done}…</div>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', marginTop: 4 }}>
              <button className="btn btn-ghost" onClick={() => setStep('map')} disabled={busy}><ArrowLeft size={14} /> Back to mapping</button>
              <button className="btn btn-primary write-action" onClick={doImport} disabled={busy || !result.valid.length}>
                {busy ? <Loader size={15} className="spin" /> : <Upload size={15} />} {busy ? ' Importing…' : ` Confirm — import ${result.valid.length} lead${result.valid.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </>
        )}

        {err && step !== 'preview' && <div style={{ color: '#991b1b', fontSize: '0.82rem', marginTop: 10 }}>{err}</div>}
      </div>
    </div>
  )
}

function Steps({ step }) {
  const order = ['upload', 'map', 'preview']
  const labels = { upload: '1 · Upload', map: '2 · Map columns', preview: '3 · Preview & confirm' }
  const at = order.indexOf(step)
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 14, fontSize: '0.72rem' }}>
      {order.map((s, i) => (
        <span key={s} style={{ padding: '3px 9px', borderRadius: 20, fontWeight: 600, background: i <= at ? '#022873' : 'var(--bg-surface,#eef2f7)', color: i <= at ? '#fff' : 'var(--text-tertiary)' }}>{labels[s]}</span>
      ))}
    </div>
  )
}

function PreviewTable({ header, data }) {
  return (
    <div style={{ maxHeight: 160, overflow: 'auto', border: '1px solid var(--border-primary, #E5E7EB)', borderRadius: 8, marginBottom: 4 }}>
      <table style={{ width: '100%', fontSize: '0.72rem', borderCollapse: 'collapse' }}>
        <thead><tr>{header.map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
        <tbody>{data.slice(0, 5).map((r, i) => <tr key={i}>{header.map(h => <td key={h} style={td}>{r[h]}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
}

function summariseSkips(skipped) {
  const counts = {}
  skipped.forEach(s => { counts[s.reason] = (counts[s.reason] || 0) + 1 })
  return Object.entries(counts).map(([r, n]) => `${n}× ${r}`).join(', ')
}

const inp = { width: '100%', padding: '7px 9px', borderRadius: 7, border: '1px solid var(--border-primary, #E5E7EB)', background: 'var(--bg-surface, #fff)', color: 'var(--text-primary)', fontSize: '0.82rem', boxSizing: 'border-box', fontFamily: 'inherit', marginTop: 4 }
const th = { textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--border-primary, #E5E7EB)', position: 'sticky', top: 0, background: 'var(--bg-card,#fff)', fontWeight: 700 }
const td = { padding: '5px 8px', borderBottom: '1px solid var(--border-primary, #f1f5f9)', whiteSpace: 'nowrap', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }
