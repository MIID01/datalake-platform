import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'

// ── Scorecard Cloud Function URLs (set after deploy) ──
const GET_SCORECARD_FORM_URL = 'https://getclientscorecardform-ifzodp5svq-wx.a.run.app'
const SUBMIT_SCORECARD_URL = 'https://submitclientscorecard-ifzodp5svq-wx.a.run.app'

const BRAND = {
  navy: '#022873',
  navyDeep: '#011a52',
  sky: '#1598CC',
  skyLight: '#3bb5e5',
  orange: '#EF5829',
  green: '#34BF3A',
  red: '#C0392B',
  white: '#FFFFFF',
  lightGray: '#F8F9FA',
  darkGray: '#333333',
  medGray: '#666666',
  bgDark: '#010e2b',
}

const recommendationLabels = {
  STRONG_HIRE: { label: 'Strong Hire', color: BRAND.green, icon: '🟢' },
  HIRE: { label: 'Hire', color: '#27ae60', icon: '🟡' },
  NO_HIRE: { label: 'No Hire', color: BRAND.orange, icon: '🟠' },
  STRONG_NO_HIRE: { label: 'Strong No Hire', color: BRAND.red, icon: '🔴' },
}

export default function ClientScorecard() {
  const { token } = useParams()
  const [state, setState] = useState('loading') // loading, form, submitting, success, error
  const [errorMsg, setErrorMsg] = useState('')
  const [formData, setFormData] = useState(null)
  const [scores, setScores] = useState({})
  const [recommendation, setRecommendation] = useState('')
  const [strengths, setStrengths] = useState('')
  const [concerns, setConcerns] = useState('')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (!token) { setState('error'); setErrorMsg('No scorecard token provided.'); return }
    loadForm()
  }, [token])

  async function loadForm() {
    try {
      const res = await fetch(`${GET_SCORECARD_FORM_URL}?token=${token}`)
      const data = await res.json()
      if (!res.ok) { setState('error'); setErrorMsg(data.error || 'Failed to load scorecard'); return }
      setFormData(data)
      setState('form')
    } catch (err) {
      setState('error')
      setErrorMsg('Unable to connect to the server. Please try again later.')
    }
  }

  function setScore(questionId, value) {
    setScores(prev => ({ ...prev, [questionId]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!recommendation) { alert('Please select an overall recommendation.'); return }

    setState('submitting')
    try {
      const res = await fetch(SUBMIT_SCORECARD_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          scores,
          overall_recommendation: recommendation,
          strengths,
          concerns,
          notes,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setState('form'); alert(data.error || 'Submission failed'); return }
      setState('success')
    } catch (err) {
      setState('form')
      alert('Failed to submit. Please check your connection and try again.')
    }
  }

  // ── Styles ──
  const pageStyle = {
    minHeight: '100vh',
    background: `linear-gradient(135deg, ${BRAND.bgDark} 0%, ${BRAND.navy} 40%, #0a3a9e 100%)`,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '32px 16px',
    fontFamily: "'Inter', 'DM Sans', sans-serif",
    color: BRAND.white,
  }
  const cardStyle = {
    background: 'rgba(2, 40, 115, 0.5)',
    border: '1px solid rgba(21, 152, 204, 0.2)',
    borderRadius: '14px',
    padding: '32px',
    maxWidth: '720px',
    width: '100%',
    marginBottom: '24px',
    backdropFilter: 'blur(12px)',
  }
  const headerStyle = {
    textAlign: 'center',
    marginBottom: '32px',
  }
  const h1Style = {
    fontSize: '1.8rem',
    fontWeight: 700,
    color: BRAND.white,
    margin: '12px 0 4px',
    fontFamily: "'Outfit', sans-serif",
  }
  const subtitleStyle = {
    color: 'rgba(255,255,255,0.6)',
    fontSize: '0.85rem',
    letterSpacing: '0.15em',
    textTransform: 'uppercase',
  }
  const categoryTitleStyle = {
    fontSize: '1rem',
    fontWeight: 700,
    color: BRAND.skyLight,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: '16px',
    paddingBottom: '8px',
    borderBottom: `1px solid rgba(21, 152, 204, 0.3)`,
  }
  const questionStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 0',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    gap: '16px',
  }
  const labelStyle = {
    flex: 1,
    fontSize: '0.9rem',
    color: 'rgba(255,255,255,0.85)',
    lineHeight: 1.4,
  }
  const ratingGroupStyle = {
    display: 'flex',
    gap: '4px',
    flexShrink: 0,
  }
  const textareaStyle = {
    width: '100%',
    padding: '12px 14px',
    borderRadius: '8px',
    border: '1px solid rgba(255,255,255,0.15)',
    background: 'rgba(255,255,255,0.06)',
    color: BRAND.white,
    fontSize: '0.9rem',
    fontFamily: 'inherit',
    minHeight: '80px',
    resize: 'vertical',
    outline: 'none',
    transition: 'border-color 0.2s',
  }
  const btnPrimary = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: '14px 32px',
    borderRadius: '8px',
    background: BRAND.sky,
    color: BRAND.white,
    fontSize: '1rem',
    fontWeight: 700,
    border: 'none',
    cursor: 'pointer',
    transition: 'all 0.2s',
    width: '100%',
  }

  // ── Loading state ──
  if (state === 'loading') {
    return (
      <div style={pageStyle}>
        <div style={cardStyle}>
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <div style={{ fontSize: '2rem', marginBottom: '16px', animation: 'pulse 1.5s infinite' }}>⏳</div>
            <p style={{ color: 'rgba(255,255,255,0.6)' }}>Loading scorecard...</p>
          </div>
        </div>
      </div>
    )
  }

  // ── Error state ──
  if (state === 'error') {
    return (
      <div style={pageStyle}>
        <div style={{ ...cardStyle, textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: '16px' }}>⚠️</div>
          <h2 style={{ color: BRAND.orange, marginBottom: '8px' }}>Unable to Load Scorecard</h2>
          <p style={{ color: 'rgba(255,255,255,0.6)', maxWidth: '400px', margin: '0 auto' }}>{errorMsg}</p>
        </div>
      </div>
    )
  }

  // ── Success state ──
  if (state === 'success') {
    return (
      <div style={pageStyle}>
        <div style={{ ...cardStyle, textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: '16px' }}>✅</div>
          <h2 style={{ color: BRAND.green, marginBottom: '8px', fontSize: '1.5rem' }}>Scorecard Submitted</h2>
          <p style={{ color: 'rgba(255,255,255,0.7)', maxWidth: '400px', margin: '0 auto', lineHeight: 1.6 }}>
            Thank you for your evaluation. Your scorecard has been securely recorded and will be reviewed by the Datalake team.
          </p>
          <div style={{ marginTop: '24px', padding: '12px', borderRadius: '8px', background: 'rgba(21, 152, 204, 0.1)', border: '1px solid rgba(21, 152, 204, 0.2)' }}>
            <p style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.4)' }}>
              This evaluation is processed under PDPL Art. 5 and is confidential.
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ── Form state ──
  const { schema, candidate_summary, project_summary, client_name } = formData

  return (
    <div style={pageStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '8px' }}>
          <span style={{ fontSize: '1.5rem', fontWeight: 800, color: BRAND.white, fontFamily: "'Outfit', sans-serif" }}>DATALAKE</span>
          <span style={{ fontSize: '1.5rem', color: BRAND.sky, fontFamily: "'Outfit', sans-serif" }}>IT</span>
        </div>
        <p style={subtitleStyle}>Interview Scorecard</p>
      </div>

      {/* Candidate Info */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', gap: '32px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Candidate</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: BRAND.white }}>{candidate_summary.name}</div>
            <div style={{ fontSize: '0.85rem', color: BRAND.skyLight }}>{candidate_summary.role}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Project</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: BRAND.white }}>{project_summary.name}</div>
            <div style={{ fontSize: '0.85rem', color: BRAND.skyLight }}>{project_summary.client}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Evaluator</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: BRAND.white }}>{client_name}</div>
          </div>
        </div>
      </div>

      {/* Scoring Form */}
      <form onSubmit={handleSubmit} style={{ maxWidth: '720px', width: '100%' }}>
        {schema.categories.map(cat => (
          <div key={cat.id} style={cardStyle}>
            <h3 style={categoryTitleStyle}>{cat.title}</h3>
            {cat.questions.map(q => (
              <div key={q.id} style={questionStyle}>
                <label style={labelStyle}>{q.label}</label>
                <div style={ratingGroupStyle}>
                  {[1, 2, 3, 4, 5].map(v => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setScore(q.id, v)}
                      style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '8px',
                        border: scores[q.id] === v ? `2px solid ${BRAND.sky}` : '1px solid rgba(255,255,255,0.15)',
                        background: scores[q.id] === v ? 'rgba(21, 152, 204, 0.3)' : 'rgba(255,255,255,0.04)',
                        color: scores[q.id] === v ? BRAND.white : 'rgba(255,255,255,0.5)',
                        fontSize: '0.85rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                      }}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}

        {/* Overall Recommendation */}
        <div style={cardStyle}>
          <h3 style={categoryTitleStyle}>Overall Recommendation</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px', marginBottom: '24px' }}>
            {Object.entries(recommendationLabels).map(([key, { label, color, icon }]) => (
              <button
                key={key}
                type="button"
                onClick={() => setRecommendation(key)}
                style={{
                  padding: '14px 16px',
                  borderRadius: '10px',
                  border: recommendation === key ? `2px solid ${color}` : '1px solid rgba(255,255,255,0.1)',
                  background: recommendation === key ? `${color}22` : 'rgba(255,255,255,0.03)',
                  color: recommendation === key ? color : 'rgba(255,255,255,0.6)',
                  fontSize: '0.9rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.15s',
                }}
              >
                {icon} {label}
              </button>
            ))}
          </div>

          {/* Text fields */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: '6px' }}>Key Strengths</label>
              <textarea
                style={textareaStyle}
                value={strengths}
                onChange={e => setStrengths(e.target.value)}
                placeholder="What stood out positively about the candidate?"
                onFocus={e => e.target.style.borderColor = BRAND.sky}
                onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.15)'}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: '6px' }}>Key Concerns</label>
              <textarea
                style={textareaStyle}
                value={concerns}
                onChange={e => setConcerns(e.target.value)}
                placeholder="Any areas of concern or gaps?"
                onFocus={e => e.target.style.borderColor = BRAND.sky}
                onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.15)'}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: '6px' }}>Additional Notes</label>
              <textarea
                style={textareaStyle}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Any other comments or observations..."
                onFocus={e => e.target.style.borderColor = BRAND.sky}
                onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.15)'}
              />
            </div>
          </div>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={state === 'submitting'}
          style={{
            ...btnPrimary,
            opacity: state === 'submitting' ? 0.6 : 1,
            marginBottom: '32px',
          }}
        >
          {state === 'submitting' ? '⏳ Submitting...' : '📋 Submit Scorecard'}
        </button>

        {/* Footer */}
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <p style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.3)' }}>
            PRIVATE & CONFIDENTIAL — PDPL Art. 5 · DTLK-ADR-002
          </p>
          <p style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.2)', marginTop: '4px' }}>
            Datalake Saudi Arabia LLC, Riyadh Al-Yarmouk 13243, CR:1009194773 NUN:7048904952
          </p>
        </div>
      </form>
    </div>
  )
}
