import { useState, useEffect } from 'react'
import { auth, db } from '../../lib/firebase'
import { collection, query, where, getDocs, doc, onSnapshot } from 'firebase/firestore'
import CEOCommandCenter from '../ceo/CommandCenter'
import CTODashboard from '../cto/Dashboard'
import EngDashboard from '../engineer/Dashboard'
import { Loader } from 'lucide-react'

export default function UnifiedDashboard() {
  const [userRole, setUserRole] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsubAuth = auth.onAuthStateChanged(async (user) => {
      if (user) {
        if (user.email === 'm.alqumri@datalake.sa') {
          setUserRole('ceo')
          setLoading(false)
          return
        }
        try {
          const uidDoc = await new Promise((resolve) => {
            const unsub = onSnapshot(doc(db, 'users', user.uid), (snap) => {
              unsub()
              resolve(snap)
            })
          })

          if (uidDoc.exists()) {
            setUserRole(uidDoc.data().role_id)
          } else {
            const q = query(collection(db, 'users'), where('email', '==', user.email))
            const snap = await getDocs(q)
            if (!snap.empty) setUserRole(snap.docs[0].data().role_id)
          }
        } catch (err) {
          console.warn('Dashboard role fetch error:', err.message)
        }
      }
      setLoading(false)
    })
    return () => unsubAuth()
  }, [])

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><Loader className="spin" color="#1598CC" /></div>

  const role = userRole || 'engineer' // Fallback

  switch (role) {
    case 'ceo':
      return <CEOCommandCenter />
    case 'cto':
      return <CTODashboard />
    case 'pm':
    case 'engineer':
    default:
      return <EngDashboard />
  }
}
