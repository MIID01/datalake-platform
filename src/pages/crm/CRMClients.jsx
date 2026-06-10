import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  collection, onSnapshot, query, orderBy,
} from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { matchesClient } from '../../lib/client-linkage'
import {
  Search, X, Building2, Plus, ChevronRight, Phone, Mail, Briefcase, DollarSign, Clock,
} from 'lucide-react'

// CRM list view. Same clients collection as /ceo/clients (single source of
// truth) but slanted for sales: status pill, active project count, MTD
// revenue, last interaction stamp.

const STATUS_OPTIONS = ['ALL', 'PROSPECT', 'ACTIVE', 'INACTIVE']
const STATUS_COLOR = {
  PROSPECT: { color: '#1598CC', bg: 'rgba(21,152,204,0.12)', label: 'Prospect' },
  ACTIVE:   { color: '#34BF3A', bg: 'rgba(52,191,58,0.12)', label: 'Active' },
  INACTIVE: { color: '#64748b', bg: 'rgba(100,116,139,0.12)', label: 'Inactive' },
}

const fmtSar = (n) => 'SAR ' + Math.round(Number(n) || 0).toLocaleString()

export default function CRMClients() {
  const [clients, setClients] = useState([])
  const [projects, setProjects] = useState([])
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')

  useEffect(() => {
    const unsubs = []
    unsubs.push(onSnapshot(query(collection(db, 'clients'), orderBy('client_name')),
      snap => { setClients(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false) },
      err => { console.warn('clients:', err.message); setLoading(false) }))
    unsubs.push(onSnapshot(collection(db, 'projects'),
      snap => setProjects(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      e => console.warn('crm projects:', e.message)))
    unsubs.push(onSnapshot(collection(db, 'invoices'),
      snap => setInvoices(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      e => console.warn('crm invoices:', e.message)))
    return () => unsubs.forEach(u => u())
  }, [])

  const enriched = useMemo(() => {
    const monthStart = new Date().toISOString().slice(0, 7)
    return clients.map(c => {
      const myProjects = projects.filter(p => matchesClient(p, c))
      const activeCount = myProjects.filter(p => (p.status || 'ACTIVE') === 'ACTIVE').length
      const revenueMtd = invoices
        .filter(i => matchesClient(i, c))
        .filter(i => {
          if (i.status !== 'PAID') return false
          const d = i.created_at?.toDate ? i.created_at.toDate().toISOString().slice(0, 7) : String(i.date || '').slice(0, 7)
          return d === monthStart
        })
        .reduce((s, i) => s + (Number(i.total) || 0), 0)
      const lastInteraction = c.last_interaction_at?.toMillis?.() || 0
      return { ...c, _active: activeCount, _projects: myProjects.length, _revenueMtd: revenueMtd, _lastInteraction: lastInteraction }
    })
  }, [clients, projects, invoices])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return enriched.filter(c => {
      const status = (c.status || 'ACTIVE').toUpperCase()
      if (statusFilter !== 'ALL' && status !== statusFilter) return false
      if (!q) return true
      return [c.client_name, c.client_name_ar, c.contact_email, c.contact_person, c.contact_phone, c.industry, c.vat_number]
        .filter(Boolean).some(v => String(v).toLowerCase().includes(q))
    }).sort((a, b) => {
      // active first by revenue, prospects next, inactive last
      const rank = { ACTIVE: 0, PROSPECT: 1, INACTIVE: 2 }
      const sa = (a.status || 'ACTIVE').toUpperCase()
      const sb = (b.status || 'ACTIVE').toUpperCase()
      if (rank[sa] !== rank[sb]) return (rank[sa] ?? 9) - (rank[sb] ?? 9)
      return b._revenueMtd - a._revenueMtd
    })
  }, [enriched, search, statusFilter])

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Loading clients…</div>

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <Building2 size={22} color="#022873" /> Clients
          </h1>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-tertiary)', marginTop: 4 }}>
            Same data as /ceo/clients. Sales-funnel view: status, active projects, MTD revenue, last interaction.
          </p>
        </div>
        <Link to="/ceo/clients" className="write-action" style={{ background: '#022873', color: '#fff', padding: '10px 18px', borderRadius: 8, border: 'none', fontWeight: 700, fontSize: '0.85rem', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Plus size={16} /> Add Client (CEO admin)
        </Link>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 240 }}>
          <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, contact, phone, VAT, industry…"
            style={{ width: '100%', padding: '10px 36px 10px 36px', borderRadius: 8, border: '1px solid var(--border-primary, #E5E7EB)', background: 'var(--bg-surface, #fff)', color: 'var(--text-primary)', fontSize: '0.86rem', boxSizing: 'border-box' }}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}><X size={14} /></button>
          )}
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border-primary, #E5E7EB)', background: 'var(--bg-surface, #fff)', color: 'var(--text-primary)', fontSize: '0.86rem' }}>
          {STATUS_OPTIONS.map(o => <option key={o} value={o}>{o === 'ALL' ? 'All statuses' : o}</option>)}
        </select>
        <span style={{ fontSize: '0.76rem', color: 'var(--text-tertiary)' }}>
          {filtered.length} of {enriched.length}
        </span>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 36, textAlign: 'center', color: 'var(--text-tertiary)' }}>No clients match.</div>
        ) : (
          <table className="data-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Client</th>
                <th>Contact</th>
                <th>Status</th>
                <th>Active projects</th>
                <th>MTD revenue</th>
                <th>Last interaction</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => {
                const sm = STATUS_COLOR[(c.status || 'ACTIVE').toUpperCase()] || STATUS_COLOR.ACTIVE
                return (
                  <tr key={c.id}>
                    <td>
                      <Link to={`/crm/clients/${c.id}`} style={{ color: 'var(--text-primary)', textDecoration: 'none', fontWeight: 600 }}>
                        {c.client_name}
                      </Link>
                      {c.client_name_ar && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }} dir="rtl">{c.client_name_ar}</div>
                      )}
                    </td>
                    <td>
                      <div style={{ fontSize: '0.82rem' }}>{c.contact_person || '—'}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>
                        {c.contact_email && <span><Mail size={10} /> {c.contact_email}</span>}
                        {c.contact_phone && <span style={{ marginLeft: 8 }}><Phone size={10} /> {c.contact_phone}</span>}
                      </div>
                    </td>
                    <td>
                      <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 999, fontSize: '0.72rem', fontWeight: 700, background: sm.bg, color: sm.color }}>
                        {sm.label}
                      </span>
                    </td>
                    <td>{c._active}</td>
                    <td style={{ fontWeight: 600 }}>{fmtSar(c._revenueMtd)}</td>
                    <td style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
                      {c._lastInteraction ? new Date(c._lastInteraction).toLocaleDateString() : '—'}
                    </td>
                    <td>
                      <Link to={`/crm/clients/${c.id}`} style={{ color: 'var(--text-tertiary)' }}><ChevronRight size={16} /></Link>
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
