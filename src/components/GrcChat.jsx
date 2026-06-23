import { useState, useRef, useEffect } from 'react'
import { Send, Sparkles, AlertTriangle, FileText } from 'lucide-react'
import { auth, GRC_ASSISTANT_CHAT_URL } from '../lib/firebase'

// Grounded GRC assistant chat. Every answer is produced server-side ONLY from the
// document corpus + audit/compliance logs, with citations; the agent says
// "Not found in the current library" when nothing grounds the answer. Read-only Q&A
// for any staff; proposals (if any) are surfaced for CEO/compliance_lead elsewhere.
export default function GrcChat({ compact = false }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const scrollRef = useRef(null)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, busy])

  const send = async () => {
    const q = input.trim()
    if (!q || busy) return
    setError('')
    const history = messages.map(m => ({ role: m.role, content: m.content }))
    const next = [...messages, { role: 'user', content: q }]
    setMessages(next)
    setInput('')
    setBusy(true)
    try {
      const idToken = await auth.currentUser.getIdToken()
      const res = await fetch(GRC_ASSISTANT_CHAT_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, history }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'The assistant is unavailable right now.')
      setMessages([...next, { role: 'assistant', content: data.answer || '(no answer)', citations: data.citations || [] }])
    } catch (err) {
      setError(err.message || 'The assistant is unavailable right now.')
      setMessages(next)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', height: compact ? 420 : 560, padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Sparkles size={18} style={{ color: 'var(--sky)' }} />
        <div>
          <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>GRC Compliance Assistant</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>Grounded in your documents &amp; logs — answers cite the source, or say it isn't in the library.</div>
        </div>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {messages.length === 0 && (
          <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text-tertiary)', maxWidth: 420 }}>
            <FileText size={40} style={{ opacity: 0.25, marginBottom: 12 }} />
            <p style={{ fontSize: '0.85rem' }}>Ask about a policy, what's overdue for review, the approval chain, or whether the library is audit-ready. Try:</p>
            <p style={{ fontSize: '0.82rem', color: 'var(--sky)', marginTop: 8 }}>“Which policies are overdue for review?”</p>
            <p style={{ fontSize: '0.82rem', color: 'var(--sky)' }}>“What does our access control policy say about MFA?”</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
            <div style={{
              padding: '10px 14px', borderRadius: 10, fontSize: '0.88rem', lineHeight: 1.5, whiteSpace: 'pre-wrap',
              background: m.role === 'user' ? 'var(--sky)' : 'rgba(0,0,0,0.25)',
              color: m.role === 'user' ? '#fff' : 'var(--text-primary)',
              border: m.role === 'user' ? 'none' : '1px solid var(--border-primary)',
            }}>
              {m.content}
            </div>
            {m.role === 'assistant' && Array.isArray(m.citations) && m.citations.length > 0 && (
              <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {m.citations.map((c, k) => (
                  <span key={k} style={{ fontSize: '0.7rem', fontFamily: 'monospace', color: 'var(--green)', background: 'rgba(52,191,58,0.1)', border: '1px solid rgba(52,191,58,0.3)', borderRadius: 5, padding: '2px 6px' }}>{c}</span>
                ))}
              </div>
            )}
          </div>
        ))}
        {busy && (
          <div style={{ alignSelf: 'flex-start', color: 'var(--text-tertiary)', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={14} className="spin" /> Checking the documents and logs…
          </div>
        )}
      </div>

      {error && (
        <div style={{ padding: '8px 16px', background: 'rgba(192,57,43,0.12)', color: '#ff6b6b', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 6 }}>
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      <div style={{ padding: 14, borderTop: '1px solid var(--border-primary)', display: 'flex', gap: 8 }}>
        <input
          type="text" value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          placeholder="Ask the GRC assistant…" disabled={busy}
          style={{ flex: 1, padding: '10px 14px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-primary)', borderRadius: 8, color: 'var(--text-primary)', outline: 'none' }}
        />
        <button className="btn btn-primary" onClick={send} disabled={busy || !input.trim()} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Send size={16} /> Ask
        </button>
      </div>
    </div>
  )
}
