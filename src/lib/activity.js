// Canonical CRM activity vocabulary + helpers (DTLK-CRM-ENT-001 Phase 1).
// SINGLE SOURCE OF TRUTH for how an activity renders + sorts, so the deal timeline
// and the contact timeline can never drift. Activities live in the canonical
// `deals/{id}/deal_activities` subcollection; this file only describes/normalizes them.
import { ACTIVITY_TYPES } from './deals'

// Per-type display metadata. Icons are resolved in the component (lucide) by type.
export const ACTIVITY_META = {
  NOTE:    { label: 'Note',    color: '#64748b' },
  CALL:    { label: 'Call',    color: '#1598CC' },
  MEETING: { label: 'Meeting', color: '#7C3AED' },
  EMAIL:   { label: 'Email',   color: '#0A66C2' },
  TASK:    { label: 'Task',    color: '#F39C12' },
}
export const activityMeta = (t) => ACTIVITY_META[t] || ACTIVITY_META.NOTE

// Loggable types from the composer (EMAIL is logged only by the send flow, never typed).
export const LOGGABLE_TYPES = ACTIVITY_TYPES.filter(t => t !== 'EMAIL')

const ms = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : (typeof v === 'number' ? v : null))

// The event's real time: when it OCCURRED if logged after the fact, else when created.
export const activityWhenMs = (a) => ms(a?.occurred_at) ?? ms(a?.created_at) ?? 0

// Normalize a raw deal_activities doc into the shape the timeline renders. `dealId`/
// `dealTitle` are carried so a contact-level (cross-deal) timeline can label the source.
export function normalizeActivity(a, dealId, dealTitle) {
  return {
    id: a.id,
    type: a.type || 'NOTE',
    when: activityWhenMs(a),
    occurredBackdated: !!a.occurred_at,
    subject: a.subject || (a.type === 'EMAIL' ? (a.email_subject || '') : ''),
    outcome: a.outcome || '',
    body: a.body || '',
    emailTo: a.type === 'EMAIL' ? (a.email_to || '') : '',
    author: a.created_by || '—',
    dealId,
    dealTitle,
  }
}

export const sortByWhenDesc = (a, b) => b.when - a.when
