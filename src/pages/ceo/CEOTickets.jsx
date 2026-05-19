import { useState, useEffect } from 'react'
import { collection, query, onSnapshot, updateDoc, doc, serverTimestamp, arrayUnion } from 'firebase/firestore'
import { db, auth } from '../../lib/firebase'
import { CheckCircle, MessageSquare, Send, Clock } from 'lucide-react'

export default function CEOTickets() {
  const [tickets, setTickets] = useState([])
  const [activeTicket, setActiveTicket] = useState(null)
  const [reply, setReply] = useState('')

  useEffect(() => {
    const q = query(collection(db, 'support_tickets'))
    const unsub = onSnapshot(q, snap => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      data.sort((a, b) => (b.created_at?.seconds || 0) - (a.created_at?.seconds || 0))
      setTickets(data)
    })
    return () => unsub()
  }, [])

  const handleReply = async () => {
    if (!reply.trim() || !activeTicket) return
    try {
      await updateDoc(doc(db, 'support_tickets', activeTicket.id), {
        thread: arrayUnion({
          sender: 'support',
          text: reply.trim(),
          author: auth.currentUser?.email || 'CEO',
          timestamp: new Date().toISOString(),
        }),
        status: 'In Progress',
        updated_at: serverTimestamp(),
      })
      setReply('')
    } catch (err) {
      console.error(err)
    }
  }

  const handleResolve = async (id) => {
    try {
      await updateDoc(doc(db, 'support_tickets', id), {
        status: 'Resolved',
        resolved_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      })
      setActiveTicket(null)
    } catch (err) {
      console.error(err)
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 24 }}>Support Tickets</h1>
      <div style={{ display: 'grid', gridTemplateColumns: activeTicket ? '400px 1fr' : '1fr', gap: 24 }}>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {tickets.map(ticket => (
            <div key={ticket.id}
              style={{
                padding: '16px 20px', cursor: 'pointer',
                borderBottom: '1px solid var(--border-primary)',
                background: activeTicket?.id === ticket.id ? 'var(--bg-surface)' : 'transparent',
              }}
              onClick={() => setActiveTicket(ticket)}
            >
              <div style={{ fontWeight: 600 }}>{ticket.subject}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: 4 }}>
                {ticket.engineer_name} · {ticket.category} · {ticket.status}
              </div>
            </div>
          ))}
          {tickets.length === 0 && <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-tertiary)' }}>No tickets found</div>}
        </div>

        {activeTicket && (
          <div className="card" style={{ display: 'flex', flexDirection: 'column', height: '600px' }}>
            <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--border-primary)' }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 700 }}>{activeTicket.subject}</h2>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                From: {activeTicket.engineer_name} ({activeTicket.engineer_email})
              </div>
            </div>
            
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
              {(activeTicket.thread || []).map((msg, i) => (
                <div key={i} style={{
                  display: 'flex',
                  justifyContent: msg.sender === 'user' ? 'flex-start' : 'flex-end',
                }}>
                  <div style={{
                    maxWidth: '80%', padding: '10px 14px', borderRadius: 12, fontSize: '0.85rem',
                    background: msg.sender === 'user' ? 'var(--bg-surface)' : 'rgba(21,152,204,0.12)',
                    border: '1px solid var(--border-primary)'
                  }}>
                    {msg.text}
                    {msg.attachment_url && (
                      <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--bg-elevated)', borderRadius: 8, border: '1px solid var(--border-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <a href={msg.attachment_url} target="_blank" rel="noreferrer" style={{ fontSize: '0.8rem', color: '#1598CC', textDecoration: 'none', fontWeight: 600 }}>
                          {msg.attachment_name || 'View Attachment'}
                        </a>
                      </div>
                    )}
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', marginTop: 4 }}>
                      {msg.author || (msg.sender === 'user' ? activeTicket.engineer_name : 'Support')}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {activeTicket.status !== 'Resolved' && activeTicket.status !== 'Closed' ? (
              <div style={{ display: 'flex', gap: 8, flexDirection: 'column' }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input className="form-input" style={{ flex: 1 }}
                    placeholder="Type a reply..." value={reply}
                    onChange={e => setReply(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleReply()}
                  />
                  <button className="btn btn-primary" onClick={handleReply}><Send size={16} /></button>
                </div>
                <button className="btn btn-success" style={{ width: '100%', justifyContent: 'center' }} onClick={() => handleResolve(activeTicket.id)}>
                  Mark as Resolved
                </button>
              </div>
            ) : (
              <div style={{ padding: 12, background: 'rgba(52,191,58,0.1)', color: '#34BF3A', textAlign: 'center', borderRadius: 8, fontWeight: 600 }}>
                This ticket is resolved.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
