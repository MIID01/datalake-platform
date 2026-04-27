import { travelData } from '../../data/mockEngineer'
import { Plane, Home, CreditCard, Shield, CheckCircle, Clock, AlertTriangle } from 'lucide-react'

const statusColors = { Approved: 'badge-success', Active: 'badge-success', Valid: 'badge-success', Completed: 'badge-neutral', Processing: 'badge-warning', Expired: 'badge-critical', 'Renewal Due': 'badge-warning' }

const cards = [
  { key: 'visa', icon: '🛂', label: 'Visa Status', fields: d => [
    { l: 'Type', v: d.type }, { l: 'Applied', v: d.applicationDate }, { l: 'Expires', v: d.expiryDate }, { l: 'Status', v: d.status, badge: true }
  ]},
  { key: 'flight', icon: '✈️', label: 'Flight Bookings', fields: d => [
    { l: 'Outbound', v: d.outbound }, { l: 'Airline', v: d.airline }, { l: 'Booking Ref', v: d.bookingRef, mono: true }, { l: 'Status', v: d.status, badge: true }
  ]},
  { key: 'housing', icon: '🏠', label: 'Housing', fields: d => [
    { l: 'Address', v: d.address }, { l: 'Lease Start', v: d.leaseStart }, { l: 'Lease End', v: d.leaseEnd }, { l: 'Status', v: d.status, badge: true }
  ]},
  { key: 'iqama', icon: '🪪', label: 'IQAMA / Work Permit', fields: d => [
    { l: 'Number', v: d.number, mono: true }, { l: 'Expires', v: d.expiryDate }, { l: 'Renewal', v: d.renewalStatus, badge: true }
  ]},
]

export default function Travel() {
  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 24 }}>Travel & Logistics</h1>

      <div className="grid-2" style={{ marginBottom: 28 }}>
        {cards.map((card, i) => {
          const data = travelData[card.key]
          const fields = card.fields(data)
          return (
            <div key={card.key} className={`card animate-fade-in-up stagger-${i + 1}`}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <span style={{ fontSize: '1.5rem' }}>{card.icon}</span>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 700 }}>{card.label}</h3>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {fields.map((f, j) => (
                  <div key={j} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: j < fields.length - 1 ? '1px solid var(--border-primary)' : 'none' }}>
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-tertiary)' }}>{f.l}</span>
                    {f.badge ? (
                      <span className={`badge ${statusColors[f.v] || 'badge-info'}`}>{f.v}</span>
                    ) : (
                      <span style={{ fontSize: '0.9rem', fontWeight: 600, fontFamily: f.mono ? 'var(--font-mono)' : 'inherit' }}>{f.v || '—'}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Timeline */}
      <div className="card animate-fade-in-up">
        <div className="card-header"><h3>Relocation Timeline</h3></div>
        <div className="timeline">
          {[
            { label: 'Visa Application Submitted', date: 'May 1, 2025', status: 'completed' },
            { label: 'Visa Approved', date: 'May 15, 2025', status: 'completed' },
            { label: 'Flight Booked (Outbound)', date: 'May 20, 2025', status: 'completed' },
            { label: 'Arrived in Riyadh', date: 'May 28, 2025', status: 'completed' },
            { label: 'Housing Secured', date: 'Jun 1, 2025', status: 'completed' },
            { label: 'IQAMA Issued', date: 'Jun 15, 2025', status: 'completed' },
            { label: 'Contract Active', date: 'Jun 1, 2025 — Jun 1, 2026', status: 'active' },
          ].map((item, i) => (
            <div key={i} className={`timeline-item ${item.status}`}>
              <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{item.label}</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: 2 }}>{item.date}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
