import { ArrowUp, Check, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useUI } from '../lib/ui'
import './Chrome.css'

/* Back to top control: appears after scrolling, never blocks content. */
export function BackToTop() {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const onScroll = () => {
      setShow(window.scrollY > 900)
      document.documentElement.classList.toggle('is-scrolled', window.scrollY > 8)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return (
    <button
      type="button"
      className={`back-to-top ${show ? 'is-visible' : ''}`}
      aria-label="Back to top"
      tabIndex={show ? 0 : -1}
      aria-hidden={!show}
      onClick={() => {
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })
        document.getElementById('main')?.focus({ preventScroll: true })
      }}
    >
      <ArrowUp aria-hidden="true" size={20} />
    </button>
  )
}

/* Friendly confirmation. Announced politely to screen readers. */
export function ToastHost() {
  const { toast, dismissToast } = useUI()
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {toast && (
        <div className="toast" key={toast.id}>
          <span className="toast__icon" aria-hidden="true">
            <Check size={16} strokeWidth={3} />
          </span>
          <p className="toast__message">{toast.message}</p>
          {toast.action && (
            <button
              type="button"
              className="toast__action"
              onClick={() => {
                toast.action?.onClick()
                dismissToast()
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button type="button" className="icon-button toast__close" aria-label="Dismiss message" onClick={dismissToast}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  )
}
