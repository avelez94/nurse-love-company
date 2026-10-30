import { ArrowLeft, ArrowRight, BookOpen, Download, GraduationCap, Minus, Plus, Search, Shirt, ShoppingBag, Stethoscope, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getCategory } from '../data/catalog'
import { site } from '../data/site'
import type { Freebie, Product } from '../data/types'
import { useCart } from '../lib/cart'
import { offerDownload } from '../lib/download'
import { formatPrice } from '../lib/format'
import { href, navigate } from '../lib/router'
import { buildSamplePlannerPdf } from '../../shared/samplePdf'
import { search, searchSuggestions } from '../lib/search'
import { useUI } from '../lib/ui'
import { Dialog } from './Dialog'
import { Gallery } from './Gallery'
import { Heart } from './illustrations/Objects'
import { ExampleLabel, ProductLabels } from './Labels'
import { PeekInside } from './PeekInside'
import { ProductArt } from './ProductArt'
import { SamplePageView } from './SamplePageView'
import { TutorialHelpLink } from './TutorialCard'
import './Overlays.css'

/** Adds a sample item to the demo bag with a friendly confirmation. */
export function useAddToBag() {
  const { add } = useCart()
  const { showToast, open } = useUI()
  return (product: Product) => {
    add(product)
    showToast(`${product.title} is in your demo bag.`, { label: 'View bag', onClick: () => open({ kind: 'bag' }) })
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
  const results = useMemo(() => search(query), [query])

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

/* Demo bag */

function BagDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { lines, count, remove, setQuantity, clear } = useCart()
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Your demo bag"
      variant="drawer"
      footer={
        lines.length > 0 && (
          <div className="bag__footer">
            <div className="bag__total">
              <span>Total</span>
              <span>Pricing to be added</span>
            </div>
            <button type="button" className="button" disabled aria-describedby="bag-checkout-note">
              Checkout not connected
            </button>
            <p id="bag-checkout-note" className="bag__note">
              This is a demonstration bag. Nothing is purchased and no payment details are collected.
            </p>
          </div>
        )
      }
    >
      <p className="bag__demo">
        <ShoppingBag aria-hidden="true" size={18} />
        Demonstration only. Sample items stay in this browser.
      </p>
      {lines.length === 0 ? (
        <div className="bag__empty">
          <Heart className="bag__empty-heart" />
          <p className="bag__empty-title">Your demo bag is empty</p>
          <p className="muted">Add a sample item to see how the bag will work.</p>
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
            {lines.map(({ product, quantity }) => (
              <li key={product.id} className="bag-line">
                <a className="bag-line__media" href={href(`product-${product.slug}`)} onClick={onClose} tabIndex={-1} aria-hidden="true">
                  <ProductArt image={product.gallery[0]} />
                </a>
                <div className="bag-line__info">
                  <a className="bag-line__title" href={href(`product-${product.slug}`)} onClick={onClose}>
                    {product.title}
                  </a>
                  <span className="bag-line__type">{product.type === 'digital' ? 'Digital download • Binder not included' : 'Ships to you'}</span>
                  <span className="bag-line__price">{formatPrice(product.priceCents)}</span>
                  <div className="bag-line__controls">
                    {product.type === 'physical' ? (
                      <div className="qty" role="group" aria-label={`Quantity for ${product.title}`}>
                        <button type="button" className="icon-button" aria-label="Decrease quantity" onClick={() => setQuantity(product.id, quantity - 1)}>
                          <Minus aria-hidden="true" size={16} />
                        </button>
                        <span className="qty__value" aria-live="polite">{quantity}</span>
                        <button type="button" className="icon-button" aria-label="Increase quantity" disabled={quantity >= 10} onClick={() => setQuantity(product.id, quantity + 1)}>
                          <Plus aria-hidden="true" size={16} />
                        </button>
                      </div>
                    ) : (
                      <span className="qty__fixed">Qty 1</span>
                    )}
                    <button type="button" className="bag-line__remove" onClick={() => remove(product.id)}>
                      <Trash2 aria-hidden="true" size={16} />
                      Remove<span className="visually-hidden"> {product.title}</span>
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {(() => {
            const digital = lines.find((l) => l.product.type === 'digital')
            return digital ? (
              <div className="bag__help">
                <TutorialHelpLink category={digital.product.category} onNavigate={onClose} />
              </div>
            ) : null
          })()}
          <button type="button" className="bag__clear" onClick={clear}>
            Empty demo bag
          </button>
        </>
      )}
    </Dialog>
  )
}

/* Quick view for physical items */

function QuickView({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const addToBag = useAddToBag()
  const [added, setAdded] = useState(false)
  useEffect(() => setAdded(false), [product])
  return (
    <Dialog open={Boolean(product)} onClose={onClose} title={product?.title ?? 'Quick view'} variant="wide">
      {product && (
        <div className="quick-view">
          <Gallery images={product.gallery} title={product.title} enlargeable={false} />
          <div className="quick-view__info">
            <ProductLabels product={product} />
            <p className="quick-view__category">{getCategory(product.category).title}</p>
            <p>{product.summary}</p>
            <p className="quick-view__price">{formatPrice(product.priceCents)}</p>
            <p className="muted quick-view__variants">
              {product.variants ? 'Choose your options below.' : 'Sizes, colors and options will be listed once confirmed.'}
            </p>
            <div className="quick-view__actions">
              <button
                type="button"
                className={`button ${added ? 'is-added' : ''}`}
                onClick={() => {
                  addToBag(product)
                  setAdded(true)
                }}
              >
                {added ? <Heart className="button__heart" /> : <ShoppingBag aria-hidden="true" size={18} />}
                {added ? 'Added to demo bag' : 'Add to demo bag'}
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
