import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  doc, getDoc, collection, onSnapshot, query, orderBy, addDoc, serverTimestamp, updateDoc,
} from 'firebase/firestore'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { auth, db, storage } from '../../lib/firebase'
import { matchesClient } from '../../lib/client-linkage'
import {
  ArrowLeft, Mail, Phone, MapPin, FileText, Briefcase, DollarSign, Calendar,
  MessageSquare, Plus, Loader, AlertCircle, Building2, Upload,
} from 'lucide-react'

// Client detail — single source of truth = clients/{id}. Right panel shows
// every related record (projects, invoices, timesheets) plus a notes
// timeline that any CEO/business/sales user can append to.

const STATUS_COLOR = {
  PROSPECT: { color: '#1598CC', bg: 'rgba(21,152,204,0.12)', label: 'Prospect' },
  ACTIVE:   { color: '#34BF3A', bg: 'rgba(52,191,58,0.12)', label: 'Active' },
  INACTIVE: { color: '#64748b', bg: 'rgba(100,116,139,0.12)', label: 'Inactive' },
}
const fmt = (n) => 'SAR ' + Math.round(Number(n) || 0).toLocaleString()

export default function CRMClientDetail() {
  const { id } = useParams()
  const [client, setClient] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [projects, setProjects] = useState([])
  const [invoices, setInvoices] = useState([])
  const [timesheets, setTimesheets] = useState([])
  const [notes, setNotes] = useState([])
  const [noteBody, setNoteBody] = useState('')
  const [noteSaving, setNoteSaving] = useState(false)
  const [stageUpdating, setStageUpdating] = useState(false)
  const [logoBusy, setLogoBusy] = useState(false)

  const uploadLogo = async (file) => {
    if (!file || !client) return
    if (!file.type.startsWith('image/')) { alert('Please choose an image file (PNG/JPG/SVG).'); return }
    if (file.size > 2 * 1024 * 1024) { alert('Logo must be under 2 MB.'); return }
    setLogoBusy(true)
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase()
      const sref = storageRef(storage, `client-logos/${client.id}.${ext}`)
      await uploadBytes(sref, file)
      const url = await getDownloadURL(sref)
      await updateDoc(doc(db, 'clients', client.id), {
        logo_url: url, logo_updated_at: serverTimestamp(), logo_updated_by: auth.currentUser?.email || 'unknown',
      })
      setClient(c => ({ ...c, logo_url: url }))
    } catch (err) {
      alert('Logo upload failed: ' + err.message)
    } finally {
      setLogoBusy(false)
    }
  }

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const snap = await getDoc(doc(db, 'clients', id))
        if (!alive) return
        if (!snap.exists()) { setError('Client not found'); setLoading(false); return }
        setClient({ id: snap.id, ...snap.data() })
        setLoading(false)
      } catch (err) {
        if (alive) { setError(err.message); setLoading(false) }
      }
    })()
    return () => { alive = false }
  }, [id])

  // Subscribe to live related collections.
  useEffect(() => {
    if (!client) return
    const unsubs = []
    unsubs.push(onSnapshot(collection(db, 'projects'),
      snap => setProjects(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => matchesClient(p, client))),
      e => console.warn('client projects:', e.message)))
    unsubs.push(onSnapshot(collection(db, 'invoices'),
      snap => setInvoices(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(i => matchesClient(i, client))),
      e => console.warn('client invoices:', e.message)))
    unsubs.push(onSnapshot(collection(db, 'timesheets'),
      snap => setTimesheets(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(t => matchesClient(t, client))),
      e => console.warn('client timesheets:', e.message)))
    unsubs.push(onSnapshot(query(collection(db, 'clients', client.id, 'client_notes'), orderBy('created_at', 'desc')),
      snap => setNotes(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      () => {}))
    return () => unsubs.forEach(u => u())
  }, [client?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const totals = useMemo(() => ({
    revenue_lifetime: invoices.filter(i => i.status === 'PAID').reduce((s, i) => s + (Number(i.total) || 0), 0),
    revenue_outstanding: invoices.filter(i => i.status !== 'PAID' && i.status !== 'CANCELLED').reduce((s, i) => s + (Number(i.total) || 0), 0),
    active_projects: projects.filter(p => (p.status || 'ACTIVE') === 'ACTIVE').length,
    timesheets_total: timesheets.length,
  }), [invoices, projects, timesheets])

  const addNote = async () => {
    if (!noteBody.trim() || !client) return
    setNoteSaving(true)
    try {
      const me = auth.currentUser
      await addDoc(collection(db, 'clients', client.id, 'client_notes'), {
        body: noteBody.trim(),
        created_at: serverTimestamp(),
        created_by: me?.email || 'unknown',
        created_by_uid: me?.uid || null,
      })
      // Stamp last_interaction on the parent doc for the list view.
      await updateDoc(doc(db, 'clients', client.id), {
        last_interaction_at: serverTimestamp(),
        last_interaction_by: me?.email || 'unknown',
      })
      setNoteBody('')
    } catch (err) {
      alert('Add note failed: ' + err.message)
    } finally {
      setNoteSaving(false)
    }
  }

  const setStatus = async (next) => {
    if (!client) return
    const cur = (client.status || 'ACTIVE').toUpperCase()
    if (next === cur) return
    const effect = next === 'ACTIVE'
      ? ' Marking ACTIVE removes the client from the prospect pipeline.'
      : next === 'INACTIVE'
      ? ' Marking INACTIVE removes the client from active views.'
      : next === 'PROSPECT'
      ? ' Marking PROSPECT moves the client into the sales pipeline.'
      : ''
    if (!window.confirm(`Change ${client.client_name || 'this client'} status from ${cur} to ${next}?${effect}`)) return
    setStageUpdating(true)
    try {
      await updateDoc(doc(db, 'clients', client.id), {
        status: next,
        updated_at: serverTimestamp(),
        updated_by: auth.currentUser?.email || 'unknown',
      })
      setClient(c => ({ ...c, status: next }))
    } catch (err) {
      alert('Status change failed: ' + err.message)
    } finally {
      setStageUpdating(false)
    }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Loading client…</div>
  if (error) return (
    <div style={{ padding: 24 }}>
      <Link to="/crm/clients" style={{ color: '#022873', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <ArrowLeft size={14} /> Back to clients
      </Link>
      <div style={{ marginTop: 14, padding: 14, background: 'rgba(192,57,43,0.1)', border: '1px solid rgba(192,57,43,0.3)', borderRadius: 8, color: '#C0392B', fontSize: '0.86rem' }}>
        <AlertCircle size={14} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} /> {error}
      </div>
    </div>
  )
  if (!client) return null

  const sm = STATUS_COLOR[(client.status || 'ACTIVE').toUpperCase()] || STATUS_COLOR.ACTIVE

  return (
    <div style={{ padding: 24 }}>
      <Link to="/crm/clients" style={{ color: '#022873', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 14, fontSize: '0.82rem' }}>
        <ArrowLeft size={14} /> Back to clients
      </Link>

      {/* Header */}
      <div style={{ background: 'var(--bg-surface, #fff)', border: '1px solid var(--border-primary, #E5E7EB)', borderRadius: 12, padding: 22, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {client.logo_url
                ? <img src={client.logo_url} alt={client.client_name} style={{ height: 40, maxWidth: 130, objectFit: 'contain' }} />
                : <Building2 size={22} color="#022873" />}
              <h1 style={{ fontSize: '1.4rem', fontWeight: 700, margin: 0 }}>{client.client_name}</h1>
              <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 999, fontSize: '0.72rem', fontWeight: 700, background: sm.bg, color: sm.color }}>{sm.label}</span>
              <label className="write-action" title="Used on timesheets & invoices" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border-primary, #E5E7EB)', background: 'var(--bg-surface, #fff)', fontSize: '0.74rem', fontWeight: 600, color: '#022873', cursor: logoBusy ? 'wait' : 'pointer' }}>
                {logoBusy ? <Loader size={12} className="spin" /> : <Upload size={12} />}
                {client.logo_url ? 'Change logo' : 'Upload logo'}
                <input type="file" accept="image/*" hidden disabled={logoBusy} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; uploadLogo(f) }} />
              </label>
            </div>
            {client.client_name_ar && (
              <div dir="rtl" style={{ marginTop: 4, fontSize: '0.84rem', color: 'var(--text-secondary)' }}>{client.client_name_ar}</div>
            )}
            <div style={{ marginTop: 8, fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>{client.industry || '—'}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
            <div style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)' }}>Status</div>
            <select className="write-action" value={(client.status || 'ACTIVE').toUpperCase()} disabled={stageUpdating} onChange={e => setStatus(e.target.value)} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border-primary, #E5E7EB)', background: 'var(--bg-surface, #fff)', fontFamily: 'inherit', fontSize: '0.84rem' }}>
              <option value="PROSPECT">Prospect</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginTop: 18 }}>
          <Stat label="Active projects" value={totals.active_projects} icon={Briefcase} color="#022873" />
          <Stat label="Lifetime revenue" value={fmt(totals.revenue_lifetime)} icon={DollarSign} color="#34BF3A" />
          <Stat label="Outstanding" value={fmt(totals.revenue_outstanding)} icon={DollarSign} color="#F39C12" />
          <Stat label="Timesheets" value={totals.timesheets_total} icon={Calendar} color="#1598CC" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginTop: 18 }}>
          <Info label="Contact person" value={client.contact_person} />
          <Info label="Email" value={client.contact_email} icon={Mail} link={client.contact_email ? `mailto:${client.contact_email}` : null} />
          <Info label="Phone" value={client.contact_phone} icon={Phone} />
          <Info label="Address" value={client.address} icon={MapPin} />
          <Info label="VAT number" value={client.vat_number} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(280px, 360px)', gap: 16, alignItems: 'start' }}>
        {/* Left: Projects + Invoices + Timesheets */}
        <div>
          <Panel title="Projects" count={projects.length} icon={Briefcase}>
            {projects.length === 0 ? (
              <Empty>No projects for this client yet.</Empty>
            ) : (
              <table className="data-table" style={{ width: '100%', fontSize: '0.84rem' }}>
                <thead><tr><th>Project</th><th>PO</th><th>Status</th><th>PO Value</th></tr></thead>
                <tbody>
                  {projects.map(p => (
                    <tr key={p.id}>
                      <td><div style={{ fontWeight: 600 }}>{p.project_name}</div><div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>{p.project_id || p.id}</div></td>
                      <td>{p.po_number || '—'}</td>
                      <td>{p.status || 'ACTIVE'}</td>
                      <td>{fmt(p.po_value_sar)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          <Panel title="Invoices" count={invoices.length} icon={FileText}>
            {invoices.length === 0 ? (
              <Empty>No invoices yet.</Empty>
            ) : (
              <table className="data-table" style={{ width: '100%', fontSize: '0.84rem' }}>
                <thead><tr><th>#</th><th>Period</th><th>Total</th><th>Status</th></tr></thead>
                <tbody>
                  {invoices.slice(0, 25).map(i => (
                    <tr key={i.id}>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.74rem' }}>{i.invoice_number || i.id.slice(0, 8)}</td>
                      <td>{i.period_start && i.period_end ? `${i.period_start} → ${i.period_end}` : (i.period || '—')}</td>
                      <td style={{ fontWeight: 600 }}>{fmt(i.total)}</td>
                      <td>{i.status || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          <Panel title="Timesheets" count={timesheets.length} icon={Calendar}>
            {timesheets.length === 0 ? (
              <Empty>No timesheets recorded.</Empty>
            ) : (
              <table className="data-table" style={{ width: '100%', fontSize: '0.84rem' }}>
                <thead><tr><th>Engineer</th><th>Period</th><th>Hours</th><th>State</th></tr></thead>
                <tbody>
                  {timesheets.slice(0, 25).map(t => (
                    <tr key={t.id}>
                      <td>{t.engineer_name || t.engineer_email || '—'}</td>
                      <td>{t.period_label || `${t.period_year || ''}-${t.period_month || ''}`}</td>
                      <td>{t.total_hours || 0}</td>
                      <td>{t.state || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>

        {/* Right: Notes timeline */}
        <div style={{ position: 'sticky', top: 16 }}>
          <Panel title="Notes & interactions" count={notes.length} icon={MessageSquare}>
            <div style={{ marginBottom: 12 }}>
              <textarea
                value={noteBody}
                onChange={e => setNoteBody(e.target.value)}
                placeholder="What happened? Call, email, meeting, decision…"
                rows={3}
                className="write-action"
                style={{ width: '100%', padding: 10, border: '1px solid var(--border-primary, #E5E7EB)', borderRadius: 6, fontFamily: 'inherit', fontSize: '0.84rem', boxSizing: 'border-box', resize: 'vertical' }}
              />
              <button onClick={addNote} disabled={!noteBody.trim() || noteSaving} className="write-action" style={{ marginTop: 8, padding: '8px 14px', borderRadius: 6, border: 'none', background: !noteBody.trim() || noteSaving ? '#94a3b8' : '#022873', color: '#fff', fontWeight: 600, fontSize: '0.84rem', cursor: !noteBody.trim() || noteSaving ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'inherit' }}>
                {noteSaving ? <Loader size={13} className="spin" /> : <Plus size={13} />}
                Add note
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 480, overflowY: 'auto' }}>
              {notes.length === 0 && <Empty>No notes yet. Add one above.</Empty>}
              {notes.map(n => (
                <div key={n.id} style={{ padding: 10, borderRadius: 8, background: 'var(--bg-surface, #f8fafc)', border: '1px solid var(--border-primary, #E5E7EB)' }}>
                  <div style={{ fontSize: '0.84rem', whiteSpace: 'pre-wrap', color: 'var(--text-primary)' }}>{n.body}</div>
                  <div style={{ marginTop: 6, fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
                    {n.created_by} · {n.created_at?.toDate ? n.created_at.toDate().toLocaleString() : '—'}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}

function Panel({ title, count, icon: Icon, children }) {
  return (
    <div style={{ background: 'var(--bg-surface, #fff)', border: '1px solid var(--border-primary, #E5E7EB)', borderRadius: 12, padding: 16, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        {Icon && <Icon size={16} color="#022873" />}
        <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0 }}>{title}</h3>
        {count != null && <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginLeft: 4 }}>({count})</span>}
      </div>
      {children}
    </div>
  )
}
function Stat({ label, value, icon: Icon, color }) {
  return (
    <div style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--bg-surface, #f8fafc)', border: '1px solid var(--border-primary, #E5E7EB)' }}>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: 4 }}>
        {Icon && <Icon size={11} />} {label}
      </div>
      <div style={{ fontSize: '1.05rem', fontWeight: 700, color, marginTop: 4 }}>{value}</div>
    </div>
  )
}
function Info({ label, value, icon: Icon, link }) {
  const content = (
    <>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: '0.86rem', color: 'var(--text-primary)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
        {Icon && <Icon size={12} />} {value || '—'}
      </div>
    </>
  )
  return link ? <a href={link} style={{ textDecoration: 'none' }}>{content}</a> : <div>{content}</div>
}
function Empty({ children }) {
  return <div style={{ padding: '14px 8px', color: 'var(--text-tertiary)', fontSize: '0.84rem', textAlign: 'center' }}>{children}</div>
}
