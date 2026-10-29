import { ArrowRight, BookOpen, Eye } from 'lucide-react'
import type { Product } from '../data/types'
import { formatPrice } from '../lib/format'
import { href } from '../lib/router'
import { useUI } from '../lib/ui'
import { ProductLabels } from './Labels'
import { ProductArt } from './ProductArt'
import './ProductCard.css'

export function ProductCard({ product, style }: { product: Product; style?: React.CSSProperties }) {
  const { open } = useUI()
  const link = href(`product-${product.slug}`)
  const isDigital = product.type === 'digital'
  return (
    <article className={`product-card product-card--${product.type}`} style={style}>
      <a className="product-card__media" href={link} tabIndex={-1} aria-hidden="true">
        <ProductArt image={product.gallery[0]} />
      </a>
      <div className="product-card__body">
        <ProductLabels product={product} />
        <h3 className="product-card__title">
          <a href={link}>{product.title}</a>
        </h3>
        <p className="product-card__summary">{product.summary}</p>
        <p className="product-card__price">{formatPrice(product.priceCents)}</p>
        <div className="product-card__actions">
          {isDigital ? (
            <button type="button" className="button button--outline button--small" onClick={() => open({ kind: 'peek', product })}>
              <BookOpen aria-hidden="true" size={18} />
              Peek inside
            </button>
          ) : (
            <button type="button" className="button button--outline button--small" onClick={() => open({ kind: 'quick-view', product })}>
              <Eye aria-hidden="true" size={18} />
              Quick view
            </button>
          )}
          <a className="arrow-link" href={link}>
            Details
            <ArrowRight className="arrow" aria-hidden="true" size={18} />
            <span className="visually-hidden"> for {product.title}</span>
          </a>
        </div>
      </div>
    </article>
  )
}
