import { ArrowRight, Check, ShoppingBag } from 'lucide-react'
import { useState } from 'react'
import { getCategory, products } from '../data/catalog'
import type { Product as ProductRecord } from '../data/types'
import { Heart } from '../components/illustrations/Objects'
import { Gallery } from '../components/Gallery'
import { ProductLabels } from '../components/Labels'
import { useAddToBag } from '../components/Overlays'
import { PeekInside } from '../components/PeekInside'
import { ProductCard } from '../components/ProductCard'
import { TutorialHelpLink } from '../components/TutorialCard'
import { formatPrice } from '../lib/format'
import { href } from '../lib/router'
import { NotFound } from './Simple'

function Detail({ term, value }: { term: string; value: string | null }) {
  return (
    <div className="details__row">
      <dt>{term}</dt>
      <dd className={value ? '' : 'muted'}>{value ?? 'To be confirmed'}</dd>
    </div>
  )
}

export function Product({ slug }: { slug: string }) {
  const product = products.find((p) => p.slug === slug)
  if (!product) return <NotFound />
  return <ProductView product={product} key={product.id} />
}

function ProductView({ product }: { product: ProductRecord }) {
  const category = getCategory(product.category)
  const addToBag = useAddToBag()
  const [added, setAdded] = useState(false)
  const isDigital = product.type === 'digital'
  const related = products.filter((p) => p.category === product.category && p.id !== product.id).slice(0, 3)

  return (
    <>
      <div className="page-header page-header--compact">
        <div className="container">
          <nav aria-label="Breadcrumb" className="crumbs">
            <ol>
              <li><a href={href('home')}>Home</a></li>
              <li><a href={href(isDigital ? 'shop' : 'extra-cute')}>{isDigital ? 'Shop' : 'A little extra cute'}</a></li>
              <li><a href={href(category.route)}>{category.title}</a></li>
              <li><span aria-current="page">{product.title}</span></li>
            </ol>
          </nav>
        </div>
      </div>
      <article className="container product">
        <div className="product__gallery">
          <Gallery images={product.gallery} title={product.title} />
        </div>
        <div className="product__info">
          <ProductLabels product={product} />
          <h1 className="product__title">{product.title}</h1>
          <p className="product__category">{category.title}</p>
          <p className="product__price">{formatPrice(product.priceCents)}</p>
          <p className="product__summary">{product.summary}</p>

          {isDigital && (
            <p className="notice">
              <strong>Inserts only.</strong> This is a digital download. Binder not included.
            </p>
          )}
          {!isDigital && !product.variants && <p className="muted product__variants">Sizes, colors and options will be listed once confirmed.</p>}

          <div className="product__actions">
            <button
              type="button"
              className={`button ${added ? 'is-added' : ''}`}
              onClick={() => {
                addToBag(product)
                setAdded(true)
              }}
            >
              {added ? <Heart className="button__heart" /> : <ShoppingBag aria-hidden="true" size={18} />}
              {added ? (isDigital ? 'In your demo bag' : 'Add another to demo bag') : 'Add to demo bag'}
            </button>
            {isDigital && (
              <button
                type="button"
                className="button button--outline"
                onClick={() => {
                  const target = document.getElementById('peek-inside')
                  target?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
                  target?.querySelector<HTMLElement>('.peek__nav--next')?.focus({ preventScroll: true })
                }}
              >
                Peek inside
              </button>
            )}
          </div>
          <p className="muted product__demo-note">
            <Check aria-hidden="true" size={16} /> Demonstration bag only. Purchasing is not enabled in this preview.
          </p>

          {isDigital && <TutorialHelpLink category={product.category} />}

          <section className="details" aria-labelledby="details-title">
            <h2 id="details-title" className="details__title">Details</h2>
            <dl>
              <Detail term="Type" value={isDigital ? 'Digital download' : 'Physical item, ships to you'} />
              <Detail term="Made for" value={product.audience} />
              {isDigital && <Detail term="File format" value={product.fileFormat} />}
              {isDigital && <Detail term="Works with" value={product.appCompatibility?.join(', ') ?? null} />}
              {isDigital && <Detail term="Binder" value="Not included" />}
              {!isDigital && <Detail term="Options" value={product.variants ? product.variants.map((v) => v.label).join(', ') : null} />}
              <Detail term="Status" value={product.isExample ? 'Example listing for the preview' : null} />
            </dl>
          </section>

          <section className="overview" aria-labelledby="overview-title">
            <h2 id="overview-title" className="details__title">Overview</h2>
            <p>{product.description}</p>
          </section>
        </div>
      </article>

      {isDigital && (
        <section className="container peek-section" id="peek-inside" aria-labelledby="peek-title">
          <h2 id="peek-title" className="peek-section__title">Peek inside</h2>
          <p className="muted">Flip through sample layouts. Use the arrows, the thumbnails, or swipe.</p>
          <div className="peek-section__viewer">
            <PeekInside pages={product.samplePages} title={product.title} />
          </div>
        </section>
      )}

      {related.length > 0 && (
        <section className="container related" aria-labelledby="related-title">
          <div className="related__head">
            <h2 id="related-title" className="related__title">More from {category.title}</h2>
            <a className="arrow-link" href={href(category.route)}>
              See all <ArrowRight className="arrow" aria-hidden="true" size={18} />
            </a>
          </div>
          <div className="product-grid">
            {related.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}
    </>
  )
}

