import { useState, useEffect } from 'react'
import { collection, query, onSnapshot } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { CheckCircle, XCircle } from 'lucide-react'

const DEFAULT_MODULES = [
  'PDPL-AWARENESS',
  'CODE-OF-CONDUCT',
  'INFO-SEC',
  'ANTI-BRIBERY',
  'WORKPLACE-SAFETY',
  'CLIENT-CONDUCT'
]

export default function CEOTraining() {
  const [completions, setCompletions] = useState([])

  useEffect(() => {
    const q = query(collection(db, 'training_completions'))
    const unsub = onSnapshot(q, snap => {
      setCompletions(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })
    return () => unsub()
  }, [])

  // Group by employee
  const byEmployee = completions.reduce((acc, comp) => {
    if (!acc[comp.engineer_email]) {
      acc[comp.engineer_email] = {
        name: comp.engineer_name,
        email: comp.engineer_email,
        modules: new Set()
      }
    }
    if (comp.status === 'COMPLETED') {
      acc[comp.engineer_email].modules.add(comp.module_id)
    }
    return acc
  }, {})

  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 24 }}>Training & Compliance Matrix</h1>
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Employee</th>
              {DEFAULT_MODULES.map(m => (
                <th key={m} style={{ fontSize: '0.75rem', textAlign: 'center' }}>{m}</th>
              ))}
              <th>Compliance %</th>
            </tr>
          </thead>
          <tbody>
            {Object.values(byEmployee).map(emp => {
              const compCount = DEFAULT_MODULES.filter(m => emp.modules.has(m)).length
              const pct = Math.round((compCount / DEFAULT_MODULES.length) * 100)
              return (
                <tr key={emp.email}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{emp.name}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>{emp.email}</div>
                  </td>
                  {DEFAULT_MODULES.map(m => (
                    <td key={m} style={{ textAlign: 'center' }}>
                      {emp.modules.has(m) ? <CheckCircle size={18} color="#34BF3A" /> : <XCircle size={18} color="#C0392B" />}
                    </td>
                  ))}
                  <td style={{ fontWeight: 700, color: pct === 100 ? '#34BF3A' : pct > 50 ? '#F39C12' : '#C0392B' }}>
                    {pct}%
                  </td>
                </tr>
              )
            })}
            {Object.keys(byEmployee).length === 0 && (
              <tr><td colSpan={DEFAULT_MODULES.length + 2} style={{ textAlign: 'center', padding: 48, color: 'var(--text-tertiary)' }}>No training records found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
