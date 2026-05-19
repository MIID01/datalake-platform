import { useState, useEffect } from 'react'
import { collection, query, getDocs, onSnapshot, orderBy } from 'firebase/firestore'
import { db, auth, BACKFILL_EMPLOYEE_URL, RECORD_LEAVER_URL } from '../../lib/firebase'
import { UserPlus, UserMinus, Activity, Mail, CheckCircle, AlertTriangle, Loader, RefreshCw } from 'lucide-react'

const SOURCE_DATA = [
  { emp_id: 'DLSA1001', name: 'Mohammed Alqumri', email: 'm.alqumri@datalake.sa', job_title: 'CEO', role_id: 'ceo', type: 'BACKFILL' },
  { emp_id: 'DLSA1002', name: 'Enas Saeed', email: '', job_title: 'Business Manager', role_id: '', type: 'LEAVER' },
  { emp_id: 'DLSA1003', name: 'Khalid Mohammed', email: 'finance@datalake.sa', job_title: 'Accountant', role_id: 'finance', type: 'BACKFILL' },
  { emp_id: 'DLSA1005', name: 'Ayham Ramadan', email: 'ayh.ashraf@datalake.sa', job_title: 'Data Architect', role_id: 'engineer', type: 'BACKFILL' },
  { emp_id: 'DLSA1006', name: 'Mahmoud Abdelghany', email: 'mah.abdelghany@datalake.sa', job_title: 'Data Protection Eng.', role_id: 'engineer', type: 'BACKFILL' },
  { emp_id: 'DLSA1007', name: 'Mohamed Dahas', email: 'moh.dahas@datalake.sa', job_title: 'Sr. Data Engineer', role_id: 'engineer', type: 'BACKFILL' },
  { emp_id: 'DLSA1008', name: 'Mahmoud Reda', email: 'mah.reda@datalake.sa', job_title: 'BI Engineer', role_id: '', type: 'LEAVER' },
  { emp_id: 'DLSA1009', name: 'Marwen Benalayat', email: 'mar.benalayat@datalake.sa', job_title: 'Data Engineer', role_id: 'engineer', type: 'BACKFILL' },
  { emp_id: 'DLSA1010', name: 'Salaheddine Gragba', email: 'Saleh.Gragba@datalake.sa', job_title: 'Data Scientist', role_id: 'engineer', type: 'BACKFILL' },
  { emp_id: 'DLSA1012', name: 'Marwan Ayoub', email: 'mar.ayoub@datalake.sa', job_title: 'BI Engineer', role_id: 'engineer', type: 'BACKFILL' },
  { emp_id: 'DLSA1013', name: 'Alaa Alkattan', email: 'Alaa.Alkattan@datalake.sa', job_title: 'AI Business Director', role_id: 'engineer', type: 'BACKFILL' },
  { emp_id: 'DLSA1014', name: 'Bassam Soliman', email: 'Bassam.soliman@datalake.sa', job_title: 'Technical Director', role_id: 'engineer', type: 'BACKFILL' },
  { emp_id: 'DLSA1015', name: 'Mohamed Ashraf', email: 'Moh.ashraf@datalake.sa', job_title: 'Developer', role_id: 'engineer', type: 'BACKFILL' },
  { emp_id: 'DLSA1016', name: 'Mahmoud Aly Metawea', email: 'Mah.Metawea@datalake.sa', job_title: 'Sr. Developer', role_id: 'engineer', type: 'BACKFILL' },
  { emp_id: 'DLSA1017', name: 'Hamdi Tebourbi', email: 'hamdi.tebourbi@datalake.sa', job_title: 'CTO', role_id: 'cto', type: 'BACKFILL' }
];

const s = {
  page: { padding: '32px 24px', maxWidth: 1200, margin: '0 auto', minHeight: '100vh', background: '#0a1628' },
  title: { fontSize: '1.5rem', fontWeight: 700, color: '#e2e8f0', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 10 },
  tabs: { display: 'flex', gap: 16, borderBottom: '1px solid #1e3050', marginBottom: 24 },
  tab: (active) => ({ padding: '12px 24px', color: active ? '#1598CC' : '#94a3b8', borderBottom: active ? '2px solid #1598CC' : 'none', cursor: 'pointer', fontWeight: 600, transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: 8 }),
  card: { background: '#111e33', borderRadius: 12, border: '1px solid #1e3050', padding: 24 },
  table: { width: '100%', borderCollapse: 'collapse', color: '#e2e8f0', fontSize: '0.88rem' },
  th: { textAlign: 'left', padding: '12px 16px', borderBottom: '1px solid #1e3050', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.05em' },
  td: { padding: '16px', borderBottom: '1px solid #1e3050' },
  btn: (color) => ({ padding: '8px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', background: color, color: '#fff', fontWeight: 600, fontSize: '0.82rem', display: 'inline-flex', alignItems: 'center', gap: 6 }),
  input: { padding: '8px 12px', borderRadius: 6, border: '1px solid #1e3050', background: '#0d1829', color: '#e2e8f0', outline: 'none' },
  select: { padding: '8px 12px', borderRadius: 6, border: '1px solid #1e3050', background: '#0d1829', color: '#e2e8f0', outline: 'none' },
  badge: (color) => ({ padding: '4px 10px', borderRadius: 12, fontSize: '0.75rem', fontWeight: 700, background: `${color}22`, color, border: `1px solid ${color}44` }),
};

export default function CEOBackfill() {
  const [activeTab, setActiveTab] = useState('BACKFILL');
  const [results, setResults] = useState({});
  const [processing, setProcessing] = useState(false);
  const [statusList, setStatusList] = useState([]);
  
  // Leavers form state
  const [leaverDates, setLeaverDates] = useState({});
  const [leaverReasons, setLeaverReasons] = useState({});

  useEffect(() => {
    if (activeTab === 'STATUS') {
      const q = query(collection(db, "users"), orderBy("created_at", "desc"));
      const unsub = onSnapshot(q, (snap) => {
        setStatusList(snap.docs.map(d => d.data()));
      });
      return () => unsub();
    }
  }, [activeTab]);

  const activeEmployees = SOURCE_DATA.filter(e => e.type === 'BACKFILL');
  const leaverEmployees = SOURCE_DATA.filter(e => e.type === 'LEAVER');

  const handleBackfillRow = async (emp) => {
    setResults(p => ({ ...p, [emp.emp_id]: { loading: true } }));
    try {
      const payload = {
        emp_id: emp.emp_id, full_name: emp.name, email: emp.email, role_id: emp.role_id,
        job_title: emp.job_title, nationality: 'Saudi', start_date: '2023-01-01', 
        contract_type: 'FULL_TIME', salary_sar: 0, emkan_assignment: false
      };
      const idToken = await auth.currentUser.getIdToken()
      const res = await fetch(BACKFILL_EMPLOYEE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
      setResults(p => ({ ...p, [emp.emp_id]: { success: true, link: data.consent_link, emailSent: data.email_sent, emailError: data.email_error } }));
    } catch (err) {
      setResults(p => ({ ...p, [emp.emp_id]: { error: err.message } }));
    }
  };

  const handleBackfillAll = async () => {
    setProcessing(true);
    for (const emp of activeEmployees) {
      if (!results[emp.emp_id]?.success) {
        await handleBackfillRow(emp);
      }
    }
    setProcessing(false);
  };

  const handleRecordLeaver = async (emp) => {
    const end_date = leaverDates[emp.emp_id];
    const reason = leaverReasons[emp.emp_id];
    if (!end_date || !reason) return alert("Select end date and reason");

    setResults(p => ({ ...p, [emp.emp_id]: { loading: true } }));
    try {
      const payload = {
        emp_id: emp.emp_id, full_name: emp.name, email: emp.email || 'N/A', 
        job_title: emp.job_title, start_date: '2023-01-01', end_date, reason
      };
      const idToken = await auth.currentUser.getIdToken()
      const res = await fetch(RECORD_LEAVER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
      setResults(p => ({ ...p, [emp.emp_id]: { success: true, msg: data.reminder } }));
    } catch (err) {
      setResults(p => ({ ...p, [emp.emp_id]: { error: err.message } }));
    }
  };

  return (
    <div style={s.page}>
      <h1 style={s.title}><UserPlus /> Employee Backfill & PDPL</h1>

      <div style={s.tabs}>
        <div style={s.tab(activeTab === 'BACKFILL')} onClick={() => setActiveTab('BACKFILL')}><Activity size={18}/> Active Employees</div>
        <div style={s.tab(activeTab === 'LEAVERS')} onClick={() => setActiveTab('LEAVERS')}><UserMinus size={18}/> Leavers</div>
        <div style={s.tab(activeTab === 'STATUS')} onClick={() => setActiveTab('STATUS')}><CheckCircle size={18}/> Status & Consent</div>
      </div>

      <div style={s.card}>
        {activeTab === 'BACKFILL' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
              <p style={{ color: '#94a3b8' }}>Migrate 13 active employees and send PDPL consent tokens.</p>
              <button style={s.btn('#1598CC')} onClick={handleBackfillAll} disabled={processing}>
                {processing ? <Loader size={16} className="spin" /> : <Mail size={16} />} Backfill All PENDING
              </button>
            </div>
            <table style={s.table}>
              <thead><tr><th style={s.th}>ID</th><th style={s.th}>Name</th><th style={s.th}>Role</th><th style={s.th}>Status</th><th style={s.th}>Action</th></tr></thead>
              <tbody>
                {activeEmployees.map(emp => {
                  const res = results[emp.emp_id];
                  return (
                    <tr key={emp.emp_id}>
                      <td style={s.td}>{emp.emp_id}</td>
                      <td style={s.td}>{emp.name}<br/><span style={{fontSize: '0.75rem', color: '#64748b'}}>{emp.email}</span></td>
                      <td style={s.td}>{emp.role_id}</td>
                      <td style={s.td}>
                        {res?.loading && <span style={s.badge('#fbbf24')}>Processing...</span>}
                        {res?.success && <><span style={s.badge('#4ade80')}>Consent Sent</span> {res.emailSent ? <span style={s.badge('#4ade80')}>✉ Email Sent</span> : <span style={s.badge('#fb923c')} title={res.emailError || 'unknown'}>✉ Email Failed</span>}</>}
                        {res?.error && <span style={s.badge('#fb923c')} title={res.error}>Failed</span>}
                        {!res && <span style={s.badge('#64748b')}>Pending</span>}
                      </td>
                      <td style={s.td}>
                        {!res?.success && (
                          <button style={s.btn('#1e293b')} onClick={() => handleBackfillRow(emp)} disabled={res?.loading}>
                            {res?.loading ? '...' : res?.error ? 'Retry' : 'Process'}
                          </button>
                        )}
                        {res?.success && (
                          <input style={{...s.input, width: 200, fontSize: '0.7rem'}} readOnly value={res.link} onClick={e => e.target.select()} />
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </>
        )}

        {activeTab === 'LEAVERS' && (
          <table style={s.table}>
            <thead><tr><th style={s.th}>ID</th><th style={s.th}>Name</th><th style={s.th}>End Date</th><th style={s.th}>Reason</th><th style={s.th}>Action</th></tr></thead>
            <tbody>
              {leaverEmployees.map(emp => {
                const res = results[emp.emp_id];
                return (
                  <tr key={emp.emp_id}>
                    <td style={s.td}>{emp.emp_id}</td>
                    <td style={s.td}>{emp.name}</td>
                    <td style={s.td}><input type="date" style={s.input} onChange={e => setLeaverDates(p => ({...p, [emp.emp_id]: e.target.value}))} /></td>
                    <td style={s.td}>
                      <select style={s.select} onChange={e => setLeaverReasons(p => ({...p, [emp.emp_id]: e.target.value}))}>
                        <option value="">Select Reason...</option>
                        <option value="RESIGNATION">Resignation</option>
                        <option value="TERMINATION">Termination</option>
                        <option value="END_OF_CONTRACT">End of Contract</option>
                      </select>
                    </td>
                    <td style={s.td}>
                      {res?.success ? (
                        <span style={s.badge('#4ade80')}>Recorded. {res.msg}</span>
                      ) : res?.error ? (
                        <span style={{color: '#fb923c', fontSize: '0.8rem'}}>{res.error}</span>
                      ) : (
                        <button style={s.btn('#EF5829')} onClick={() => handleRecordLeaver(emp)} disabled={res?.loading}>Record Leaver</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        {activeTab === 'STATUS' && (
          <table style={s.table}>
            <thead><tr><th style={s.th}>ID</th><th style={s.th}>Name</th><th style={s.th}>Consent State</th><th style={s.th}>Granted At</th></tr></thead>
            <tbody>
              {statusList.map(u => (
                <tr key={u.emp_id}>
                  <td style={s.td}>{u.emp_id}</td>
                  <td style={s.td}>{u.full_name}</td>
                  <td style={s.td}>
                    <span style={s.badge(u.pdpl_consent_state === 'GRANTED' ? '#4ade80' : u.pdpl_consent_state === 'PENDING' ? '#fbbf24' : '#ef4444')}>
                      {u.pdpl_consent_state}
                    </span>
                  </td>
                  <td style={s.td}>{u.pdpl_consent_granted_at?.toDate().toLocaleString() || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <style>{`.spin { animation: spin 1s linear infinite; } @keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
