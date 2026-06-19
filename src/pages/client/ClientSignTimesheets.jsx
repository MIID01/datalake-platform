import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { useAccessProfile } from '../../hooks/useAccessProfile'
import { Clock, Loader, ExternalLink } from 'lucide-react'

// Client portal — timesheets awaiting (or completed) this client's signature.
// The owning client can read their own project_timesheets (firestore.rules);
// "Review & sign" opens the shared sign page in authenticated mode.
const NAVY = '#022873'
const LABEL = { CTO_APPROVED: 'Ready to sign', SENT_TO_CLIENT: 'Ready to sign', CLIENT_SIGNED: 'Signed', INVOICED: 'Invoiced' }
const COLOR = { CTO_APPROVED: '#b45309', SENT_TO_CLIENT: '#b45309', CLIENT_SIGNED: '#15803d', INVOICED: '#64748b' }

export default function ClientSignTimesheets() {
  const { profile } = useAccessProfile()
  const clientId = profile?.client_id
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!clientId) { setLoading(false); return }
    const unsub = onSnapshot(query(collection(db, 'project_timesheets'), where('client_id', '==', clientId)),
      s => { setRows(s.docs.map(d => ({ id: d.id, ...d.data() })).filter(t => LABEL[t.state])); setLoading(false) },
      () => setLoading(false))
    return () => unsub()
  }, [clientId])

  return (
    <div style={{ padding: 24, fontFamily: "'DM Sans', Arial, sans-serif" }}>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: NAVY, display: 'flex', alignItems: 'center', gap: 10 }}>
        <Clock size={20} color="#1598CC" /> Timesheets
      </h1>
      <p style={{ fontSize: '0.82rem', color: '#64748b', margin: '4px 0 18px' }}>Monthly project timesheets for your account — review and sign.</p>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}><Loader className="spin" /><style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{100%{transform:rotate(360deg)}}`}</style></div>
      ) : !clientId ? (
        <Notice>Your account isn’t linked to a client record yet — please contact Datalake.</Notice>
      ) : rows.length === 0 ? (
        <Notice>No timesheets awaiting your signature.</Notice>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.86rem' }}>
            <thead><tr style={{ textAlign: 'left', color: '#94a3b8', borderBottom: '1px solid #E5E7EB' }}>
              <th style={{ padding: '11px 14px' }}>Project</th><th style={{ padding: '11px 14px' }}>Period</th><th style={{ padding: '11px 14px' }}>PO</th><th style={{ padding: '11px 14px' }}>Status</th><th style={{ padding: '11px 14px' }} />
            </tr></thead>
            <tbody>
              {rows.map(t => (
                <tr key={t.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                  <td style={{ padding: '11px 14px', fontWeight: 600 }}>{t.project_name || '—'}</td>
                  <td style={{ padding: '11px 14px' }}>{t.period_label || '—'}</td>
                  <td style={{ padding: '11px 14px' }}>{t.po_number || '—'}</td>
                  <td style={{ padding: '11px 14px', color: COLOR[t.state], fontWeight: 700 }}>{LABEL[t.state]}</td>
                  <td style={{ padding: '11px 14px', textAlign: 'right' }}>
                    {['CTO_APPROVED', 'SENT_TO_CLIENT'].includes(t.state)
                      ? <Link to={`/sign-timesheet/${t.id}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#fff', background: NAVY, padding: '6px 12px', borderRadius: 7, textDecoration: 'none', fontSize: '0.78rem', fontWeight: 600 }}>Review & sign <ExternalLink size={12} /></Link>
                      : <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Notice({ children }) {
  return <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12 }}>{children}</div>
}
