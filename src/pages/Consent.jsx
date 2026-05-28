import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { GET_BACKFILL_CONSENT_URL, SUBMIT_BACKFILL_CONSENT_URL } from '../lib/firebase'
import { Shield, CheckCircle, AlertTriangle, Loader, ChevronRight } from 'lucide-react'

const s = {
  page: { padding: '40px 24px', maxWidth: 800, margin: '0 auto', minHeight: '100vh', background: '#0a1628', color: '#e2e8f0' },
  card: { background: '#111e33', borderRadius: 12, border: '1px solid #1e3050', padding: 32, marginBottom: 24 },
  h1: { fontSize: '1.8rem', fontWeight: 700, color: '#1598CC', marginBottom: 16 },
  h2: { fontSize: '1.2rem', fontWeight: 600, color: '#e2e8f0', marginBottom: 16, borderBottom: '1px solid #1e3050', paddingBottom: 8 },
  p: { fontSize: '0.9rem', color: '#94a3b8', lineHeight: 1.6, marginBottom: 16 },
  fieldRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #1e3050' },
  label: { fontSize: '0.85rem', fontWeight: 600, color: '#94a3b8' },
  value: { fontSize: '0.9rem', fontWeight: 600, color: '#e2e8f0' },
  input: { width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid #1e3050', background: '#0d1829', color: '#e2e8f0', marginTop: 8 },
  btn: (color) => ({ width: '100%', padding: '14px', borderRadius: 8, border: 'none', background: color, color: '#fff', fontWeight: 700, fontSize: '1rem', cursor: 'pointer', display: 'flex', justifyContent: 'center', gap: 10 }),
  checkRow: { display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  checkbox: { width: 18, height: 18, marginTop: 4, cursor: 'pointer' }
};

export default function Consent() {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [userData, setUserData] = useState(null);
  
  const [needsCorrection, setNeedsCorrection] = useState(false);
  const [correctionsText, setCorrectionsText] = useState('');
  
  const [details, setDetails] = useState({
    arabic_name: '', national_id: '', iqama_number: '', date_of_birth: '',
    contact_phone: '', iban: '', emergency_contact_name: '', emergency_contact_phone: ''
  });
  
  const [consents, setConsents] = useState([false, false, false, false]);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    fetch(GET_BACKFILL_CONSENT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    })
      .then(res => res.json().then(data => ({ res, data })))
      .then(({ res, data }) => {
        if (!res.ok) throw new Error(data.error || "Failed to load form");
        setUserData(data);
        setLoading(false);
      })
      .catch(err => { setError(err.message); setLoading(false); });
  }, [token]);

  const handleSubmit = async () => {
    if (consents.some(c => !c)) return alert("You must acknowledge all processing terms.");
    setSubmitting(true);
    try {
      const res = await fetch(SUBMIT_BACKFILL_CONSENT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token, data_confirmed_correct: !needsCorrection, corrections_text: correctionsText,
          ...details,
          consent_acknowledged: consents[0], consent_to_processing: consents[1],
          consent_to_ai_usage: consents[2], consent_to_monitoring: consents[3]
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Submission failed");
      setSuccess(true);
    } catch (err) {
      setError(err.message);
    }
    setSubmitting(false);
  };

  if (loading) return <div style={s.page}><Loader className="spin" /> Loading secure form...</div>;
  if (error) return <div style={s.page}><div style={s.card}><AlertTriangle color="#EF5829" size={48} /><h1 style={s.h1}>Link Invalid or Expired</h1><p style={s.p}>{error}</p></div></div>;
  if (success) return <div style={s.page}><div style={s.card}><CheckCircle color="#34BF3A" size={48} /><h1 style={{...s.h1, color: '#34BF3A'}}>Consent Recorded</h1><p style={s.p}>Thank you. Your data has been confirmed and consent recorded. You may now close this window and log in to the Datalake platform.</p></div></div>;

  return (
    <div style={s.page}>
      <div style={s.card}>
        <Shield color="#1598CC" size={40} style={{marginBottom: 16}} />
        <h1 style={s.h1}>Hello {userData.full_name.split(' ')[0]}</h1>
        <p style={s.p}>This secure form takes about 5 minutes. Please verify your data and provide your PDPL consent so we can set up your platform access.</p>
      </div>

      <div style={s.card}>
        <h2 style={s.h2}>1. Confirm your data</h2>
        <div style={s.fieldRow}><span style={s.label}>Full Name</span><span style={s.value}>{userData.full_name}</span></div>
        <div style={s.fieldRow}><span style={s.label}>Email</span><span style={s.value}>{userData.email}</span></div>
        <div style={s.fieldRow}><span style={s.label}>Job Title</span><span style={s.value}>{userData.job_title}</span></div>
        <div style={s.fieldRow}><span style={s.label}>Start Date</span><span style={s.value}>{userData.start_date}</span></div>
        
        <div style={{marginTop: 20}}>
          <label style={{display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', ...s.value}}>
            <input type="checkbox" checked={needsCorrection} onChange={e => setNeedsCorrection(e.target.checked)} style={{width: 16, height: 16}} />
            Some of this data is incorrect
          </label>
          {needsCorrection && (
            <textarea style={{...s.input, marginTop: 12, minHeight: 80}} placeholder="Please describe what needs to be corrected..." value={correctionsText} onChange={e => setCorrectionsText(e.target.value)} />
          )}
        </div>
      </div>

      <div style={s.card}>
        <h2 style={s.h2}>2. Additional details</h2>
        <p style={s.p}>All fields are optional but recommended for your HR profile.</p>
        <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16}}>
          <div><label style={s.label}>Arabic Name</label><input style={s.input} value={details.arabic_name} onChange={e => setDetails({...details, arabic_name: e.target.value})} /></div>
          <div><label style={s.label}>National ID / Iqama</label><input style={s.input} value={details.national_id} onChange={e => setDetails({...details, national_id: e.target.value})} /></div>
          <div><label style={s.label}>Date of Birth</label><input type="date" style={s.input} value={details.date_of_birth} onChange={e => setDetails({...details, date_of_birth: e.target.value})} /></div>
          <div><label style={s.label}>Contact Phone</label><input style={s.input} value={details.contact_phone} onChange={e => setDetails({...details, contact_phone: e.target.value})} /></div>
          <div style={{gridColumn: '1 / -1'}}><label style={s.label}>IBAN</label><input style={s.input} value={details.iban} onChange={e => setDetails({...details, iban: e.target.value})} /></div>
          <div><label style={s.label}>Emergency Contact Name</label><input style={s.input} value={details.emergency_contact_name} onChange={e => setDetails({...details, emergency_contact_name: e.target.value})} /></div>
          <div><label style={s.label}>Emergency Contact Phone</label><input style={s.input} value={details.emergency_contact_phone} onChange={e => setDetails({...details, emergency_contact_phone: e.target.value})} /></div>
        </div>
      </div>

      <div style={s.card}>
        <h2 style={s.h2}>3. Privacy & Processing Acknowledgement</h2>
        <div style={{...s.p, background: '#0d1829', padding: 16, borderRadius: 8, border: '1px solid #1e3050'}}>
          Datalake processes your personal data to manage your employment and client engagements:
          <ul style={{margin: '10px 0 10px 20px'}}>
            <li>Identification, contact, employment, and financial data — for HR, payroll, and statutory reporting</li>
            <li>Project and timesheet data — for client billing</li>
            <li>Platform usage data — for security monitoring</li>
            <li>AI-assisted processing — Datalake uses AI tools for CV formatting, scoring, and extracting fields from documents you upload. AI outputs are reviewed by a human before any decision about you.</li>
          </ul>
          All data stored exclusively in Saudi Arabia. No cross-border transfer.<br/><br/>
          Your rights are described in the Privacy Policy (DTLK-POL-PRI-001) and HR Policy (DTLK-POL-HRM-001), available in the platform after consent.
        </div>

        <div style={{marginTop: 20}}>
          {[
            "I have read and understood how Datalake processes my personal data",
            "I consent to processing for the purposes described",
            "I acknowledge AI tools may be used, with human review of outputs",
            "I acknowledge system usage may be logged and monitored"
          ].map((text, i) => (
            <label key={i} style={s.checkRow}>
              <input type="checkbox" style={s.checkbox} checked={consents[i]} onChange={e => {
                const newC = [...consents]; newC[i] = e.target.checked; setConsents(newC);
              }} />
              <span style={{...s.value, lineHeight: 1.4}}>{text}</span>
            </label>
          ))}
        </div>
      </div>

      <button style={s.btn(consents.every(c => c) ? '#1598CC' : '#1e3050')} disabled={!consents.every(c => c) || submitting} onClick={handleSubmit}>
        {submitting ? <Loader className="spin" /> : 'Submit Consent & Data'}
      </button>

      <style>{`.spin { animation: spin 1s linear infinite; } @keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
