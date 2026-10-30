import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Product, Variant } from '../data/types'
import { readJSON, writeJSON } from './storage'
import { useStore } from './store'

/*
  Shopping bag. Kept in this browser until checkout. Prices shown here are for
  display only: the server recalculates every price at checkout.
  Digital downloads are always quantity one (one download per purchase).
*/

export interface CartLine {
  key: string
  product: Product
  variant: Variant | null
  quantity: number
}

interface Stored {
  productId: string
  variantId: string | null
  quantity: number
}

interface CartValue {
  lines: CartLine[]
  count: number
  add: (product: Product, variantId?: string | null) => void
  remove: (key: string) => void
  setQuantity: (key: string, quantity: number) => void
  clear: () => void
  bump: number
  checkoutItems: Array<{ productId: string; variantId: string | null; quantity: number }>
}

const CartContext = createContext<CartValue | null>(null)
const KEY = 'nlc-bag-v2'
const keyOf = (s: { productId: string; variantId: string | null }) => `${s.productId}:${s.variantId ?? ''}`

export function CartProvider({ children }: { children: ReactNode }) {
  const { productById, status } = useStore()
  const [stored, setStored] = useState<Stored[]>(() => readJSON<Stored[]>(KEY, []))
  const [bump, setBump] = useState(0)

  useEffect(() => writeJSON(KEY, stored), [stored])

  const add = useCallback((product: Product, variantId: string | null = null) => {
    setStored((prev) => {
      const k = keyOf({ productId: product.id, variantId })
      const existing = prev.find((l) => keyOf(l) === k)
      if (existing) {
        if (product.type === 'digital') return prev
        return prev.map((l) => (keyOf(l) === k ? { ...l, quantity: Math.min(l.quantity + 1, 10) } : l))
      }
      return [...prev, { productId: product.id, variantId, quantity: 1 }]
    })
    setBump((b) => b + 1)
  }, [])

  const remove = useCallback((k: string) => setStored((prev) => prev.filter((l) => keyOf(l) !== k)), [])
  const setQuantity = useCallback((k: string, q: number) => {
    setStored((prev) => (q <= 0 ? prev.filter((l) => keyOf(l) !== k) : prev.map((l) => (keyOf(l) === k ? { ...l, quantity: Math.min(q, 10) } : l))))
  }, [])
  const clear = useCallback(() => setStored([]), [])

  const value = useMemo<CartValue>(() => {
    const lines: CartLine[] = []
    for (const s of stored) {
      const product = productById(s.productId)
      if (!product) continue
      const variant = s.variantId ? (product.variants?.find((v) => v.id === s.variantId) ?? null) : null
      lines.push({ key: keyOf(s), product, variant, quantity: product.type === 'digital' ? 1 : s.quantity })
    }
    return {
      lines,
      count: lines.reduce((n, l) => n + l.quantity, 0),
      add,
      remove,
      setQuantity,
      clear,
      bump,
      checkoutItems: lines.map((l) => ({ productId: l.product.id, variantId: l.variant?.id ?? null, quantity: l.quantity })),
    }
    // Keep stored lines for products that are temporarily missing while the catalog loads.
  }, [stored, productById, add, remove, setQuantity, clear, bump, status])

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart(): CartValue {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used inside CartProvider')
  return ctx
}
