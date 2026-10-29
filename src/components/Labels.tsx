import { Download, Info, Truck } from 'lucide-react'
import { site } from '../data/site'
import type { Product } from '../data/types'

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

export function ExampleLabel() {
  return (
    <span className="label label--example">
      <Info aria-hidden="true" />
      Example listing
    </span>
  )
}

/** The labels every product shows, so digital and physical never blur together. */
export function ProductLabels({ product }: { product: Product }) {
  return (
    <span className="label-row">
      {product.type === 'digital' ? <DigitalLabel /> : <ShipsLabel />}
      {product.isExample && <ExampleLabel />}
    </span>
  )
}
