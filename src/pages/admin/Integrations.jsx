import { useState, useEffect, useMemo } from 'react'
import { auth, db, SAVE_INTEGRATION_CONFIG_URL, GET_INTEGRATION_CONFIG_URL } from '../../lib/firebase'
import { doc, getDoc } from 'firebase/firestore'
import {
  Phone, Mail, MessageCircle, MessageSquare, Calendar, Brain,
  ChevronDown, ChevronRight, Plug, Eye, EyeOff, Save, RefreshCw,
  CheckCircle2, XCircle, AlertCircle, Loader, ShieldAlert, Lock,
} from 'lucide-react'
import { s } from './adminStyles'

const MASK = '********'

const PROVIDERS = [
  {
    key: 'telephony', label: 'Telephony', Icon: Phone,
    description: 'SIP / cloud telephony (Twilio, Vonage, Aircall) — drives incoming-call routing and call transcripts.',
    fields: [
      { key: 'provider', label: 'Provider', type: 'select', options: ['twilio', 'vonage', 'aircall', 'sip'], required: true },
      { key: 'account_sid', label: 'Account SID / Account ID', type: 'text', required: true },
      { key: 'auth_token', label: 'Auth Token', type: 'password', required: true },
      { key: 'phone_number', label: 'Phone Number (E.164)', type: 'text', placeholder: '+966500000000' },
      { key: 'webhook_secret', label: 'Webhook Signing Secret', type: 'password' },
    ],
  },
  {
    key: 'email', label: 'Email', Icon: Mail,
    description: 'OAuth-connected mailbox (Google Workspace, Microsoft 365) — drives email sync and analysis.',
    fields: [
      { key: 'provider', label: 'Provider', type: 'select', options: ['google', 'm365'], required: true },
      { key: 'mailbox_email', label: 'Mailbox Address', type: 'text', required: true, placeholder: 'ceo@example.com' },
      { key: 'client_id', label: 'OAuth Client ID', type: 'text', required: true },
      { key: 'client_secret', label: 'OAuth Client Secret', type: 'password', required: true },
      { key: 'refresh_token', label: 'Refresh Token', type: 'password', required: true },
      { key: 'sync_frequency_minutes', label: 'Sync Frequency (minutes)', type: 'number', placeholder: '15' },
    ],
  },
  {
    key: 'whatsapp', label: 'WhatsApp', Icon: MessageCircle,
    description: 'Meta WhatsApp Business API — inbound message webhook + outbound sends.',
    fields: [
      { key: 'provider', label: 'Provider', type: 'select', options: ['meta', 'twilio'], required: true },
      { key: 'phone_number_id', label: 'Phone Number ID', type: 'text', required: true },
      { key: 'business_account_id', label: 'Business Account ID', type: 'text' },
      { key: 'access_token', label: 'Access Token', type: 'password', required: true },
      { key: 'webhook_verify_token', label: 'Webhook Verify Token', type: 'password', required: true },
    ],
  },
  {
    key: 'sms', label: 'SMS', Icon: MessageSquare,
    description: 'Local SMS provider for KSA delivery (Unifonic, Msegat) or Twilio for international.',
    fields: [
      { key: 'provider', label: 'Provider', type: 'select', options: ['twilio', 'unifonic', 'msegat'], required: true },
      { key: 'account_sid', label: 'Account SID / App SID', type: 'text', required: true },
      { key: 'auth_token', label: 'Auth Token / API Key', type: 'password', required: true },
      { key: 'sender_id', label: 'Sender ID', type: 'text', placeholder: 'DATALAKE' },
    ],
  },
  {
    key: 'calendar', label: 'Calendar', Icon: Calendar,
    description: 'Google / Microsoft calendar — meeting scheduling and availability.',
    fields: [
      { key: 'provider', label: 'Provider', type: 'select', options: ['google', 'm365'], required: true },
      { key: 'calendar_id', label: 'Calendar ID', type: 'text', required: true, placeholder: 'primary' },
      { key: 'client_id', label: 'OAuth Client ID', type: 'text', required: true },
      { key: 'client_secret', label: 'OAuth Client Secret', type: 'password', required: true },
      { key: 'refresh_token', label: 'Refresh Token', type: 'password', required: true },
    ],
  },
  {
    key: 'ai', label: 'AI', Icon: Brain,
    description: 'AI inference endpoint. Default is self-hosted Qwen on Cloud Run over VPC (no external APIs).',
    fields: [
      { key: 'provider', label: 'Provider', type: 'select', options: ['qwen-self-hosted', 'openai', 'anthropic'], required: true },
      { key: 'endpoint_url', label: 'Endpoint URL', type: 'text', required: true, placeholder: 'https://...' },
      { key: 'model', label: 'Model', type: 'text', placeholder: 'qwen2.5-7b' },
      { key: 'api_key', label: 'API Key (optional for self-hosted)', type: 'password' },
    ],
  },
]

const styles = {
  accordion: { display: 'flex', flexDirection: 'column', gap: 12 },
  section: { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, overflow: 'hidden' },
  sectionHeader: { display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', cursor: 'pointer', userSelect: 'none', background: 'rgba(255,255,255,0.02)' },
  sectionHeaderActive: { background: 'rgba(21,152,204,0.08)', borderBottom: '1px solid rgba(255,255,255,0.08)' },
  sectionIcon: { width: 36, height: 36, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(21,152,204,0.15)', color: '#38bdf8', flexShrink: 0 },
  sectionTitle: { flex: 1, display: 'flex', flexDirection: 'column' },
  sectionLabel: { fontSize: '0.95rem', fontWeight: 700, color: '#fff' },
  sectionDesc: { fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)', marginTop: 2 },
  sectionBody: { padding: '18px 18px 20px', display: 'flex', flexDirection: 'column', gap: 14 },
  fieldGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 },
  field: { display: 'flex', flexDirection: 'column', gap: 5 },
  fieldLabel: { fontSize: '0.74rem', fontWeight: 600, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.02em' },
  input: { padding: '9px 11px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.25)', color: '#fff', fontSize: '0.85rem', outline: 'none', fontFamily: 'inherit' },
  passwordWrap: { position: 'relative' },
  passwordToggle: { position: 'absolute', right: 8, top: 7, background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.45)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 2 },
  required: { color: '#fca5a5', marginLeft: 3 },
  maskedHint: { fontSize: '0.68rem', color: 'rgba(56,189,248,0.85)', fontStyle: 'italic' },
  actions: { display: 'flex', alignItems: 'center', gap: 10, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.06)', flexWrap: 'wrap' },
  btnPrimary: { padding: '8px 16px', borderRadius: 8, border: '1px solid #1598CC', background: '#1598CC', color: '#fff', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 },
  btnSecondary: { padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.85)', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 },
  btnDisabled: { padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.03)', color: 'rgba(255,255,255,0.35)', fontSize: '0.82rem', fontWeight: 600, cursor: 'not-allowed', display: 'inline-flex', alignItems: 'center', gap: 6 },
  statusConnected: { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 12, background: 'rgba(52,191,58,0.15)', color: '#4ade80', fontSize: '0.74rem', fontWeight: 600 },
  statusDisconnected: { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 12, background: 'rgba(192,57,43,0.15)', color: '#fca5a5', fontSize: '0.74rem', fontWeight: 600 },
  statusUnknown: { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 12, background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)', fontSize: '0.74rem', fontWeight: 600 },
  msgSuccess: { color: '#4ade80', fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: 5 },
  msgError: { color: '#fca5a5', fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: 5 },
}

function ProviderSection({ provider, tenantId, expanded, onToggle }) {
  const [values, setValues] = useState({})
  const [showSecret, setShowSecret] = useState({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [saveMsg, setSaveMsg] = useState({ kind: '', text: '' })
  const [testResult, setTestResult] = useState(null) // 'connected' | 'disconnected' | null
  const [loaded, setLoaded] = useState(false)

  const loadConfig = async () => {
    if (!tenantId) return
    setLoading(true); setLoadError('')
    try {
      const idToken = await auth.currentUser.getIdToken()
      const url = `${GET_INTEGRATION_CONFIG_URL}?provider=${encodeURIComponent(provider.key)}`
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${idToken}`, 'X-Tenant-ID': tenantId },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      const cfg = data.config || {}
      const next = {}
      for (const f of provider.fields) next[f.key] = cfg[f.key] != null ? String(cfg[f.key]) : ''
      setValues(next)
      setLoaded(true)
      setTestResult(data.config ? 'connected' : 'disconnected')
    } catch (err) {
      setLoadError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!expanded || loaded || !tenantId) return
    const run = async () => { await loadConfig() }
    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, tenantId])

  const handleChange = (key, val) => {
    setValues(v => ({ ...v, [key]: val }))
    setSaveMsg({ kind: '', text: '' })
  }

  const handleSave = async () => {
    setSaving(true); setSaveMsg({ kind: '', text: '' })
    try {
      // Build payload — skip sensitive fields that are still masked (means user did not change them)
      const config = {}
      for (const f of provider.fields) {
        const v = values[f.key]
        if (v == null || v === '') continue
        if (f.type === 'password' && v === MASK) continue // keep existing secret
        config[f.key] = f.type === 'number' ? Number(v) : v
      }
      // Validate required fields are present (allow masked secrets to count as present)
      const missing = provider.fields.filter(f => {
        if (!f.required) return false
        const v = values[f.key]
        return !v
      })
      if (missing.length > 0) {
        throw new Error(`Missing required: ${missing.map(m => m.label).join(', ')}`)
      }

      const idToken = await auth.currentUser.getIdToken()
      const res = await fetch(SAVE_INTEGRATION_CONFIG_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
          'X-Tenant-ID': tenantId,
        },
        body: JSON.stringify({ provider: provider.key, config }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setSaveMsg({ kind: 'success', text: 'Configuration saved.' })
      // Re-fetch so secrets re-mask
      await loadConfig()
    } catch (err) {
      setSaveMsg({ kind: 'error', text: err.message })
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true); setTestResult(null)
    try {
      const idToken = await auth.currentUser.getIdToken()
      const url = `${GET_INTEGRATION_CONFIG_URL}?provider=${encodeURIComponent(provider.key)}`
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${idToken}`, 'X-Tenant-ID': tenantId },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      // "Connected" = backend returns a config doc with required fields present
      const cfg = data.config
      if (!cfg) { setTestResult('disconnected'); return }
      const missing = provider.fields.filter(f => f.required && !cfg[f.key])
      setTestResult(missing.length === 0 ? 'connected' : 'disconnected')
    } catch {
      setTestResult('disconnected')
    } finally {
      setTesting(false)
    }
  }

  const { Icon } = provider
  const headerStyle = { ...styles.sectionHeader, ...(expanded ? styles.sectionHeaderActive : {}) }

  return (
    <div style={styles.section}>
      <div style={headerStyle} onClick={onToggle}>
        <div style={styles.sectionIcon}><Icon size={18} /></div>
        <div style={styles.sectionTitle}>
          <span style={styles.sectionLabel}>{provider.label}</span>
          <span style={styles.sectionDesc}>{provider.description}</span>
        </div>
        {testResult === 'connected' && <span style={styles.statusConnected}><CheckCircle2 size={12} /> Connected</span>}
        {testResult === 'disconnected' && <span style={styles.statusDisconnected}><XCircle size={12} /> Disconnected</span>}
        {testResult === null && loaded && <span style={styles.statusUnknown}><AlertCircle size={12} /> Not tested</span>}
        {expanded ? <ChevronDown size={18} color="rgba(255,255,255,0.5)" /> : <ChevronRight size={18} color="rgba(255,255,255,0.5)" />}
      </div>

      {expanded && (
        <div style={styles.sectionBody}>
          {loading && <div style={{ ...s.loading, padding: 20 }}><Loader size={16} className="spin" /> Loading config…</div>}
          {loadError && <div style={s.error}>Could not load: {loadError}</div>}

          {!loading && !loadError && (
            <>
              <div style={styles.fieldGrid}>
                {provider.fields.map(field => {
                  const v = values[field.key] || ''
                  const isMasked = field.type === 'password' && v === MASK
                  const showThis = !!showSecret[field.key]

                  if (field.type === 'select') {
                    return (
                      <div key={field.key} style={styles.field}>
                        <label style={styles.fieldLabel}>
                          {field.label}{field.required && <span style={styles.required}>*</span>}
                        </label>
                        <select
                          style={styles.input}
                          value={v}
                          onChange={e => handleChange(field.key, e.target.value)}
                        >
                          <option value="">— Select —</option>
                          {field.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                      </div>
                    )
                  }

                  if (field.type === 'password') {
                    return (
                      <div key={field.key} style={styles.field}>
                        <label style={styles.fieldLabel}>
                          {field.label}{field.required && <span style={styles.required}>*</span>}
                        </label>
                        <div style={styles.passwordWrap}>
                          <input
                            type={showThis ? 'text' : 'password'}
                            style={{ ...styles.input, paddingRight: 34, width: '100%', boxSizing: 'border-box' }}
                            value={v}
                            placeholder={field.placeholder}
                            onChange={e => handleChange(field.key, e.target.value)}
                            onFocus={e => { if (isMasked) { handleChange(field.key, ''); e.target.value = '' } }}
                          />
                          <button type="button" style={styles.passwordToggle} onClick={() => setShowSecret(s => ({ ...s, [field.key]: !s[field.key] }))} title={showThis ? 'Hide' : 'Show'}>
                            {showThis ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                        </div>
                        {isMasked && <span style={styles.maskedHint}>Stored — focus to replace</span>}
                      </div>
                    )
                  }

                  return (
                    <div key={field.key} style={styles.field}>
                      <label style={styles.fieldLabel}>
                        {field.label}{field.required && <span style={styles.required}>*</span>}
                      </label>
                      <input
                        type={field.type === 'number' ? 'number' : 'text'}
                        style={styles.input}
                        value={v}
                        placeholder={field.placeholder}
                        onChange={e => handleChange(field.key, e.target.value)}
                      />
                    </div>
                  )
                })}
              </div>

              <div style={styles.actions}>
                <button
                  style={saving ? styles.btnDisabled : styles.btnPrimary}
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? <Loader size={13} className="spin" /> : <Save size={13} />} Save
                </button>
                <button
                  style={testing ? styles.btnDisabled : styles.btnSecondary}
                  onClick={handleTest}
                  disabled={testing}
                >
                  {testing ? <Loader size={13} className="spin" /> : <Plug size={13} />} Test Connection
                </button>
                {saveMsg.kind === 'success' && <span style={styles.msgSuccess}><CheckCircle2 size={13} /> {saveMsg.text}</span>}
                {saveMsg.kind === 'error' && <span style={styles.msgError}><AlertCircle size={13} /> {saveMsg.text}</span>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default function Integrations() {
  const [tenantId, setTenantId] = useState(null)
  const [userRole, setUserRole] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState({ telephony: true })

  // Load user's tenant_id + role for in-page gating (defense in depth — AuthGate is the real check).
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const u = auth.currentUser
        if (!u) { setError('Not signed in.'); setLoading(false); return }
        const snap = await getDoc(doc(db, 'users', u.uid))
        if (cancelled) return
        if (!snap.exists()) {
          setError('User record not found.')
          setLoading(false)
          return
        }
        const data = snap.data()
        setUserRole(data.role_id || null)
        setTenantId(data.tenant_id || null)
        setLoading(false)
      } catch (e) {
        if (!cancelled) { setError(e.message); setLoading(false) }
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const isAllowed = useMemo(() => userRole === 'ceo' || userRole === 'it_admin', [userRole])

  if (loading) {
    return <div style={{ ...s.page }}><div style={s.loading}><Loader size={16} className="spin" /> Loading integrations…</div></div>
  }

  if (error) {
    return <div style={s.page}><h1 style={s.h1}>Integrations</h1><div style={s.error}>{error}</div></div>
  }

  if (!isAllowed) {
    return (
      <div style={s.page}>
        <h1 style={s.h1}>Integrations</h1>
        <div style={{ ...s.error, display: 'flex', alignItems: 'center', gap: 10 }}>
          <ShieldAlert size={18} /> Only CEO or IT Administrator can configure tenant integrations.
        </div>
      </div>
    )
  }

  if (!tenantId) {
    return (
      <div style={s.page}>
        <h1 style={s.h1}>Integrations</h1>
        <div style={s.error}>
          Your account has no <code>tenant_id</code> assigned. Set one on your user record before configuring integrations.
        </div>
      </div>
    )
  }

  return (
    <div style={s.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={s.h1}>Integrations</h1>
          <p style={s.sub}>Tenant: <code style={s.mono}>{tenantId}</code> — Configure per-provider credentials. Secrets are stored in GCP Secret Manager and masked on read.</p>
        </div>
      </div>

      <div style={s.notice}>
        <Lock size={16} />
        <span>
          Sensitive fields (passwords, tokens, API keys) are written to <strong>Secret Manager</strong> and re-read as <code>{MASK}</code>.
          Leave them masked to keep the existing secret, or focus the field to type a replacement. The "Test Connection" check verifies the
          backend has a stored config with required fields populated.
        </span>
      </div>

      <div style={styles.accordion}>
        {PROVIDERS.map(p => (
          <ProviderSection
            key={p.key}
            provider={p}
            tenantId={tenantId}
            expanded={!!expanded[p.key]}
            onToggle={() => setExpanded(e => ({ ...e, [p.key]: !e[p.key] }))}
          />
        ))}
      </div>

      <style>{`
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
