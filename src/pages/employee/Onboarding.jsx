import { useState, useEffect, Component } from 'react'
import { useNavigate } from 'react-router-dom'
import { auth, db } from '../../lib/firebase'
import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, serverTimestamp } from 'firebase/firestore'
import { ChevronDown, CheckCircle, Lock, ShieldCheck } from 'lucide-react'

// Error boundary so a crash never shows a white page
class OnboardingErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(err) { return { error: err } }
  componentDidCatch(err, info) { console.error('[Onboarding] crash:', err, info) }
  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: '100vh', background: '#F4F6F9', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', flexDirection: 'column', gap: 16 }}>
          <h2 style={{ color: '#C0392B', margin: 0 }}>Something went wrong</h2>
          <p style={{ color: '#475569', maxWidth: 500 }}>{this.state.error.message}</p>
          <button onClick={() => window.location.reload()} style={{ padding: '10px 24px', borderRadius: 8, border: '1px solid #022873', background: '#022873', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Reload</button>
        </div>
      )
    }
    return this.props.children
  }
}

const NAVY = '#022873'
const SKY = '#1598CC'
const GREEN = '#34BF3A'
const BG = '#F4F6F9'

// ── Policy content (verbatim — DTLK-POL-PRI-001, PDPL Art.5, DTLK-POL-HRM-002, NCA ECC) ──
const ITEMS = [
  {
    item_id: 'privacy_policy',
    title: 'Privacy Policy — Data Processing Notice',
    ack: `I confirm that I have read and understood the Datalake Privacy Policy. I understand that my personal data is processed on Google Cloud Platform (me-central2, Dammam) for the purposes described above.`,
    blocks: [
      { h: `Datalake Saudi Arabia — Privacy Notice for Employees` },
      { p: `Document: DTLK-POL-PRI-001 | Version: 1.0 | Classification: Public` },
      { h: `1. About Datalake Saudi Arabia` },
      { p: `Datalake Saudi Arabia ("Datalake," "the Company") is a specialist data infrastructure and staff augmentation firm registered in Riyadh (CR: 109194773). Our primary business is identifying, deploying, and managing engineers at client sites.` },
      { h: `2. What personal data we collect` },
      { p: `To fulfill our employment obligations, we collect:` },
      { ul: [
        `Identification Data: Name, National ID/Iqama, passport details, photographs`,
        `Contact Data: Email address, phone number, residential address`,
        `Professional Data: CVs, employment history, educational qualifications, certifications`,
        `Financial Data: Bank account details for payroll processing`,
        `System Data: Authentication logs from Google Workspace and the Datalake platform`,
      ] },
      { h: `3. How we use your data` },
      { p: `We process personal data for:` },
      { ul: [
        `Managing your employment, assignment, and deployment to client sites`,
        `Processing payroll, GOSI contributions, and end-of-service benefits`,
        `Facilitating timesheets, leave management, and expense claims`,
        `Communicating with clients regarding your assignment`,
        `Complying with MHRSD, GOSI, ZATCA, and other regulatory requirements`,
      ] },
      { h: `4. Infrastructure and data storage` },
      { p: `All personal data is stored and processed on Google Cloud Platform (GCP) in the me-central2 region (Dammam, Saudi Arabia). Specifically:` },
      { ul: [
        `Firestore (database) — employee records, timesheets, leave requests`,
        `Google Cloud Storage — signed contracts, uploaded documents`,
        `BigQuery — audit logs and compliance records`,
      ] },
      { p: `All data remains within the Kingdom of Saudi Arabia. No cross-border transfer occurs without an approved data transfer mechanism.` },
      { p: `The Company uses self-hosted AI services (PaddleOCR and Qwen 2.5) for CV processing. These services run within the same GCP region and do not transmit data externally.` },
      { h: `5. Data sharing` },
      { p: `We share personal data only when:` },
      { ul: [
        `Required for your client assignment (professional profile shared with the client)`,
        `Required by Saudi authorities or law enforcement`,
        `Required for payroll, GOSI, or insurance processing`,
      ] },
      { p: `We do not sell personal data to third parties.` },
      { h: `6. Data retention` },
      { ul: [
        `Active employees: data retained for the duration of employment plus 10 years (per Labor Law and ZATCA requirements)`,
        `After termination: data retained for 2 years minimum, then purged unless a legal hold applies`,
      ] },
      { h: `7. Your rights under PDPL` },
      { p: `You have the right to:` },
      { ul: [
        `Know what data we hold about you (PDPL Art. 14)`,
        `Request correction of inaccurate data (PDPL Art. 15)`,
        `Request deletion when data is no longer needed (PDPL Art. 16)`,
        `Object to processing in certain circumstances`,
      ] },
      { p: `To exercise these rights, contact: m.alqumri@datalake.sa` },
      { h: `8. Approval` },
      { p: `This notice was approved by Mohammed Alqumri, CEO, Datalake Saudi Arabia.` },
      { p: `Effective Date: 22 May 2026` },
    ],
  },
  {
    item_id: 'pdpl_consent',
    title: 'Consent to Personal Data Processing (PDPL Article 5)',
    ack: `I freely and explicitly consent to the processing of my personal data by Datalake Saudi Arabia for the purposes described above, pursuant to PDPL Article 5. I understand that I may withdraw this consent at any time.`,
    blocks: [
      { h: `Consent Form — Personal Data Processing` },
      { p: `Pursuant to the Saudi Personal Data Protection Law (PDPL), Datalake Saudi Arabia requests your explicit consent for the processing of your personal data.` },
      { p: `Data Controller: Datalake Saudi Arabia, CR: 109194773, Riyadh 13243 Rajeeh Street` },
      { h: `Categories of personal data processed:` },
      { ul: [
        `Full name, National ID/Iqama number, contact details`,
        `Employment contract details, salary, GOSI registration`,
        `Timesheet records, leave history, expense claims`,
        `Project assignment and client deployment information`,
        `System authentication and access logs`,
      ] },
      { h: `Purposes of processing:` },
      { ol: [
        `Employment administration and contract management`,
        `Payroll processing, GOSI contributions, and WPS compliance`,
        `Project assignment, timesheet tracking, and client billing`,
        `Leave management and attendance tracking`,
        `Regulatory compliance (MHRSD, ZATCA, NCA, PDPL)`,
        `Internal audit and compliance monitoring`,
      ] },
      { p: `Lawful basis: Your consent (PDPL Article 5) and contractual necessity (employment contract)` },
      { p: `Data storage: Google Cloud Platform, me-central2 region (Dammam, Saudi Arabia). No cross-border transfer.` },
      { p: `Retention period: Duration of employment plus 10 years for financial/regulatory records; 2 years minimum for employment records after termination.` },
      { p: `Your right to withdraw: You may withdraw this consent at any time by contacting m.alqumri@datalake.sa. Withdrawal does not affect the lawfulness of processing performed before withdrawal. Note: withdrawal of consent may affect the Company's ability to fulfill its employment obligations.` },
    ],
  },
  {
    item_id: 'code_of_conduct',
    title: 'Employee Code of Conduct (DTLK-POL-HRM-002)',
    ack: `I confirm that I have read, understood, and agree to comply with the Datalake Employee Code of Conduct (DTLK-POL-HRM-002). I understand that violations may result in disciplinary action including termination under Article 80 of the Saudi Labour Law.`,
    blocks: [
      { h: `DTLK-POL-HRM-002 | Employee Code of Conduct | Version 1.0` },
      { h: `Preamble` },
      { p: `The purpose of this Code is to define the ethical and professional standards expected of every person representing Datalake Saudi Arabia ('the Company'). It sets out the conduct principles that govern our work relationships, client interactions, and decision-making processes.` },
      { p: `This Code applies equally to all employees, contractors, and consultants whether working onsite, offshore, or at client premises. It is rooted in Saudi Labour Law, the PDPL, and Datalake's corporate values of Integrity, Reliability, Innovation, and Respect.` },
      { h: `1. Commitment to Ethical Behaviour` },
      { p: `Datalake expects employees to conduct themselves with honesty, fairness, and professionalism. Every action must uphold the reputation of the Company and the trust of our clients and partners. Corruption, bribery, fraud, misrepresentation, or conflicts of interest are strictly prohibited.` },
      { p: `Employees shall not offer, solicit, or accept any benefit or gift that could influence or appear to influence business judgment. Any gift or entertainment exceeding SAR 500 must be declared to HR and logged in the Gifts and Hospitality Register.` },
      { h: `2. Professional Conduct and Respect` },
      { p: `All employees must treat colleagues, clients, and partners with dignity and respect. Harassment, discrimination, or any form of abusive behaviour is unacceptable. Professional appearance, communication, and punctuality are mandatory across all work environments, whether physical or digital. Conflicts or disagreements must be handled through constructive dialogue or escalation to line management. Retaliation against anyone who raises a concern in good faith will not be tolerated.` },
      { h: `2.1 Employee Representation and Dress Code` },
      { p: `As representatives of Datalake Saudi Arabia, employees are expected to present a professional, respectful, and culturally appropriate image reflecting both Company standards and the traditions of the Kingdom of Saudi Arabia.` },
      { h: `General Appearance:` },
      { ul: [
        `Employees shall maintain a clean, professional appearance during working hours, whether on-site, off-site, or at client locations.`,
        `Attire must be neat, modest, and free from inappropriate or political graphics.`,
        `Personal hygiene and grooming are essential to professional conduct.`,
      ] },
      { h: `Men's Dress Code:` },
      { ul: [
        `Saudi nationals are expected to wear formal Saudi attire (thoub and ghutra/shemagh) or a formal business suit, depending on the client environment.`,
        `Non-Saudi male employees shall wear business-formal attire — suit, dress shirt, and tie — or business-smart attire when authorised.`,
        `Jeans, T-shirts, sportswear, and open footwear are not permitted during working hours or at client events.`,
      ] },
      { h: `Women's Dress Code:` },
      { ul: [
        `Female employees must wear formal professional attire that complies with Saudi standards of modesty.`,
        `Clothing must be loose-fitting, covering arms and legs fully.`,
        `In public or client-facing environments, an abaya-style outerwear or modest blazer ensemble is recommended.`,
      ] },
      { h: `Special Events and Exceptions:` },
      { ul: [
        `For internal or team-building events, HR may authorise business-casual attire in advance.`,
        `Employees on international assignments may adapt to the host country's business standards while maintaining Datalake's professionalism.`,
      ] },
      { h: `Client-Facing Conduct:` },
      { ul: [
        `When at client sites, employees represent Datalake. Behave as if the CEO is in the room.`,
        `Follow the client's site-specific rules for access, security badges, visitor protocols, and working hours.`,
        `Do not discuss Datalake internal matters, other clients, or commercial terms with client staff.`,
        `Do not use client systems for personal purposes.`,
        `All communication with the client about your assignment, contract, or billing goes through the CEO — never directly discuss rates, contract terms, or extensions with client managers.`,
        `If a client asks you to do work outside your agreed scope, escalate to the CEO before accepting.`,
      ] },
      { h: `Representation and Behaviour:` },
      { ul: [
        `Employees must behave professionally in all contexts — meetings, conferences, or online forums.`,
        `Use of the Company name, logo, or email signature implies official representation and must be authorised.`,
        `Social media posts mentioning Datalake or its clients require prior approval.`,
      ] },
      { h: `3. Confidentiality and Data Protection` },
      { p: `Employees must protect all Company, client, and personal data per the Privacy Policy (DTLK-POL-PRI-001) and the PDPL. Information may not be disclosed or used for personal gain. These obligations remain in effect after employment ends.` },
      { h: `4. Conflict of Interest` },
      { p: `Employees shall avoid situations where personal interests conflict or appear to conflict with Company interests. Outside employment or self-dealing requires prior written approval from the CEO. Annual completion of the Conflict of Interest Declaration Form is mandatory.` },
      { h: `5. Compliance with Laws and Policies` },
      { p: `All employees must comply with Saudi laws and Company policies, including cybersecurity, data privacy, intellectual property, and safety. Violations may lead to disciplinary action up to termination under Article 80 of the Saudi Labour Law.` },
      { h: `6. Use of Company Assets` },
      { p: `Company property and systems must be used responsibly and only for authorised purposes. Misuse or damage is a disciplinary offence. System use is monitored under the Information Security Policy.` },
      { h: `7. Attendance and Accountability` },
      { p: `Employees must follow their assigned schedules and client-site attendance requirements. Unauthorised absence or repeated tardiness triggers disciplinary action under the Disciplinary Action Policy (DTLK-POL-HRM-004).` },
      { h: `8. Whistleblowing and Reporting Misconduct` },
      { p: `Employees are encouraged to report violations confidentially to the CEO or through the anonymous whistleblowing channel. Reports are investigated promptly and fairly, and retaliation is strictly prohibited.` },
      { h: `9. Enforcement and Sanctions` },
      { p: `Breaches of this Code are investigated through the disciplinary process. Sanctions may range from warnings to termination depending on severity. Serious or repeated violations may be reported to competent authorities.` },
      { h: `10. Acknowledgement` },
      { p: `All employees must acknowledge this Code of Conduct during onboarding. Refusal to acknowledge does not exempt from compliance.` },
    ],
  },
  {
    item_id: 'infosec_awareness',
    title: 'Information Security Awareness (NCA ECC Compliance)',
    ack: `I confirm that I have read and understand my information security obligations. I agree to comply with the Company's security requirements and to report any security incidents immediately.`,
    blocks: [
      { h: `Your Information Security Obligations` },
      { p: `As an employee of Datalake Saudi Arabia, you are required to comply with the National Cybersecurity Authority (NCA) Essential Cybersecurity Controls (ECC) and the Company's information security requirements.` },
      { h: `1. Access and Authentication` },
      { ul: [
        `Use only your authorized @datalake.sa Google Workspace account to access company systems`,
        `Enable Multi-Factor Authentication (MFA) on your Google account — this is mandatory, not optional`,
        `Do not share your login credentials with anyone, including colleagues`,
        `Lock your screen when stepping away from your workstation`,
        `Report any suspicious login attempts or unauthorized access immediately`,
      ] },
      { h: `2. Data Protection` },
      { ul: [
        `All client data is confidential. Do not copy, download, or transfer client data to personal devices or accounts`,
        `Do not use personal email, WhatsApp, or unauthorized cloud storage for company or client data`,
        `All documents containing personal or client data must be stored on the Datalake platform or Google Workspace — never on local storage`,
        `When your assignment ends, all client data must be returned or destroyed as directed`,
      ] },
      { h: `3. Device Security` },
      { ul: [
        `Keep your operating system and applications updated`,
        `Use only company-approved software`,
        `Do not connect to unsecured public Wi-Fi when accessing company systems — use a VPN`,
        `Report lost or stolen devices immediately to the CEO`,
      ] },
      { h: `4. Incident Reporting` },
      { ul: [
        `If you suspect a data breach, unauthorized access, or security incident, report it immediately to m.alqumri@datalake.sa`,
        `Do not attempt to investigate or contain a security incident yourself`,
        `The Company is required to notify SDAIA within 72 hours of a confirmed data breach (PDPL Article 19) — early reporting by employees is critical`,
      ] },
      { h: `5. Acceptable Use` },
      { ul: [
        `Company systems are for business use. Limited personal use is permitted but must not affect productivity or security`,
        `Do not access, download, or distribute inappropriate, illegal, or offensive content using company systems`,
        `All system activity may be monitored and logged for security and compliance purposes`,
      ] },
      { h: `6. Consequences` },
      { ul: [
        `Violations of these security obligations may result in disciplinary action under DTLK-POL-HRM-004`,
        `Serious violations (data theft, unauthorized disclosure, deliberate security bypass) may result in immediate termination under Article 80 of the Saudi Labour Law and referral to competent authorities`,
      ] },
    ],
  },
]

function PolicyBody({ blocks }) {
  return (
    <div style={{ fontSize: '0.9rem', lineHeight: 1.6, color: '#1f2937' }}>
      {blocks.map((b, i) => {
        if (b.h) return <h4 key={i} style={{ fontWeight: 700, color: NAVY, margin: '16px 0 6px' }}>{b.h}</h4>
        if (b.p) return <p key={i} style={{ margin: '0 0 10px' }}>{b.p}</p>
        if (b.ul) return <ul key={i} style={{ margin: '0 0 10px', paddingLeft: 22 }}>{b.ul.map((li, j) => <li key={j} style={{ marginBottom: 4 }}>{li}</li>)}</ul>
        if (b.ol) return <ol key={i} style={{ margin: '0 0 10px', paddingLeft: 22 }}>{b.ol.map((li, j) => <li key={j} style={{ marginBottom: 4 }}>{li}</li>)}</ol>
        return null
      })}
    </div>
  )
}

function OnboardingInner() {
  const navigate = useNavigate()
  const [profile, setProfile] = useState(null) // { uid, docId, email, name, emp_id }
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState(null)
  const [opened, setOpened] = useState(() => new Set())   // sections expanded at least once
  const [checked, setChecked] = useState(() => new Set()) // acknowledged item_ids
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (user) => {
      if (!user) { setLoading(false); return }
      try {
        let docId = user.uid
        let data = null
        const userEmail = user.email || ''
        const byUid = await getDoc(doc(db, 'users', user.uid))
        if (byUid.exists()) {
          data = byUid.data()
        } else if (userEmail) {
          const snap = await getDocs(query(collection(db, 'users'), where('email', '==', userEmail.toLowerCase())))
          if (!snap.empty) { docId = snap.docs[0].id; data = snap.docs[0].data() }
        }
        // Already onboarded → straight to dashboard
        if (data?.onboarding_complete === true) { navigate('/employee/dashboard', { replace: true }); return }
        setProfile({
          uid: user.uid,
          docId,
          email: userEmail,
          name: data?.full_name || data?.display_name || user.displayName || userEmail || 'Employee',
          emp_id: data?.employee_id || data?.emp_id || user.uid,
        })
      } catch (err) {
        console.error('[Onboarding] profile load error:', err)
        setError(err.message || 'Could not load your profile.')
      } finally {
        setLoading(false)
      }
    })
    return () => unsub()
  }, [navigate])

  const toggle = (id) => {
    setOpenId(prev => (prev === id ? null : id))
    setOpened(prev => new Set(prev).add(id))
  }

  const toggleCheck = (id) => {
    setChecked(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const handleSubmit = async () => {
    if (checked.size !== ITEMS.length || submitting || !profile) return
    setSubmitting(true)
    setError('')
    try {
      // One acknowledgment doc per item under the employee's onboarding subcollection
      await Promise.all(ITEMS.map(it =>
        setDoc(doc(db, 'employees', profile.emp_id, 'onboarding', it.item_id), {
          item_id: it.item_id,
          status: 'completed',
          completed_at: serverTimestamp(),
          employee_email: profile.email,
        })
      ))
      // Flip the gate flag on the user's own record
      await updateDoc(doc(db, 'users', profile.docId), {
        onboarding_complete: true,
        onboarding_completed_at: serverTimestamp(),
      })
      navigate('/employee/dashboard', { replace: true })
    } catch (err) {
      setError(err.message || 'Could not save your onboarding. Please try again.')
      setSubmitting(false)
    }
  }

  if (loading) {
    return <div style={{ minHeight: '100vh', background: BG, display: 'flex', alignItems: 'center', justifyContent: 'center', color: NAVY }}>Loading…</div>
  }
  if (!profile) {
    return <div style={{ minHeight: '100vh', background: BG, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#C0392B', padding: 24, textAlign: 'center' }}>{error || 'You must be signed in to complete onboarding.'}</div>
  }

  const completedCount = checked.size
  const pct = (completedCount / ITEMS.length) * 100
  const allDone = completedCount === ITEMS.length

  return (
    <div style={{ minHeight: '100vh', background: BG, fontFamily: "'DM Sans', Arial, sans-serif" }}>
      <style>{`@keyframes pop { 0% { transform: scale(0.4); opacity: 0 } 60% { transform: scale(1.15) } 100% { transform: scale(1); opacity: 1 } } .pop { animation: pop 0.28s ease-out }`}</style>

      {/* Navy header */}
      <header style={{ background: NAVY, color: '#fff', padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 14 }}>
        <img src="/images/logo-white.svg" alt="Datalake" style={{ height: 36 }} onError={(e) => { e.currentTarget.style.display = 'none' }} />
        <div style={{ fontWeight: 700, fontSize: '1.1rem', letterSpacing: '0.04em' }}>DATALAKE</div>
      </header>

      <main style={{ maxWidth: 820, margin: '0 auto', padding: '28px 16px 64px' }}>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: NAVY, margin: '0 0 4px' }}>Welcome to Datalake</h1>
        <p style={{ color: '#475569', margin: '0 0 4px' }}>{profile.name}</p>
        <p style={{ color: '#64748b', fontSize: '0.9rem', margin: '0 0 20px' }}>
          Please read and acknowledge all four policies below to activate your account.
        </p>

        {/* Progress */}
        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: '16px 18px', marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontWeight: 600, color: NAVY }}>{completedCount} of {ITEMS.length} completed</span>
            {allDone && <span style={{ color: GREEN, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6 }}><CheckCircle size={16} /> Ready</span>}
          </div>
          <div style={{ height: 8, background: '#E5E7EB', borderRadius: 999, overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: GREEN, borderRadius: 999, transition: 'width 0.35s ease' }} />
          </div>
        </div>

        {error && (
          <div style={{ background: 'rgba(192,57,43,0.1)', border: '1px solid rgba(192,57,43,0.3)', color: '#C0392B', borderRadius: 10, padding: '12px 16px', marginBottom: 16, fontSize: '0.88rem' }}>{error}</div>
        )}

        {/* Accordions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {ITEMS.map((it) => {
            const isOpen = openId === it.item_id
            const wasOpened = opened.has(it.item_id)
            const isChecked = checked.has(it.item_id)
            return (
              <section key={it.item_id} style={{ background: '#fff', border: `1px solid ${isChecked ? GREEN : '#E5E7EB'}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
                <button
                  onClick={() => toggle(it.item_id)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '16px 18px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                >
                  <span style={{ flexShrink: 0 }}>
                    {isChecked
                      ? <CheckCircle className="pop" size={22} color={GREEN} />
                      : <span style={{ width: 22, height: 22, borderRadius: '50%', border: '2px solid #CBD5E1', display: 'inline-block' }} />}
                  </span>
                  <span style={{ flex: 1, fontWeight: 700, color: NAVY }}>{it.title}</span>
                  <ChevronDown size={18} color="#64748b" style={{ transition: 'transform 0.2s', transform: isOpen ? 'rotate(180deg)' : 'none', flexShrink: 0 }} />
                </button>

                {isOpen && (
                  <div style={{ padding: '0 18px 16px', borderTop: '1px solid #EEF2F6' }}>
                    <div style={{ maxHeight: 360, overflowY: 'auto', padding: '14px 4px 4px' }}>
                      <PolicyBody blocks={it.blocks} />
                    </div>
                  </div>
                )}

                <label
                  style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '14px 18px', borderTop: '1px solid #EEF2F6', background: wasOpened ? '#F8FAFC' : '#F1F5F9', cursor: wasOpened ? 'pointer' : 'not-allowed', opacity: wasOpened ? 1 : 0.6 }}
                  title={wasOpened ? '' : 'Open and read the policy first'}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    disabled={!wasOpened}
                    onChange={() => toggleCheck(it.item_id)}
                    style={{ marginTop: 3, width: 18, height: 18, accentColor: SKY, flexShrink: 0 }}
                  />
                  <span style={{ fontSize: '0.86rem', color: '#334155', display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                    {!wasOpened && <Lock size={14} style={{ marginTop: 2, color: '#94a3b8', flexShrink: 0 }} />}
                    {it.ack}
                  </span>
                </label>
              </section>
            )
          })}
        </div>

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={!allDone || submitting}
          style={{
            marginTop: 24, width: '100%', padding: '15px', borderRadius: 12, border: 'none',
            background: allDone && !submitting ? NAVY : '#94a3b8', color: '#fff', fontWeight: 700, fontSize: '1rem',
            cursor: allDone && !submitting ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
        >
          <ShieldCheck size={18} /> {submitting ? 'Saving…' : 'Complete Onboarding'}
        </button>
      </main>
    </div>
  )
}

export default function Onboarding() {
  return (
    <OnboardingErrorBoundary>
      <OnboardingInner />
    </OnboardingErrorBoundary>
  )
}
