import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getProduct } from '../data/catalog'
import type { Product } from '../data/types'
import { readJSON, writeJSON } from './storage'

/*
  Demonstration bag. It only remembers sample items in this browser.
  No prices are invented, no checkout runs and nothing is purchased.
*/

export interface CartLine {
  product: Product
  quantity: number
}

interface CartValue {
  lines: CartLine[]
  count: number
  add: (product: Product) => void
  remove: (productId: string) => void
  setQuantity: (productId: string, quantity: number) => void
  clear: () => void
  /** Increments every time something is added, so the bag icon can animate. */
  bump: number
}

const CartContext = createContext<CartValue | null>(null)
const KEY = 'nlc-demo-bag-v1'

type Stored = Array<{ id: string; quantity: number }>

export function CartProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState<Stored>(() => readJSON<Stored>(KEY, []))
  const [bump, setBump] = useState(0)

  useEffect(() => writeJSON(KEY, stored), [stored])

  const add = useCallback((product: Product) => {
    setStored((prev) => {
      const existing = prev.find((l) => l.id === product.id)
      if (existing) {
        // Digital downloads stay at a quantity of one.
        if (product.type === 'digital') return prev
        return prev.map((l) => (l.id === product.id ? { ...l, quantity: Math.min(l.quantity + 1, 10) } : l))
      }
      return [...prev, { id: product.id, quantity: 1 }]
    })
    setBump((b) => b + 1)
  }, [])

  const remove = useCallback((id: string) => setStored((prev) => prev.filter((l) => l.id !== id)), [])

  const setQuantity = useCallback((id: string, quantity: number) => {
    setStored((prev) =>
      quantity <= 0 ? prev.filter((l) => l.id !== id) : prev.map((l) => (l.id === id ? { ...l, quantity: Math.min(quantity, 10) } : l)),
    )
  }, [])

  const clear = useCallback(() => setStored([]), [])

  const value = useMemo<CartValue>(() => {
    const lines = stored
      .map((l) => ({ product: getProduct(l.id), quantity: l.quantity }))
      .filter((l): l is CartLine => Boolean(l.product))
    return { lines, count: lines.reduce((n, l) => n + l.quantity, 0), add, remove, setQuantity, clear, bump }
  }, [stored, add, remove, setQuantity, clear, bump])

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart(): CartValue {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used inside CartProvider')
  return ctx
}
