import { useState } from 'react'
import { X } from 'lucide-react'

// Generic type-to-filter combobox.
//
// <SearchablePicker
//   items={engineers}
//   selectedId={form.engineer_id}
//   onSelect={(id, item) => u('engineer_id', id)}
//   getId={e => e.id}
//   getLabel={e => e.full_name || e.name || e.id}
//   getSubtitle={e => [e.employee_id, e.job_title, e.email].filter(Boolean).join(' · ')}
//   searchFields={e => [e.full_name, e.employee_id, e.email, e.job_title]}
//   placeholder="Type to search…"
//   theme="dark" | "light"
//   maxHeight={240}
// />
//
// Use this anywhere we have a list of 5+ items and the operator currently has
// to scroll through them (employees, engineers, projects, clients, …).

const THEMES = {
  dark: {
    input: {
      background: 'rgba(0,0,0,0.25)', color: '#fff',
      border: '1px solid rgba(255,255,255,0.15)',
    },
    placeholder: 'rgba(255,255,255,0.55)',
    dropdown: { background: '#0f1d36', border: '1px solid rgba(255,255,255,0.15)' },
    rowDivider: '1px solid rgba(255,255,255,0.05)',
    rowSelected: 'rgba(21,152,204,0.15)',
    subtitle: 'rgba(255,255,255,0.55)',
    clearColor: 'rgba(255,255,255,0.55)',
    primary: '#fff',
  },
  light: {
    input: {
      background: 'var(--bg-surface, #f4f6f9)',
      color: 'var(--text-primary, #1A1A2E)',
      border: '1px solid var(--border-primary, #E5E7EB)',
    },
    placeholder: 'var(--text-tertiary, #8898aa)',
    dropdown: { background: 'var(--bg-card, #fff)', border: '1px solid var(--border-primary, #E5E7EB)', boxShadow: '0 6px 18px rgba(0,0,0,0.08)' },
    rowDivider: '1px solid var(--border-primary, #f0f2f5)',
    rowSelected: 'rgba(21,152,204,0.10)',
    subtitle: 'var(--text-tertiary, #8898aa)',
    clearColor: 'var(--text-tertiary, #8898aa)',
    primary: 'var(--text-primary, #1A1A2E)',
  },
}

function norm(v) { return String(v ?? '').toLowerCase() }

export default function SearchablePicker({
  items = [],
  selectedId,
  onSelect,
  getId = (x) => x.id,
  getLabel = (x) => x.name || x.id,
  getSubtitle = () => '',
  searchFields = (x) => [x.name, x.email, x.id],
  placeholder = 'Type to search…',
  theme = 'dark',
  maxHeight = 240,
  disabled = false,
  emptyText = 'No matches.',
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const t = THEMES[theme] || THEMES.dark

  const selected = items.find(it => getId(it) === selectedId)
  const matches = q.trim()
    ? items.filter(it => {
        const term = norm(q.trim())
        return (searchFields(it) || []).some(f => norm(f).includes(term))
      })
    : items

  return (
    <div style={{ position: 'relative' }}>
      <input
        type="text"
        disabled={disabled}
        style={{
          width: '100%', padding: '9px 30px 9px 12px', borderRadius: 8,
          fontSize: '0.88rem', fontFamily: 'inherit',
          boxSizing: 'border-box', outline: 'none',
          ...t.input,
          cursor: disabled ? 'not-allowed' : 'text',
        }}
        placeholder={selected ? getLabel(selected) : placeholder}
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => !disabled && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {selected && !q && (
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); onSelect && onSelect('', null); setQ('') }}
          style={{ position: 'absolute', right: 8, top: 7, background: 'transparent', border: 'none', color: t.clearColor, cursor: 'pointer', padding: 4 }}
          title="Clear selection"
        ><X size={13} /></button>
      )}
      {open && !disabled && (
        <div
          style={{
            position: 'absolute', top: '100%', left: 0, right: 0,
            marginTop: 4, maxHeight, overflowY: 'auto',
            borderRadius: 8, zIndex: 50, ...t.dropdown,
          }}
        >
          {matches.length === 0 ? (
            <div style={{ padding: '12px 14px', color: t.placeholder, fontSize: '0.82rem' }}>
              {q ? `No matches for "${q}".` : emptyText}
            </div>
          ) : matches.map(it => {
            const id = getId(it)
            const isSel = id === selectedId
            return (
              <button
                key={id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onSelect && onSelect(id, it); setQ(''); setOpen(false) }}
                style={{
                  width: '100%', textAlign: 'left', padding: '10px 14px',
                  border: 'none', background: isSel ? t.rowSelected : 'transparent',
                  color: t.primary, cursor: 'pointer', fontFamily: 'inherit',
                  borderBottom: t.rowDivider,
                }}
              >
                <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{getLabel(it)}</div>
                {getSubtitle(it) && (
                  <div style={{ fontSize: '0.72rem', color: t.subtitle, marginTop: 2 }}>{getSubtitle(it)}</div>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
