import { useState, useEffect, useRef } from 'react'

export function useCountUp(end, duration = 800, start = 0) {
  const [value, setValue] = useState(start)
  const rafRef = useRef()

  useEffect(() => {
    const startTime = performance.now()
    const animate = (now) => {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      // ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      setValue(Math.round(start + (end - start) * eased))
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate)
      }
    }
    rafRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(rafRef.current)
  }, [end, duration, start])

  return value
}

export function useRiyadhTime() {
  const [time, setTime] = useState('')
  useEffect(() => {
    const update = () => {
      const now = new Date()
      setTime(now.toLocaleTimeString('en-US', {
        timeZone: 'Asia/Riyadh',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      }))
    }
    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [])
  return time
}

export function useKeyboardShortcuts(handlers) {
  useEffect(() => {
    const listener = (e) => {
      // Don't fire in input fields
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return
      const key = e.key.toLowerCase()
      if (handlers[key]) {
        e.preventDefault()
        handlers[key]()
      }
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [handlers])
}

export function useUndoAction(delay = 5000) {
  const [pending, setPending] = useState(null)
  const timerRef = useRef()

  const execute = (action, onConfirm, description) => {
    setPending({ description, action })
    timerRef.current = setTimeout(() => {
      onConfirm()
      setPending(null)
    }, delay)
  }

  const undo = () => {
    clearTimeout(timerRef.current)
    setPending(null)
  }

  useEffect(() => () => clearTimeout(timerRef.current), [])

  return { pending, execute, undo }
}

export function formatDate(dateStringOrTimestamp) {
  if (!dateStringOrTimestamp) return ''
  const date = dateStringOrTimestamp.toDate ? dateStringOrTimestamp.toDate() : new Date(dateStringOrTimestamp)
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  })
}

export function formatCurrency(amount) {
  if (amount == null) return 'SAR 0.00'
  return new Intl.NumberFormat('en-SA', {
    style: 'currency',
    currency: 'SAR',
  }).format(amount).replace('SAR', 'SAR ')
}
