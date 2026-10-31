import { ServerUnavailablePage } from '../components/Unavailable'
import { ArrowRight, BookOpen, Check, PlayCircle, ShoppingBag } from 'lucide-react'
import { useState } from 'react'
import { getCategory } from '../data/catalog'
import type { Product as ProductRecord } from '../data/types'
import { Heart } from '../components/illustrations/Objects'
import { Gallery } from '../components/Gallery'
import { Price, ProductLabels } from '../components/Labels'
import { useAddToBag, VariantPicker } from '../components/Overlays'
import { ProductReviews } from '../components/Reviews'
import { ProductCard } from '../components/ProductCard'
import { TutorialHelpLink } from '../components/TutorialCard'
import { RichText } from '../components/RichText'
import { href } from '../lib/router'
import { displayPrice, useStore } from '../lib/store'
import { useUI } from '../lib/ui'
import { CONSENT_WORDING } from '../../shared/consent'
import { NotFound } from './Simple'

function Detail({ term, value }: { term: string; value: string | null }) {
  return (
    <div className="details__row">
      <dt>{term}</dt>
      <dd className={value ? '' : 'muted'}>{value ?? 'To be confirmed'}</dd>
    </div>
  )
}

const kb = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

export function Product({ slug }: { slug: string }) {
  const { getProduct, status } = useStore()
  const product = getProduct(slug)
  if (!product && status === 'loading') return <div className="container page-loading" role="status">Loading product...</div>
  if (!product && status === 'offline') return <ServerUnavailablePage title="This product is not available yet" />
  if (!product) return <NotFound />
  return <ProductView product={product} key={product.id} />
}

/** The product page body. In admin preview mode, buying is switched off. */
export function ProductView({ product, preview = false }: { product: ProductRecord; preview?: boolean }) {
  const category = getCategory(product.category)
  const addToBag = useAddToBag()
  const { open } = useUI()
  const { products } = useStore()
  const [added, setAdded] = useState(false)
  const [variantId, setVariantId] = useState<string | null>(null)
  const variant = product.variants?.find((v) => v.id === variantId) ?? null
  const isDigital = product.type === 'digital'
  const needsVariant = Boolean(product.variants?.length) && !variant
  const soldOut = product.inStock === false
  const unpriced = displayPrice(product, variant).now === null
  const d = product.digital
  const related = preview ? [] : products.filter((p) => p.category === product.category && p.id !== product.id).slice(0, 3)

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
          <p className="product__price">
            <Price product={product} variant={variant} />
          </p>
          <p className="product__summary">{product.summary}</p>

          {isDigital && (
            <p className="notice">
              <strong>Inserts only.</strong> This is a digital download. Binder not included.
            </p>
          )}
          {!isDigital && (product.variants?.length ? <VariantPicker product={product} value={variantId} onChange={setVariantId} /> : <p className="muted product__variants">Sizes, colors and options will be listed once confirmed.</p>)}

          <div className="product__actions">
            <button
              type="button"
              className={`button ${added ? 'is-added' : ''}`}
              disabled={preview || soldOut || needsVariant || unpriced || (isDigital && added)}
              onClick={() => {
                addToBag(product, variantId)
                setAdded(true)
              }}
            >
              {added ? <Heart className="button__heart" /> : <ShoppingBag aria-hidden="true" size={18} />}
              {soldOut ? 'Sold out' : unpriced ? 'Pricing to be added' : needsVariant ? 'Choose an option' : added ? (isDigital ? 'In your bag' : 'Add another') : product.isFreebie ? 'Add free resource to bag' : 'Add to bag'}
            </button>
            {isDigital && product.samplePages.length > 0 && (
              <button type="button" className="button button--outline" onClick={() => open({ kind: 'peek', product })} aria-haspopup="dialog">
                <BookOpen aria-hidden="true" size={18} />
                Peek inside
              </button>
            )}
          </div>
          {product.isFreebie && (
            <p className="freebie-terms">
              <strong>Free with our email list:</strong> {CONSENT_WORDING['freebie-v1']} No payment or card details needed.
            </p>
          )}
          {isDigital && (
            <p className="muted product__demo-note">
              <Check aria-hidden="true" size={16} /> Each purchase includes one download of the latest version, in your account after payment.
            </p>
          )}
          {product.isDemo && (
            <p className="muted product__demo-note">
              <Check aria-hidden="true" size={16} /> Demo listing for the preview. The price and file are placeholders.
            </p>
          )}

          {isDigital && <TutorialHelpLink category={product.category} />}
          {product.walkthrough && (
            <a className="arrow-link" href={href(`tutorial-${product.walkthrough.slug}`)}>
              <PlayCircle aria-hidden="true" size={18} /> Watch the walkthrough: {product.walkthrough.title}
            </a>
          )}

          {isDigital && Boolean(product.whatsIncluded?.length) && (
            <section className="included" aria-labelledby="included-title">
              <h2 id="included-title" className="details__title">What's included</h2>
              <ul className="included__list">
                {product.whatsIncluded!.map((item) => (
                  <li key={item}>
                    <Check aria-hidden="true" size={16} />
                    {item}
                  </li>
                ))}
              </ul>
              {isDigital && <p className="muted">Inserts only. Binder not included.</p>}
            </section>
          )}

          <section className="details" aria-labelledby="details-title">
            <h2 id="details-title" className="details__title">Details</h2>
            <dl>
              <Detail term="Type" value={isDigital ? 'Digital download' : 'Physical item, ships to you'} />
              <Detail term="Made for" value={product.audience} />
              {isDigital && <Detail term="Pages" value={d?.pageCount ? String(d.pageCount) : null} />}
              {isDigital && <Detail term="Page size" value={d?.pageSize ? `${d.pageSize}${d.orientation ? `, ${d.orientation}` : ''}` : null} />}
              {isDigital && <Detail term="File format" value={product.fileFormat} />}
              {isDigital && <Detail term="File size" value={d?.fileSizeBytes ? kb(d.fileSizeBytes) : null} />}
              {isDigital && <Detail term="Use" value={d?.usage.length ? d.usage.join(', ') : null} />}
              {isDigital && <Detail term="Works with" value={product.appCompatibility?.join(', ') ?? null} />}
              {isDigital && d?.versionNumber && <Detail term="Version" value={`Version ${d.versionNumber}${d.versionReleasedAt ? `, updated ${new Date(d.versionReleasedAt).toLocaleDateString()}` : ''}`} />}
              {isDigital && <Detail term="Binder" value="Not included" />}
              {!isDigital && <Detail term="Options" value={product.variants ? product.variants.map((v) => v.title).join(', ') : null} />}
              {product.isExample && <Detail term="Status" value={product.isDemo ? 'Demo listing for the preview' : 'Example listing for the preview'} />}
            </dl>
          </section>

          <section className="overview" aria-labelledby="overview-title">
            <h2 id="overview-title" className="details__title">Overview</h2>
            {product.descriptionDoc ? <RichText doc={product.descriptionDoc} /> : <p>{product.description}</p>}
          </section>
        </div>
      </article>

      {!product.isExample && <ProductReviews slug={product.slug} preview={preview} />}

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

