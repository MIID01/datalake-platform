import { useEffect, useState } from 'react'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db, auth } from '../lib/firebase'
import { getAcknowledgmentSummary } from '../lib/policies'
import { ShieldCheck, AlertTriangle, Loader, CheckCircle2 } from 'lucide-react'

// CEO control: enable/disable the onboarding→training→timesheet gate and set its
// effective date. Writing platform_settings/timesheet_gate is CEO-allowed by
// firestore.rules; the onTimesheetGateChange function logs the change to
// BigQuery control_events. Shows the live acknowledgment Pending count and
// requires a confirm when enabling while Pending > 0.
export default function TimesheetGatePanel() {
  const [enabled, setEnabled] = useState(false)
  const [effectiveDate, setEffectiveDate] = useState('')
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const gd = await getDoc(doc(db, 'platform_settings', 'timesheet_gate'))
        if (!cancelled && gd.exists()) {
          const d = gd.data()
          setEnabled(d.enabled === true)
          if (d.effective_date) {
            const dt = d.effective_date.toDate ? d.effective_date.toDate() : new Date(d.effective_date)
            if (!Number.isNaN(dt.getTime())) setEffectiveDate(dt.toISOString().slice(0, 10))
          }
        }
      } catch { /* */ }
      try { const s = await getAcknowledgmentSummary(); if (!cancelled) setSummary(s) } catch { if (!cancelled) setSummary(null) }
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [])

  const pending = summary?.pending ?? 0

  const save = async () => {
    if (enabled && pending > 0) {
      const ok = window.confirm(
        `${pending} of ${summary.total} employees still have PENDING policy acknowledgments.\n\n` +
        `Enabling the gate will BLOCK their timesheet submissions until they acknowledge the current policies (and complete required training).\n\nEnable anyway?`
      )
      if (!ok) return
    }
    setSaving(true); setMsg(null)
    try {
      await setDoc(doc(db, 'platform_settings', 'timesheet_gate'), {
        enabled,
        effective_date: effectiveDate || null,
        updated_by: auth.currentUser?.email || 'unknown',
        updated_at: serverTimestamp(),
      }, { merge: true })
      setMsg({ kind: 'success', text: `Gate ${enabled ? 'ENABLED' : 'disabled'}${effectiveDate ? ` — effective ${effectiveDate}` : ''}. Change logged to control_events.` })
    } catch (e) {
      setMsg({ kind: 'error', text: e.message || 'Could not save the gate setting.' })
    } finally {
      setSaving(false)
    }
  }

  const wrap = { background: 'rgba(2,40,115,0.4)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 20, marginBottom: 20, backdropFilter: 'blur(12px)' }

  return (
    <div style={wrap}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <ShieldCheck size={18} color="#1598CC" />
        <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#fff', margin: 0 }}>Timesheet Compliance Gate</h3>
      </div>
      <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: '0.8rem', margin: '0 0 14px', maxWidth: 720, lineHeight: 1.6 }}>
        When enabled (on/after the effective date), engineers cannot submit timesheets until they have acknowledged the
        current policies AND completed required training. Leave disabled until the acknowledgment campaign + training sweep are done.
      </p>

      {loading ? (
        <div style={{ color: 'rgba(255,255,255,0.6)', display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem' }}>
          <Loader size={16} className="spin" /> Loading gate state &amp; acknowledgment status…
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', color: '#fff', fontSize: '0.88rem', fontWeight: 600 }}>
              <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} style={{ width: 18, height: 18, cursor: 'pointer' }} />
              Gate enabled
            </label>
            <div>
              <label style={{ display: 'block', fontSize: '0.72rem', color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>Effective date</label>
              <input type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)}
                style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#fff', fontFamily: 'inherit', fontSize: '0.85rem' }} />
            </div>
            {/* Live Pending count beside the toggle */}
            <div style={{ padding: '8px 14px', borderRadius: 8, background: pending > 0 ? 'rgba(243,156,18,0.12)' : 'rgba(52,191,58,0.12)', border: '1px solid ' + (pending > 0 ? 'rgba(243,156,18,0.3)' : 'rgba(52,191,58,0.3)') }}>
              <div style={{ fontSize: '1.1rem', fontWeight: 800, color: pending > 0 ? '#F39C12' : '#34BF3A' }}>
                {summary ? `${pending} pending` : '— '}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.55)' }}>
                {summary ? `${summary.completed}/${summary.total} acknowledged` : 'count unavailable'} · <a href="/hr/acknowledgments" style={{ color: '#7dd3fc' }}>register</a>
              </div>
            </div>
            <button onClick={save} disabled={saving}
              style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: '#1598CC', color: '#fff', fontWeight: 700, fontSize: '0.85rem', fontFamily: 'inherit', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {saving ? <Loader size={14} className="spin" /> : <CheckCircle2 size={14} />} Save
            </button>
          </div>

          {enabled && pending > 0 && (
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, color: '#F39C12', fontSize: '0.8rem' }}>
              <AlertTriangle size={14} /> {pending} employee(s) pending — enabling now will block their timesheets until they acknowledge.
            </div>
          )}
          {msg && (
            <div style={{ marginTop: 12, padding: '9px 14px', borderRadius: 8, fontSize: '0.82rem',
              background: msg.kind === 'error' ? 'rgba(192,57,43,0.12)' : 'rgba(52,191,58,0.12)',
              border: '1px solid ' + (msg.kind === 'error' ? 'rgba(192,57,43,0.3)' : 'rgba(52,191,58,0.3)'),
              color: msg.kind === 'error' ? '#fca5a5' : '#86efac' }}>
              {msg.text}
            </div>
          )}
        </>
      )}
      <style>{`.spin { animation: spin 1s linear infinite; } @keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
