import { engineerProfile } from '../../data/mockEngineer'
import { User, Shield, Download, Trash2, Edit2, Plus } from 'lucide-react'

export default function Profile() {
  const p = engineerProfile

  const sections = [
    {
      title: '👤 Personal Information',
      fields: [
        { l: 'Full Name', v: p.name },
        { l: 'Employee ID', v: p.employeeId, mono: true },
        { l: 'Email', v: p.email },
        { l: 'Phone', v: p.phone, editable: true },
        { l: 'Nationality', v: p.nationality },
      ],
    },
    {
      title: '📋 Contract Information',
      fields: [
        { l: 'Client', v: p.client },
        { l: 'Role', v: p.role },
        { l: 'Contract Start', v: p.contractStart },
        { l: 'Contract End', v: p.contractEnd },
        { l: 'Contract Type', v: p.contractType },
        // PO Number stripped — confidential project commercial data
      ],
    },
    {
      title: '💰 Financial Information',
      fields: [
        { l: 'Base Salary', v: p.baseSalary },
        { l: 'Bank', v: p.bankName },
        { l: 'GOSI Number', v: p.gosiNumber, mono: true },
      ],
    },
    {
      title: '🆘 Emergency Contact',
      editable: true,
      fields: [
        { l: 'Name', v: p.emergencyContact.name, editable: true },
        { l: 'Relationship', v: p.emergencyContact.relationship, editable: true },
        { l: 'Phone', v: p.emergencyContact.phone, editable: true },
      ],
    },
  ]

  return (
    <div>
      <div className="flex-between" style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>My Profile</h1>
      </div>

      {/* Profile Header */}
      <div className="card animate-fade-in-up" style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 20 }}>
        <div style={{
          width: 72, height: 72, borderRadius: '50%',
          background: 'linear-gradient(135deg, var(--steel-blue), var(--navy))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'white', fontSize: '1.5rem', fontWeight: 800, fontFamily: 'var(--font-heading)',
        }}>
          MA
        </div>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: '1.3rem', fontWeight: 700 }}>{p.name}</h2>
          <p style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>{p.role} · {p.client}</p>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: 4 }}>{p.employeeId} · {p.email}</p>
        </div>
        <button className="btn btn-ghost btn-sm"><Edit2 size={14} /> Edit Photo</button>
      </div>

      {/* Info Sections */}
      {sections.map((section, si) => (
        <div key={si} className={`profile-section animate-fade-in-up stagger-${si + 1}`}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: 16 }}>{section.title}</h3>
          {section.fields.map((field, fi) => (
            <div key={fi} className="profile-field">
              <span className="field-label">{field.l}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="field-value" style={{ fontFamily: field.mono ? 'var(--font-mono)' : 'inherit' }}>{field.v}</span>
                {field.editable && <button className="btn-icon" style={{ color: 'var(--text-tertiary)', width: 28, height: 28 }}><Edit2 size={14} /></button>}
              </div>
            </div>
          ))}
        </div>
      ))}

      {/* Skills & Certifications */}
      <div className="profile-section animate-fade-in-up stagger-5">
        <div className="flex-between" style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>🛠️ Skills & Certifications</h3>
          <button className="btn btn-ghost btn-sm"><Plus size={14} /> Add</button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {p.skills.map(skill => (
            <span key={skill} className="badge badge-info">{skill}</span>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {p.certifications.map(cert => (
            <div key={cert} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="badge badge-success">🏅</span>
              <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>{cert}</span>
            </div>
          ))}
        </div>
      </div>

      {/* PDPL Actions */}
      <div className="profile-section animate-fade-in-up" style={{ background: 'var(--bg-surface)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <Shield size={20} style={{ color: 'var(--text-tertiary)' }} />
          <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>Data Privacy (PDPL)</h3>
        </div>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-tertiary)', marginBottom: 16, lineHeight: 1.6 }}>
          Under the Saudi Personal Data Protection Law (PDPL), you have the right to access your data and request its deletion.
        </p>
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn btn-ghost btn-sm"><Download size={14} /> Download My Data (PDPL Art. 15)</button>
          <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }}><Trash2 size={14} /> Request Data Deletion (PDPL Art. 18)</button>
        </div>
      </div>
    </div>
  )
}
