import { useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import './Dialog.css'

/*
  Accessible dialog built on the native <dialog> element: focus stays inside,
  Escape closes, the backdrop closes, and focus returns to the opener.
*/

interface DialogProps {
  open: boolean
  onClose: () => void
  title: string
  /** Visually hide the title while keeping it for screen readers. */
  hideTitle?: boolean
  variant?: 'center' | 'wide' | 'drawer' | 'sheet' | 'menu'
  children: ReactNode
  footer?: ReactNode
  /** Element to focus first; defaults to the first focusable control. */
  initialFocus?: React.RefObject<HTMLElement | null>
  className?: string
}

export function Dialog({ open, onClose, title, hideTitle, variant = 'center', children, footer, initialFocus, className }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const returnTo = useRef<HTMLElement | null>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      returnTo.current = document.activeElement as HTMLElement | null
      dialog.showModal()
      document.documentElement.classList.add('has-dialog')
      const target = initialFocus?.current
      if (target) target.focus()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open, initialFocus])

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    const onNativeClose = () => {
      document.documentElement.classList.remove('has-dialog')
      const el = returnTo.current
      if (el && document.contains(el)) el.focus({ preventScroll: true })
      returnTo.current = null
    }
    dialog.addEventListener('close', onNativeClose)
    return () => dialog.removeEventListener('close', onNativeClose)
  }, [])

  // Make sure the page never stays locked if the component unmounts while open.
  useEffect(() => () => document.documentElement.classList.remove('has-dialog'), [])

  return (
    <dialog
      ref={ref}
      className={`dialog dialog--${variant} ${className ?? ''}`}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onMouseDown={(e) => {
        if (e.target === ref.current) onClose()
      }}
    >
      {open && (
        <div className="dialog__panel">
          <header className="dialog__header">
            <h2 id={titleId} className={hideTitle ? 'visually-hidden' : 'dialog__title'}>
              {title}
            </h2>
            <button type="button" className="icon-button dialog__close" onClick={onClose} aria-label="Close">
              <X aria-hidden="true" size={22} />
            </button>
          </header>
          <div className="dialog__body">{children}</div>
          {footer && <footer className="dialog__footer">{footer}</footer>}
        </div>
      )}
    </dialog>
  )
}
