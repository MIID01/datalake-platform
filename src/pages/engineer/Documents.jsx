import { documents } from '../../data/mockEngineer'
import { FileText, Download, Pen, CheckCircle, Eye, Shield, Award, Lock, BookOpen } from 'lucide-react'

const categoryConfig = {
  employment: { icon: '📋', color: 'var(--steel-blue)', label: 'Employment Documents' },
  payslips: { icon: '💰', color: 'var(--green)', label: 'Payslips' },
  taxGosi: { icon: '🏛️', color: 'var(--amber)', label: 'Tax & GOSI' },
  policies: { icon: '📜', color: 'var(--navy)', label: 'Company Policies' },
  training: { icon: '🏅', color: 'var(--amber)', label: 'Training Certificates' },
}

export default function Documents() {
  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Documents</h1>
        <p style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem', marginTop: 4 }}>
          View, download, and sign your employment documents
        </p>
      </div>

      {Object.entries(documents).map(([category, docs]) => {
        const config = categoryConfig[category]
        if (!config) return null
        return (
          <div key={category} className="card animate-fade-in-up" style={{ marginBottom: 20, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-primary)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: '1.2rem' }}>{config.icon}</span>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{config.label}</h3>
              <span className="badge badge-neutral">{docs.length}</span>
            </div>
            <div>
              {docs.map(doc => (
                <div key={doc.id} className="doc-card" style={{ border: 'none', borderBottom: '1px solid var(--border-primary)', borderRadius: 0, padding: '14px 24px' }}>
                  <div className="doc-icon" style={{ background: `${config.color}15`, color: config.color }}>
                    <FileText size={20} />
                  </div>
                  <div className="doc-info">
                    <div className="doc-name">{doc.name}</div>
                    <div className="doc-meta">
                      {doc.date && new Date(doc.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                      {doc.type && ` · ${doc.type}`}
                    </div>
                  </div>
                  {doc.action === 'Sign Required' && (
                    <span className="badge badge-critical animate-pulse">⚠️ Signature Required</span>
                  )}
                  {doc.signed === true && (
                    <span className="badge badge-success"><CheckCircle size={12} /> Signed</span>
                  )}
                  {doc.acknowledged === true && (
                    <span className="badge badge-success"><CheckCircle size={12} /> Acknowledged</span>
                  )}
                  <div style={{ display: 'flex', gap: 6 }}>
                    {doc.action === 'Sign Required' ? (
                      <button className="btn btn-primary btn-sm"><Pen size={14} /> Sign Now</button>
                    ) : (
                      <>
                        <button className="btn btn-ghost btn-sm"><Eye size={14} /> View</button>
                        <button className="btn btn-ghost btn-sm"><Download size={14} /></button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })}

      {/* Compliance Forms */}
      <div className="card animate-fade-in-up" style={{ marginBottom: 20, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-primary)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: '1.2rem' }}>🛡️</span>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>Compliance Forms</h3>
        </div>
        {[
          { name: 'Conflict of Interest Disclosure', status: 'Not Submitted', action: 'Submit' },
          { name: 'Whistleblower Report (Anonymous)', status: null, action: 'Submit Report' },
        ].map((form, i) => (
          <div key={i} className="doc-card" style={{ border: 'none', borderBottom: '1px solid var(--border-primary)', borderRadius: 0, padding: '14px 24px' }}>
            <div className="doc-icon" style={{ background: 'var(--red-dim)', color: 'var(--red)' }}>
              <Shield size={20} />
            </div>
            <div className="doc-info">
              <div className="doc-name">{form.name}</div>
              {form.status && <div className="doc-meta">{form.status}</div>}
            </div>
            <button className="btn btn-ghost btn-sm">{form.action}</button>
          </div>
        ))}
      </div>
    </div>
  )
}
