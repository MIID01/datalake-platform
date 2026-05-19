import { useState, useEffect } from 'react'
import { auth, db } from '../lib/firebase'
import { doc, updateDoc } from 'firebase/firestore'
import { ShieldCheck, User, ArrowRight, CheckCircle, Smartphone } from 'lucide-react'

export default function OnboardingFlow({ userRole, onComplete }) {
  const [step, setStep] = useState(1)
  const [phone, setPhone] = useState('')
  const [emergencyContact, setEmergencyContact] = useState('')
  const [saving, setSaving] = useState(false)

  const handleComplete = async () => {
    setSaving(true)
    try {
      await updateDoc(doc(db, 'users', auth.currentUser.uid), {
        onboarding_completed: true,
        phone_number: phone || null,
        emergency_contact: emergencyContact || null
      })
      onComplete()
    } catch (err) {
      console.warn('Failed to complete onboarding:', err)
      onComplete() // Proceed anyway
    }
    setSaving(false)
  }

  const roleName = userRole?.role_id === 'ceo' ? 'Management' : userRole?.role_id?.toUpperCase() || 'User'

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0a1628', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#e2e8f0', fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 24, padding: 48, maxWidth: 600, width: '90%', position: 'relative', overflow: 'hidden' }}>
        
        {/* Progress Bar */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 40 }}>
          {[1, 2, 3].map(i => (
            <div key={i} style={{ height: 4, flex: 1, background: i <= step ? '#1598CC' : 'rgba(255,255,255,0.1)', borderRadius: 2, transition: 'all 0.3s' }} />
          ))}
        </div>

        {step === 1 && (
          <div className="animate-fade-in-up">
            <h1 style={{ fontSize: '2rem', fontWeight: 700, color: '#fff', marginBottom: 12 }}>Welcome to Datalake</h1>
            <p style={{ fontSize: '1.1rem', color: '#94a3b8', marginBottom: 32, lineHeight: 1.6 }}>
              Your account has been successfully provisioned. Your system role is assigned as <strong style={{ color: '#fff' }}>{roleName}</strong>.
            </p>
            <div style={{ background: 'rgba(21,152,204,0.1)', border: '1px solid rgba(21,152,204,0.2)', padding: 24, borderRadius: 16, marginBottom: 32 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
                <ShieldCheck color="#1598CC" size={32} />
                <div>
                  <div style={{ fontWeight: 600, color: '#fff' }}>Secure & Compliant</div>
                  <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>Hosted locally in Saudi Arabia (me-central2)</div>
                </div>
              </div>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: '0.9rem', color: '#cbd5e1', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <li>All actions are audit-logged for NCA compliance.</li>
                <li>Your data is protected under PDPL regulations.</li>
                <li>Role-based access is strictly enforced.</li>
              </ul>
            </div>
            <button onClick={() => setStep(2)} style={{ width: '100%', padding: '14px', background: '#1598CC', color: '#fff', border: 'none', borderRadius: 12, fontSize: '1rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              Continue <ArrowRight size={18} />
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="animate-fade-in-up">
            <h1 style={{ fontSize: '1.8rem', fontWeight: 700, color: '#fff', marginBottom: 12 }}>Complete your profile</h1>
            <p style={{ fontSize: '1rem', color: '#94a3b8', marginBottom: 32 }}>We need a few details before you can access the dashboard.</p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginBottom: 32 }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#94a3b8', marginBottom: 8 }}>Phone Number</label>
                <div style={{ position: 'relative' }}>
                  <Smartphone size={18} color="#94a3b8" style={{ position: 'absolute', left: 14, top: 14 }} />
                  <input 
                    type="tel" 
                    placeholder="+966 5X XXX XXXX" 
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    style={{ width: '100%', padding: '12px 14px 12px 42px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10, color: '#fff', fontSize: '1rem', outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#94a3b8', marginBottom: 8 }}>Emergency Contact Name & Phone</label>
                <div style={{ position: 'relative' }}>
                  <User size={18} color="#94a3b8" style={{ position: 'absolute', left: 14, top: 14 }} />
                  <input 
                    type="text" 
                    placeholder="E.g. Mohammed Ali (+966...)" 
                    value={emergencyContact}
                    onChange={e => setEmergencyContact(e.target.value)}
                    style={{ width: '100%', padding: '12px 14px 12px 42px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10, color: '#fff', fontSize: '1rem', outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={() => setStep(1)} style={{ padding: '14px', background: 'rgba(255,255,255,0.05)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, fontSize: '1rem', fontWeight: 600, cursor: 'pointer', flex: 1 }}>
                Back
              </button>
              <button onClick={() => setStep(3)} style={{ padding: '14px', background: '#1598CC', color: '#fff', border: 'none', borderRadius: 12, fontSize: '1rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, flex: 2 }}>
                Continue <ArrowRight size={18} />
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="animate-fade-in-up" style={{ textAlign: 'center' }}>
            <div style={{ width: 80, height: 80, background: 'rgba(52,191,58,0.1)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
              <CheckCircle color="#34BF3A" size={40} />
            </div>
            <h1 style={{ fontSize: '1.8rem', fontWeight: 700, color: '#fff', marginBottom: 12 }}>You're all set!</h1>
            <p style={{ fontSize: '1rem', color: '#94a3b8', marginBottom: 40 }}>
              You have acknowledged the mandatory policies. Your dashboard is ready.
            </p>
            <button onClick={handleComplete} disabled={saving} style={{ width: '100%', padding: '14px', background: '#34BF3A', color: '#fff', border: 'none', borderRadius: 12, fontSize: '1rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              {saving ? 'Saving...' : 'Go to Dashboard'} <ArrowRight size={18} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
