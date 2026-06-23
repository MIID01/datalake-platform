import { useState } from 'react'
import { collection, addDoc, doc, updateDoc, serverTimestamp, Timestamp } from 'firebase/firestore'
import { auth, db } from '../../lib/firebase'
import { LOGGABLE_TYPES, activityMeta } from '../../lib/activity'
import { Loader, CalendarPlus } from 'lucide-react'

// Enterprise activity logger (DTLK-CRM-ENT-001 Phase 1). Logs a Note/Call/Meeting/Task
// to the canonical `deals/{id}/deal_activities`, optionally back-dated to when it
// actually happened, with an outcome — and can schedule the next step as a linked
// `crm_tasks` row (same store the follow-up agent + Tasks page use). No new store.
//
// Props: dealId/dealTitle for the single-deal case; OR `deals` ([{id,title}]) to show
// a deal picker on the contact timeline. onLogged() fires after a successful write.
const inp = { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-primary, #E5E7EB)', background: 'var(--bg-surface, #fff)', color: 'var(--text-primary)', fontSize: '0.84rem', boxSizing: 'border-box', fontFamily: 'inherit' }

export default function LogActivity({ dealId, dealTitle, deals, onLogged }) {
  const picker = Array.isArray(deals) && deals.length > 0
  const [targetDeal, setTargetDeal] = useState(picker ? deals[0].id : dealId)
  const [type, setType] = useState('CALL')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [outcome, setOutcome] = useState('')
  const [occurredAt, setOccurredAt] = useState('') // blank = now; set to back-date
  const [scheduleNext, setScheduleNext] = useState(false)
  const [nextTitle, setNextTitle] = useState('')
  const [nextDue, setNextDue] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const reset = () => { setSubject(''); setBody(''); setOutcome(''); setOccurredAt(''); setScheduleNext(false); setNextTitle(''); setNextDue('') }

  const save = async () => {
    setMsg('')
    const did = picker ? targetDeal : dealId
    if (!did) { setMsg('Pick a deal to log against.'); return }
    if (!subject.trim() && !body.trim()) { setMsg('Add a subject or note.'); return }
    setBusy(true)
    try {
      const me = auth.currentUser
      const dTitle = picker ? (deals.find(d => d.id === targetDeal)?.title || null) : (dealTitle || null)
      await addDoc(collection(db, 'deals', did, 'deal_activities'), {
        type,
        subject: subject.trim() || null,
        body: body.trim() || null,
        outcome: outcome.trim() || null,
        ...(occurredAt ? { occurred_at: Timestamp.fromDate(new Date(occurredAt)) } : {}),
        created_at: serverTimestamp(),
        created_by: me?.email || 'unknown',
        created_by_uid: me?.uid || null,
      })
      await updateDoc(doc(db, 'deals', did), { last_activity_at: serverTimestamp() })
      if (scheduleNext && nextTitle.trim()) {
        await addDoc(collection(db, 'crm_tasks'), {
          title: nextTitle.trim(),
          due_date: nextDue || null,
          assignee_email: me?.email || null,
          status: 'OPEN',
          deal_id: did,
          deal_title: dTitle,
          source: 'activity-followup',
          created_by: me?.email || 'unknown',
          created_at: serverTimestamp(),
          updated_at: serverTimestamp(),
        })
      }
      reset()
      setMsg('Logged.')
      onLogged?.()
    } catch (e) {
      setMsg('Failed: ' + e.message)
    } finally { setBusy(false) }
  }

  return (
    <div style={{ border: '1px solid var(--border-primary, #E5E7EB)', borderRadius: 8, padding: 12, marginBottom: 14 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        {LOGGABLE_TYPES.map(t => {
          const m = activityMeta(t)
          const active = type === t
          return (
            <button key={t} onClick={() => setType(t)} type="button"
              style={{ padding: '5px 12px', borderRadius: 7, border: `1px solid ${active ? m.color : 'var(--border-primary, #E5E7EB)'}`, background: active ? m.color + '1A' : 'transparent', color: active ? m.color : 'var(--text-secondary)', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
              {m.label}
            </button>
          )
        })}
      </div>

      {picker && (
        <select value={targetDeal} onChange={e => setTargetDeal(e.target.value)} style={{ ...inp, marginBottom: 8 }}>
          {deals.map(d => <option key={d.id} value={d.id}>{d.title || d.id}</option>)}
        </select>
      )}

      <input value={subject} onChange={e => setSubject(e.target.value)} placeholder={`${activityMeta(type).label} subject (e.g. "Intro call with procurement")`} style={{ ...inp, marginBottom: 8 }} />
      <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Notes / what was discussed…" rows={3} style={{ ...inp, marginBottom: 8, resize: 'vertical' }} />

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <input value={outcome} onChange={e => setOutcome(e.target.value)} placeholder="Outcome (optional, e.g. Positive / No answer)" style={{ ...inp, flex: 1, minWidth: 180 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>
          When
          <input type="datetime-local" value={occurredAt} onChange={e => setOccurredAt(e.target.value)} title="Leave blank = now; set to log a past activity" style={{ ...inp, width: 200 }} />
        </label>
      </div>

      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: '0.8rem', color: 'var(--text-secondary)', cursor: 'pointer', marginBottom: scheduleNext ? 8 : 0 }}>
        <input type="checkbox" checked={scheduleNext} onChange={e => setScheduleNext(e.target.checked)} />
        <CalendarPlus size={14} /> Schedule a follow-up task
      </label>
      {scheduleNext && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <input value={nextTitle} onChange={e => setNextTitle(e.target.value)} placeholder="Next step (e.g. Send proposal)" style={{ ...inp, flex: 1, minWidth: 200 }} />
          <input type="date" value={nextDue} onChange={e => setNextDue(e.target.value)} style={{ ...inp, width: 170 }} />
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
        <button className="btn btn-primary write-action" onClick={save} disabled={busy} type="button">
          {busy ? <Loader size={14} className="spin" /> : 'Log activity'}
        </button>
        {msg && <span style={{ fontSize: '0.78rem', color: msg.startsWith('Failed') || msg.includes('Pick') || msg.includes('Add a') ? '#991b1b' : '#1f7a2a' }}>{msg}</span>}
      </div>
    </div>
  )
}
