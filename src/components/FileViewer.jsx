import { useState } from 'react'
import { Download, Printer, Mail, X, FileText, Image as ImageIcon } from 'lucide-react'

export default function FileViewer({ url, name, type, onClose, onEmail }) {
  const [loading, setLoading] = useState(true)

  const handlePrint = () => {
    const w = window.open(url)
    w.onload = () => {
      w.print()
    }
  }

  const isImage = type === 'image' || url?.match(/\.(jpeg|jpg|gif|png)$/i)
  const isPDF = type === 'pdf' || url?.match(/\.pdf$/i)

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(10px)', zIndex: 9999, display: 'flex', flexDirection: 'column' }}>
      {/* Top Bar */}
      <div style={{ height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', background: '#0a1628', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: '#fff' }}>
          {isImage ? <ImageIcon size={20} color="#38bdf8" /> : <FileText size={20} color="#fb7185" />}
          <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{name || 'Document Viewer'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <a 
            href={url} 
            download={name}
            style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#e2e8f0', textDecoration: 'none', fontSize: '0.85rem', padding: '6px 12px', borderRadius: 6, background: 'rgba(255,255,255,0.1)' }}
          >
            <Download size={16} /> Download
          </a>
          <button onClick={handlePrint} style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#e2e8f0', border: 'none', background: 'rgba(255,255,255,0.1)', fontSize: '0.85rem', padding: '6px 12px', borderRadius: 6, cursor: 'pointer' }}>
            <Printer size={16} /> Print
          </button>
          {onEmail && (
            <button onClick={() => onEmail(url, name)} style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#fff', border: 'none', background: '#1598CC', fontSize: '0.85rem', padding: '6px 12px', borderRadius: 6, cursor: 'pointer' }}>
              <Mail size={16} /> Email
            </button>
          )}
          <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.2)', margin: '0 8px' }} />
          <button onClick={onClose} style={{ color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', display: 'flex' }}>
            <X size={24} />
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, overflow: 'auto' }}>
        {loading && <div style={{ position: 'absolute', color: '#fff' }}>Loading document...</div>}
        
        {isImage ? (
          <img 
            src={url} 
            alt={name} 
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', boxShadow: '0 10px 40px rgba(0,0,0,0.5)', borderRadius: 8 }} 
            onLoad={() => setLoading(false)}
          />
        ) : isPDF ? (
          <iframe 
            src={`${url}#toolbar=0`} 
            title={name}
            style={{ width: '100%', height: '100%', maxWidth: 1000, border: 'none', background: '#fff', borderRadius: 8, boxShadow: '0 10px 40px rgba(0,0,0,0.5)' }}
            onLoad={() => setLoading(false)}
          />
        ) : (
          <div style={{ background: '#1e293b', padding: 40, borderRadius: 12, textAlign: 'center', color: '#e2e8f0' }}>
            <FileText size={48} color="#94a3b8" style={{ marginBottom: 16 }} />
            <div style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 8 }}>Preview not available</div>
            <div style={{ fontSize: '0.9rem', color: '#94a3b8', marginBottom: 24 }}>This file type cannot be previewed in the browser.</div>
            <a href={url} download={name} style={{ padding: '10px 24px', background: '#1598CC', color: '#fff', textDecoration: 'none', borderRadius: 8, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Download size={18} /> Download File
            </a>
          </div>
        )}
      </div>
    </div>
  )
}
