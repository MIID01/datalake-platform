import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { doc, onSnapshot, collection, query, orderBy, addDoc, serverTimestamp, updateDoc, getDocs } from 'firebase/firestore'
import { auth, db, SEND_DEAL_EMAIL_URL } from '../../lib/firebase'
import { DEAL_STAGES, stageMeta, fmtSar, ACTIVITY_TYPES } from '../../lib/deals'
import { ArrowLeft, Building2, Mail, Send, Loader, Trophy } from 'lucide-react'

export default function CRMDealDetail() {
  const { id } = useParams()
  const [deal, setDeal] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [acts, setActs] = useState([])
  const [clients, setClients] = useState([])

  const [actType, setActType] = useState('NOTE')
  const [actBody, setActBody] = useState('')
  const [savingAct, setSavingAct] = useState(false)
  const [emTo, setEmTo] = useState('')
  const [emSubj, setEmSubj] = useState('')
  const [emBody, setEmBody] = useState('')
  const [sending, setSending] = useState(false)
  const [emMsg, setEmMsg] = useState('')
  const [linkClient, setLinkClient] = useState('')

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'deals', id),
      s => { if (!s.exists()) { setError('Deal not found'); setLoading(false); return } setDeal({ id: s.id, ...s.data() }); setLoading(false) },
      e => { setError(e.message); setLoading(false) })
    return () => unsub()
  }, [id])

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, 'deals', id, 'deal_activities'), orderBy('created_at', 'desc')),
      s => setActs(s.docs.map(d => ({ id: d.id, ...d.data() }))),
      e => console.warn('deal activities:', e.message))
    return () => unsub()
  }, [id])

  useEffect(() => { getDocs(collection(db, 'clients')).then(s => setClients(s.docs.map(d => ({ id: d.id, ...d.data() })))).catch(() => {}) }, [])
  useEffect(() => { if (deal && !emTo && deal.contact_email) setEmTo(deal.contact_email) }, [deal]) // eslint-disable-line

  const addActivity = async () => {
    if (!actBody.trim()) return
    setSavingAct(true)
    try {
      const me = auth.currentUser
      await addDoc(collection(db, 'deals', id, 'deal_activities'), {
        type: actType, body: actBody.trim(), created_at: serverTimestamp(), created_by: me?.email || 'unknown', created_by_uid: me?.uid || null,
      })
      await updateDoc(doc(db, 'deals', id), { last_activity_at: serverTimestamp() })
      setActBody('')
    } catch (e) { alert('Add activity failed: ' + e.message) } finally { setSavingAct(false) }
  }

  const sendEmail = async () => {
    setEmMsg('')
    if (!emTo.trim() || !emSubj.trim() || !emBody.trim()) { setEmMsg('To, subject and message are required.'); return }
    setSending(true)
    try {
      const token = await auth.currentUser.getIdToken()
      const r = await fetch(SEND_DEAL_EMAIL_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ deal_id: id, to: emTo.trim(), subject: emSubj.trim(), body: emBody.trim() }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setEmSubj(''); setEmBody(''); setEmMsg('Sent (from hr@datalake.sa) — logged to the timeline.')
    } catch (e) { setEmMsg('Send failed: ' + e.message) } finally { setSending(false) }
  }

  const move = async (toStage) => {
    try {
      const patch = { stage: toStage, updated_at: serverTimestamp(), stage_updated_by: auth.currentUser?.email || 'unknown' }
      if (toStage === 'WON') { patch.won_at = serverTimestamp(); patch.won_client_id = deal.client_id || null }
      await updateDoc(doc(db, 'deals', id), patch)
    } catch (e) { alert('Stage change failed: ' + e.message) }
  }

  const linkWonClient = async () => {
    if (!linkClient) return
    try { await updateDoc(doc(db, 'deals', id), { client_id: linkClient, won_client_id: linkClient, updated_at: serverTimestamp() }) }
    catch (e) { alert('Link failed: ' + e.message) }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Loading deal…</div>
  if (error) return <div style={{ padding: 24 }}><Link to="/crm/pipeline" style={{ color: '#1598CC' }}>← Pipeline</Link><div style={{ marginTop: 16, color: '#991b1b' }}>{error}</div></div>

  const sm = stageMeta(deal.stage)
  const needsWonLink = deal.stage === 'WON' && !deal.won_client_id && !deal.client_id

  return (
    <div style={{ padding: 24 }}>
      <Link to="/crm/pipeline" style={{ color: '#1598CC', fontSize: '0.82rem', display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 12 }}><ArrowLeft size={14} /> Pipeline</Link>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: '1.3rem', fontWeight: 700, margin: 0 }}>{deal.title || '(untitled deal)'}</h1>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Building2 size={13} /> {deal.client_id ? <Link to={`/crm/clients/${deal.client_id}`} style={{ color: '#1598CC' }}>{deal.company_name || deal.client_id}</Link> : (deal.company_name || '—')} · {fmtSar(deal.value_sar)} · owner {deal.owner_email || '—'}
          </div>
        </div>
        <span style={{ padding: '5px 12px', borderRadius: 999, fontSize: '0.78rem', fontWeight: 700, background: sm.color + '22', color: sm.color }}>{sm.label}</span>
      </div>

      {/* Stage control */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>STAGE</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {DEAL_STAGES.map(s => (
            <button key={s.id} onClick={() => move(s.id)} className="write-action" disabled={s.id === deal.stage}
              style={{ padding: '6px 12px', borderRadius: 7, border: `1px solid ${s.id === deal.stage ? s.color : 'var(--border-primary, #E5E7EB)'}`, background: s.id === deal.stage ? s.color + '22' : 'transparent', color: s.id === deal.stage ? s.color : 'var(--text-secondary)', fontSize: '0.78rem', fontWeight: 600, cursor: s.id === deal.stage ? 'default' : 'pointer', fontFamily: 'inherit' }}>
              {s.id === 'WON' && <Trophy size={11} style={{ verticalAlign: -1, marginRight: 3 }} />}{s.label}
            </button>
          ))}
        </div>
        {needsWonLink && (
          <div style={{ marginTop: 12, padding: 10, background: 'rgba(52,191,58,0.08)', border: '1px solid rgba(52,191,58,0.25)', borderRadius: 8 }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: 6 }}>Won — link this deal to a client account (canonical):</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <select value={linkClient} onChange={e => setLinkClient(e.target.value)} style={inp}><option value="">Select client…</option>{clients.map(c => <option key={c.id} value={c.id}>{c.client_name || c.id}</option>)}</select>
              <button className="btn btn-success write-action" onClick={linkWonClient} disabled={!linkClient}>Link</button>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 16, alignItems: 'start' }}>
        {/* Activity timeline */}
        <div className="card">
          <div style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: 10 }}>Activity</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <select value={actType} onChange={e => setActType(e.target.value)} style={{ ...inp, maxWidth: 120 }}>{ACTIVITY_TYPES.filter(t => t !== 'EMAIL').map(t => <option key={t} value={t}>{t}</option>)}</select>
            <input value={actBody} onChange={e => setActBody(e.target.value)} placeholder="Log a note / call / meeting / task…" style={inp} onKeyDown={e => e.key === 'Enter' && addActivity()} />
            <button className="btn btn-primary write-action" onClick={addActivity} disabled={savingAct || !actBody.trim()}>{savingAct ? <Loader size={14} className="spin" /> : 'Add'}</button>
          </div>
          {acts.length === 0 ? (
            <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', textAlign: 'center', padding: 16 }}>No activity yet.</div>
          ) : acts.map(a => (
            <div key={a.id} style={{ padding: '10px 0', borderTop: '1px solid var(--border-primary, #E5E7EB)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#022873' }}>{a.type}{a.type === 'EMAIL' && a.email_to ? ` → ${a.email_to}` : ''}</span>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>{a.created_at?.toDate ? a.created_at.toDate().toLocaleString() : ''}</span>
              </div>
              {a.type === 'EMAIL' && a.email_subject && <div style={{ fontSize: '0.8rem', fontWeight: 600, marginTop: 2 }}>{a.email_subject}</div>}
              <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: 2, whiteSpace: 'pre-wrap' }}>{a.body}</div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', marginTop: 2 }}>{a.created_by}</div>
            </div>
          ))}
        </div>

        {/* Email composer + contact */}
        <div className="card">
          <div style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}><Mail size={15} /> Send email</div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginBottom: 8 }}>Sends from hr@datalake.sa (Workspace) and logs to the timeline.</div>
          <input value={emTo} onChange={e => setEmTo(e.target.value)} placeholder="To" style={{ ...inp, marginBottom: 8 }} />
          <input value={emSubj} onChange={e => setEmSubj(e.target.value)} placeholder="Subject" style={{ ...inp, marginBottom: 8 }} />
          <textarea value={emBody} onChange={e => setEmBody(e.target.value)} placeholder="Message" rows={5} style={{ ...inp, marginBottom: 8, resize: 'vertical' }} />
          <button className="btn btn-primary write-action" onClick={sendEmail} disabled={sending} style={{ width: '100%', justifyContent: 'center' }}>{sending ? <Loader size={14} className="spin" /> : <Send size={14} />} {sending ? ' Sending…' : ' Send'}</button>
          {emMsg && <div style={{ fontSize: '0.78rem', marginTop: 8, color: emMsg.startsWith('Send failed') ? '#991b1b' : '#1f7a2a' }}>{emMsg}</div>}

          <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border-primary, #E5E7EB)', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Contact</div>
            <div>{deal.contact_name || '—'}</div>
            <div>{deal.contact_email || '—'}</div>
            <div>{deal.contact_phone || '—'}</div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', marginTop: 8 }}>Source {deal.source || '—'}{deal.lawful_basis ? ` · PDPL: ${deal.lawful_basis}` : ''}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

const inp = { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-primary, #E5E7EB)', background: 'var(--bg-surface, #fff)', color: 'var(--text-primary)', fontSize: '0.84rem', boxSizing: 'border-box', fontFamily: 'inherit' }
