import { Link } from 'react-router-dom'
import { Home } from 'lucide-react'
import { LEGAL_FOOTER_EN } from '../lib/company-legal'

// Catch-all 404. Renders for any unmatched path so the SPA never shows a blank
// white screen. Links back to "/", which routes the visitor onward (LandingPage
// sends authenticated users to their portal home).
export default function NotFound() {
  return (
    <div style={{
      minHeight: '100vh', background: '#F4F6F9',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'DM Sans', 'Inter', Arial, sans-serif", padding: 24, textAlign: 'center',
    }}>
      <img src="/images/logo-dark.svg" alt="Datalake" style={{ height: 52, marginBottom: 32 }} />

      <div style={{ fontSize: '4rem', fontWeight: 800, color: '#022873', lineHeight: 1 }}>404</div>
      <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1A1A2E', margin: '12px 0 6px' }}>
        Page not found
      </h1>
      <p style={{ fontSize: '0.9rem', color: '#64748b', maxWidth: 420, margin: '0 0 24px' }}>
        The page you’re looking for doesn’t exist or may have moved. Check the address, or head back to a safe place.
      </p>

      <Link to="/" style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '11px 22px', borderRadius: 10, textDecoration: 'none',
        background: '#1598CC', color: '#fff', fontWeight: 600, fontSize: '0.9rem',
        boxShadow: '0 4px 14px rgba(21,152,204,0.3)',
      }}>
        <Home size={16} /> Back to home
      </Link>

      <div style={{ marginTop: 40, fontSize: '0.68rem', color: '#94a3b8' }}>{LEGAL_FOOTER_EN}</div>
    </div>
  )
}
