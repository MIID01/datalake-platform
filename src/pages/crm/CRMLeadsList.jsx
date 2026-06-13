import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { auth, CRM_ARCHIVE_DEALS_URL, appCheckHeader } from '../../lib/firebase'
import { CEO_EMAIL } from '../../lib/auth'
import { LEGAL_FOOTER_EN } from '../../lib/company-legal'
import { DEAL_STAGES, stageMeta, fmtSar } from '../../lib/deals'
import { Trash2, Download, Search, Loader, AlertTriangle, RotateCcw, Archive } from 'lucide-react'

// Leads/deals LIST view — the bulk-ops surface (DTLK-UI-CRM-001 §3.2). Reads the
// SAME `deals` array the board subscribes to (single source; passed in — no second
// listener). Select-all, multi-select, bulk-export (CEO-only) and, for the CEO,
// bulk SOFT-DELETE (archive) + restore — routed through the audited Cloud Function
// (functions/crmImport.js crmArchiveDeals). Nothing hard-deletes from the UI (§2).
export default function CRMLeadsList({ deals }) {
  const [sel, setSel] = useState(() => new Set())
  const [q, setQ] = useState('')
  const [stageFilter, setStageFilter] = useState('ALL')
  const [showArchived, setShowArchived] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [msg, setMsg] = useState('')
  const isCeo = (auth.currentUser?.email || '').toLowerCase() === CEO_EMAIL.toLowerCase()

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return deals
      .filter(d => showArchived ? d.archived : !d.archived)
      .filter(d => stageFilter === 'ALL' || d.stage === stageFilter)
      .filter(d => !needle || [d.title, d.company_name, d.contact_name, d.contact_email, d.contact_phone, d.owner_email, d.source]
        .some(v => String(v || '').toLowerCase().includes(needle)))
      .sort((a, b) => tsMs(b.created_at) - tsMs(a.created_at))
  }, [deals, q, stageFilter, showArchived])

  const archivedCount = useMemo(() => deals.filter(d => d.archived).length, [deals])
  const allSelected = rows.length > 0 && rows.every(d => sel.has(d.id))
  const selectedRows = rows.filter(d => sel.has(d.id))

  const toggle = (id) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleAll = () => setSel(s => {
    if (allSelected) { const n = new Set(s); rows.forEach(d => n.delete(d.id)); return n }
    const n = new Set(s); rows.forEach(d => n.add(d.id)); return n
  })

  const exportCsv = (which) => {
    if (!isCeo) { setMsg('Export is restricted to the CEO.'); return } // lead data must never leave via non-CEO export
    const list = which.length ? which : rows
    if (!list.length) { setMsg('Nothing to export.'); return }
    const cols = ['id', 'entity_id', 'title', 'company_name', 'stage', 'value_sar', 'owner_email', 'contact_name', 'contact_email', 'contact_phone', 'source', 'import_batch_id', 'lawful_basis', 'consent_source', 'archived', 'created_at']
    const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }
    const lines = [cols.join(',')]
    list.forEach(d => lines.push(cols.map(c => esc(c === 'created_at' ? tsIso(d.created_at) : d[c])).join(',')))
    lines.push('') // D-5: every export carries the canonical legal footer
    lines.push(esc(LEGAL_FOOTER_EN))
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `deals-export-${list.length}.csv`
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
    setMsg(`Exported ${list.length} row(s).`)
  }

  // Soft-delete / restore via the audited Cloud Function (CEO-gated server-side too).
  const archiveSelected = async (restore) => {
    setMsg(''); setBusy(true)
    try {
      const ids = selectedRows.map(d => d.id)
      const token = await auth.currentUser.getIdToken()
      const resp = await fetch(CRM_ARCHIVE_DEALS_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(await appCheckHeader()) },
        body: JSON.stringify({ ids, restore, reason: restore ? 'bulk restore' : 'bulk archive (list view)' }),
      })
      const json = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(json.error || `Request failed (${resp.status})`)
      setMsg(`${restore ? 'Restored' : 'Archived'} ${json.affected ?? ids.length} deal(s).`)
      setSel(new Set()); setConfirmDel(false)
    } catch (e) { setMsg((confirmDel ? 'Archive' : 'Restore') + ' failed: ' + e.message) }
    finally { setBusy(false) }
  }

  return (
    <div>
      {/* toolbar */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ position: 'relative', flex: '1 1 220px' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search title, company, contact, owner…" style={{ ...inp, paddingLeft: 30 }} />
        </div>
        <select value={stageFilter} onChange={e => setStageFilter(e.target.value)} style={{ ...inp, width: 'auto' }}>
          <option value="ALL">All stages</option>
          {DEAL_STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <button onClick={() => { setShowArchived(v => !v); setSel(new Set()) }} className="btn btn-ghost" style={{ ...iconBtn, ...(showArchived ? { borderColor: '#022873', color: '#022873' } : {}) }}>
          <Archive size={14} /> {showArchived ? 'Viewing archived' : `Archived (${archivedCount})`}
        </button>
        {isCeo && <button className="btn btn-ghost" onClick={() => exportCsv([])} style={iconBtn}><Download size={14} /> Export all ({rows.length})</button>}
      </div>

      {/* bulk action bar */}
      {sel.size > 0 && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', background: 'var(--bg-surface,#eef2f7)', border: '1px solid var(--border-primary,#E5E7EB)', borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>
          <strong style={{ fontSize: '0.82rem' }}>{sel.size} selected</strong>
          {isCeo
            ? <>
                <button className="btn btn-ghost" onClick={() => exportCsv(selectedRows)} style={iconBtn}><Download size={14} /> Export selected</button>
                {showArchived
                  ? <button className="btn btn-ghost write-action" onClick={() => archiveSelected(true)} disabled={busy} style={{ ...iconBtn, color: '#15803d', borderColor: 'rgba(21,128,61,0.35)' }}><RotateCcw size={14} /> Restore selected</button>
                  : <button className="btn btn-ghost write-action" onClick={() => setConfirmDel(true)} disabled={busy} style={{ ...iconBtn, color: '#C0392B', borderColor: 'rgba(192,57,43,0.35)' }}><Trash2 size={14} /> Archive selected</button>}
              </>
            : <span style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)' }}>(bulk export & archive are CEO-only)</span>}
          <button className="btn btn-ghost" onClick={() => setSel(new Set())} style={{ ...iconBtn, marginLeft: 'auto' }}>Clear</button>
        </div>
      )}

      {msg && <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 10 }}>{msg}</div>}

      {/* table */}
      <div style={{ overflowX: 'auto', border: '1px solid var(--border-primary,#E5E7EB)', borderRadius: 10 }}>
        <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--bg-surface,#f8fafc)' }}>
              <th style={{ ...hcell, width: 36 }}><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" /></th>
              <th style={hcell}>Title</th><th style={hcell}>Company</th><th style={hcell}>Stage</th>
              <th style={{ ...hcell, textAlign: 'right' }}>Value</th><th style={hcell}>Owner</th><th style={hcell}>Contact</th><th style={hcell}>Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)' }}>{showArchived ? 'No archived deals.' : 'No deals match.'}</td></tr>
            ) : rows.map(d => {
              const sm = stageMeta(d.stage)
              return (
                <tr key={d.id} style={{ borderTop: '1px solid var(--border-primary,#f1f5f9)', background: sel.has(d.id) ? 'rgba(21,152,204,0.06)' : 'transparent' }}>
                  <td style={cell}><input type="checkbox" checked={sel.has(d.id)} onChange={() => toggle(d.id)} aria-label={`Select ${d.title}`} /></td>
                  <td style={cell}><Link to={`/crm/deals/${d.id}`} style={{ color: 'var(--text-primary)', fontWeight: 600, textDecoration: 'none' }}>{d.title || '(untitled)'}</Link></td>
                  <td style={cell}>{d.company_name || '—'}</td>
                  <td style={cell}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: sm.color }} />{sm.label}</span></td>
                  <td style={{ ...cell, textAlign: 'right' }}>{fmtSar(d.value_sar)}</td>
                  <td style={cell}>{d.owner_email || '—'}</td>
                  <td style={cell}>{d.contact_email || d.contact_name || d.contact_phone || '—'}</td>
                  <td style={cell}><span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>{d.source || '—'}</span></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* archive confirm */}
      {confirmDel && (
        <div className="modal-overlay" onClick={() => !busy && setConfirmDel(false)}>
          <div className="card" style={{ width: 'min(460px,94vw)', margin: 0 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}><AlertTriangle size={18} color="#C0392B" /><h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>Archive {selectedRows.length} deal(s)?</h3></div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 8 }}>This <strong>soft-deletes</strong> the selected deal(s): they leave the live board but are recoverable from <em>Archived</em>. Nothing is permanently deleted.</p>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginBottom: 16 }}>Tip: use <strong>Export selected</strong> first to keep a CSV backup.</p>
            {msg && <div style={{ fontSize: '0.8rem', color: '#991b1b', marginBottom: 10 }}>{msg}</div>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setConfirmDel(false)} disabled={busy}>Cancel</button>
              <button className="btn write-action" onClick={() => archiveSelected(false)} disabled={busy} style={{ background: '#C0392B', color: '#fff', border: 'none' }}>
                {busy ? <Loader size={15} className="spin" /> : <Trash2 size={15} />} {busy ? ' Archiving…' : ` Archive ${selectedRows.length}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const tsMs = (ts) => { try { return ts?.toMillis ? ts.toMillis() : 0 } catch { return 0 } }
const tsIso = (ts) => { try { return ts?.toDate ? ts.toDate().toISOString() : '' } catch { return '' } }
const inp = { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-primary, #E5E7EB)', background: 'var(--bg-surface, #fff)', color: 'var(--text-primary)', fontSize: '0.82rem', boxSizing: 'border-box', fontFamily: 'inherit' }
const iconBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.8rem' }
const hcell = { textAlign: 'left', padding: '9px 10px', fontWeight: 700, fontSize: '0.74rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }
const cell = { padding: '8px 10px', whiteSpace: 'nowrap', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }
