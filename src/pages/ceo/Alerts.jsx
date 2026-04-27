import { useState } from 'react'
import { notifications } from '../../data/mockCEO'
import { Bell, AlertTriangle, Info, CheckCircle, Filter, Eye } from 'lucide-react'

const priorityConfig = {
  critical: { color: 'var(--red)', bg: 'var(--red-dim)', icon: '🔴', label: 'CRITICAL' },
  high: { color: 'var(--amber)', bg: 'var(--amber-dim, var(--warning-dim))', icon: '🟠', label: 'HIGH' },
  normal: { color: 'var(--sky-blue)', bg: 'var(--sky-blue-dim)', icon: '🔵', label: 'NORMAL' },
  low: { color: 'var(--text-tertiary)', bg: 'var(--bg-surface)', icon: '⚪', label: 'LOW' },
}

export default function Alerts() {
  const [items, setItems] = useState(notifications)
  const [filter, setFilter] = useState('All')

  const filtered = filter === 'All' ? items : items.filter(n => n.priority === filter.toLowerCase())
  const unreadCount = items.filter(n => !n.read).length

  const markRead = (id) => {
    setItems(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
  }

  return (
    <div>
      <div className="flex-between" style={{ marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Alerts & Logs</h1>
          <p style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem', marginTop: 4 }}>
            {unreadCount} unread notifications
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {['All', 'Critical', 'High', 'Normal', 'Low'].map(f => (
            <button key={f} className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFilter(f)}>{f}</button>
          ))}
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {filtered.map(n => {
          const config = priorityConfig[n.priority]
          return (
            <div
              key={n.id}
              className="approval-item"
              style={{
                background: !n.read ? 'var(--bg-surface)' : 'transparent',
                borderLeft: `3px solid ${config.color}`,
                opacity: n.read ? 0.7 : 1,
              }}
              onClick={() => markRead(n.id)}
            >
              <div className="approval-icon" style={{ background: config.bg, fontSize: '1rem' }}>
                {config.icon}
              </div>
              <div className="approval-info">
                <div className="approval-title" style={{ fontWeight: n.read ? 500 : 700 }}>{n.title}</div>
                <div className="approval-meta">{n.desc}</div>
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{n.time}</span>
              <span className={`badge`} style={{ background: config.bg, color: config.color, minWidth: 60, textAlign: 'center' }}>{config.label}</span>
              {!n.read && <span style={{ width: 8, height: 8, borderRadius: '50%', background: config.color, flexShrink: 0 }} />}
            </div>
          )
        })}
        {filtered.length === 0 && (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-tertiary)' }}>
            <Bell size={32} style={{ marginBottom: 8, opacity: 0.3 }} />
            <div>No notifications in this category</div>
          </div>
        )}
      </div>
    </div>
  )
}
