import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Freebie, Product } from '../data/types'

/* Which overlay is open. Only one dialog shows at a time. */
export type Overlay =
  | { kind: 'none' }
  | { kind: 'search'; query?: string }
  | { kind: 'finder' }
  | { kind: 'bag' }
  | { kind: 'menu' }
  | { kind: 'quick-view'; product: Product }
  | { kind: 'peek'; product: Product; start?: number }
  | { kind: 'freebie'; freebie: Freebie }

export interface Toast {
  id: number
  message: string
  action?: { label: string; onClick: () => void }
}

interface UIValue {
  overlay: Overlay
  open: (o: Overlay) => void
  close: () => void
  toast: Toast | null
  showToast: (message: string, action?: Toast['action']) => void
  dismissToast: () => void
}

const UIContext = createContext<UIValue | null>(null)

export function UIProvider({ children }: { children: ReactNode }) {
  const [overlay, setOverlay] = useState<Overlay>({ kind: 'none' })
  const [toast, setToast] = useState<Toast | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const dismissToast = useCallback(() => {
    window.clearTimeout(timer.current)
    setToast(null)
  }, [])

  const showToast = useCallback((message: string, action?: Toast['action']) => {
    window.clearTimeout(timer.current)
    setToast({ id: Date.now(), message, action })
    timer.current = window.setTimeout(() => setToast(null), 4200)
  }, [])

  const value = useMemo<UIValue>(
    () => ({
      overlay,
      open: setOverlay,
      close: () => setOverlay({ kind: 'none' }),
      toast,
      showToast,
      dismissToast,
    }),
    [overlay, toast, showToast, dismissToast],
  )
  return <UIContext.Provider value={value}>{children}</UIContext.Provider>
}

export function useUI(): UIValue {
  const ctx = useContext(UIContext)
  if (!ctx) throw new Error('useUI must be used inside UIProvider')
  return ctx
}
