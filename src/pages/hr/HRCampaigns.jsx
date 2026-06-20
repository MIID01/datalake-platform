import { useEffect, useMemo, useState } from 'react'
import { collection, onSnapshot, query, orderBy, where, addDoc, updateDoc, doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { auth, db } from '../../lib/firebase'
import { Megaphone, Plus, Copy, Check, Share2, Loader, Settings, Pause, Play } from 'lucide-react'

// Recruiting campaigns — channel-agnostic. Create a campaign → get a TRACKED careers
// link → use it as the destination URL in LinkedIn / Google Ads / any channel. Every
// application carries campaign_id (via the link's UTM), so attribution is exact.
// No external ad-platform API needed to run or measure campaigns.
const NAVY = '#022873'
const CHANNELS = [
  { id: 'linkedin', label: 'LinkedIn', utm: 'linkedin' },
  { id: 'google', label: 'Google Ads', utm: 'google' },
  { id: 'twitter', label: 'X (Twitter)', utm: 'twitter' },
  { id: 'indeed', label: 'Indeed', utm: 'indeed' },
  { id: 'referral', label: 'Referral', utm: 'referral' },
  { id: 'other', label: 'Other', utm: 'other' },
]
const DEFAULT_BASE = 'https://datalake-production-sa.web.app'
const slugify = (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const HIRED_STATES = ['ACTIVE_EMPLOYEE', 'HIRED', 'OFFER_ACCEPTED']

export default function HRCampaigns() {
  const me = auth.currentUser?.email || ''
  const [campaigns, setCampaigns] = useState([])
  const [applicants, setApplicants] = useState([])
  const [jobs, setJobs] = useState([])
  const [base, setBase] = useState(DEFAULT_BASE)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [baseInput, setBaseInput] = useState('')
  const [form, setForm] = useState({ name: '', channel: 'linkedin', type: 'paid', job_id: '' })

  useEffect(() => {
    const u1 = onSnapshot(query(collection(db, 'recruiting_campaigns'), orderBy('created_at', 'desc')),
      s => { setCampaigns(s.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false) }, () => setLoading(false))
    const u2 = onSnapshot(collection(db, 'talent_pool'),
      s => setApplicants(s.docs.map(d => ({ campaign_id: d.data().campaign_id || null, state: d.data().state }))), () => {})
    const u3 = onSnapshot(query(collection(db, 'job_listings'), where('status', '==', 'open')),
      s => setJobs(s.docs.map(d => ({ id: d.id, ...d.data() }))), () => {})
    getDoc(doc(db, 'crm_config', 'careers')).then(d => { if (d.exists() && d.data().base_url) { setBase(d.data().base_url); setBaseInput(d.data().base_url) } else setBaseInput(DEFAULT_BASE) }).catch(() => {})
    return () => { u1(); u2(); u3() }
  }, [])

  const statsByCampaign = useMemo(() => {
    const m = {}
    applicants.forEach(a => {
      if (!a.campaign_id) return
      m[a.campaign_id] ||= { apps: 0, hired: 0 }
      m[a.campaign_id].apps++
      if (HIRED_STATES.includes(a.state)) m[a.campaign_id].hired++
    })
    return m
  }, [applicants])

  const linkFor = (c) => {
    const params = new URLSearchParams({ utm_source: c.utm_source || c.channel, utm_medium: c.utm_medium || 'recruiting', utm_campaign: c.slug || slugify(c.name), campaign_id: c.id })
    if (c.job_id) params.set('job', c.job_id)
    return `${base.replace(/\/$/, '')}/careers?${params.toString()}`
  }

  const create = async () => {
    if (!form.name.trim()) return
    setBusy(true)
    try {
      const ch = CHANNELS.find(c => c.id === form.channel) || CHANNELS[0]
      const job = jobs.find(j => j.id === form.job_id)
      await addDoc(collection(db, 'recruiting_campaigns'), {
        name: form.name.trim(), channel: ch.id, utm_source: ch.utm,
        utm_medium: form.type === 'paid' ? 'cpc' : 'organic', slug: slugify(form.name),
        job_id: form.job_id || null, job_title: job?.title || null,
        status: 'ACTIVE', created_by: me, created_at: serverTimestamp(),
      })
      setForm({ name: '', channel: 'linkedin', type: 'paid', job_id: '' })
    } catch (e) { window.alert('Create failed: ' + e.message) } finally { setBusy(false) }
  }

  const toggle = (c) => updateDoc(doc(db, 'recruiting_campaigns', c.id), { status: c.status === 'PAUSED' ? 'ACTIVE' : 'PAUSED' }).catch(e => alert(e.message))
  const copy = (txt, id) => { navigator.clipboard.writeText(txt).then(() => { setCopied(id); setTimeout(() => setCopied(''), 1500) }) }
  const shareLinkedIn = (url) => window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`, '_blank', 'noopener')
  const saveBase = async () => { try { await setDoc(doc(db, 'crm_config', 'careers'), { base_url: baseInput.trim().replace(/\/$/, ''), updated_by: me }, { merge: true }); setBase(baseInput.trim().replace(/\/$/, '')); setShowSettings(false) } catch (e) { alert(e.message) } }

  const sel = { padding: '8px 10px', borderRadius: 8, border: '1px solid #E5E7EB', fontSize: '0.86rem', fontFamily: 'inherit', background: '#fff' }

  return (
    <div style={{ padding: 24, fontFamily: "'DM Sans', sans-serif", maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: NAVY, display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 4px' }}>
            <Megaphone size={20} color="#1598CC" /> Recruiting Campaigns
          </h1>
          <p style={{ fontSize: '0.8rem', color: '#64748b', margin: 0 }}>Tracked links for LinkedIn, Google Ads & any channel — applicants are attributed automatically.</p>
        </div>
        <button onClick={() => setShowSettings(s => !s)} style={ghostBtn}><Settings size={14} /> Careers domain</button>
      </div>

      {showSettings && (
        <div style={{ ...card, marginTop: 12 }}>
          <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#475569', marginBottom: 6 }}>Careers base URL (the campaign links point here)</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input value={baseInput} onChange={e => setBaseInput(e.target.value)} placeholder="https://datalake.sa" style={{ ...sel, flex: 1, minWidth: 240 }} />
            <button onClick={saveBase} style={primaryBtn(false)}>Save</button>
          </div>
          <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: 6 }}>Switch to <b>https://datalake.sa</b> once that domain is connected to the site (Firebase custom domain + DNS). Until then keep the default.</div>
        </div>
      )}

      {/* Create */}
      <div style={{ ...card, marginTop: 14 }}>
        <div style={{ fontSize: '0.92rem', fontWeight: 700, color: NAVY, marginBottom: 10 }}>New campaign</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Campaign name (e.g. Data Engineers Q3)" style={{ ...sel, flex: 1, minWidth: 220 }} />
          <select value={form.channel} onChange={e => setForm(f => ({ ...f, channel: e.target.value }))} style={sel}>{CHANNELS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
          <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} style={sel}><option value="paid">Paid</option><option value="organic">Organic</option></select>
          <select value={form.job_id} onChange={e => setForm(f => ({ ...f, job_id: e.target.value }))} style={sel}><option value="">All roles</option>{jobs.map(j => <option key={j.id} value={j.id}>{j.title}</option>)}</select>
          <button onClick={create} disabled={busy || !form.name.trim()} style={primaryBtn(busy || !form.name.trim())}><Plus size={14} /> Create</button>
        </div>
      </div>

      {/* List */}
      {loading ? <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}><Loader className="spin" /><style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{100%{transform:rotate(360deg)}}`}</style></div>
        : campaigns.length === 0 ? <div style={{ ...card, marginTop: 14, textAlign: 'center', color: '#94a3b8', padding: 36 }}>No campaigns yet. Create one above to get a tracked link.</div>
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
            {campaigns.map(c => {
              const link = linkFor(c)
              const st = statsByCampaign[c.id] || { apps: 0, hired: 0 }
              const paused = c.status === 'PAUSED'
              return (
                <div key={c.id} style={{ ...card, opacity: paused ? 0.7 : 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ fontWeight: 700, color: '#0F172A' }}>{c.name}
                      <span style={{ marginLeft: 8, fontSize: '0.7rem', fontWeight: 700, color: '#1598CC', textTransform: 'uppercase' }}>{(CHANNELS.find(x => x.id === c.channel)?.label) || c.channel}</span>
                      <span style={{ marginLeft: 6, fontSize: '0.68rem', color: '#94a3b8' }}>{c.utm_medium === 'cpc' ? 'Paid' : 'Organic'}{c.job_title ? ` · ${c.job_title}` : ' · All roles'}</span>
                      {paused && <span style={{ marginLeft: 6, fontSize: '0.66rem', fontWeight: 700, color: '#b45309' }}>PAUSED</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 14, fontSize: '0.8rem' }}>
                      <span><b style={{ color: NAVY }}>{st.apps}</b> <span style={{ color: '#94a3b8' }}>applicants</span></span>
                      <span><b style={{ color: '#15803d' }}>{st.hired}</b> <span style={{ color: '#94a3b8' }}>hired</span></span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
                    <code style={{ flex: 1, minWidth: 240, fontSize: '0.72rem', background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 6, padding: '7px 9px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{link}</code>
                    <button onClick={() => copy(link, c.id)} style={ghostBtn}>{copied === c.id ? <Check size={13} color="#15803d" /> : <Copy size={13} />} {copied === c.id ? 'Copied' : 'Copy link'}</button>
                    <button onClick={() => shareLinkedIn(link)} style={{ ...ghostBtn, color: '#0A66C2', borderColor: '#0A66C2' }}><Share2 size={13} /> Share</button>
                    <button onClick={() => toggle(c)} style={ghostBtn}>{paused ? <Play size={13} /> : <Pause size={13} />} {paused ? 'Resume' : 'Pause'}</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
    </div>
  )
}

const card = { background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 16 }
const ghostBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, border: '1px solid #E5E7EB', background: '#fff', color: '#022873', fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' }
const primaryBtn = (disabled) => ({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 8, border: 'none', background: disabled ? '#94a3b8' : '#022873', color: '#fff', fontWeight: 700, fontSize: '0.82rem', cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit' })
