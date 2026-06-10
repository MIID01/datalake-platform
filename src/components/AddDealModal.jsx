import { useState, useEffect } from 'react'
import { collection, getDocs, addDoc, serverTimestamp, Timestamp } from 'firebase/firestore'
import { auth, db } from '../lib/firebase'
import { DEAL_STAGES, DEAL_SOURCES, DEFAULT_LEAD_RETENTION_DAYS } from '../lib/deals'
import { X, Loader, Save } from 'lucide-react'

// Create a deal (opportunity). Either link an existing client (canonical FK) or
// enter a company name as a raw lead (client_id stays null until WON/linked).
// Contact PII triggers a required PDPL lawful basis + retention stamp.
export default function AddDealModal({ onClose, onCreated }) {
  const [clients, setClients] = useState([])
  const [form, setForm] = useState({
    title: '', value_sar: '', stage: 'NEW', owner_email: auth.currentUser?.email || '',
    client_id: '', company_name: '',
    contact_name: '', contact_email: '', contact_phone: '',
    source: 'MANUAL', expected_close: '', lawful_basis: 'legitimate_interest', consent_source: '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    getDocs(collection(db, 'clients'))
      .then(s => setClients(s.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.client_name || '').localeCompare(b.client_name || ''))))
      .catch(() => {})
  }, [])

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const hasPii = !!(form.contact_email || form.contact_phone || form.contact_name)

  const submit = async () => {
    setErr('')
    if (!form.title.trim()) return setErr('Deal title is required.')
    if (form.value_sar === '' || isNaN(Number(form.value_sar)) || Number(form.value_sar) < 0) return setErr('Enter a valid value in SAR.')
    if (!form.client_id && !form.company_name.trim()) return setErr('Pick an existing client OR enter a company name (lead).')
    if (hasPii && form.lawful_basis === 'consent' && !form.consent_source.trim()) return setErr('Consent basis requires a documented consent source (PDPL).')
    setSaving(true)
    try {
      const me = auth.currentUser
      const linked = clients.find(c => c.id === form.client_id)
      const purgeAfter = hasPii ? Timestamp.fromMillis(Date.now() + DEFAULT_LEAD_RETENTION_DAYS * 86400000) : null
      const ref = await addDoc(collection(db, 'deals'), {
        title: form.title.trim(),
        value_sar: Number(form.value_sar),
        stage: form.stage,
        owner_email: form.owner_email.trim() || me?.email || 'unknown',
        client_id: form.client_id || null,
        company_name: linked ? (linked.client_name || '') : form.company_name.trim(),
        contact_name: form.contact_name.trim() || null,
        contact_email: form.contact_email.trim() || null,
        contact_phone: form.contact_phone.trim() || null,
        source: form.source,
        expected_close: form.expected_close || null,
        lawful_basis: hasPii ? form.lawful_basis : null,
        consent_source: hasPii && form.lawful_basis === 'consent' ? form.consent_source.trim() : null,
        pdpl_purge_after: purgeAfter,
        created_at: serverTimestamp(),
        created_by: me?.email || 'unknown',
        created_by_uid: me?.uid || null,
        updated_at: serverTimestamp(),
      })
      onCreated?.(ref.id)
      onClose?.()
    } catch (e) {
      setErr('Create failed: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="card" style={{ width: 'min(640px, 94vw)', maxHeight: '92vh', overflowY: 'auto', margin: 0 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>New Deal</h3>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}><X size={18} /></button>
        </div>

        <div style={grid2}>
          <Field label="Deal title *"><input style={inp} value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Emkan — data platform Phase 2" /></Field>
          <Field label="Value (SAR) *"><input style={inp} type="number" min="0" value={form.value_sar} onChange={e => set('value_sar', e.target.value)} /></Field>
          <Field label="Stage"><select style={inp} value={form.stage} onChange={e => set('stage', e.target.value)}>{DEAL_STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></Field>
          <Field label="Owner (email)"><input style={inp} value={form.owner_email} onChange={e => set('owner_email', e.target.value)} /></Field>
          <Field label="Link existing client (account)">
            <select style={inp} value={form.client_id} onChange={e => set('client_id', e.target.value)}>
              <option value="">— none (raw lead) —</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.client_name || c.id}</option>)}
            </select>
          </Field>
          <Field label="…or company name (lead)"><input style={inp} value={form.company_name} onChange={e => set('company_name', e.target.value)} disabled={!!form.client_id} placeholder={form.client_id ? 'using linked client' : 'New company'} /></Field>
          <Field label="Source"><select style={inp} value={form.source} onChange={e => set('source', e.target.value)}>{DEAL_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}</select></Field>
          <Field label="Expected close"><input style={inp} type="date" value={form.expected_close} onChange={e => set('expected_close', e.target.value)} /></Field>
        </div>

        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border-primary, #E5E7EB)' }}>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>Contact (optional — PII)</div>
          <div style={grid2}>
            <Field label="Contact name"><input style={inp} value={form.contact_name} onChange={e => set('contact_name', e.target.value)} /></Field>
            <Field label="Contact email"><input style={inp} value={form.contact_email} onChange={e => set('contact_email', e.target.value)} /></Field>
            <Field label="Contact phone"><input style={inp} value={form.contact_phone} onChange={e => set('contact_phone', e.target.value)} /></Field>
          </div>
          {hasPii && (
            <div style={{ ...grid2, marginTop: 8 }}>
              <Field label="Lawful basis (PDPL) *"><select style={inp} value={form.lawful_basis} onChange={e => set('lawful_basis', e.target.value)}><option value="legitimate_interest">Legitimate interest</option><option value="consent">Consent</option></select></Field>
              {form.lawful_basis === 'consent' && <Field label="Consent source *"><input style={inp} value={form.consent_source} onChange={e => set('consent_source', e.target.value)} placeholder="Where/when consent was given" /></Field>}
            </div>
          )}
          {hasPii && <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginTop: 6 }}>Contact data is retained {Math.round(DEFAULT_LEAD_RETENTION_DAYS / 365)} years then purged (PDPL).</div>}
        </div>

        {err && <div style={{ color: '#991b1b', fontSize: '0.82rem', marginTop: 12 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary write-action" onClick={submit} disabled={saving}>
            {saving ? <Loader size={15} className="spin" /> : <Save size={15} />} {saving ? ' Saving…' : ' Create deal'}
          </button>
        </div>
      </div>
    </div>
  )
}

const grid2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }
const inp = { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-primary, #E5E7EB)', background: 'var(--bg-surface, #fff)', color: 'var(--text-primary)', fontSize: '0.85rem', boxSizing: 'border-box', fontFamily: 'inherit' }
function Field({ label, children }) {
  return <label style={{ display: 'block' }}><span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>{label}</span>{children}</label>
}
