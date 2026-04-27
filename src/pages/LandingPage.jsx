import { useNavigate } from 'react-router-dom'
import '../styles/ceo.css'

export default function LandingPage() {
  const navigate = useNavigate()

  return (
    <div className="landing-page">
      <div className="landing-logo animate-fade-in-up">
        <img 
          src="/images/logo-white.svg" 
          alt="Datalake — Analytics Data Technology" 
          style={{ height: 80, marginBottom: 8 }}
        />
      </div>

      <div className="portal-cards" style={{ gridTemplateColumns: 'repeat(6, 1fr)', maxWidth: 1700 }}>
        <div
          className="portal-card ceo animate-fade-in-up stagger-1"
          onClick={() => navigate('/ceo')}
          role="button"
          tabIndex={0}
          id="portal-select-ceo"
        >
          <div className="portal-icon">⚡</div>
          <h2>CEO Command Center</h2>
          <p>Executive cockpit — approvals, pipeline, finance, AI ops, and task inbox.</p>
          <span className="portal-url">ceo.datalake.sa</span>
        </div>

        <div
          className="portal-card engineer animate-fade-in-up stagger-2"
          onClick={() => navigate('/cto')}
          role="button"
          tabIndex={0}
          id="portal-select-cto"
          style={{ '--accent': '#34BF3A' }}
        >
          <div className="portal-icon">🎯</div>
          <h2>CTO Portal</h2>
          <p>Timesheet approvals, project oversight, and operational review.</p>
          <span className="portal-url">cto.datalake.sa</span>
        </div>

        <div
          className="portal-card engineer animate-fade-in-up stagger-3"
          onClick={() => navigate('/portal')}
          role="button"
          tabIndex={0}
          id="portal-select-engineer"
        >
          <div className="portal-icon">👤</div>
          <h2>Engineer Portal</h2>
          <p>Timesheets, leave, expenses, documents, training — zero email required.</p>
          <span className="portal-url">portal.datalake.sa</span>
        </div>

        <div
          className="portal-card engineer animate-fade-in-up stagger-3"
          onClick={() => navigate('/client')}
          role="button"
          tabIndex={0}
          id="portal-select-client"
          style={{ '--accent': '#E8913A' }}
        >
          <div className="portal-icon">🏢</div>
          <h2>Client Portal</h2>
          <p>Approve monthly timesheets and sign off on project hours with e-signature.</p>
          <span className="portal-url">client.datalake.sa</span>
        </div>

        <div
          className="portal-card engineer animate-fade-in-up stagger-4"
          onClick={() => navigate('/hr')}
          role="button"
          tabIndex={0}
          id="portal-select-hr"
          style={{ '--accent': '#8e44ad' }}
        >
          <div className="portal-icon">📋</div>
          <h2>HR Scoring</h2>
          <p>7-criterion interview scorecard per DTLK-OPS-PRC-002.</p>
          <span className="portal-url">hr.datalake.sa</span>
        </div>

        <div
          className="portal-card engineer animate-fade-in-up stagger-4"
          onClick={() => navigate('/careers')}
          role="button"
          tabIndex={0}
          id="portal-select-careers"
          style={{ '--accent': '#34BF3A' }}
        >
          <div className="portal-icon">🚀</div>
          <h2>Careers</h2>
          <p>Public job listings with PDPL-compliant consent capture and CV intake.</p>
          <span className="portal-url">datalake.sa/careers</span>
        </div>
      </div>
    </div>
  )
}
