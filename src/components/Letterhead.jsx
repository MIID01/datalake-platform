import { LEGAL_FOOTER_EN } from '../lib/company-legal'
import '../styles/letterhead.css'

// Shared company letterhead for DOM-based exports (html2canvas → PDF) and
// browser print. Renders the Datalake color logo header on white + a 3-colour
// brand footer band above the canonical legal line. Wrap any printable/exported
// document body in <Letterhead>…</Letterhead>.
//
// Props:
//   title?    — optional document title shown beside the logo
//   meta?     — optional string[] of small meta lines (e.g. period, doc id)
//   docId?    — element id to expose for html2canvas / print capture
//   children  — the document body
export default function Letterhead({ title, meta = [], docId, className = '', children }) {
  return (
    <div id={docId} className={`letterhead-doc ${className}`}>
      <header className="letterhead-head">
        <img src="/images/logo-dark.svg" alt="Datalake" className="letterhead-logo" />
        {(title || meta.length > 0) && (
          <div className="letterhead-meta">
            {title && <div className="letterhead-title">{title}</div>}
            {meta.map((m, i) => <div key={i} className="letterhead-metaline">{m}</div>)}
          </div>
        )}
      </header>

      <div className="letterhead-body">{children}</div>

      <footer className="letterhead-foot">
        <div className="letterhead-band" aria-hidden="true">
          <span style={{ background: '#1598CC' }} />
          <span style={{ background: '#34BF3A' }} />
          <span style={{ background: '#EF5829' }} />
        </div>
        <div className="letterhead-legal">{LEGAL_FOOTER_EN}</div>
      </footer>
    </div>
  )
}
