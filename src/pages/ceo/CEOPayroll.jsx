import { useState, useEffect, useMemo } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { DollarSign, AlertTriangle, CheckCircle, Clock } from 'lucide-react'

export default function CEOPayroll() {
  const [timesheets, setTimesheets] = useState([])
  const [projects, setProjects] = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let loadedCount = 0
    const checkLoaded = () => { loadedCount++; if (loadedCount === 3) setLoading(false) }

    const unsubTs = onSnapshot(collection(db, 'timesheets'), snap => {
      setTimesheets(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      checkLoaded()
    }, err => console.warn(err))

    const unsubProj = onSnapshot(collection(db, 'projects'), snap => {
      setProjects(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      checkLoaded()
    }, err => console.warn(err))

    const unsubEmp = onSnapshot(collection(db, 'employees'), snap => {
      setEmployees(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      checkLoaded()
    }, err => console.warn(err))

    return () => { unsubTs(); unsubProj(); unsubEmp(); }
  }, [])

  const { payrollData, summary } = useMemo(() => {
    const now = new Date()
    const currentMonth = now.getMonth() + 1
    const currentYear = now.getFullYear()

    const roster = new Map()

    timesheets.forEach(ts => {
      if (ts.period_month === currentMonth && ts.period_year === currentYear) {
        if (!roster.has(ts.engineer_id)) {
          const empRecord = employees.find(e => e.id === ts.engineer_id || e.employee_id === ts.engineer_id)
          const gross = empRecord && empRecord.salary ? Number(empRecord.salary) : 0
          const employee_gosi = gross * 0.0975
          const employer_gosi = gross * 0.1175
          
          roster.set(ts.engineer_id, {
            id: ts.engineer_id,
            name: ts.engineer_name || ts.engineer_id,
            gross: gross,
            gosi: employee_gosi,
            employer_gosi: employer_gosi,
            net: gross - employee_gosi,
            wps_status: ts.state === 'CLIENT_SIGNED' || ts.state === 'CTO_APPROVED' ? 'CLEARED' : 'PENDING_TIMESHEET',
            hold_alert: ts.state === 'REJECTED' ? 'Timesheet Disputed' : null
          })
        }
      }
    })

    const list = Array.from(roster.values())
    const sumGross = list.reduce((acc, emp) => acc + emp.gross, 0)
    const sumNet = list.reduce((acc, emp) => acc + emp.net, 0)
    const sumGosi = list.reduce((acc, emp) => acc + emp.gosi, 0)

    return {
      payrollData: list,
      summary: { sumGross, sumNet, sumGosi, count: list.length }
    }
  }, [timesheets, projects, employees])

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center' }}>Loading payroll data...</div>
  }

  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 24 }}>Payroll & WPS Management</h1>
      
      <div className="grid-3" style={{ marginBottom: 28 }}>
        <div className="stat-card" style={{ '--stat-accent': 'var(--sky-blue)' }}>
          <div className="stat-label">Total Gross Pay</div>
          <div className="stat-value" style={{ color: 'var(--sky-blue)' }}>SAR {summary.sumGross.toLocaleString()}</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginTop: 8 }}>{summary.count} active employees</div>
        </div>
        <div className="stat-card" style={{ '--stat-accent': 'var(--green)' }}>
          <div className="stat-label">Net Payable (WPS)</div>
          <div className="stat-value" style={{ color: 'var(--green)' }}>SAR {summary.sumNet.toLocaleString()}</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginTop: 8 }}>Ready for bank transfer</div>
        </div>
        <div className="stat-card" style={{ '--stat-accent': 'var(--purple)' }}>
          <div className="stat-label">Total GOSI Contributions</div>
          <div className="stat-value" style={{ color: 'var(--purple)' }}>SAR {summary.sumGosi.toLocaleString()}</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginTop: 8 }}>Due by 15th of next month</div>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-primary)' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>Employee Payroll Roster — Current Month</h3>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Gross Pay</th>
              <th>GOSI Deduction</th>
              <th>Net Pay</th>
              <th>WPS Status</th>
              <th>Alerts</th>
            </tr>
          </thead>
          <tbody>
            {payrollData.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24 }}>No active payroll records this month.</td></tr>
            ) : payrollData.map(emp => (
              <tr key={emp.id}>
                <td style={{ fontWeight: 600 }}>{emp.name}</td>
                <td>SAR {emp.gross.toLocaleString()}</td>
                <td style={{ color: 'var(--text-tertiary)' }}>SAR {emp.gosi.toLocaleString()}</td>
                <td style={{ fontWeight: 600 }}>SAR {emp.net.toLocaleString()}</td>
                <td>
                  {emp.wps_status === 'CLEARED' ? (
                    <span className="badge badge-success"><CheckCircle size={12} style={{marginRight:4}}/> Cleared</span>
                  ) : (
                    <span className="badge badge-warning"><Clock size={12} style={{marginRight:4}}/> Pending Timesheet</span>
                  )}
                </td>
                <td>
                  {emp.hold_alert ? (
                    <span style={{ color: 'var(--red)', display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.85rem' }}>
                      <AlertTriangle size={14} /> {emp.hold_alert}
                    </span>
                  ) : (
                    <span style={{ color: 'var(--text-tertiary)' }}>None</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
