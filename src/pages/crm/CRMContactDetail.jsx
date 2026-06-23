import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { collection, onSnapshot, getDocs, query, where, doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { stageMeta, fmtSar } from '../../lib/deals'
import { normalizeActivity, sortByWhenDesc } from '../../lib/activity'
import ActivityTimeline from '../../components/crm/ActivityTimeline'
import LogActivity from '../../components/crm/LogActivity'
import NextSteps from '../../components/crm/NextSteps'
import { ArrowLeft, Mail, Phone, Building2, Loader, AlertTriangle } from 'lucide-react'

// Contact detail (DTLK-CRM-ENT-001 Phase 1). Contacts are DERIVED from `deals`
// (by contact_email) — no contacts store. This view aggregates the contact's
// activity + next-steps ACROSS all their deals, reusing the same canonical stores
// (`deal_activities`, `crm_tasks`) and components as the deal page. Logging here
// writes to a chosen deal via the deal picker — never a parallel record.
export default function CRMContactDetail() {
  const { email: emailParam } = useParams()
  const email = decodeURIComponent(emailParam || '').toLowerCase()
  const [deals, setDeals] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activities, setActivities] = useState([])
  const [tasks, setTasks] = useState([])
  const [busyTask, setBusyTask] = useState('')
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'deals'),
      s => { setDeals(s.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false) },
      e => { setError(e.message); setLoading(false) })
    return () => unsub()
  }, [])

  const myDeals = useMemo(() => deals.filter(d => !d.archived && (d.contact_email || '').trim().toLowerCase() === email), [deals, email])
  const contact = useMemo(() => {
    if (myDeals.length === 0) return null
    return {
      name: (myDeals.find(d => d.contact_name)?.contact_name) || email,
      email: myDeals.find(d => d.contact_email)?.contact_email || '',
      phone: myDeals.find(d => d.contact_phone)?.contact_phone || '',
      company: myDeals.find(d => d.company_name)?.company_name || '',
    }
  }, [myDeals, email])

  const dealsLite = useMemo(() => myDeals.map(d => ({ id: d.id, title: d.title || d.company_name || d.id })), [myDeals])
  const dealTitleById = useMemo(() => Object.fromEntries(myDeals.map(d => [d.id, d.title || d.company_name || d.id])), [myDeals])
  const idsKey = myDeals.map(d => d.id).join(',')

  // Aggregate activities across the contact's deals (read on load; refetch on log).
  useEffect(() => {
    let alive = true
    const ids = idsKey ? idsKey.split(',') : []
    ;(async () => {
      if (ids.length === 0) { if (alive) setActivities([]); return }
      try {
        const all = []
        for (const did of ids) {
          const snap = await getDocs(collection(db, 'deals', did, 'deal_activities'))
          snap.forEach(a => all.push(normalizeActivity({ id: a.id, ...a.data() }, did, dealTitleById[did])))
        }
        if (alive) setActivities(all.sort(sortByWhenDesc))
      } catch (e) { console.warn('contact activities:', e.message) }
    })()
    return () => { alive = false }
  }, [idsKey, refresh]) // eslint-disable-line react-hooks/exhaustive-deps

  // Open next-steps across the contact's deals (crm_tasks, deal_id in chunks of 30).
  useEffect(() => {
    let alive = true
    const ids = idsKey ? idsKey.split(',') : []
    ;(async () => {
      if (ids.length === 0) { if (alive) setTasks([]); return }
      try {
        const all = []
        for (let i = 0; i < ids.length; i += 30) {
          const snap = await getDocs(query(collection(db, 'crm_tasks'), where('deal_id', 'in', ids.slice(i, i + 30))))
          snap.forEach(t => all.push({ id: t.id, ...t.data() }))
        }
        if (alive) setTasks(all)
      } catch (e) { console.warn('contact tasks:', e.message) }
    })()
    return () => { alive = false }
  }, [idsKey, refresh])

  const completeTask = async (t) => {
    setBusyTask(t.id)
    try { await updateDoc(doc(db, 'crm_tasks', t.id), { status: 'DONE', done_at: serverTimestamp(), updated_at: serverTimestamp() }); setRefresh(r => r + 1) }
    catch (e) { window.alert(e.message) } finally { setBusyTask('') }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Loading contact…</div>
  if (error) return <div style={{ padding: 32, color: '#C0392B' }}><AlertTriangle size={16} /> Could not load: {error}</div>
  if (!contact) return (
    <div style={{ padding: 24 }}>
      <Link to="/crm/contacts" style={{ color: '#1598CC' }}>← Contacts</Link>
      <div style={{ marginTop: 16, color: 'var(--text-tertiary)' }}>No active deals found for {email}.</div>
    </div>
  )

  return (
    <div style={{ padding: 24 }}>
      <Link to="/crm/contacts" style={{ color: '#1598CC', fontSize: '0.82rem', display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 12 }}><ArrowLeft size={14} /> Contacts</Link>

      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: '1.3rem', fontWeight: 700, margin: 0 }}>{contact.name}</h1>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)', marginTop: 4, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          {contact.company && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Building2 size={13} /> {contact.company}</span>}
          {contact.email && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Mail size={13} /> <a href={`mailto:${contact.email}`} style={{ color: '#1598CC', textDecoration: 'none' }}>{contact.email}</a></span>}
          {contact.phone && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Phone size={13} /> {contact.phone}</span>}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 16, alignItems: 'start' }}>
        <div className="card">
          <div style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: 8 }}>Next steps</div>
          <NextSteps tasks={tasks} onComplete={completeTask} busyId={busyTask} showDeal />

          <div style={{ fontSize: '0.9rem', fontWeight: 700, margin: '16px 0 8px' }}>Log activity</div>
          <LogActivity deals={dealsLite} onLogged={() => setRefresh(r => r + 1)} />

          <div style={{ fontSize: '0.9rem', fontWeight: 700, margin: '4px 0 0' }}>Timeline <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', fontWeight: 400 }}>· across {myDeals.length} deal{myDeals.length === 1 ? '' : 's'}</span></div>
          <ActivityTimeline items={activities} showDeal />
        </div>

        <div className="card">
          <div style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: 10 }}>Deals</div>
          {dealsLite.map(d => {
            const full = myDeals.find(x => x.id === d.id)
            const sm = stageMeta(full?.stage)
            return (
              <Link key={d.id} to={`/crm/deals/${d.id}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '10px 0', borderTop: '1px solid var(--border-primary, #E5E7EB)', textDecoration: 'none', color: 'inherit' }}>
                <span style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)' }}>{d.title}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)' }}>{fmtSar(full?.value_sar)}</span>
                  <span style={{ padding: '2px 9px', borderRadius: 999, fontSize: '0.7rem', fontWeight: 700, background: sm.color + '22', color: sm.color }}>{sm.label}</span>
                </span>
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
