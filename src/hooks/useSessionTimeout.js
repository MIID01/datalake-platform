import { useEffect, useRef } from 'react'
import { signOut } from 'firebase/auth'
import { auth } from '../lib/firebase'

// Session controls for a SAMA/NCA-facing platform: auto sign-out after inactivity
// and a hard absolute cap. Firebase ID tokens refresh silently for ~indefinitely
// while a tab is open, so without this a session never ends. Only active while
// signed in; any real user activity resets the idle timer.
const IDLE_MS = 30 * 60 * 1000        // 30 minutes of no activity
const ABSOLUTE_MS = 8 * 60 * 60 * 1000 // 8 hours maximum session length

export function useSessionTimeout(active) {
  const idleTimer = useRef(null)
  const absoluteTimer = useRef(null)

  useEffect(() => {
    if (!active) return

    const end = (reason) => {
      try { sessionStorage.setItem('logout_reason', reason) } catch { /* ignore */ }
      signOut(auth).catch(() => {})
    }
    const resetIdle = () => {
      if (idleTimer.current) clearTimeout(idleTimer.current)
      idleTimer.current = setTimeout(() => end('idle'), IDLE_MS)
    }

    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click']
    events.forEach((e) => window.addEventListener(e, resetIdle, { passive: true }))
    resetIdle()
    absoluteTimer.current = setTimeout(() => end('absolute'), ABSOLUTE_MS)

    return () => {
      events.forEach((e) => window.removeEventListener(e, resetIdle))
      if (idleTimer.current) clearTimeout(idleTimer.current)
      if (absoluteTimer.current) clearTimeout(absoluteTimer.current)
    }
  }, [active])
}
