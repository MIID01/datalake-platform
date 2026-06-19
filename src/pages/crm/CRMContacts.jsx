import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, onSnapshot } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { stageMeta } from '../../lib/deals'
import { Users, Search, Mail, Phone, Building2, Loader, AlertTriangle } from 'lucide-react'

// Contacts directory — DERIVED from the canonical `deals` collection (people are
// stored inline on deals: contact_name/email/phone). No parallel contacts store,
// so it can never drift from the pipeline. Dedupes by email (or name).
const NAVY = '#022873'

export default function CRMContacts() {
  const [deals, setDeals] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'deals'),
      snap => { setDeals(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false) },
      err => { setError(err.message); setLoading(false) })
    return () => unsub()
  }, [])

  const contacts = useMemo(() => {
    const map = new Map()
    deals.filter(d => !d.archived).forEach(d => {
      const name = (d.contact_name || '').trim()
      const email = (d.contact_email || '').trim().toLowerCase()
      if (!name && !email) return
      const key = email || name.toLowerCase()
      if (!map.has(key)) {
        map.set(key, { key, name: name || email, email: d.contact_email || '', phone: d.contact_phone || '', company: d.company_name || '', deals: [] })
      }
      const c = map.get(key)
      if (!c.phone && d.contact_phone) c.phone = d.contact_phone
      if (!c.company && d.company_name) c.company = d.company_name
      c.deals.push({ id: d.id, title: d.title || d.company_name || d.id, stage: d.stage })
    })
    return Array.from(map.values()).sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  }, [deals])

  const filtered = useMemo(() => {
    if (!q.trim()) return contacts
    const s = q.toLowerCase()
    return contacts.filter(c => [c.name, c.email, c.company].some(v => (v || '').toLowerCase().includes(s)))
  }, [contacts, q])

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}><Loader size={26} className="spin" /><div>Loading contacts…</div><style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{100%{transform:rotate(360deg)}}`}</style></div>
  if (error) return <div style={{ padding: 32, color: '#C0392B' }}><AlertTriangle size={16} /> Could not load: {error}</div>

  return (
    <div style={{ padding: '28px 24px', maxWidth: 1100, margin: '0 auto', fontFamily: "'DM Sans', sans-serif" }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: NAVY, display: 'flex', alignItems: 'center', gap: 10, margin: 0 }}>
        <Users size={22} color="#1598CC" /> Contacts
      </h1>
      <p style={{ fontSize: '0.82rem', color: '#64748b', margin: '4px 0 18px' }}>{contacts.length} people across the pipeline · derived from deals</p>

      <div style={{ position: 'relative', marginBottom: 18, maxWidth: 420 }}>
        <Search size={15} style={{ position: 'absolute', left: 12, top: 11, color: '#94a3b8' }} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, email, company…" style={{ width: '100%', padding: '9px 12px 9px 34px', border: '1px solid #E5E7EB', borderRadius: 9, fontSize: '0.88rem', boxSizing: 'border-box' }} />
      </div>

      {filtered.length === 0 ? (
        <div style={{ padding: 44, textAlign: 'center', color: '#94a3b8', background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12 }}>
          {contacts.length === 0 ? 'No contacts yet — they appear here as deals get contact details.' : 'No contacts match your search.'}
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
            <thead><tr style={{ textAlign: 'left', color: '#94a3b8', borderBottom: '1px solid #E5E7EB' }}>
              <th style={{ padding: '11px 14px' }}>Name</th>
              <th style={{ padding: '11px 14px' }}>Company</th>
              <th style={{ padding: '11px 14px' }}>Contact</th>
              <th style={{ padding: '11px 14px' }}>Deals</th>
            </tr></thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.key} style={{ borderBottom: '1px solid #F1F5F9' }}>
                  <td style={{ padding: '11px 14px', fontWeight: 600, color: '#0F172A' }}>{c.name}</td>
                  <td style={{ padding: '11px 14px', color: '#475569' }}>{c.company ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Building2 size={13} color="#94a3b8" />{c.company}</span> : '—'}</td>
                  <td style={{ padding: '11px 14px', color: '#475569' }}>
                    {c.email && <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Mail size={12} color="#94a3b8" /><a href={`mailto:${c.email}`} style={{ color: '#1598CC', textDecoration: 'none' }}>{c.email}</a></div>}
                    {c.phone && <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.78rem' }}><Phone size={12} color="#94a3b8" />{c.phone}</div>}
                    {!c.email && !c.phone && '—'}
                  </td>
                  <td style={{ padding: '11px 14px' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                      {c.deals.map(d => (
                        <Link key={d.id} to={`/crm/deals/${d.id}`} title={d.title} style={{ fontSize: '0.7rem', fontWeight: 700, color: stageMeta(d.stage).color, background: `${stageMeta(d.stage).color}18`, border: `1px solid ${stageMeta(d.stage).color}40`, borderRadius: 6, padding: '2px 7px', textDecoration: 'none', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {d.title}
                        </Link>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
