import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { doc, onSnapshot, collection, query, orderBy, where, addDoc, serverTimestamp, updateDoc, getDocs } from 'firebase/firestore'
import { auth, db, SEND_DEAL_EMAIL_URL, GENERATE_PDF_URL } from '../../lib/firebase'
import { DEAL_STAGES, stageMeta, fmtSar, ACTIVITY_TYPES, computeQuoteTotals, quoteStateMeta, canDeleteDeals } from '../../lib/deals'
import { setDealsArchived } from '../../lib/crm-actions'
import { useAccessProfile } from '../../hooks/useAccessProfile'
import { SignedBadgeList } from '../../components/SignedBadge'
import ConfirmDialog from '../../components/ConfirmDialog'
import { ArrowLeft, Building2, Mail, Send, Loader, Trophy, FileText, Plus, Trash2 } from 'lucide-react'

// Reusable email templates for the deal composer. Each builds {subject, body} from
// the deal — no fabricated facts, just a starting draft the rep edits before sending.
const EMAIL_TEMPLATES = [
  { id: 'intro', label: 'Intro / first outreach', build: (d) => ({
    subject: `Datalake Saudi Arabia — ${d?.company_name || 'introduction'}`,
    body: `Dear ${d?.contact_name || 'there'},\n\nThank you for your interest in Datalake Saudi Arabia. I'd welcome the chance to understand your data and technology needs and how we can support ${d?.company_name || 'your team'}.\n\nWould a short call this week work for you?\n\nBest regards,` }) },
  { id: 'followup', label: 'Follow-up', build: (d) => ({
    subject: `Following up — ${d?.title || d?.company_name || 'our conversation'}`,
    body: `Dear ${d?.contact_name || 'there'},\n\nI wanted to follow up on our recent conversation regarding ${d?.title || 'your requirements'}. Please let me know if you have any questions or if there's anything further I can provide.\n\nBest regards,` }) },
  { id: 'proposal', label: 'Proposal sent', build: (d) => ({
    subject: `Proposal — ${d?.title || d?.company_name || 'Datalake'}`,
    body: `Dear ${d?.contact_name || 'there'},\n\nPlease find our proposal for ${d?.title || 'the engagement'} attached. We've tailored it to the requirements we discussed. I'm happy to walk through any part of it at your convenience.\n\nBest regards,` }) },
  { id: 'checkin', label: 'Check-in', build: (d) => ({
    subject: `Checking in — ${d?.company_name || 'Datalake'}`,
    body: `Dear ${d?.contact_name || 'there'},\n\nJust checking in to see where things stand and whether there's anything you need from us to move forward.\n\nBest regards,` }) },
]

export default function CRMDealDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profile } = useAccessProfile()
  const canDelete = canDeleteDeals(profile?.role_id)
  const [deal, setDeal] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [confirmDel, setConfirmDel] = useState(false)
  const [delBusy, setDelBusy] = useState(false)
  const [delErr, setDelErr] = useState('')
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

  // ── Quotes ──
  const [quotes, setQuotes] = useState([])
  const [qItems, setQItems] = useState([{ description: '', qty: 1, unit_price_sar: 0 }])
  const [qDiscount, setQDiscount] = useState(0)
  const [qBusy, setQBusy] = useState(false)
  const [qMsg, setQMsg] = useState('')

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

  // Quotes for this deal. where() only (no orderBy) to avoid a composite index;
  // sorted client-side by created_at desc.
  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, 'deal_quotes'), where('deal_id', '==', id)),
      s => setQuotes(s.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.created_at?.toMillis?.() || 0) - (a.created_at?.toMillis?.() || 0))),
      e => console.warn('deal quotes:', e.message))
    return () => unsub()
  }, [id])

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

  // ── Quote builder ── (DRAFT create/edit is client-side; all approval-state
  // transitions are server-side in the financeReviewDealQuote/approveDealQuote CFs)
  const setItem = (i, field, val) => setQItems(items => items.map((it, idx) => idx === i ? { ...it, [field]: val } : it))
  const addItem = () => setQItems(items => [...items, { description: '', qty: 1, unit_price_sar: 0 }])
  const removeItem = (i) => setQItems(items => items.length > 1 ? items.filter((_, idx) => idx !== i) : items)
  const liveTotals = computeQuoteTotals(qItems, qDiscount)
  const draftQuote = quotes.find(q => q.status === 'DRAFT')

  const buildLineItems = () => qItems
    .filter(it => (it.description || '').trim() && Number(it.qty) > 0)
    .map(it => ({ description: it.description.trim(), qty: Number(it.qty) || 0, unit_price_sar: Number(it.unit_price_sar) || 0, line_total_sar: (Number(it.qty) || 0) * (Number(it.unit_price_sar) || 0) }))

  const saveDraft = async () => {
    setQMsg('')
    const line_items = buildLineItems()
    if (!line_items.length) { setQMsg('Add at least one line item with a description, quantity and price.'); return }
    setQBusy(true)
    try {
      const totals = computeQuoteTotals(line_items, qDiscount)
      const me = auth.currentUser
      const payload = {
        deal_id: id,
        client_id: deal.client_id || null,
        deal_title: deal.title || null,          // display snapshot for queue rows
        client_name: deal.company_name || null,  // display snapshot for queue rows
        title: `Quote for ${deal.title || 'deal'}`,
        line_items,
        ...totals,
        currency: 'SAR',
        updated_at: serverTimestamp(),
      }
      if (draftQuote) {
        await updateDoc(doc(db, 'deal_quotes', draftQuote.id), payload)
        setQMsg('Draft saved.')
      } else {
        await addDoc(collection(db, 'deal_quotes'), {
          ...payload, status: 'DRAFT', created_at: serverTimestamp(), created_by: me?.email || 'unknown', created_by_uid: me?.uid || null,
        })
        setQMsg('Draft quote created.')
      }
    } catch (e) { setQMsg('Save failed: ' + e.message) } finally { setQBusy(false) }
  }

  const downloadQuotePdf = async (quoteId) => {
    try {
      const idToken = await auth.currentUser.getIdToken()
      const res = await fetch(GENERATE_PDF_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
        body: JSON.stringify({ template: 'quote', docId: quoteId }),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `Failed (${res.status})`) }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = `quote-${quoteId}.pdf`; a.click()
      URL.revokeObjectURL(url)
    } catch (e) { window.alert(e.message) }
  }

  const submitForFinance = async (quoteId) => {
    setQBusy(true); setQMsg('')
    try {
      await updateDoc(doc(db, 'deal_quotes', quoteId), { status: 'PENDING_FINANCE', submitted_at: serverTimestamp(), updated_at: serverTimestamp() })
      setQMsg('Submitted for finance review.')
    } catch (e) { setQMsg('Submit failed: ' + e.message) } finally { setQBusy(false) }
  }

  // Load an existing DRAFT into the editor when one appears.
  useEffect(() => {
    if (draftQuote && Array.isArray(draftQuote.line_items) && draftQuote.line_items.length) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setQItems(draftQuote.line_items.map(li => ({ description: li.description || '', qty: li.qty || 1, unit_price_sar: li.unit_price_sar || 0 })))
      setQDiscount(draftQuote.discount_pct || 0)
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [draftQuote?.id]) // eslint-disable-line

  const doDelete = async () => {
    setDelErr(''); setDelBusy(true)
    try {
      await setDealsArchived({ ids: [id], reason: 'deleted from deal detail' })
      navigate('/crm/pipeline') // soft-deleted; recoverable from List → Archived
    } catch (e) { setDelErr(e.message); setDelBusy(false) }
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ padding: '5px 12px', borderRadius: 999, fontSize: '0.78rem', fontWeight: 700, background: sm.color + '22', color: sm.color }}>{sm.label}</span>
          {canDelete && !deal.archived && (
            <button onClick={() => setConfirmDel(true)} className="write-action" title="Delete this deal"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 11px', borderRadius: 7, border: '1px solid rgba(192,57,43,0.35)', background: 'transparent', color: '#C0392B', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              <Trash2 size={13} /> Delete
            </button>
          )}
        </div>
      </div>

      <ConfirmDialog open={confirmDel} danger busy={delBusy} error={delErr}
        title="Delete this deal?"
        message="This soft-deletes the deal — it leaves the pipeline but is recoverable from List → Archived. The action is audited."
        confirmLabel="Delete" onConfirm={doDelete} onCancel={() => { setConfirmDel(false); setDelErr('') }} />

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
          <select defaultValue="" onChange={e => { const t = EMAIL_TEMPLATES.find(x => x.id === e.target.value); if (t) { const { subject, body } = t.build(deal); setEmSubj(subject); setEmBody(body) } e.target.value = '' }} style={{ ...inp, marginBottom: 8 }}>
            <option value="">Insert template…</option>
            {EMAIL_TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
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

      {/* ── Quotes / discount approval ── */}
      <div className="card" style={{ marginTop: 16 }}>
        <div style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}><FileText size={15} /> Quotes</div>
        <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginBottom: 12 }}>A quote routes to <strong>finance review → CEO approval</strong>. Totals are recomputed and the gate is enforced server-side.</div>

        {/* Builder — visible only while no quote is past DRAFT (edit the draft, or create the first). */}
        {(!quotes.length || draftQuote) && (
          <div style={{ border: '1px solid var(--border-primary, #E5E7EB)', borderRadius: 8, padding: 12, marginBottom: 14 }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: 8 }}>{draftQuote ? 'Edit draft' : 'New quote'}</div>
            {qItems.map((it, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                <input value={it.description} onChange={e => setItem(i, 'description', e.target.value)} placeholder="Description" style={{ ...inp, flex: 2 }} />
                <input type="number" min="0" value={it.qty} onChange={e => setItem(i, 'qty', e.target.value)} placeholder="Qty" style={{ ...inp, width: 70 }} />
                <input type="number" min="0" value={it.unit_price_sar} onChange={e => setItem(i, 'unit_price_sar', e.target.value)} placeholder="Unit SAR" style={{ ...inp, width: 110 }} />
                <span style={{ width: 110, textAlign: 'right', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{fmtSar((Number(it.qty) || 0) * (Number(it.unit_price_sar) || 0))}</span>
                <button onClick={() => removeItem(i)} title="Remove" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#C0392B' }}><Trash2 size={14} /></button>
              </div>
            ))}
            <button onClick={addItem} className="write-action" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'transparent', border: '1px dashed var(--border-primary, #E5E7EB)', borderRadius: 7, padding: '5px 10px', fontSize: '0.76rem', color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'inherit', marginTop: 2 }}><Plus size={12} /> Add line</button>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, gap: 12, flexWrap: 'wrap' }}>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                Discount %
                <input type="number" min="0" max="100" value={qDiscount} onChange={e => setQDiscount(e.target.value)} style={{ ...inp, width: 80 }} />
              </label>
              <div style={{ fontSize: '0.82rem', textAlign: 'right' }}>
                <div style={{ color: 'var(--text-tertiary)' }}>Subtotal {fmtSar(liveTotals.subtotal_sar)} · Discount −{fmtSar(liveTotals.discount_sar)}</div>
                <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>Total {fmtSar(liveTotals.total_sar)}</div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn btn-primary write-action" onClick={saveDraft} disabled={qBusy}>{qBusy ? <Loader size={14} className="spin" /> : 'Save draft'}</button>
              {draftQuote && <button className="btn btn-success write-action" onClick={() => submitForFinance(draftQuote.id)} disabled={qBusy}>Submit for finance review</button>}
            </div>
            {qMsg && <div style={{ fontSize: '0.78rem', marginTop: 8, color: qMsg.includes('failed') || qMsg.includes('Add at least') ? '#991b1b' : '#1f7a2a' }}>{qMsg}</div>}
          </div>
        )}

        {/* Quote history */}
        {quotes.length === 0 ? (
          <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', textAlign: 'center', padding: 8 }}>No quotes yet.</div>
        ) : quotes.map(q => {
          const qm = quoteStateMeta(q.status)
          return (
            <div key={q.id} style={{ padding: '10px 0', borderTop: '1px solid var(--border-primary, #E5E7EB)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ fontSize: '0.84rem', fontWeight: 600 }}>{fmtSar(q.total_sar)} {q.discount_pct ? <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>· {q.discount_pct}% off</span> : null}</div>
                <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: '0.72rem', fontWeight: 700, background: qm.color + '22', color: qm.color }}>{qm.label}</span>
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginTop: 2 }}>
                {(q.line_items || []).length} line item{(q.line_items || []).length === 1 ? '' : 's'} · by {q.created_by || '—'}
                {q.finance_reviewed_by ? ` · finance: ${q.finance_reviewed_by}` : ''}{q.ceo_approved_by ? ` · CEO: ${q.ceo_approved_by}` : ''}
                {q.status === 'REJECTED' && (q.ceo_notes || q.finance_notes) ? ` · reason: ${q.ceo_notes || q.finance_notes}` : ''}
              </div>
              <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <SignedBadgeList parentCollection="deal_quotes" parentId={q.id} compact />
                <button onClick={() => downloadQuotePdf(q.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'transparent', color: '#022873', border: '1px solid #022873', borderRadius: 6, padding: '4px 10px', fontSize: '0.74rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                  <FileText size={11} /> PDF
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const inp = { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-primary, #E5E7EB)', background: 'var(--bg-surface, #fff)', color: 'var(--text-primary)', fontSize: '0.84rem', boxSizing: 'border-box', fontFamily: 'inherit' }
