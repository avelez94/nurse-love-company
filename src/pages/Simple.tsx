import { BookOpen } from 'lucide-react'
import { freebies } from '../data/catalog'
import { site } from '../data/site'
import { ExampleLabel } from '../components/Labels'
import { SamplePageView } from '../components/SamplePageView'
import { href } from '../lib/router'
import { HelpLoading, HelpView } from '../components/HelpFaq'
import { usePublishedHelp } from '../lib/help'
import { useUI } from '../lib/ui'
import { useStore } from '../lib/store'
import { ProductCard } from '../components/ProductCard'
import { CONSENT_WORDING } from '../../shared/consent'
import { PageHeader } from './PageHeader'

/** The condition for every Freebie Corner resource, shown here and again in the bag before claiming. */
function FreebieConsentNote() {
  return (
    <p className="freebie-terms">
      <strong>How freebies work:</strong> {CONSENT_WORDING['freebie-v1']} You claim it through a short checkout with your account email; no payment or card details are needed.
    </p>
  )
}

export function Freebies() {
  const { open } = useUI()
  const { products, status } = useStore()
  const real = products.filter((p) => p.isFreebie)
  if (real.length) {
    return (
      <>
        <PageHeader
          title={site.freebie.heading}
          crumbs={[{ label: 'Home', route: 'home' }, { label: site.freebie.heading }]}
          intro={
            <>
              <p className="page-header__tagline">{site.freebie.tagline}</p>
              <p>{site.freebie.copy}</p>
              <FreebieConsentNote />
            </>
          }
        />
        <section className="container freebie-list" aria-label="Free resources">
          <div className="product-grid">
            {real.map((p, i) => (
              <ProductCard key={p.id} product={p} style={{ animationDelay: `${i * 50}ms` }} />
            ))}
          </div>
        </section>
      </>
    )
  }
  if (status === 'loading') return <div className="container page-loading" role="status">Loading...</div>
  return (
    <>
      <PageHeader
        title={site.freebie.heading}
        crumbs={[{ label: 'Home', route: 'home' }, { label: site.freebie.heading }]}
        intro={
          <>
            <p className="page-header__tagline">{site.freebie.tagline}</p>
            <p>{site.freebie.copy}</p>
            <p className="muted page-header__small">No email or sign up needed. Preview each printable before you download.</p>
          </>
        }
      />
      <section className="container freebie-list" aria-label="Free printables">
        <div className="product-grid">
          {freebies.map((f, i) => (
            <article key={f.id} className="product-card freebie-card" style={{ animationDelay: `${i * 50}ms` }}>
              <button type="button" className="freebie-card__media" onClick={() => open({ kind: 'freebie', freebie: f })} aria-label={`Preview ${f.title}`}>
                <SamplePageView page={f.page} className="freebie-card__page" label="" />
              </button>
              <div className="product-card__body">
                <span className="label-row">
                  <span className="label">Free printable</span>
                  <ExampleLabel />
                </span>
                <h2 className="product-card__title">{f.title}</h2>
                <p className="product-card__summary">{f.summary}</p>
                <div className="product-card__actions">
                  <button type="button" className="button button--small" onClick={() => open({ kind: 'freebie', freebie: f })}>
                    <BookOpen aria-hidden="true" size={18} />
                    {f.downloadable ? 'Preview & download' : 'Preview'}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </>
  )
}

export function Help() {
  const { loading, help } = usePublishedHelp()
  if (loading) return <HelpLoading />
  return <HelpView help={help} />
}

export function NotFound() {
  return (
    <>
      <PageHeader title="We couldn't find that page" intro={<p>The link may be old, or the page may have moved.</p>} />
      <section className="container story">
        <div className="chip-row">
          <a className="button button--small" href={href('home')}>Go to the homepage</a>
          <a className="chip" href={href('shop')}>Shop resources</a>
          <a className="chip" href={href('freebie-corner')}>The Freebie Corner</a>
        </div>
      </section>
    </>
  )
}
