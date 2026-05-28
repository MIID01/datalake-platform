import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'

const RECORD_SIGNATURE_URL = 'https://recordsignature-ifzodp5svq-wx.a.run.app'

const BRAND = {
  navy: '#022873', sky: '#1598CC', skyLight: '#3bb5e5', orange: '#EF5829',
  green: '#34BF3A', white: '#FFFFFF', bgDark: '#010e2b', medGray: '#666666',
}

export default function ContractAcceptance() {
  const { token } = useParams()
  const [state, setState] = useState('loading')
  const [error, setError] = useState('')
  const [contract, setContract] = useState(null)
  const [nameConfirm, setNameConfirm] = useState('')
  const [agreed, setAgreed] = useState(false)

  useEffect(() => {
    if (!token) { setState('error'); setError('No contract token.'); return }
    fetch(`${RECORD_SIGNATURE_URL}?token=${token}`)
      .then(r => r.json().then(d => r.ok ? d : Promise.reject(d)))
      .then(d => { setContract(d); setState('review') })
      .catch(e => { setState('error'); setError(e.error || 'Failed to load contract') })
  }, [token])

  async function handleAccept(e) {
    e.preventDefault()
    if (!agreed || !nameConfirm.trim()) return
    setState('submitting')
    try {
      const res = await fetch(RECORD_SIGNATURE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, full_name_confirmation: nameConfirm.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { setState('review'); alert(data.error); return }
      setState('success')
    } catch { setState('review'); alert('Failed to submit. Try again.') }
  }

  const page = {
    minHeight: '100vh', fontFamily: "'Inter', sans-serif", color: BRAND.white,
    background: `linear-gradient(135deg, ${BRAND.bgDark} 0%, ${BRAND.navy} 50%, #0a3a9e 100%)`,
    display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 16px',
  }
  const card = {
    background: 'rgba(2,40,115,0.5)', border: '1px solid rgba(21,152,204,0.2)',
    borderRadius: 14, padding: 32, maxWidth: 720, width: '100%', marginBottom: 24,
    backdropFilter: 'blur(12px)',
  }

  if (state === 'loading') return <div style={page}><div style={card}><p style={{textAlign:'center',color:'rgba(255,255,255,0.6)'}}>Loading contract...</p></div></div>
  if (state === 'error') return <div style={page}><div style={{...card,textAlign:'center'}}><div style={{fontSize:'3rem',marginBottom:16}}>⚠️</div><h2 style={{color:BRAND.orange}}>{error}</h2></div></div>
  if (state === 'success') return (
    <div style={page}>
      <div style={{...card,textAlign:'center'}}>
        <div style={{fontSize:'3rem',marginBottom:16}}>✅</div>
        <h2 style={{color:BRAND.green,fontSize:'1.5rem',marginBottom:8}}>Contract Accepted</h2>
        <p style={{color:'rgba(255,255,255,0.7)',maxWidth:400,margin:'0 auto',lineHeight:1.6}}>
          Welcome to Datalake Saudi Arabia LLC. Your account will be provisioned shortly and you will receive a welcome email.
        </p>
      </div>
    </div>
  )

  return (
    <div style={page}>
      <div style={{textAlign:'center',marginBottom:24}}>
        <span style={{fontSize:'1.5rem',fontWeight:800}}>DATALAKE</span>{' '}
        <span style={{fontSize:'1.5rem',color:BRAND.sky}}>IT</span>
        <p style={{color:'rgba(255,255,255,0.5)',fontSize:'0.8rem',letterSpacing:'0.1em',textTransform:'uppercase'}}>Employment Contract</p>
      </div>

      <div style={card}>
        <div style={{display:'flex',gap:32,flexWrap:'wrap',marginBottom:24}}>
          {[
            ['Candidate', contract.candidate_name],
            ['Project', contract.project_name],
            ['Client', contract.client_name],
            ['Salary', `SAR ${Number(contract.salary_monthly).toLocaleString()}/mo`],
            ['Start', contract.start_date],
            ['Duration', `${contract.duration_months} months`],
          ].map(([l,v]) => (
            <div key={l}>
              <div style={{fontSize:'0.65rem',color:'rgba(255,255,255,0.4)',textTransform:'uppercase',letterSpacing:'0.1em'}}>{l}</div>
              <div style={{fontSize:'1rem',fontWeight:600}}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{...card,maxHeight:500,overflowY:'auto'}}>
        <h3 style={{color:BRAND.skyLight,fontSize:'1rem',marginBottom:16,textTransform:'uppercase',letterSpacing:'0.05em'}}>Contract Terms</h3>
        <div style={{whiteSpace:'pre-wrap',fontSize:'0.85rem',lineHeight:1.7,color:'rgba(255,255,255,0.85)'}}>
          {contract.contract_text}
        </div>
      </div>

      <form onSubmit={handleAccept} style={{maxWidth:720,width:'100%'}}>
        <div style={card}>
          <label style={{display:'flex',gap:12,alignItems:'flex-start',cursor:'pointer',marginBottom:20}}>
            <input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)} style={{marginTop:4,width:18,height:18,accentColor:BRAND.sky}} />
            <span style={{fontSize:'0.85rem',color:'rgba(255,255,255,0.8)',lineHeight:1.5}}>
              I have read and understood the terms of this employment contract. By typing my full name and clicking Accept, I agree to the terms and conditions. I understand that Nafath e-signature will be implemented in a future phase; this click-to-accept serves as my interim digital acceptance.
            </span>
          </label>
          <div style={{marginBottom:16}}>
            <label style={{fontSize:'0.75rem',color:'rgba(255,255,255,0.5)',display:'block',marginBottom:6}}>Type your full name to confirm</label>
            <input type="text" value={nameConfirm} onChange={e=>setNameConfirm(e.target.value)}
              placeholder={contract.candidate_name}
              style={{width:'100%',padding:'12px 14px',borderRadius:8,border:'1px solid rgba(255,255,255,0.15)',background:'rgba(255,255,255,0.06)',color:BRAND.white,fontSize:'1rem',fontFamily:'inherit',outline:'none'}}
            />
          </div>
          <button type="submit" disabled={!agreed||!nameConfirm.trim()||state==='submitting'}
            style={{width:'100%',padding:'14px',borderRadius:8,background:agreed&&nameConfirm.trim()?BRAND.green:'rgba(255,255,255,0.1)',color:BRAND.white,fontSize:'1rem',fontWeight:700,border:'none',cursor:agreed&&nameConfirm.trim()?'pointer':'not-allowed',transition:'all 0.2s'}}>
            {state==='submitting'?'Submitting...':'✓ Accept Contract'}
          </button>
        </div>
        <p style={{textAlign:'center',fontSize:'0.68rem',color:'rgba(255,255,255,0.25)',marginBottom:8}}>
          PDPL Art. 5 · IP address logged · DTLK-FORM-HRM-001
        </p>
        <p style={{textAlign:'center',fontSize:'0.68rem',color:'rgba(255,255,255,0.3)',marginBottom:4}}>
          Datalake Saudi Arabia LLC, Riyadh Al-Yarmouk 13243, CR:1009194773 NUN:7048904952
        </p>
        <p style={{textAlign:'center',fontSize:'0.68rem',color:'rgba(255,255,255,0.25)',marginBottom:32,direction:'rtl'}} lang="ar">
          شركة بحيرة البيانات للاستشارات في مجال الاتصالات وتقنية المعلومات · شركة ذات مسؤولية محدودة (LLC)
        </p>
      </form>
    </div>
  )
}
