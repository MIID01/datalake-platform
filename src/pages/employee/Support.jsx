import { useState, useEffect, useRef } from 'react'
import { collection, addDoc, query, where, onSnapshot, updateDoc, doc, serverTimestamp, orderBy, arrayUnion } from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, auth, storage } from '../../lib/firebase'
import { Plus, Send, CheckCircle, Clock, MessageSquare, X, AlertTriangle, Loader, Inbox, Paperclip } from 'lucide-react'

const CATEGORIES = ['Payroll / Salary', 'IT / Access Issues', 'Leave / HR', 'Contract / Legal', 'Client Conflict', 'Housing / Travel', 'Health & Safety', 'Other']
const PRIORITIES = ['Low', 'Medium', 'High', 'Critical']
const priorityColors = { Low: '#78909C', Medium: '#1598CC', High: '#F39C12', Critical: '#C0392B' }
const statusColors = { Open: '#F39C12', 'In Progress': '#1598CC', Resolved: '#34BF3A', Closed: '#78909C' }

export default function Support() {
  const [tickets, setTickets] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [activeTicket, setActiveTicket] = useState(null)
  const [reply, setReply] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState(null)
  const [form, setForm] = useState({ category: CATEGORIES[0], priority: 'Medium', subject: '', description: '' })
  const [attachment, setAttachment] = useState(null)
  const [userEmail, setUserEmail] = useState(null)
  const [userName, setUserName] = useState('')
  const fileInputRef = useRef(null)

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(user => {
      if (user) { setUserEmail(user.email); setUserName(user.displayName || user.email) }
    })
    return () => unsub()
  }, [])

  useEffect(() => {
    if (!userEmail) return
    const q = query(collection(db, 'support_tickets'), where('engineer_email', '==', userEmail))
    const unsub = onSnapshot(q, snap => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      data.sort((a, b) => (b.created_at?.seconds || 0) - (a.created_at?.seconds || 0))
      setTickets(data)
    }, err => console.warn('Tickets listener:', err.message))
    return () => unsub()
  }, [userEmail])

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type }); setTimeout(() => setToast(null), 4000)
  }

  const handleSubmit = async () => {
    if (!form.subject || form.subject.length < 5) { showToast('Subject must be at least 5 characters', 'error'); return }
    if (!form.description || form.description.length < 20) { showToast('Description must be at least 20 characters', 'error'); return }
    setSubmitting(true)
    try {
      const ticketNum = String(Math.floor(1000 + Math.random() * 9000))
      const ticketId = `TKT-${new Date().getFullYear()}-${ticketNum}`

      let attachmentUrl = null
      let attachmentName = null
      if (attachment) {
        const fileRef = ref(storage, `support_tickets/${ticketId}/${attachment.name}`)
        await uploadBytes(fileRef, attachment)
        attachmentUrl = await getDownloadURL(fileRef)
        attachmentName = attachment.name
      }

      await addDoc(collection(db, 'support_tickets'), {
        ticket_id: ticketId,
        category: form.category,
        priority: form.priority,
        subject: form.subject,
        description: form.description,
        attachment_url: attachmentUrl,
        attachment_name: attachmentName,
        status: 'Open',
        engineer_email: userEmail,
        engineer_name: userName,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
        assigned_to: null,
        resolved_at: null,
        thread: [{
          sender: 'user',
          text: form.description,
          author: userEmail,
          timestamp: new Date().toISOString(),
          attachment_url: attachmentUrl,
          attachment_name: attachmentName,
        }],
      })
      showToast(`Ticket ${ticketId} created successfully`)
      setForm({ category: CATEGORIES[0], priority: 'Medium', subject: '', description: '' })
      setAttachment(null)
      setShowForm(false)
    } catch (err) {
      showToast(`Failed: ${err.message}`, 'error')
    }
    setSubmitting(false)
  }

  const handleReply = async () => {
    if (!reply.trim() || !activeTicket) return
    setSubmitting(true)
    try {
      await updateDoc(doc(db, 'support_tickets', activeTicket.id), {
        thread: arrayUnion({
          sender: 'user',
          text: reply.trim(),
          author: userEmail,
          timestamp: new Date().toISOString(),
        }),
        updated_at: serverTimestamp(),
      })
      setReply('')
      showToast('Reply sent')
    } catch (err) {
      showToast(`Failed: ${err.message}`, 'error')
    }
    setSubmitting(false)
  }

  const fmtDate = (ts) => {
    if (!ts) return '—'
    const d = ts.toDate ? ts.toDate() : new Date(ts)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div>
      {toast && (
        <div className="animate-fade-in-up" style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          padding: '12px 20px', borderRadius: 10, fontSize: '0.85rem', fontWeight: 600,
          background: toast.type === 'error' ? 'rgba(192,57,43,0.95)' : 'rgba(52,191,58,0.95)',
          color: '#fff', boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          {toast.type === 'error' ? <AlertTriangle size={16} /> : <CheckCircle size={16} />} {toast.msg}
        </div>
      )}

      <div className="flex-between" style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Support Tickets</h1>
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
          <Plus size={16} /> New Ticket
        </button>
      </div>

      {/* New Ticket Form */}
      {showForm && (
        <div className="card animate-fade-in-up" style={{ marginBottom: 24 }}>
          <h3 style={{ marginBottom: 20 }}>Create Support Ticket</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div className="form-group">
              <label className="form-label">Category *</label>
              <select className="form-input" value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Priority</label>
              <select className="form-input" value={form.priority} onChange={e => setForm(p => ({ ...p, priority: e.target.value }))}>
                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group" style={{ marginBottom: 16 }}>
            <label className="form-label">Subject *</label>
            <input className="form-input" type="text" value={form.subject}
              onChange={e => setForm(p => ({ ...p, subject: e.target.value }))}
              placeholder="Brief summary (min 5 characters)" maxLength={120} />
          </div>
          <div className="form-group" style={{ marginBottom: 16 }}>
            <label className="form-label">Description *</label>
            <textarea className="form-input" rows={4} value={form.description}
              onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
              placeholder="Full details of your issue (min 20 characters)..." />
          </div>
          <div className="form-group" style={{ marginBottom: 16 }}>
            <label className="form-label">Attachment (Optional)</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={e => setAttachment(e.target.files[0])} />
              <button className="btn btn-outline" onClick={() => fileInputRef.current?.click()} disabled={submitting}>
                <Paperclip size={16} /> {attachment ? 'Change File' : 'Attach File'}
              </button>
              {attachment && <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{attachment.name}</span>}
              {attachment && <button className="btn-icon" onClick={() => setAttachment(null)}><X size={16} /></button>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
              {submitting ? <Loader size={16} className="spin" /> : <Send size={16} />}
              {submitting ? ' Submitting...' : ' Submit Ticket'}
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: activeTicket ? '400px 1fr' : '1fr', gap: 24 }}>
        {/* Ticket List */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {tickets.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-tertiary)' }}>
              <Inbox size={40} style={{ marginBottom: 12, opacity: 0.3 }} />
              <div style={{ fontWeight: 600, marginBottom: 4 }}>No tickets yet</div>
              <div style={{ fontSize: '0.82rem' }}>Create one using the button above</div>
            </div>
          ) : tickets.map(ticket => (
            <div key={ticket.id}
              style={{
                padding: '16px 20px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14,
                borderBottom: '1px solid var(--border-primary)',
                background: activeTicket?.id === ticket.id ? 'var(--bg-surface)' : 'transparent',
                transition: 'background 0.15s',
              }}
              onClick={() => setActiveTicket(ticket)}
            >
              <div style={{
                width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                background: `${statusColors[ticket.status]}15`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {ticket.status === 'Resolved' || ticket.status === 'Closed'
                  ? <CheckCircle size={16} color={statusColors[ticket.status]} />
                  : <Clock size={16} color={statusColors[ticket.status]} />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {ticket.subject}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginTop: 2 }}>
                  {ticket.ticket_id} · {ticket.category} · {fmtDate(ticket.created_at)}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                <span style={{
                  padding: '2px 8px', borderRadius: 10, fontSize: '0.65rem', fontWeight: 600,
                  background: `${priorityColors[ticket.priority]}15`, color: priorityColors[ticket.priority],
                }}>{ticket.priority}</span>
                <span style={{
                  padding: '2px 8px', borderRadius: 10, fontSize: '0.65rem', fontWeight: 600,
                  background: `${statusColors[ticket.status]}15`, color: statusColors[ticket.status],
                }}>{ticket.status}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Ticket Detail / Thread */}
        {activeTicket && (
          <div className="card animate-fade-in-up" style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--border-primary)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>{activeTicket.subject}</h3>
                  <div style={{ marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ padding: '2px 10px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600, background: 'rgba(21,152,204,0.12)', color: '#1598CC' }}>{activeTicket.category}</span>
                    <span style={{ padding: '2px 10px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600, background: `${priorityColors[activeTicket.priority]}15`, color: priorityColors[activeTicket.priority] }}>{activeTicket.priority}</span>
                    <span style={{ padding: '2px 10px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600, background: `${statusColors[activeTicket.status]}15`, color: statusColors[activeTicket.status] }}>{activeTicket.status}</span>
                  </div>
                </div>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
                  {activeTicket.ticket_id}
                </span>
              </div>
            </div>

            {/* Thread Messages */}
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
              {(activeTicket.thread || []).map((msg, i) => (
                <div key={i} style={{
                  display: 'flex',
                  justifyContent: msg.sender === 'user' ? 'flex-end' : 'flex-start',
                }}>
                  <div style={{ maxWidth: '80%' }}>
                    <div style={{
                      padding: '10px 14px', borderRadius: 12, fontSize: '0.85rem', lineHeight: 1.5,
                      background: msg.sender === 'user' ? 'rgba(21,152,204,0.12)' : 'var(--bg-surface)',
                      border: `1px solid ${msg.sender === 'user' ? 'rgba(21,152,204,0.2)' : 'var(--border-primary)'}`,
                    }}>
                      {msg.text}
                      {msg.attachment_url && (
                        <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--bg-base)', borderRadius: 8, border: '1px solid var(--border-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Paperclip size={14} color="var(--text-secondary)" />
                          <a href={msg.attachment_url} target="_blank" rel="noreferrer" style={{ fontSize: '0.8rem', color: '#1598CC', textDecoration: 'none', fontWeight: 600 }}>
                            {msg.attachment_name || 'View Attachment'}
                          </a>
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', marginTop: 4, textAlign: msg.sender === 'user' ? 'right' : 'left' }}>
                      {msg.timestamp ? new Date(msg.timestamp).toLocaleString() : ''} · {msg.sender === 'user' ? 'You' : msg.author || 'Support'}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Reply */}
            {activeTicket.status !== 'Closed' && (
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="form-input" style={{ flex: 1 }}
                  placeholder="Type a reply..."
                  value={reply}
                  onChange={e => setReply(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleReply()}
                />
                <button className="btn btn-primary" onClick={handleReply} disabled={submitting || !reply.trim()}>
                  <Send size={16} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
