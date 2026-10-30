import { ArrowLeft, ArrowRight, BookOpen, Download, GraduationCap, Minus, Plus, Search, Shirt, ShoppingBag, Stethoscope, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getCategory } from '../data/catalog'
import { site } from '../data/site'
import type { Freebie, Product } from '../data/types'
import { useCart } from '../lib/cart'
import { offerDownload } from '../lib/download'
import { api, errorMessage } from '../lib/api'
import { formatPrice } from '../lib/format'
import { useSession } from '../lib/session'
import { displayPrice, useStore } from '../lib/store'
import { href, navigate } from '../lib/router'
import { buildSamplePlannerPdf } from '../../shared/samplePdf'
import { CONSENT_WORDING, type MarketingStatus } from '../../shared/consent'
import { search, searchSuggestions } from '../lib/search'
import { useUI } from '../lib/ui'
import { Dialog } from './Dialog'
import { Gallery } from './Gallery'
import { Heart } from './illustrations/Objects'
import { ExampleLabel, Price, ProductLabels } from './Labels'
import { PeekInside } from './PeekInside'
import { ProductArt } from './ProductArt'
import { SamplePageView } from './SamplePageView'
import { TutorialHelpLink } from './TutorialCard'
import './Overlays.css'

/** Adds an item to the bag with a friendly confirmation. */
export function useAddToBag() {
  const { add } = useCart()
  const { showToast, open } = useUI()
  return (product: Product, variantId: string | null = null) => {
    add(product, variantId)
    showToast(`${product.title} is in your bag.`, { label: 'View bag', onClick: () => open({ kind: 'bag' }) })
  }
}

export function Overlays() {
  const { overlay, close } = useUI()
  return (
    <>
      <SearchDialog open={overlay.kind === 'search'} initial={overlay.kind === 'search' ? overlay.query ?? '' : ''} onClose={close} />
      <FinderDialog open={overlay.kind === 'finder'} onClose={close} />
      <BagDrawer open={overlay.kind === 'bag'} onClose={close} />
      <QuickView product={overlay.kind === 'quick-view' ? overlay.product : null} onClose={close} />
      <PeekDialog product={overlay.kind === 'peek' ? overlay.product : null} start={overlay.kind === 'peek' ? overlay.start : 0} onClose={close} />
      <FreebieDialog freebie={overlay.kind === 'freebie' ? overlay.freebie : null} onClose={close} />
    </>
  )
}

/* Search */

const kindLabel = { digital: 'Digital download', physical: 'Ships to you', freebie: 'Freebie', tutorial: 'Tutorial', page: 'Page' } as const

function SearchDialog({ open, initial, onClose }: { open: boolean; initial: string; onClose: () => void }) {
  const [query, setQuery] = useState(initial)
  const input = useRef<HTMLInputElement>(null)
  const { products, tutorials } = useStore()
  const results = useMemo(() => search(query, products, tutorials), [query, products, tutorials])

  useEffect(() => {
    if (open) setQuery(initial)
  }, [open, initial])

  const go = (route: string) => {
    onClose()
    navigate(route)
  }

  return (
    <Dialog open={open} onClose={onClose} title="Search" initialFocus={input} className="search-dialog">
      <form
        className="search-field"
        role="search"
        onSubmit={(e) => {
          e.preventDefault()
          if (results[0]) go(results[0].route)
        }}
      >
        <Search aria-hidden="true" size={20} />
        <label htmlFor="site-search" className="visually-hidden">
          Search the shop
        </label>
        <input
          ref={input}
          id="site-search"
          type="search"
          autoComplete="off"
          placeholder={site.searchPlaceholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button type="button" className="search-field__clear" onClick={() => { setQuery(''); input.current?.focus() }}>
            Clear
          </button>
        )}
      </form>

      <div className="search-results" aria-live="polite">
        {query.trim() === '' ? (
          <div className="search-empty">
            <p>Try searching for</p>
            <div className="chip-row">
              {searchSuggestions.map((s) => (
                <button key={s} type="button" className="chip" onClick={() => { setQuery(s); input.current?.focus() }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : results.length === 0 ? (
          <div className="search-empty">
            <p className="search-empty__title">No matches for “{query.trim()}”</p>
            <p className="muted">Check the spelling, try a shorter word, or browse a collection.</p>
            <div className="chip-row">
              <a className="chip" href={href('shop')} onClick={onClose}>All digital resources</a>
              <a className="chip" href={href('extra-cute')} onClick={onClose}>Apparel & accessories</a>
              <a className="chip" href={href('freebie-corner')} onClick={onClose}>The Freebie Corner</a>
            </div>
          </div>
        ) : (
          <>
            <p className="search-results__count">
              {results.length} {results.length === 1 ? 'result' : 'results'}
            </p>
            <ul className="search-results__list">
              {results.map((r) => (
                <li key={r.id}>
                  <a className="search-result" href={href(r.route)} onClick={onClose}>
                    <span className={`search-result__kind search-result__kind--${r.kind}`}>{kindLabel[r.kind]}</span>
                    <span className="search-result__title">{r.title}</span>
                    <span className="search-result__detail">{r.detail}</span>
                    <ArrowRight className="arrow" aria-hidden="true" size={18} />
                  </a>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Dialog>
  )
}

/* Find your essentials */

type FinderStep = 'start' | 'nurse' | 'np' | 'cute'

function FinderDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState<FinderStep>('start')
  useEffect(() => {
    if (open) setStep('start')
  }, [open])

  const go = (route: string) => {
    onClose()
    navigate(route)
  }

  const choices: Record<Exclude<FinderStep, 'start'>, { title: string; intro: string; options: Array<{ label: string; detail: string; route: string }> }> = {
    nurse: {
      title: 'Your nursing journey',
      intro: 'Lovely. Where would you like to start?',
      options: [
        { label: 'Browse Nurse Binder Inserts', detail: 'Printable resources for your nursing journey.', route: 'nurse-binder-inserts' },
        { label: 'Try a free printable first', detail: 'Visit The Freebie Corner.', route: 'freebie-corner' },
      ],
    },
    np: {
      title: 'Your NP journey',
      intro: 'Wonderful. Where would you like to start?',
      options: [
        { label: 'Browse NP Binder Inserts', detail: 'Resources for your NP journey.', route: 'np-binder-inserts' },
        { label: 'Try a free printable first', detail: 'Visit The Freebie Corner.', route: 'freebie-corner' },
      ],
    },
    cute: {
      title: 'Apparel & cute accessories',
      intro: 'Fun! What are you shopping for?',
      options: [
        { label: 'Apparel', detail: 'Soft, comfy favorites for off-duty days.', route: 'apparel' },
        { label: 'Accessories', detail: 'Sweet little details for every day.', route: 'accessories' },
        { label: 'Pens', detail: 'Write your nursing story in style.', route: 'pens' },
        { label: 'Show me everything', detail: 'All physical favorites that ship to you.', route: 'extra-cute' },
      ],
    },
  }

  return (
    <Dialog open={open} onClose={onClose} title="Find your essentials" className="finder">
      {step === 'start' ? (
        <div className="finder__step" key="start">
          <p className="finder__intro">Welcome! Tell us a little about what you need and we will point you in the right direction.</p>
          <ul className="finder__options">
            <li>
              <button type="button" className="finder__option" onClick={() => setStep('nurse')}>
                <Stethoscope aria-hidden="true" />
                <span>
                  <strong>Resources for my nursing journey</strong>
                  <span>Nurse Binder Inserts and study pages</span>
                </span>
                <ArrowRight className="arrow" aria-hidden="true" size={18} />
              </button>
            </li>
            <li>
              <button type="button" className="finder__option" onClick={() => setStep('np')}>
                <GraduationCap aria-hidden="true" />
                <span>
                  <strong>Resources for my NP journey</strong>
                  <span>NP Binder Inserts</span>
                </span>
                <ArrowRight className="arrow" aria-hidden="true" size={18} />
              </button>
            </li>
            <li>
              <button type="button" className="finder__option" onClick={() => setStep('cute')}>
                <Shirt aria-hidden="true" />
                <span>
                  <strong>Apparel & cute accessories</strong>
                  <span>Shirts, earrings, pens and more</span>
                </span>
                <ArrowRight className="arrow" aria-hidden="true" size={18} />
              </button>
            </li>
          </ul>
        </div>
      ) : (
        <div className="finder__step" key={step}>
          <button type="button" className="finder__back" onClick={() => setStep('start')}>
            <ArrowLeft aria-hidden="true" size={18} />
            Back
          </button>
          <h3 className="finder__title">{choices[step].title}</h3>
          <p className="finder__intro">{choices[step].intro}</p>
          <ul className="finder__options">
            {choices[step].options.map((o) => (
              <li key={o.route}>
                <button type="button" className="finder__option" onClick={() => go(o.route)}>
                  <span>
                    <strong>{o.label}</strong>
                    <span>{o.detail}</span>
                  </span>
                  <ArrowRight className="arrow" aria-hidden="true" size={18} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Dialog>
  )
}

/* Bag */

function BagDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { lines, count, remove, setQuantity, clear, checkoutItems } = useCart()
  const { user } = useSession()
  const { payments, status } = useStore()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (open) setError('')
  }, [open])

  const subtotal = lines.reduce((n, l) => n + (displayPrice(l.product, l.variant).now ?? 0) * l.quantity, 0)
  const unpriced = lines.some((l) => displayPrice(l.product, l.variant).now === null)
  const paymentsReady = payments === 'test' || payments === 'live'
  const digitalLine = lines.find((l) => l.product.type === 'digital')
  const freebies = lines.filter((l) => l.product.isFreebie)
  const allFree = lines.length > 0 && freebies.length === lines.length
  const [joinList, setJoinList] = useState(false)
  const [listStatus, setListStatus] = useState<MarketingStatus | null>(null)
  useEffect(() => {
    if (!open || !user) return setListStatus(null)
    let alive = true
    api<MarketingStatus>('/api/account/marketing').then((s) => alive && setListStatus(s), () => alive && setListStatus(null))
    return () => {
      alive = false
    }
  }, [open, user])
  const subscribed = listStatus?.status === 'subscribed'
  const needsList = freebies.length > 0 && !subscribed && !joinList

  const checkout = async () => {
    setError('')
    if (!user) {
      onClose()
      navigate('sign-in')
      return
    }
    if (needsList) return
    setBusy(true)
    try {
      const res = await api<{ url?: string; free?: boolean; orderNumber: string }>('/api/checkout', { body: { items: checkoutItems, join_list: joinList } })
      if (res.free) {
        clear()
        onClose()
        navigate('checkout-success?free=1')
        setBusy(false)
        return
      }
      window.location.assign(res.url!)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }
  const removeFreebies = () => {
    for (const l of freebies) remove(l.key)
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Your bag"
      variant="drawer"
      footer={
        lines.length > 0 && (
          <div className="bag__footer">
            <div className="bag__total">
              <span>Subtotal</span>
              <span>{unpriced ? 'Pricing to be added' : formatPrice(subtotal)}</span>
            </div>
            <p className="bag__note">
              {allFree ? 'No payment or card details needed.' : 'Shipping and any sales tax are calculated at checkout. Prices are confirmed by the store when you check out.'}
            </p>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {user && status !== 'offline' && (
              <div className="bag__list-consent">
                {subscribed ? (
                  <p className="bag__note">
                    You’re on the Nurse Love Company email list{freebies.length ? ', so your free resource is ready to claim' : ''}. You can change this in your account settings.
                  </p>
                ) : (
                  <>
                    <label className="bag__consent">
                      <input type="checkbox" checked={joinList} onChange={(e) => setJoinList(e.target.checked)} />
                      <span>{freebies.length ? CONSENT_WORDING['freebie-v1'] : `Optional: ${CONSENT_WORDING['checkout-v1']}`}</span>
                    </label>
                    {listStatus?.status === 'unsubscribed' && <p className="bag__note">You unsubscribed earlier. Ticking the box signs you up again.</p>}
                    {needsList && (
                      <div className="bag__needs-list" role="status">
                        <p>Free resources are a thank you for joining our email list. To claim {freebies.length === 1 ? 'it' : 'them'}, tick the box above.</p>
                        <button type="button" className="button button--outline button--small" onClick={removeFreebies}>
                          {allFree ? 'Remove the free resource' : 'Remove the free resource and continue'}
                        </button>
                      </div>
                    )}
                  </>
                )}
                <p className="bag__note">
                  Your receipt, downloads and account emails go to {user.email} whether or not you join. Joining the list is separate from these.
                </p>
              </div>
            )}
            {status === 'offline' ? (
              <p className="bag__note">Checkout needs the store server, which is not connected in this preview.</p>
            ) : allFree ? (
              <button type="button" className="button" onClick={checkout} disabled={busy || (Boolean(user) && needsList)}>
                <ShoppingBag aria-hidden="true" size={18} />
                {busy ? 'Claiming...' : user ? 'Claim my free resource' : 'Sign in to claim'}
              </button>
            ) : !paymentsReady ? (
              <>
                <button type="button" className="button" disabled aria-describedby="bag-checkout-note">
                  Checkout not connected yet
                </button>
                <p id="bag-checkout-note" className="bag__note">
                  Payments are awaiting setup{payments === 'live-blocked' ? ' and launch approval' : ''}. Nothing will be charged and no payment details are collected.
                </p>
              </>
            ) : (
              <button type="button" className="button" onClick={checkout} disabled={busy || unpriced || (Boolean(user) && needsList)}>
                <ShoppingBag aria-hidden="true" size={18} />
                {busy ? 'Opening secure checkout...' : user ? 'Check out securely' : 'Sign in to check out'}
              </button>
            )}
            {paymentsReady && payments === 'test' && <p className="bag__note">Test mode: use a Stripe test card. No real money moves.</p>}
          </div>
        )
      }
    >
      {lines.length === 0 ? (
        <div className="bag__empty">
          <Heart className="bag__empty-heart" />
          <p className="bag__empty-title">Your bag is empty</p>
          <p className="muted">Find something you love and it will wait for you here.</p>
          <div className="chip-row">
            <a className="chip" href={href('shop')} onClick={onClose}>Digital resources</a>
            <a className="chip" href={href('extra-cute')} onClick={onClose}>Apparel & accessories</a>
          </div>
        </div>
      ) : (
        <>
          <p className="bag__count">
            {count} {count === 1 ? 'item' : 'items'}
          </p>
          <ul className="bag__list">
            {lines.map(({ key, product, variant, quantity }) => (
              <li key={key} className="bag-line">
                <a className="bag-line__media" href={href(`product-${product.slug}`)} onClick={onClose} tabIndex={-1} aria-hidden="true">
                  <ProductArt image={product.gallery[0]} />
                </a>
                <div className="bag-line__info">
                  <a className="bag-line__title" href={href(`product-${product.slug}`)} onClick={onClose}>
                    {product.title}
                  </a>
                  {variant && <span className="bag-line__type">{variant.title}</span>}
                  <span className="bag-line__type">{product.type === 'digital' ? 'Digital download • Binder not included' : 'Ships to you'}</span>
                  {product.isFreebie && <span className="bag-line__type">Free with email list signup</span>}
                  <span className="bag-line__price">
                    <Price product={product} variant={variant} />
                  </span>
                  <div className="bag-line__controls">
                    {product.type === 'physical' ? (
                      <div className="qty" role="group" aria-label={`Quantity for ${product.title}`}>
                        <button type="button" className="icon-button" aria-label="Decrease quantity" onClick={() => setQuantity(key, quantity - 1)}>
                          <Minus aria-hidden="true" size={16} />
                        </button>
                        <span className="qty__value" aria-live="polite">{quantity}</span>
                        <button type="button" className="icon-button" aria-label="Increase quantity" disabled={quantity >= 10} onClick={() => setQuantity(key, quantity + 1)}>
                          <Plus aria-hidden="true" size={16} />
                        </button>
                      </div>
                    ) : (
                      <span className="qty__fixed">Qty 1 • one download</span>
                    )}
                    <button type="button" className="bag-line__remove" onClick={() => remove(key)}>
                      <Trash2 aria-hidden="true" size={16} />
                      Remove<span className="visually-hidden"> {product.title}</span>
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {digitalLine && (
            <div className="bag__help">
              <TutorialHelpLink category={digitalLine.product.category} onNavigate={onClose} />
            </div>
          )}
          <button type="button" className="bag__clear" onClick={clear}>
            Empty bag
          </button>
        </>
      )}
    </Dialog>
  )
}

/** Variant picker for physical items with sizes or colors. */
export function VariantPicker({ product, value, onChange }: { product: Product; value: string | null; onChange: (id: string) => void }) {
  if (!product.variants?.length) return null
  return (
    <fieldset className="variant-picker">
      <legend>Choose an option</legend>
      <div className="chip-row">
        {product.variants.map((v) => (
          <button key={v.id} type="button" className="chip" aria-pressed={value === v.id} disabled={!v.inStock} onClick={() => onChange(v.id)}>
            {v.title}
            {!v.inStock && <span className="visually-hidden"> (sold out)</span>}
            {!v.inStock && <span aria-hidden="true"> • sold out</span>}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

/* Quick view for physical items */

function QuickView({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const addToBag = useAddToBag()
  const [added, setAdded] = useState(false)
  const [variantId, setVariantId] = useState<string | null>(null)
  useEffect(() => {
    setAdded(false)
    setVariantId(null)
  }, [product])
  const variant = product?.variants?.find((v) => v.id === variantId) ?? null
  const needsVariant = Boolean(product?.variants?.length) && !variant
  const soldOut = product?.inStock === false
  return (
    <Dialog open={Boolean(product)} onClose={onClose} title={product?.title ?? 'Quick view'} variant="wide">
      {product && (
        <div className="quick-view">
          <Gallery images={product.gallery} title={product.title} enlargeable={false} />
          <div className="quick-view__info">
            <ProductLabels product={product} />
            <p className="quick-view__category">{getCategory(product.category).title}</p>
            <p>{product.summary}</p>
            <p className="quick-view__price">
              <Price product={product} variant={variant} />
            </p>
            {product.variants?.length ? (
              <VariantPicker product={product} value={variantId} onChange={setVariantId} />
            ) : (
              <p className="muted quick-view__variants">Sizes, colors and options will be listed once confirmed.</p>
            )}
            <div className="quick-view__actions">
              <button
                type="button"
                className={`button ${added ? 'is-added' : ''}`}
                disabled={needsVariant || soldOut || displayPrice(product, variant).now === null}
                onClick={() => {
                  addToBag(product, variantId)
                  setAdded(true)
                }}
              >
                {added ? <Heart className="button__heart" /> : <ShoppingBag aria-hidden="true" size={18} />}
                {soldOut ? 'Sold out' : needsVariant ? 'Choose an option' : added ? 'Added to bag' : 'Add to bag'}
              </button>
              <a className="arrow-link" href={href(`product-${product.slug}`)} onClick={onClose}>
                Full details <ArrowRight className="arrow" aria-hidden="true" size={18} />
              </a>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  )
}

/* Peek inside for digital items */

function PeekDialog({ product, start, onClose }: { product: Product | null; start?: number; onClose: () => void }) {
  return (
    <Dialog open={Boolean(product)} onClose={onClose} title={product ? `Peek inside: ${product.title}` : 'Peek inside'} className="peek-dialog">
      {product && (
        <>
          <div className="peek-dialog__labels">
            <ProductLabels product={product} />
          </div>
          <PeekInside pages={product.samplePages} title={product.title} start={start} />
          <div className="peek-dialog__help">
            <TutorialHelpLink category={product.category} onNavigate={onClose} />
          </div>
          <a className="button button--outline button--small peek-dialog__details" href={href(`product-${product.slug}`)} onClick={onClose}>
            <BookOpen aria-hidden="true" size={18} />
            View product details
          </a>
        </>
      )}
    </Dialog>
  )
}

/* Freebie preview and demonstration download */

type DownloadState = 'idle' | 'working' | 'saved' | 'declined' | 'failed'

function FreebieDialog({ freebie, onClose }: { freebie: Freebie | null; onClose: () => void }) {
  const [state, setState] = useState<DownloadState>('idle')
  useEffect(() => setState('idle'), [freebie])

  const download = async () => {
    if (!freebie?.fileName) return
    setState('working')
    const outcome = await offerDownload(freebie.fileName, buildSamplePlannerPdf(), 'application/pdf')
    setState(outcome)
  }

  return (
    <Dialog open={Boolean(freebie)} onClose={onClose} title={freebie?.title ?? 'Free printable'} variant="wide">
      {freebie && (
        <div className="freebie-preview">
          <div className="freebie-preview__page">
            <SamplePageView page={freebie.page} className="freebie-preview__img" label={`Larger preview of the ${freebie.title}. Prototype sample.`} />
          </div>
          <div className="freebie-preview__info">
            <span className="label-row">
              <span className="label">
                <Download aria-hidden="true" />
                Free printable
              </span>
              <ExampleLabel />
            </span>
            <p>{freebie.summary}</p>
            <p className="freebie-preview__notice">
              Prototype sample. This is a general planner page made for the preview, not a finished Nurse Love Company resource. No email or sign up is needed.
            </p>
            {freebie.downloadable ? (
              <>
                <button type="button" className="button" onClick={download} disabled={state === 'working'} aria-describedby="freebie-format">
                  <Download aria-hidden="true" size={18} />
                  {state === 'working' ? 'Preparing your sample...' : 'Download sample PDF'}
                </button>
                <p id="freebie-format" className="muted freebie-preview__format">
                  One page PDF, letter size.
                </p>
              </>
            ) : (
              <button type="button" className="button" disabled>
                Preview only in this prototype
              </button>
            )}
            <div className="freebie-preview__status" role="status" aria-live="polite">
              {state === 'saved' && (
                <p className="download-done">
                  <Heart className="download-done__heart" strokeWidth={2.2} />
                  Your sample is on its way. Enjoy!
                </p>
              )}
              {state === 'declined' && <p className="muted">No problem. The download was cancelled.</p>}
              {state === 'failed' && <p className="muted">The download could not start here. Please try again in a regular browser window.</p>}
            </div>
          </div>
        </div>
      )}
    </Dialog>
  )
}
