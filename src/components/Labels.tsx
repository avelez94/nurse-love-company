import { Download, Info, Truck } from 'lucide-react'
import { site } from '../data/site'
import type { Product, Variant } from '../data/types'
import { formatPrice } from '../lib/format'
import { displayPrice } from '../lib/store'

export function DigitalLabel() {
  return (
    <span className="label">
      <Download aria-hidden="true" />
      {site.insertLabel}
    </span>
  )
}

export function ShipsLabel() {
  return (
    <span className="label">
      <Truck aria-hidden="true" />
      {site.shipsLabel}
    </span>
  )
}

export function ExampleLabel({ demo = false }: { demo?: boolean }) {
  return (
    <span className="label label--example">
      <Info aria-hidden="true" />
      {demo ? 'Demo listing' : 'Example listing'}
    </span>
  )
}

/** Price with sale and demo states. Never shows an invented price as real. */
export function Price({ product, variant, className = '' }: { product: Product; variant?: Variant | null; className?: string }) {
  const { now, was } = displayPrice(product, variant)
  if (now === null || now === undefined) return <span className={`price price--none ${className}`}>Pricing to be added</span>
  if (product.isFreebie) return <span className={`price ${className}`}><span className="price__now">Free</span></span>
  return (
    <span className={`price ${className}`}>
      {was !== null && <s className="price__was">{formatPrice(was)}</s>}
      <span className="price__now">{formatPrice(now)}</span>
      {product.isDemo && <span className="price__demo">Demo price</span>}
    </span>
  )
}

/** The labels every product shows, so digital and physical never blur together. */
export function ProductLabels({ product }: { product: Product }) {
  return (
    <span className="label-row">
      {product.type === 'digital' ? <DigitalLabel /> : <ShipsLabel />}
      {product.isExample && <ExampleLabel demo={product.isDemo} />}
      {product.preorder && <span className="label label--preorder">Preorder</span>}
      {product.inStock === false && <span className="label label--example">{product.type === 'physical' ? 'Unavailable' : 'Sold out'}</span>}
    </span>
  )
}

/** "Ships by December 15" for a preorder date (YYYY-MM-DD). */
export const shipByText = (d: string) => `Ships by ${new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })}`
