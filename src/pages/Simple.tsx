import { ArrowRight, BookOpen, ExternalLink } from 'lucide-react'
import { freebies } from '../data/catalog'
import { site } from '../data/site'
import { ExampleLabel } from '../components/Labels'
import { TutorialHelpLink } from '../components/TutorialCard'
import { Heart } from '../components/illustrations/Objects'
import { SamplePageView } from '../components/SamplePageView'
import { href } from '../lib/router'
import { useUI } from '../lib/ui'
import { PageHeader } from './PageHeader'

export function Freebies() {
  const { open } = useUI()
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

export function Story() {
  return (
    <>
      <PageHeader title="Our Story" crumbs={[{ label: 'Home', route: 'home' }, { label: 'Our Story' }]} intro={<p className="page-header__tagline">{site.statement}</p>} />
      <section className="container story">
        <div className="story__card">
          <Heart className="story__heart" />
          <p>
            Nurse Love Company creates study resources, printable inserts and everyday favorites for nurses and nursing students, with a separate path for nurse practitioner students.
          </p>
          <p>
            Every digital resource is made to support your nursing life, and every physical favorite is chosen to add a little extra cute to your day.
          </p>
          <div className="story__placeholder">
            <p className="eyebrow">Placeholder</p>
            <p>This space is reserved for the founder's story, in the founder's own words. It will be added before launch.</p>
          </div>
          <div className="chip-row">
            <a className="button button--small" href={href('shop')}>
              Shop resources <ArrowRight className="arrow" aria-hidden="true" size={18} />
            </a>
            <a className="chip" href={href('freebie-corner')}>The Freebie Corner</a>
          </div>
        </div>
      </section>
    </>
  )
}

export function Help() {
  const faqs = [
    { q: 'What are binder inserts?', a: 'Printable pages you add to your own binder. Nurse Love Company sells the inserts only. A binder is not included.' },
    { q: 'Can I use resources digitally?', a: 'Each resource lists its own format and how it can be used. Check each resource for details.' },
    { q: 'Which items ship to me?', a: 'Apparel, accessories and pens are physical items that ship to you. Shipping details will be shared before launch.' },
    { q: 'How do I put my binder together?', a: 'Watch the free Tutorials. They show how to print, arrange and use your inserts. Physical binders are not included with digital purchases.' },
    { q: 'Can I buy on this preview?', a: 'Not yet. This preview shows how shopping will work. The bag is a demonstration and no purchase or payment takes place.' },
  ]
  return (
    <>
      <PageHeader title="Help & contact" crumbs={[{ label: 'Home', route: 'home' }, { label: 'Help & contact' }]} intro={<p>Quick answers while the new shop is being prepared.</p>} />
      <section className="container help">
        <div className="help__faqs">
          {faqs.map((f) => (
            <details key={f.q} className="faq">
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
        <aside className="help__contact">
          <h2 className="help__title">Getting started</h2>
          <TutorialHelpLink category="np-inserts" showTitle />
          <TutorialHelpLink category="nurse-inserts" showTitle />
          <h2 className="help__title">Contact</h2>
          <p>Contact details for the new site will be added before launch.</p>
          <p>
            In the meantime, visit the current Nurse Love Company website:
          </p>
          <a className="arrow-link" href={site.existingSite} target="_blank" rel="noopener noreferrer">
            nurselovecompany.com <ExternalLink aria-hidden="true" size={16} />
            <span className="visually-hidden"> (opens in a new tab)</span>
          </a>
        </aside>
      </section>
    </>
  )
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
